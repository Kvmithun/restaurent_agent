import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAvailability } from './availability.js';

test('availability confirms a request fully available', () => assert.deepEqual(evaluateAvailability(5, 5), { confirmedQuantity: 5, decision: 'CONFIRMED' }));
test('availability confirms only available quantity for a shortage', () => assert.deepEqual(evaluateAvailability(5, 3), { confirmedQuantity: 3, decision: 'PARTIALLY_CONFIRMED' }));
test('availability rejects an unavailable item', () => assert.deepEqual(evaluateAvailability(2, 0), { confirmedQuantity: 0, decision: 'NOT_CONFIRMED' }));
