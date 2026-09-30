import { Router } from 'express';
import { z } from 'zod';
import { authenticateJWT, requireRole, type AuthRequest } from '../middleware/auth.js';
import { DeliveryPartner, Menu, Order, Restaurant } from '../models/index.js';
import { assignDelivery, createOrder, listOrders, reportFailure, transitionOrder } from '../services/orders.js';

export const platformRouter = Router();
const idParam = z.string().regex(/^[a-f\d]{24}$/i);
const asyncRoute = (fn: (request: AuthRequest, response: any) => Promise<unknown>) => (request: AuthRequest, response: any, next: any) => Promise.resolve(fn(request, response)).catch(next);
platformRouter.use(authenticateJWT);

platformRouter.get('/restaurants', requireRole('USER'), asyncRoute(async (request, response) => {
  const lat = Number(request.query.lat), lon = Number(request.query.lon);
  const filter: Record<string, unknown> = { status: 'ACTIVE', isVerified: true };
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) filter.location = { $near: { $geometry: { type: 'Point', coordinates: [lon, lat] }, $maxDistance: 30_000 } };
  response.json(await Restaurant.find(filter).select('restaurantName address location status').limit(100).lean());
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

platformRouter.patch('/delivery/location', requireRole('DELIVERY_PARTNER'), asyncRoute(async (request, response) => {
  const location = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).parse(request.body);
  const partner = await DeliveryPartner.findOneAndUpdate({ _id: request.auth!.subject }, { $set: { currentLocation: { type: 'Point', coordinates: [location.longitude, location.latitude] } } }, { new: true }).select('currentLocation');
  if (!partner) return response.status(404).json({ error: { code: 'PARTNER_NOT_FOUND', message: 'Delivery partner not found' } });
  response.json(partner);
}));

platformRouter.put('/restaurant/menu', requireRole('RESTAURANT'), asyncRoute(async (request, response) => {
  const items = z.array(z.object({ name: z.string().min(1).max(120), description: z.string().max(500).optional(), category: z.string().min(1).max(80), price: z.number().nonnegative(), availableQuantity: z.number().int().nonnegative(), isAvailable: z.boolean().optional() })).max(300).parse(request.body.items);
  const menu = await Menu.findOneAndUpdate({ restaurantId: request.auth!.subject }, { $set: { items, published: request.body.published === true } }, { upsert: true, new: true, runValidators: true });
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
