# AI ordering and menu extraction

## Ordering workflow

The LangGraph state stores the user, messages, selected restaurant, cart, authoritative availability, order ID, lifecycle status, retry counts, and TTL timestamps. Redis stores the active state; MongoDB remains authoritative for menus, inventory, orders, and failure records.

The graph uses Groq for structured intent/item extraction, deterministic MongoDB menu lookup and quantity checks, explicit user confirmation, and response generation. Order creation occurs only after confirmation and rechecks inventory transactionally. Restaurant acceptance and delivery completion remain role-authorized API actions.

SSE forwards response-generation tokens as they arrive. SSE content does not mutate order state.

## Menu import

Restaurant uploads accept PDF, JPEG, PNG, WebP, CSV, JSON, and text, limited to 10 MB. PDF text is extracted locally; scanned PDF pages and image files are sent to the configured Groq vision model for OCR and extraction. The model output is validated against a strict schema and stored as a draft. A restaurant owner can correct every field before publishing. Zero values mark missing/unclear price or quantity for review; the system never treats a model guess as a confirmed price or stock count.

Configure `GROQ_API_KEY`, `GROQ_MODEL`, and `GROQ_VISION_MODEL`. The default vision model is `qwen/qwen3.6-27b`.
