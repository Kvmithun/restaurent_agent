import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { FailedSession, Menu, Order, OrderAttempt, Restaurant, User, DeliveryPartner } from '../models/index.js';
import { isAllowedOrderTransition } from '../domain/orders/transitions.js';
import { redis } from '../infra/connections.js';

const requestSchema = z.object({ restaurantId: z.string().regex(/^[a-f\d]{24}$/i), sessionId: z.string().uuid().optional(), userAttemptNumber: z.number().int().positive().optional(), deliveryAddress: z.string().trim().min(5).max(500).optional(), items: z.array(z.object({ dishId: z.string().regex(/^[a-f\d]{24}$/i), quantity: z.number().int().positive().max(50) })).min(1).max(30) });

async function syncSessionWorkflow(order: any) {
  if (!order.sessionId) return;
  try {
    const key = `restaurant:session:${order.sessionId}`;
    const raw = await redis.get(key);
    if (!raw) return;
    const state = JSON.parse(raw);
    const workflow = {
      ...state.workflow,
      currentStage: order.status === 'DELIVERED' ? 'COMPLETED' : order.status === 'FAILED' ? 'FAILED' : order.status,
      orderStatus: order.status,
      restaurantStatus: order.restaurantStatus,
      cookingStatus: order.cookingStatus,
      deliveryStatus: order.deliveryStatus,
    };
    await redis.set(key, JSON.stringify({ ...state, orderId: order.id ?? order._id?.toString(), restaurantId: order.restaurantId?.toString(), deliveryPartnerId: order.deliveryPartnerId?.toString(), workflow, result: order.status === 'DELIVERED' ? 'COMPLETE' : 'INCOMPLETE', updatedAt: new Date().toISOString() }), 'EX', env.SESSION_TTL_SECONDS);
  } catch (error) {
    console.error(JSON.stringify({ event: 'session.workflow_sync_failed', sessionId: order.sessionId, message: error instanceof Error ? error.message : 'unknown' }));
  }
}

export async function createOrder(userId: string, input: unknown) {
  const data = requestSchema.parse(input);
  if (data.sessionId) {
    const existing = await Order.findOne({ sessionId: data.sessionId, userId });
    if (existing) return existing.toJSON();
  }
  const session = await mongoose.startSession();
  let result: unknown;
  try {
    await session.withTransaction(async () => {
      const restaurant = await Restaurant.findOne({ _id: data.restaurantId, status: 'ACTIVE', isVerified: true }).session(session);
      if (!restaurant) throw Object.assign(new Error('Restaurant is unavailable'), { status: 404, code: 'RESTAURANT_UNAVAILABLE' });
      const user = await User.findById(userId).session(session);
      if (!user) throw Object.assign(new Error('User not found'), { status: 404, code: 'USER_NOT_FOUND' });
      const menu = await Menu.findOne({ restaurantId: restaurant._id, published: true }).session(session);
      if (!menu) throw Object.assign(new Error('Restaurant menu is unavailable'), { status: 409, code: 'MENU_UNAVAILABLE' });
      const items = [];
      for (const requested of data.items) {
        const menuItem = menu.items.find((item: any) => item._id.toString() === requested.dishId && item.isAvailable);
        if (!menuItem) throw Object.assign(new Error('One or more items are unavailable'), { status: 409, code: 'ITEM_UNAVAILABLE' });
        const inventory = await Menu.updateOne({ _id: menu._id, items: { $elemMatch: { _id: menuItem._id, availableQuantity: { $gte: requested.quantity }, isAvailable: true } } }, { $inc: { 'items.$.availableQuantity': -requested.quantity } }, { session });
        if (inventory.modifiedCount !== 1) throw Object.assign(new Error(`${menuItem.name} does not have enough quantity`), { status: 409, code: 'INSUFFICIENT_QUANTITY' });
        items.push({ dishId: menuItem._id, dishName: menuItem.name, quantity: requested.quantity, price: menuItem.price });
      }
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const [order] = await Order.create([{ userId, restaurantId: restaurant._id, sessionId: data.sessionId, items, total, deliveryAddress: data.deliveryAddress ?? user.address }], { session });
      await OrderAttempt.create([{ orderId: order._id, sessionId: data.sessionId, attemptType: 'USER', attemptNumber: data.userAttemptNumber ?? 1, status: 'SUCCEEDED', reason: 'User confirmed order' }], { session });
      result = order.toJSON();
    });
    return result;
  } catch (error) {
    if (data.sessionId) {
      const detail = error as Error & { code?: string; status?: number };
      await OrderAttempt.create({ sessionId: data.sessionId, attemptType: 'USER', attemptNumber: data.userAttemptNumber ?? 1, status: 'FAILED', reason: (detail.code ?? detail.message ?? 'Order attempt failed').slice(0, 500) }).catch(() => undefined);
    }
    throw error;
  } finally { await session.endSession(); }
}

export async function listOrders(role: 'USER' | 'RESTAURANT' | 'DELIVERY_PARTNER', actorId: string) {
  const filter = role === 'USER' ? { userId: actorId } : role === 'RESTAURANT' ? { restaurantId: actorId } : { deliveryPartnerId: actorId };
  return Order.find(filter).sort({ createdAt: -1 })
    .populate('restaurantId', 'restaurantName address location')
    .populate('userId', 'name phone address location')
    .lean();
}

export async function transitionOrder(orderId: string, actorId: string, role: 'USER' | 'RESTAURANT' | 'DELIVERY_PARTNER', nextStatus: string, details: Record<string, unknown> = {}) {
  const order = await Order.findById(orderId);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404, code: 'ORDER_NOT_FOUND' });
  const owns = role === 'USER' ? order.userId.toString() === actorId : role === 'RESTAURANT' ? order.restaurantId.toString() === actorId : order.deliveryPartnerId?.toString() === actorId;
  if (!owns) throw Object.assign(new Error('Order not found'), { status: 404, code: 'ORDER_NOT_FOUND' });
  const roleAllowed = role === 'USER' ? nextStatus === 'CANCELLED' : role === 'RESTAURANT' ? ['RESTAURANT_ACCEPTED','RESTAURANT_REJECTED','PREPARING','READY_FOR_PICKUP'].includes(nextStatus) : ['DELIVERY_ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED'].includes(nextStatus);
  if (!roleAllowed) throw Object.assign(new Error('This role cannot perform that order action'), { status: 403, code: 'FORBIDDEN' });
  if (!isAllowedOrderTransition(order.status, nextStatus)) throw Object.assign(new Error(`Cannot move order from ${order.status} to ${nextStatus}`), { status: 409, code: 'INVALID_ORDER_TRANSITION' });

  if (nextStatus === 'RESTAURANT_ACCEPTED') {
    if (role !== 'RESTAURANT') throw Object.assign(new Error('Only the restaurant can accept an order'), { status: 403, code: 'FORBIDDEN' });
    const minutes = z.number().int().min(1).max(240).parse(details.estimatedPreparationMinutes);
    order.estimatedPreparationMinutes = minutes;
    order.estimatedReadyAt = new Date(Date.now() + minutes * 60_000);
    order.restaurantStatus = 'ACCEPTED';
  } else if (nextStatus === 'RESTAURANT_REJECTED') order.restaurantStatus = 'REJECTED';
  else if (nextStatus === 'PREPARING') order.cookingStatus = 'PREPARING';
  else if (nextStatus === 'READY_FOR_PICKUP') order.cookingStatus = 'READY';
  else if (nextStatus === 'DELIVERY_ACCEPTED' || nextStatus === 'PICKED_UP' || nextStatus === 'OUT_FOR_DELIVERY' || nextStatus === 'DELIVERED') {
    if (role !== 'DELIVERY_PARTNER') throw Object.assign(new Error('Only the assigned delivery partner can update delivery'), { status: 403, code: 'FORBIDDEN' });
    order.deliveryStatus = nextStatus;
    if (nextStatus === 'DELIVERED') order.cookingStatus = 'COMPLETE';
  }
  const currentStatus = order.status;
  const patch: Record<string, unknown> = { status: nextStatus, restaurantStatus: order.restaurantStatus, cookingStatus: order.cookingStatus, deliveryStatus: order.deliveryStatus };
  if (order.estimatedPreparationMinutes !== undefined) patch.estimatedPreparationMinutes = order.estimatedPreparationMinutes;
  if (order.estimatedReadyAt !== undefined) patch.estimatedReadyAt = order.estimatedReadyAt;
  const restoreInventory = nextStatus === 'RESTAURANT_REJECTED' || nextStatus === 'CANCELLED';
  let updated: any;
  if (restoreInventory) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        updated = await Order.findOneAndUpdate({ _id: order._id, status: currentStatus, inventoryRestored: false }, { $set: { ...patch, inventoryRestored: true } }, { new: true, session });
        if (!updated) throw Object.assign(new Error('Order changed during this action; refresh and try again'), { status: 409, code: 'ORDER_STATE_CONFLICT' });
        for (const item of order.items) await Menu.updateOne({ restaurantId: order.restaurantId, 'items._id': item.dishId }, { $inc: { 'items.$.availableQuantity': item.quantity } }, { session });
      });
    } finally { await session.endSession(); }
  } else {
    updated = await Order.findOneAndUpdate({ _id: order._id, status: currentStatus }, { $set: patch }, { new: true, runValidators: true });
  }
  if (!updated) throw Object.assign(new Error('Order changed during this action; refresh and try again'), { status: 409, code: 'ORDER_STATE_CONFLICT' });
  if (nextStatus === 'DELIVERED') {
    if (updated.deliveryPartnerId) await DeliveryPartner.updateOne({ _id: updated.deliveryPartnerId }, { $set: { isAvailable: true } });
  }
  await syncSessionWorkflow(updated);
  return updated.toJSON();
}

export async function assignDelivery(orderId: string) {
  const order = await Order.findOne({ _id: orderId, status: 'READY_FOR_PICKUP' });
  if (!order) throw Object.assign(new Error('Order is not ready for delivery assignment'), { status: 409, code: 'ORDER_NOT_READY' });
  const partner = await DeliveryPartner.findOneAndUpdate({ isAvailable: true, status: 'ACTIVE' }, { isAvailable: false }, { new: true, sort: { createdAt: 1 } });
  if (!partner) throw Object.assign(new Error('No delivery partner is currently available'), { status: 409, code: 'NO_DELIVERY_PARTNER' });
  const updated = await Order.findOneAndUpdate({ _id: order._id, status: 'READY_FOR_PICKUP' }, { $set: { deliveryPartnerId: partner._id as Types.ObjectId, deliveryStatus: 'ASSIGNED', status: 'DELIVERY_ASSIGNED' } }, { new: true });
  if (!updated) {
    await DeliveryPartner.updateOne({ _id: partner._id }, { $set: { isAvailable: true } });
    throw Object.assign(new Error('Order was assigned by another request'), { status: 409, code: 'ORDER_STATE_CONFLICT' });
  }
  return updated.toJSON();
}

export async function reportFailure(orderId: string, actorId: string, role: 'RESTAURANT' | 'DELIVERY_PARTNER', reason: string) {
  const order = await Order.findById(orderId);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404, code: 'ORDER_NOT_FOUND' });
  const field = role === 'RESTAURANT' ? 'cooking' : 'delivery';
  const owns = role === 'RESTAURANT' ? order.restaurantId.toString() === actorId : order.deliveryPartnerId?.toString() === actorId;
  if (!owns) throw Object.assign(new Error('Order not found'), { status: 404, code: 'ORDER_NOT_FOUND' });
  if (role === 'RESTAURANT' && !['RESTAURANT_ACCEPTED', 'PREPARING'].includes(order.status)) throw Object.assign(new Error('Cooking failure cannot be reported at this stage'), { status: 409, code: 'INVALID_ORDER_STAGE' });
  if (role === 'DELIVERY_PARTNER' && order.status !== 'OUT_FOR_DELIVERY') throw Object.assign(new Error('Delivery failure cannot be reported at this stage'), { status: 409, code: 'INVALID_ORDER_STAGE' });
  const currentStatus = order.status;
  const attemptNumber = order.retry[field] + 1;
  const max = field === 'cooking' ? env.MAX_COOK_RETRIES : env.MAX_DELIVERY_RETRIES;
  const exhausted = attemptNumber > max;
  const nextStatus = exhausted ? 'FAILED' : field === 'cooking' ? 'RESTAURANT_ACCEPTED' : 'DELIVERY_ASSIGNED';
  const session = await mongoose.startSession();
  let updated: any;
  try {
    await session.withTransaction(async () => {
      updated = await Order.findOneAndUpdate({ _id: order._id, status: currentStatus, [`retry.${field}`]: attemptNumber - 1 }, { $set: { status: nextStatus, [`retry.${field}`]: attemptNumber, ...(field === 'cooking' ? { cookingStatus: exhausted ? 'FAILED' : 'RETRYING' } : { deliveryStatus: exhausted ? 'FAILED' : 'RETRYING' }), ...(exhausted && field === 'cooking' && !order.inventoryRestored ? { inventoryRestored: true } : {}) } }, { new: true, session });
      if (!updated) throw Object.assign(new Error('Order changed during this action; refresh and try again'), { status: 409, code: 'ORDER_STATE_CONFLICT' });
      await OrderAttempt.create([{ orderId, attemptType: field.toUpperCase(), attemptNumber, status: 'FAILED', reason: reason.slice(0, 500) }], { session });
      if (exhausted && order.sessionId) await FailedSession.updateOne({ sessionId: order.sessionId }, { $set: { userId: order.userId, restaurantId: order.restaurantId, deliveryPartnerId: order.deliveryPartnerId, orderId: order._id, failureStage: field.toUpperCase(), failureReason: reason.slice(0, 500), retryCounts: { user: order.retry.user, cooking: field === 'cooking' ? attemptNumber : order.retry.cooking, delivery: field === 'delivery' ? attemptNumber : order.retry.delivery } } }, { upsert: true, session });
      if (exhausted && field === 'cooking' && !order.inventoryRestored) for (const item of order.items) await Menu.updateOne({ restaurantId: order.restaurantId, 'items._id': item.dishId }, { $inc: { 'items.$.availableQuantity': item.quantity } }, { session });
    });
  } finally { await session.endSession(); }
  if (!updated) throw Object.assign(new Error('Order changed during this action; refresh and try again'), { status: 409, code: 'ORDER_STATE_CONFLICT' });
  if (exhausted && field === 'delivery' && updated.deliveryPartnerId) await DeliveryPartner.updateOne({ _id: updated.deliveryPartnerId }, { $set: { isAvailable: true } });
  await syncSessionWorkflow(updated);
  return { order: updated.toJSON(), exhausted };
}
