import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { redis } from '../../infra/connections.js';
import { createSessionState } from './session.js';
import type { RestaurantAgentState } from './state.js';

const prefix = 'restaurant:session:';
export async function createActiveSession(userId: string) {
  const now = new Date();
  const state = createSessionState({ sessionId: randomUUID(), userId }, now);
  state.expiresAt = new Date(now.getTime() + env.SESSION_TTL_SECONDS * 1000).toISOString();
  await redis.set(`${prefix}${state.sessionId}`, JSON.stringify(state), 'EX', env.SESSION_TTL_SECONDS);
  return state;
}
export async function loadActiveSession(sessionId: string, userId: string): Promise<RestaurantAgentState | null> {
  const raw = await redis.get(`${prefix}${sessionId}`);
  if (!raw) return null;
  const state = JSON.parse(raw) as RestaurantAgentState;
  return state.userId === userId ? state : null;
}
export async function saveActiveSession(state: RestaurantAgentState) {
  state.updatedAt = new Date().toISOString();
  await redis.set(`${prefix}${state.sessionId}`, JSON.stringify(state), 'EX', env.SESSION_TTL_SECONDS);
}
