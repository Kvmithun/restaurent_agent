import { Router } from 'express';
import { z } from 'zod';
import { authenticateJWT, requireRole, type AuthRequest } from '../middleware/auth.js';
import { orderingGraph } from '../domain/ai/graph.js';
import { createActiveSession, loadActiveSession, saveActiveSession } from '../domain/ai/sessions.js';
import type { RestaurantAgentState } from '../domain/ai/state.js';

export const aiRouter = Router();
const asyncRoute = (fn: (request: AuthRequest, response: any) => Promise<unknown>) => (request: AuthRequest, response: any, next: any) => Promise.resolve(fn(request, response)).catch(next);
aiRouter.use(authenticateJWT, requireRole('USER'));

aiRouter.post('/sessions', asyncRoute(async (request, response) => {
  const state = await createActiveSession(request.auth!.subject);
  response.status(201).json({ sessionId: state.sessionId, expiresAt: state.expiresAt });
}));

aiRouter.post('/sessions/:sessionId/chat', asyncRoute(async (request, response) => {
  const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
  const body = z.object({ message: z.string().trim().min(1).max(4000) }).parse(request.body);
  const saved = await loadActiveSession(params.sessionId, request.auth!.subject);
  if (!saved) return response.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Ordering session expired or not found' } });
  const userMessage = { role: 'user' as const, content: body.message, createdAt: new Date().toISOString() };
  const input = { ...saved, input: body.message, messages: [...saved.messages, userMessage] };
  const result = await orderingGraph.invoke({ ...input, userRetries: saved.retry.user, cookingRetries: saved.retry.cooking, deliveryRetries: saved.retry.delivery }, { configurable: { thread_id: saved.sessionId } });
  const assistantMessage = { role: 'assistant' as const, content: result.response, createdAt: new Date().toISOString() };
  const nextState: RestaurantAgentState = {
    ...saved, restaurantId: result.restaurantId, deliveryPartnerId: result.deliveryPartnerId, intent: result.intent,
    cart: result.cart, availability: result.availability, orderId: result.orderId,
    workflow: { currentStage: result.currentStage, orderStatus: result.orderStatus, restaurantStatus: result.restaurantStatus, cookingStatus: result.cookingStatus, deliveryStatus: result.deliveryStatus },
    retry: { user: result.userRetries, cooking: result.cookingRetries, delivery: result.deliveryRetries }, result: result.result,
    messages: [...input.messages, assistantMessage], updatedAt: new Date().toISOString(),
  };
  await saveActiveSession(nextState);
  response.json({ sessionId: saved.sessionId, message: result.response, state: { currentStage: result.currentStage, result: result.result, cart: result.cart, availability: result.availability, orderId: result.orderId, orderStatus: result.orderStatus } });
}));

aiRouter.post('/chat', asyncRoute(async (request, response) => {
  const body = z.object({ sessionId: z.string().uuid().optional(), message: z.string().trim().min(1).max(4000) }).parse(request.body);
  const state = body.sessionId ? await loadActiveSession(body.sessionId, request.auth!.subject) : await createActiveSession(request.auth!.subject);
  if (!state) return response.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Ordering session expired or not found' } });
  const userMessage = { role: 'user' as const, content: body.message, createdAt: new Date().toISOString() };
  const result = await orderingGraph.invoke({ ...state, input: body.message, userRetries: state.retry.user, cookingRetries: state.retry.cooking, deliveryRetries: state.retry.delivery, messages: [...state.messages, userMessage] }, { configurable: { thread_id: state.sessionId } });
  const assistantMessage = { role: 'assistant' as const, content: result.response, createdAt: new Date().toISOString() };
  const nextState: RestaurantAgentState = { ...state, restaurantId: result.restaurantId, intent: result.intent, cart: result.cart, availability: result.availability, orderId: result.orderId, workflow: { currentStage: result.currentStage, orderStatus: result.orderStatus }, retry: { user: result.userRetries, cooking: result.cookingRetries, delivery: result.deliveryRetries }, result: result.result, messages: [...state.messages, userMessage, assistantMessage], updatedAt: new Date().toISOString() };
  await saveActiveSession(nextState);
  response.json({ sessionId: state.sessionId, message: result.response, state: { currentStage: result.currentStage, result: result.result, availability: result.availability, orderId: result.orderId } });
}));

aiRouter.post('/chat/stream', asyncRoute(async (request, response) => {
  const body = z.object({ sessionId: z.string().uuid().optional(), message: z.string().trim().min(1).max(4000) }).parse(request.body);
  const state = body.sessionId ? await loadActiveSession(body.sessionId, request.auth!.subject) : await createActiveSession(request.auth!.subject);
  if (!state) return response.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Ordering session expired or not found' } });
  response.setHeader('Content-Type', 'text/event-stream'); response.setHeader('Cache-Control', 'no-cache, no-transform'); response.setHeader('Connection', 'keep-alive'); response.flushHeaders();
  const send = (event: string, data: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const userMessage = { role: 'user' as const, content: body.message, createdAt: new Date().toISOString() };
    const stream = await orderingGraph.streamEvents({ ...state, input: body.message, userRetries: state.retry.user, cookingRetries: state.retry.cooking, deliveryRetries: state.retry.delivery, messages: [...state.messages, userMessage] }, { configurable: { thread_id: state.sessionId }, version: 'v3' });
    let streamed = '';
    for await (const modelStream of stream.messagesFrom('response_generation')) {
      for await (const event of modelStream) {
        if (event.event === 'content-block-delta' && event.delta.type === 'text-delta') {
          streamed += event.delta.text;
          send('token', { token: event.delta.text });
        }
      }
    }
    const finalState: any = await stream.output;
    if (!finalState) { send('error', { message: 'The assistant did not return a completed response. Please retry.' }); response.end(); return; }
    const message = String(finalState.response ?? streamed);
    if (streamed !== message) send('replace', { message });
    const assistantMessage = { role: 'assistant' as const, content: message, createdAt: new Date().toISOString() };
    const nextState: RestaurantAgentState = { ...state, restaurantId: finalState.restaurantId, deliveryPartnerId: finalState.deliveryPartnerId, intent: finalState.intent, cart: finalState.cart, availability: finalState.availability, orderId: finalState.orderId, workflow: { currentStage: finalState.currentStage, orderStatus: finalState.orderStatus, restaurantStatus: finalState.restaurantStatus, cookingStatus: finalState.cookingStatus, deliveryStatus: finalState.deliveryStatus }, retry: { user: finalState.userRetries, cooking: finalState.cookingRetries, delivery: finalState.deliveryRetries }, result: finalState.result, messages: [...state.messages, userMessage, assistantMessage], updatedAt: new Date().toISOString() };
    await saveActiveSession(nextState);
    send('done', { sessionId: state.sessionId, state: { currentStage: finalState.currentStage, result: finalState.result, availability: finalState.availability, orderId: finalState.orderId, orderStatus: finalState.orderStatus } });
    response.end();
  } catch (error) {
    send('error', { message: 'The assistant could not process this request. Please try again.' });
    response.end();
    console.error(JSON.stringify({ event: 'ai.stream_failed', sessionId: state.sessionId, error: error instanceof Error ? error.message : 'unknown' }));
  }
}));
