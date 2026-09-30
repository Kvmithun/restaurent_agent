export const orderTransitions: Record<string, string[]> = {
  PENDING_RESTAURANT: ['RESTAURANT_ACCEPTED', 'RESTAURANT_REJECTED', 'CANCELLED'], RESTAURANT_ACCEPTED: ['PREPARING'], PREPARING: ['READY_FOR_PICKUP', 'FAILED'],
  READY_FOR_PICKUP: ['DELIVERY_ASSIGNED'], DELIVERY_ASSIGNED: ['DELIVERY_ACCEPTED'], DELIVERY_ACCEPTED: ['PICKED_UP'], PICKED_UP: ['OUT_FOR_DELIVERY'], OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
};
export function isAllowedOrderTransition(currentStatus: string, nextStatus: string): boolean { return (orderTransitions[currentStatus] ?? []).includes(nextStatus); }
