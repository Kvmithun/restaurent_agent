# Local development and deployment

## Local services

Use MongoDB Atlas or a local MongoDB replica set (transactions are required for inventory/order consistency). Start Redis locally or configure a managed Redis URL. Set the root `.env` from `.env.example`, install workspace dependencies from the root, then run `./dev.sh`. The backend connects to both stores before listening.

## Production deployment requirements

Set secrets through the deployment environment, restrict CORS to the deployed frontend origin, use managed MongoDB and Redis with TLS and authentication, terminate HTTPS at the ingress, and configure health checks against `/api/health`. Move uploads to a private durable object store before deploying multiple backend instances. Configure structured log collection without recording credentials or private documents.

## Implemented workflows and remaining setup

The repository includes JWT authentication, MongoDB persistence, Redis-backed AI sessions, menu and order APIs, deterministic inventory reservations, order lifecycle and retry handling, restaurant and delivery dashboards, text and voice input, SSE responses from the AI assistant, private document uploads, Groq-backed OCR/menu extraction to editable drafts, and a token-protected operator review page.

Restaurant and delivery registrations start in `PENDING`. Use `/admin/review` with the `ADMIN_REVIEW_TOKEN` to review documents and activate/reject applications. Order dashboards poll every 15 seconds for status updates; a dedicated push notification service is not included. Local file storage is intended for single-instance development and should be replaced by shared private object storage in production.

MongoDB transactions require Atlas or a replica set. Redis must be reachable before the backend starts. If AI is not configured with `GROQ_API_KEY`, manual menu ordering remains available and the assistant returns a configuration message. The health endpoint confirms that the API process is running; startup also waits for MongoDB and Redis connections.
