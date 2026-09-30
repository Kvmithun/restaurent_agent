export type AvailabilityDecision = 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'NOT_CONFIRMED';
export function evaluateAvailability(requestedQuantity: number, availableQuantity: number): { confirmedQuantity: number; decision: AvailabilityDecision } {
  if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || !Number.isInteger(availableQuantity) || availableQuantity < 0) throw new Error('Quantities must be valid non-negative integers');
  const confirmedQuantity = Math.min(requestedQuantity, availableQuantity);
  return { confirmedQuantity, decision: confirmedQuantity === 0 ? 'NOT_CONFIRMED' : confirmedQuantity < requestedQuantity ? 'PARTIALLY_CONFIRMED' : 'CONFIRMED' };
}
