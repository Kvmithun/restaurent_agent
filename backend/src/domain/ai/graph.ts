import { ChatGroq } from '@langchain/groq';
import { END, START, StateGraph, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { Menu, Restaurant } from '../../models/index.js';
import { evaluateAvailability } from '../orders/availability.js';
import { createOrder, transitionOrder } from '../../services/orders.js';
import { extractionPrompt, responsePrompt } from './prompts.js';

const cartItem = z.object({ dishId: z.string().optional(), dishName: z.string(), requestedQuantity: z.number().int().positive(), confirmedQuantity: z.number().int().nonnegative(), price: z.number().nonnegative().optional() });
const availableItem = z.object({ dishId: z.string(), dishName: z.string(), requestedQuantity: z.number().int(), availableQuantity: z.number().int(), confirmedQuantity: z.number().int(), decision: z.enum(['CONFIRMED','PARTIALLY_CONFIRMED','NOT_CONFIRMED']) });
const State = new StateSchema({
  sessionId: z.string(), userId: z.string(), restaurantId: z.string().optional(), restaurantName: z.string().optional(), deliveryPartnerId: z.string().optional(),
  messages: z.array(z.object({ role: z.enum(['system','user','assistant','tool']), content: z.string(), createdAt: z.string() })).default([]),
  input: z.string(), intent: z.string().default('CHAT'), cart: z.array(cartItem).default([]), availability: z.array(availableItem).default([]), orderId: z.string().optional(),
  currentStage: z.string().default('INTENT_DETECTION'), orderStatus: z.string().optional(), restaurantStatus: z.string().optional(), cookingStatus: z.string().optional(), deliveryStatus: z.string().optional(),
  userRetries: z.number().int().default(0), cookingRetries: z.number().int().default(0), deliveryRetries: z.number().int().default(0), result: z.enum(['COMPLETE','INCOMPLETE']).default('INCOMPLETE'), response: z.string().default(''),
});

const extractedSchema = z.object({ intent: z.enum(['ORDER_FOOD','CONFIRM_ORDER','CANCEL_ORDER','CLARIFY','CHAT']), restaurant: z.string().optional(), items: z.array(z.object({ dish: z.string(), quantity: z.number().int().positive() })).default([]) });
const model = new ChatGroq({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL, temperature: 0, maxRetries: 1 });
const extractor = model.withStructuredOutput(extractedSchema);

async function interpret(state: typeof State.State) {
  if (!env.GROQ_API_KEY) return { intent: 'UNAVAILABLE', response: 'AI ordering is not configured yet. Please use the restaurant menu to order.' };
  const context = state.messages.map((message) => `${message.role}: ${message.content}`).slice(-12).join('\n');
  const parsed = await extractor.invoke([{ role: 'system', content: extractionPrompt }, { role: 'user', content: `Conversation so far:\n${context}\nCurrent message:\n${state.input}` }]);
  const items = parsed.items ?? [];
  return { intent: parsed.intent, userRetries: state.userRetries + (parsed.intent === 'ORDER_FOOD' ? 1 : 0), ...(parsed.restaurant ? { restaurantName: parsed.restaurant } : {}), ...(items.length ? { cart: items.map((item) => ({ dishName: item.dish, requestedQuantity: item.quantity, confirmedQuantity: 0 })) } : {}) };
}

async function validateAvailability(state: typeof State.State) {
  if (state.userRetries > env.MAX_USER_RETRIES) return { currentStage: 'RETRY_LIMIT', response: 'This ordering session has reached its order-attempt limit. Start a new session to continue.' };
  if (state.intent === 'CONFIRM_ORDER') {
    if (state.orderId) return { currentStage: 'ORDER_IN_PROGRESS', response: `Order ${state.orderId} is currently ${state.orderStatus ?? 'in progress'}. I have not created another order.` };
    if (!state.restaurantId || !state.cart.length || !state.availability.length || state.availability.some((item) => item.confirmedQuantity < 1)) return { currentStage: 'CLARIFICATION', response: 'There is no verified order ready to place. Tell me the restaurant and items you would like.' };
    const order = await createOrder(state.userId, { restaurantId: state.restaurantId, sessionId: state.sessionId, items: state.availability.filter((item) => item.confirmedQuantity > 0).map((item) => ({ dishId: item.dishId, quantity: item.confirmedQuantity })) });
    const created = order as { _id: string; status: string };
    return { orderId: created._id, orderStatus: created.status, currentStage: 'RESTAURANT_CONFIRMATION', cart: state.cart, response: `Your order ${created._id} has been placed and is waiting for the restaurant to respond.` };
  }
  if (state.intent === 'CANCEL_ORDER') {
    if (state.orderId && state.orderStatus === 'PENDING_RESTAURANT') {
      const order = await transitionOrder(state.orderId, state.userId, 'USER', 'CANCELLED');
      return { orderStatus: order.status, cart: [], availability: [], currentStage: 'CANCELLED', response: 'Your pending order was cancelled.' };
    }
    if (state.orderId) return { currentStage: 'ORDER_IN_PROGRESS', response: `Order ${state.orderId} is ${state.orderStatus ?? 'in progress'} and cannot be cancelled at this stage.` };
    return { cart: [], availability: [], currentStage: 'CANCELLED', response: 'I cleared the current draft. Nothing was placed.' };
  }
  if (state.intent !== 'ORDER_FOOD') return { currentStage: state.intent === 'UNAVAILABLE' ? 'INCOMPLETE' : 'CONVERSATION', response: state.intent === 'UNAVAILABLE' ? state.response : 'Tell me a restaurant and the dishes and quantities you want, and I’ll check the menu.' };
  let restaurant = state.restaurantId ? await Restaurant.findOne({ _id: state.restaurantId, status: 'ACTIVE', isVerified: true }) : null;
  if (!restaurant && state.restaurantName) restaurant = await Restaurant.findOne({ restaurantName: { $regex: `^${escapeRegex(state.restaurantName)}$`, $options: 'i' }, status: 'ACTIVE', isVerified: true });
  if (!restaurant) return { currentStage: 'RESTAURANT_SELECTION', response: state.restaurantName ? `I couldn't find an active restaurant named ${state.restaurantName}. Which restaurant would you like?` : 'Which restaurant would you like to order from?' };
  const menu = await Menu.findOne({ restaurantId: restaurant._id, published: true });
  if (!menu) return { restaurantId: restaurant.id, restaurantName: restaurant.restaurantName, currentStage: 'MENU_LOOKUP', response: `${restaurant.restaurantName} has no published menu available right now.` };
  const results = state.cart.map((requested) => {
    const item = menu.items.find((candidate: any) => candidate.name.toLowerCase() === requested.dishName.toLowerCase() && candidate.isAvailable);
    if (!item) return { dishId: '', dishName: requested.dishName, requestedQuantity: requested.requestedQuantity, availableQuantity: 0, confirmedQuantity: 0, decision: 'NOT_CONFIRMED' as const };
    const { confirmedQuantity, decision } = evaluateAvailability(requested.requestedQuantity, item.availableQuantity);
    return { dishId: item.id, dishName: item.name, requestedQuantity: requested.requestedQuantity, availableQuantity: item.availableQuantity, confirmedQuantity, decision };
  });
  const safeCart = results.filter((item) => item.dishId).map((item) => {
    const menuItem = menu.items.find((candidate: any) => candidate.id === item.dishId) as any;
    return { dishId: item.dishId, dishName: item.dishName, requestedQuantity: item.requestedQuantity, confirmedQuantity: item.confirmedQuantity, price: menuItem.price };
  });
  const canConfirm = results.length > 0 && results.every((item) => item.confirmedQuantity > 0);
  const facts = results.map((item) => item.decision === 'NOT_CONFIRMED' ? `${item.dishName} is unavailable.` : item.confirmedQuantity < item.requestedQuantity ? `Only ${item.confirmedQuantity} of ${item.requestedQuantity} ${item.dishName} are available.` : `${item.confirmedQuantity} ${item.dishName} available at ₹${safeCart.find((cart) => cart.dishId === item.dishId)?.price} each.`).join(' ');
  return { restaurantId: restaurant.id, restaurantName: restaurant.restaurantName, cart: safeCart, availability: results, currentStage: canConfirm ? 'USER_CONFIRMATION' : 'CLARIFICATION', response: `${facts} ${canConfirm ? 'Would you like me to place this order?' : 'Would you like to change the quantities or choose something else?'}` };
}

async function respond(state: typeof State.State) {
  if (!state.response || !env.GROQ_API_KEY) return {};
  try {
    const chunks = await model.withConfig({ runName: 'assistant_response' }).stream([{ role: 'system', content: responsePrompt }, { role: 'user', content: `Write a friendly, brief version of this verified backend response. Preserve all facts exactly and do not add any: ${state.response}` }]);
    let response = '';
    for await (const chunk of chunks) if (typeof chunk.content === 'string') response += chunk.content;
    const sourceNumbers = [...state.response.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]).sort().join(',');
    const outputNumbers = [...response.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]).sort().join(',');
    return { response: sourceNumbers === outputNumbers && response.trim() ? response.trim() : state.response };
  } catch { return {}; }
}

function escapeRegex(input: string) { return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export const orderingGraph = new StateGraph(State)
  .addNode('intent_detection', interpret)
  .addNode('availability_validation', validateAvailability)
  .addNode('response_generation', respond)
  .addEdge(START, 'intent_detection')
  .addEdge('intent_detection', 'availability_validation')
  .addEdge('availability_validation', 'response_generation')
  .addEdge('response_generation', END)
  .compile();

export type OrderingState = typeof State.State;
