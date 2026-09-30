import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedOrderTransition } from './transitions.js';

test('order follows the defined lifecycle', () => {
  assert.equal(isAllowedOrderTransition('PENDING_RESTAURANT', 'RESTAURANT_ACCEPTED'), true);
  assert.equal(isAllowedOrderTransition('PREPARING', 'READY_FOR_PICKUP'), true);
  assert.equal(isAllowedOrderTransition('OUT_FOR_DELIVERY', 'DELIVERED'), true);
});
test('order cannot skip required lifecycle stages', () => {
  assert.equal(isAllowedOrderTransition('PENDING_RESTAURANT', 'DELIVERED'), false);
  assert.equal(isAllowedOrderTransition('DELIVERED', 'PREPARING'), false);
});
