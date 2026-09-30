import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import multer from 'multer';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { authenticateJWT, requireRole, type AuthRequest } from '../middleware/auth.js';
import { AccountDocument, DeliveryPartner, Menu, MenuImport, Order, OrderAttempt, Restaurant, User } from '../models/index.js';
import { assignDelivery, createOrder, listOrders, reportFailure, transitionOrder } from '../services/orders.js';
import { createMenuImport, reviewFssaiDocument, saveAccountDocument } from '../services/documents.js';
import { env } from '../config/env.js';
import { geocodeAddress, pointFromCoordinates, roadRoute, straightLineMeters } from '../services/geo.js';

export const platformRouter = Router();
const idParam = z.string().regex(/^[a-f\d]{24}$/i);
const asyncRoute = (fn: (request: AuthRequest, response: any) => Promise<unknown>) => (request: AuthRequest, response: any, next: any) => Promise.resolve(fn(request, response)).catch(next);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const uploadLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
platformRouter.use(authenticateJWT);

platformRouter.get('/account/profile', asyncRoute(async (request, response) => {
  const Model = request.auth!.role === 'USER' ? User : request.auth!.role === 'RESTAURANT' ? Restaurant : DeliveryPartner;
  const account = await Model.findById(request.auth!.subject).select('-passwordHash').lean();
  if (!account) return response.status(404).json({ error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found' } });
  response.json({ ...account, role: request.auth!.role });
}));

platformRouter.get('/documents', requireRole('RESTAURANT', 'DELIVERY_PARTNER'), asyncRoute(async (request, response) => {
  response.json(await AccountDocument.find({ ownerId: request.auth!.subject, ownerRole: request.auth!.role }).select('category originalName contentType createdAt aiReview').sort({ createdAt: -1 }).lean());
}));

async function runFssaiReview(ownerId: string, document: any, buffer: Buffer) {
  const restaurant: any = await Restaurant.findById(ownerId).select('restaurantName fssaiNumber').lean();
  if (!restaurant) throw Object.assign(new Error('Restaurant account not found'), { status: 404, code: 'RESTAURANT_NOT_FOUND' });
  let aiReview: any;
  try {
    aiReview = await reviewFssaiDocument({ buffer, mimeType: document.contentType, restaurantName: restaurant.restaurantName, expectedLicenseNumber: restaurant.fssaiNumber });
  } catch {
    aiReview = { status: 'REVIEW_FAILED', findings: ['AI screening could not complete. Retry the review or ask an operator to inspect the file.'], reviewedAt: new Date() };
  }
  await AccountDocument.updateOne({ _id: document._id, ownerId, category: 'FSSAI' }, { $set: { aiReview } });
  await Restaurant.updateOne({ _id: ownerId }, { $set: { fssaiDocument: document._id } });
  return aiReview;
}

async function requireMenuDraftAccess(restaurantId: string) {
  const restaurant: any = await Restaurant.findById(restaurantId).select('status').lean();
  if (!restaurant || restaurant.status === 'SUSPENDED') throw Object.assign(new Error('Restaurant account cannot manage a menu'), { status: 403, code: 'RESTAURANT_NOT_ACTIVE' });
  if (restaurant.status === 'ACTIVE') return;
  const reviewed = await AccountDocument.exists({ ownerId: restaurantId, ownerRole: 'RESTAURANT', category: 'FSSAI', 'aiReview.status': 'READY_FOR_MENU' });
  if (!reviewed) throw Object.assign(new Error('Upload an FSSAI document and complete AI screening before creating a menu draft'), { status: 403, code: 'FSSAI_REVIEW_REQUIRED' });
}

async function requireActiveRestaurant(restaurantId: string) {
  const restaurant = await Restaurant.exists({ _id: restaurantId, status: 'ACTIVE', isVerified: true });
  if (!restaurant) throw Object.assign(new Error('An operator must approve the restaurant before publishing its menu'), { status: 403, code: 'RESTAURANT_NOT_ACTIVE' });
}

platformRouter.post('/documents', requireRole('RESTAURANT', 'DELIVERY_PARTNER'), uploadLimiter, upload.single('file'), asyncRoute(async (request, response) => {
  if (!request.file) return response.status(400).json({ error: { code: 'FILE_REQUIRED', message: 'Choose a document to upload' } });
  const category = z.enum(['FSSAI', 'DRIVING_LICENCE', 'VEHICLE_PHOTO']).parse(request.body.category);
  if (request.auth!.role === 'RESTAURANT' && category !== 'FSSAI' || request.auth!.role === 'DELIVERY_PARTNER' && category === 'FSSAI') return response.status(400).json({ error: { code: 'INVALID_DOCUMENT_CATEGORY', message: 'Document category does not match this account type' } });
  const document = await saveAccountDocument({ ownerId: request.auth!.subject, ownerRole: request.auth!.role as 'RESTAURANT' | 'DELIVERY_PARTNER', category, originalName: request.file.originalname, mimeType: request.file.mimetype, buffer: request.file.buffer });
  const aiReview = category === 'FSSAI' ? await runFssaiReview(request.auth!.subject, document, request.file.buffer) : undefined;
  if (category === 'DRIVING_LICENCE') await DeliveryPartner.updateOne({ _id: request.auth!.subject }, { $set: { drivingLicenceDocument: document.id } });
  if (category === 'VEHICLE_PHOTO') await DeliveryPartner.updateOne({ _id: request.auth!.subject }, { $set: { vehiclePhoto: document.id } });
  response.status(201).json({ id: document.id, category: document.category, originalName: document.originalName, contentType: document.contentType, createdAt: document.createdAt, ...(aiReview ? { aiReview } : {}) });
}));

platformRouter.post('/documents/:documentId/review', requireRole('RESTAURANT'), uploadLimiter, asyncRoute(async (request, response) => {
  const id = idParam.parse(request.params.documentId);
  const document: any = await AccountDocument.findOne({ _id: id, ownerId: request.auth!.subject, ownerRole: 'RESTAURANT', category: 'FSSAI' }).lean();
  if (!document) return response.status(404).json({ error: { code: 'FSSAI_DOCUMENT_NOT_FOUND', message: 'FSSAI document not found' } });
  const buffer = await readFile(path.join(env.UPLOAD_DIRECTORY, document.storageName));
  const aiReview = await runFssaiReview(request.auth!.subject, document, buffer);
  response.json({ id: document._id, aiReview });
}));

platformRouter.get('/documents/:documentId/file', requireRole('RESTAURANT', 'DELIVERY_PARTNER'), asyncRoute(async (request, response) => {
  const id = idParam.parse(request.params.documentId);
  const document: any = await AccountDocument.findOne({ _id: id, ownerId: request.auth!.subject, ownerRole: request.auth!.role }).lean();
  if (!document) return response.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' } });
  response.setHeader('Content-Type', document.contentType);
  response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(document.originalName)}"`);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  createReadStream(path.join(env.UPLOAD_DIRECTORY, document.storageName)).pipe(response);
}));

platformRouter.get('/restaurants', requireRole('USER'), asyncRoute(async (request, response) => {
  const user: any = await User.findById(request.auth!.subject).select('address location').lean();
  let origin = pointFromCoordinates(user?.location);
  if (!origin && user?.address) {
    origin = (await geocodeAddress(user.address))?.point ?? null;
    if (origin) await User.updateOne({ _id: request.auth!.subject }, { $set: { location: origin } });
  }
  const restaurants: any[] = await Restaurant.find({ status: 'ACTIVE', isVerified: true }).select('restaurantName address location status').limit(100).lean();
  for (const restaurant of restaurants.filter((entry) => !pointFromCoordinates(entry.location)).slice(0, 10)) {
    void geocodeAddress(restaurant.address, restaurant.restaurantName).then((match) => match?.point && Restaurant.updateOne({ _id: restaurant._id }, { $set: { location: match.point } })).catch(() => undefined);
  }
  if (!origin) return response.json(restaurants);
  const candidates = restaurants.map((restaurant) => ({ restaurant, point: pointFromCoordinates(restaurant.location) }))
    .sort((left, right) => (left.point ? straightLineMeters(origin!, left.point) : Number.POSITIVE_INFINITY) - (right.point ? straightLineMeters(origin!, right.point) : Number.POSITIVE_INFINITY));
  const nearest = candidates.slice(0, 20);
  const result = await Promise.all(nearest.map(async ({ restaurant, point }) => {
    if (!point) return { ...restaurant, distanceMeters: null, distanceSeconds: null };
    const route = await roadRoute(origin!, point);
    return { ...restaurant, distanceMeters: route?.distanceMeters ?? straightLineMeters(origin!, point), distanceSeconds: route?.durationSeconds ?? null };
  }));
  result.sort((a, b) => (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY));
  response.json([...result, ...candidates.slice(20).map(({ restaurant }) => ({ ...restaurant, distanceMeters: null, distanceSeconds: null }))]);
}));

platformRouter.get('/restaurants/:restaurantId/menu', requireRole('USER'), asyncRoute(async (request, response) => {
  const id = idParam.parse(request.params.restaurantId);
  const menu = await Menu.findOne({ restaurantId: id, published: true }).lean();
  if (!menu) return response.status(404).json({ error: { code: 'MENU_NOT_FOUND', message: 'Menu not found' } });
  response.json(menu);
}));

platformRouter.patch('/delivery/availability', requireRole('DELIVERY_PARTNER'), asyncRoute(async (request, response) => {
  const available = z.boolean().parse(request.body.available);
  const partner = await DeliveryPartner.findOneAndUpdate({ _id: request.auth!.subject, status: 'ACTIVE' }, { $set: { isAvailable: available } }, { new: true }).select('isAvailable status');
  if (!partner) return response.status(403).json({ error: { code: 'PARTNER_NOT_ACTIVE', message: 'Delivery account is not active' } });
  response.json(partner);
}));

platformRouter.get('/delivery/availability', requireRole('DELIVERY_PARTNER'), asyncRoute(async (request, response) => {
  const partner = await DeliveryPartner.findById(request.auth!.subject).select('isAvailable status').lean();
  if (!partner) return response.status(404).json({ error: { code: 'PARTNER_NOT_FOUND', message: 'Delivery partner not found' } });
  response.json(partner);
}));

platformRouter.patch('/delivery/location', requireRole('DELIVERY_PARTNER'), asyncRoute(async (request, response) => {
  const location = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).parse(request.body);
  const partner = await DeliveryPartner.findOneAndUpdate({ _id: request.auth!.subject }, { $set: { currentLocation: { type: 'Point', coordinates: [location.longitude, location.latitude] } } }, { new: true }).select('currentLocation');
  if (!partner) return response.status(404).json({ error: { code: 'PARTNER_NOT_FOUND', message: 'Delivery partner not found' } });
  response.json(partner);
}));

platformRouter.put('/restaurant/menu', requireRole('RESTAURANT'), asyncRoute(async (request, response) => {
  await requireActiveRestaurant(request.auth!.subject);
  const items = z.array(z.object({ name: z.string().min(1).max(120), description: z.string().max(500).optional(), category: z.string().min(1).max(80), price: z.number().nonnegative(), availableQuantity: z.number().int().nonnegative(), isAvailable: z.boolean().optional() })).max(300).parse(request.body.items);
  const menu = await Menu.findOneAndUpdate({ restaurantId: request.auth!.subject }, { $set: { items, published: request.body.published === true } }, { upsert: true, new: true, runValidators: true });
  response.json(menu);
}));

platformRouter.get('/restaurant/menu/own', requireRole('RESTAURANT'), asyncRoute(async (request, response) => {
  const menu = await Menu.findOne({ restaurantId: request.auth!.subject }).lean();
  response.json(menu ?? { items: [], published: false });
}));

platformRouter.post('/restaurant/menu/import', requireRole('RESTAURANT'), uploadLimiter, upload.single('file'), asyncRoute(async (request, response) => {
  if (!request.file) return response.status(400).json({ error: { code: 'FILE_REQUIRED', message: 'Choose a menu file to import' } });
  await requireMenuDraftAccess(request.auth!.subject);
  const draft = await createMenuImport({ restaurantId: request.auth!.subject, file: request.file });
  response.status(201).json(draft);
}));

platformRouter.get('/restaurant/menu/imports', requireRole('RESTAURANT'), asyncRoute(async (request, response) => {
  response.json(await MenuImport.find({ restaurantId: request.auth!.subject }).sort({ createdAt: -1 }).lean());
}));

platformRouter.patch('/restaurant/menu/imports/:importId', requireRole('RESTAURANT'), asyncRoute(async (request, response) => {
  await requireMenuDraftAccess(request.auth!.subject);
  const id = idParam.parse(request.params.importId);
  const items = z.array(z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), category: z.string().trim().min(1).max(80), price: z.number().nonnegative(), availableQuantity: z.number().int().nonnegative(), isAvailable: z.boolean().optional() })).min(1).max(300).parse(request.body.items);
  const draft = await MenuImport.findOneAndUpdate({ _id: id, restaurantId: request.auth!.subject, status: 'DRAFT' }, { $set: { items } }, { new: true, runValidators: true });
  if (!draft) return response.status(404).json({ error: { code: 'MENU_IMPORT_NOT_FOUND', message: 'Draft menu import not found' } });
  response.json(draft);
}));

platformRouter.post('/restaurant/menu/imports/:importId/publish', requireRole('RESTAURANT'), asyncRoute(async (request, response) => {
  await requireActiveRestaurant(request.auth!.subject);
  const id = idParam.parse(request.params.importId);
  const draft = await MenuImport.findOne({ _id: id, restaurantId: request.auth!.subject, status: 'DRAFT' });
  if (!draft) return response.status(404).json({ error: { code: 'MENU_IMPORT_NOT_FOUND', message: 'Draft menu import not found' } });
  const items = z.array(z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), category: z.string().trim().min(1).max(80), price: z.number().finite().nonnegative(), availableQuantity: z.number().int().nonnegative(), isAvailable: z.boolean().optional() })).min(1).max(300).parse(draft.items.map((item: any) => item.toObject()));
  const menu = await Menu.findOneAndUpdate({ restaurantId: request.auth!.subject }, { $set: { items, published: true } }, { upsert: true, new: true, runValidators: true });
  draft.status = 'PUBLISHED';
  await draft.save();
  response.json(menu);
}));

platformRouter.post('/orders', requireRole('USER'), asyncRoute(async (request, response) => response.status(201).json(await createOrder(request.auth!.subject, request.body))));
platformRouter.get('/orders', requireRole('USER', 'RESTAURANT', 'DELIVERY_PARTNER'), asyncRoute(async (request, response) => response.json(await listOrders(request.auth!.role, request.auth!.subject))));
platformRouter.get('/orders/:orderId', requireRole('USER', 'RESTAURANT', 'DELIVERY_PARTNER'), asyncRoute(async (request, response) => {
  const orderId = idParam.parse(request.params.orderId);
  const role = request.auth!.role, actorId = request.auth!.subject;
  const filter = role === 'USER' ? { _id: orderId, userId: actorId } : role === 'RESTAURANT' ? { _id: orderId, restaurantId: actorId } : { _id: orderId, deliveryPartnerId: actorId };
  const order = await Order.findOne(filter).lean();
  if (!order) return response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' } });
  response.json(order);
}));

platformRouter.get('/orders/:orderId/attempts', requireRole('USER', 'RESTAURANT', 'DELIVERY_PARTNER'), asyncRoute(async (request, response) => {
  const orderId = idParam.parse(request.params.orderId);
  const role = request.auth!.role, actorId = request.auth!.subject;
  const filter = role === 'USER' ? { _id: orderId, userId: actorId } : role === 'RESTAURANT' ? { _id: orderId, restaurantId: actorId } : { _id: orderId, deliveryPartnerId: actorId };
  const order: any = await Order.findOne(filter).select('_id sessionId').lean();
  if (!order) return response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' } });
  response.json(await OrderAttempt.find({ $or: [{ orderId }, ...(order.sessionId ? [{ sessionId: order.sessionId }] : [])] }).sort({ createdAt: 1 }).lean());
}));

platformRouter.post('/orders/:orderId/transition', requireRole('USER', 'RESTAURANT', 'DELIVERY_PARTNER'), asyncRoute(async (request, response) => {
  const orderId = idParam.parse(request.params.orderId);
  const body = z.object({ status: z.enum(['RESTAURANT_ACCEPTED','RESTAURANT_REJECTED','PREPARING','READY_FOR_PICKUP','DELIVERY_ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','CANCELLED']), estimatedPreparationMinutes: z.number().optional() }).parse(request.body);
  response.json(await transitionOrder(orderId, request.auth!.subject, request.auth!.role, body.status, body));
}));

platformRouter.post('/orders/:orderId/assign-delivery', requireRole('RESTAURANT'), asyncRoute(async (request, response) => {
  const orderId = idParam.parse(request.params.orderId);
  const order = await Order.findOne({ _id: orderId, restaurantId: request.auth!.subject });
  if (!order) return response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' } });
  response.json(await assignDelivery(orderId));
}));

platformRouter.post('/orders/:orderId/failures', requireRole('RESTAURANT', 'DELIVERY_PARTNER'), asyncRoute(async (request, response) => {
  const orderId = idParam.parse(request.params.orderId);
  const body = z.object({ reason: z.string().min(1).max(500) }).parse(request.body);
  response.json(await reportFailure(orderId, request.auth!.subject, request.auth!.role as 'RESTAURANT' | 'DELIVERY_PARTNER', body.reason));
}));
