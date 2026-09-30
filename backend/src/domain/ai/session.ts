import type { RestaurantAgentState } from './state.js';

export function createSessionState(input: Pick<RestaurantAgentState, 'sessionId' | 'userId'>, now = new Date()): RestaurantAgentState {
  const timestamp = now.toISOString();
  return {
    ...input,
    messages: [],
    cart: [],
    availability: [],
    workflow: { currentStage: 'INTENT_DETECTION' },
    retry: { user: 0, cooking: 0, delivery: 0 },
    result: 'INCOMPLETE',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
