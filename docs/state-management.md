# AI session state

The active ordering session is represented by `RestaurantAgentState` in `backend/src/domain/ai/state.ts`. It includes session/user/restaurant/delivery identifiers, messages, intent, cart, deterministic availability results, order ID, workflow statuses, retries, result, and timestamps.

Cart prices and availability are authoritative backend values. A language model may extract dish names and requested quantities, but cannot populate trusted price/availability or advance workflow status. `COMPLETE` is reserved for the verified end-to-end workflow; new sessions begin `INCOMPLETE`.

Redis will own short-lived state and LangGraph checkpoints. MongoDB will store permanent users, menus, orders, attempts, and terminal failure/audit records. The session constructor initializes retry counters to zero; configured limits are held in environment configuration and enforced by deterministic services.
