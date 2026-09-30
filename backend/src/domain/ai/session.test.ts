import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionState } from './session.js';

test('new ordering session initializes identifiers, retries, workflow, and timestamps', () => {
  const now = new Date('2026-01-02T03:04:05.000Z');
  const state = createSessionState({ sessionId: 'session-1', userId: 'user-1' }, now);
  assert.equal(state.sessionId, 'session-1');
  assert.equal(state.userId, 'user-1');
  assert.equal(state.result, 'INCOMPLETE');
  assert.deepEqual(state.retry, { user: 0, cooking: 0, delivery: 0 });
  assert.equal(state.workflow.currentStage, 'INTENT_DETECTION');
  assert.equal(state.createdAt, now.toISOString());
});
