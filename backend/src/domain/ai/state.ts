export type WorkflowResult = 'COMPLETE' | 'INCOMPLETE';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
}

export interface CartItem {
  dishId?: string;
  dishName: string;
  requestedQuantity: number;
  confirmedQuantity: number;
  /** Price is populated from the authoritative menu, never from model output. */
  price?: number;
}

export interface AvailabilityItem {
  dishId: string;
  dishName: string;
  requestedQuantity: number;
  availableQuantity: number;
  confirmedQuantity: number;
  decision: 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'NOT_CONFIRMED';
}

export interface RetryState {
  user: number;
  cooking: number;
  delivery: number;
}

export interface WorkflowState {
  currentStage: string;
  orderStatus?: string;
  restaurantStatus?: string;
  cookingStatus?: string;
  deliveryStatus?: string;
}

/** Redis/LangGraph active session shape. MongoDB remains the permanent source of truth. */
export interface RestaurantAgentState {
  sessionId: string;
  userId: string;
  restaurantId?: string;
  deliveryPartnerId?: string;
  messages: ChatMessage[];
  intent?: string;
  cart: CartItem[];
  availability: AvailabilityItem[];
  orderId?: string;
  workflow: WorkflowState;
  retry: RetryState;
  result: WorkflowResult;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}
