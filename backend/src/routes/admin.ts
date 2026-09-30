import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AccountDocument, DeliveryPartner, Restaurant } from '../models/index.js';

export const adminRouter = Router();

function authorize(request: import('express').Request, response: import('express').Response, next: import('express').NextFunction) {
  const expected = env.ADMIN_REVIEW_TOKEN;
  const supplied = request.header('x-admin-review-token') ?? '';
  const expectedBytes = Buffer.from(expected), suppliedBytes = Buffer.from(supplied);
  if (!expected || expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return response.status(401).json({ error: { code: 'ADMIN_UNAUTHORIZED', message: 'Valid review credentials are required' } });
  }
  return next();
}

adminRouter.use(rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), authorize);
adminRouter.post('/restaurants/:id/activate', async (request, response, next) => {
  try {
    const id = z.string().regex(/^[a-f\d]{24}$/i).parse(request.params.id);
    const account = await Restaurant.findOneAndUpdate({ _id: id, status: 'PENDING' }, { $set: { status: 'ACTIVE', isVerified: true } }, { new: true }).select('-passwordHash');
    if (!account) return response.status(404).json({ error: { code: 'PENDING_ACCOUNT_NOT_FOUND', message: 'Pending restaurant account not found' } });
    return response.json(account);
  } catch (error) { return next(error); }
});

adminRouter.post('/delivery-partners/:id/activate', async (request, response, next) => {
  try {
    const id = z.string().regex(/^[a-f\d]{24}$/i).parse(request.params.id);
    const account = await DeliveryPartner.findOneAndUpdate({ _id: id, status: 'PENDING' }, { $set: { status: 'ACTIVE' } }, { new: true }).select('-passwordHash');
    if (!account) return response.status(404).json({ error: { code: 'PENDING_ACCOUNT_NOT_FOUND', message: 'Pending delivery partner account not found' } });
    return response.json(account);
  } catch (error) { return next(error); }
});

adminRouter.post('/restaurants/:id/reject', async (request, response, next) => {
  try {
    const id = z.string().regex(/^[a-f\d]{24}$/i).parse(request.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body);
    const account = await Restaurant.findOneAndUpdate({ _id: id, status: 'PENDING' }, { $set: { status: 'SUSPENDED', isVerified: false, reviewReason: reason, reviewedAt: new Date() } }, { new: true }).select('-passwordHash');
    if (!account) return response.status(404).json({ error: { code: 'PENDING_ACCOUNT_NOT_FOUND', message: 'Pending restaurant account not found' } });
    return response.json(account);
  } catch (error) { return next(error); }
});

adminRouter.post('/delivery-partners/:id/reject', async (request, response, next) => {
  try {
    const id = z.string().regex(/^[a-f\d]{24}$/i).parse(request.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body);
    const account = await DeliveryPartner.findOneAndUpdate({ _id: id, status: 'PENDING' }, { $set: { status: 'SUSPENDED', reviewReason: reason, reviewedAt: new Date() } }, { new: true }).select('-passwordHash');
    if (!account) return response.status(404).json({ error: { code: 'PENDING_ACCOUNT_NOT_FOUND', message: 'Pending delivery partner account not found' } });
    return response.json(account);
  } catch (error) { return next(error); }
});

adminRouter.get('/pending', async (_request, response, next) => {
  try {
    const [restaurants, deliveryPartners] = await Promise.all([
      Restaurant.find({ status: 'PENDING' }).select('-passwordHash').lean(),
      DeliveryPartner.find({ status: 'PENDING' }).select('-passwordHash').lean(),
    ]);
    const owners = [...restaurants.map((account) => account._id), ...deliveryPartners.map((account) => account._id)];
    const documents = await AccountDocument.find({ ownerId: { $in: owners } }).select('ownerId category originalName contentType createdAt aiReview').sort({ createdAt: -1 }).lean();
    return response.json({ restaurants, deliveryPartners, documents });
  } catch (error) { return next(error); }
});

adminRouter.get('/documents/:id/file', async (request, response, next) => {
  try {
    const id = z.string().regex(/^[a-f\d]{24}$/i).parse(request.params.id);
    const document: any = await AccountDocument.findById(id).lean();
    if (!document) return response.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' } });
    response.setHeader('Content-Type', document.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(document.originalName)}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return createReadStream(path.join(env.UPLOAD_DIRECTORY, document.storageName)).pipe(response);
  } catch (error) { return next(error); }
});
