# Local development and deployment

## Local services

Use MongoDB Atlas or a local MongoDB replica set (transactions are required for inventory/order consistency). Start Redis locally or configure a managed Redis URL. Set the root `.env` from `.env.example`, install workspace dependencies from the root, then run `./dev.sh`. The backend connects to both stores before listening.

## Production deployment requirements

Set secrets through the deployment environment, restrict CORS to the deployed frontend origin, use managed MongoDB and Redis with TLS and authentication, terminate HTTPS at the ingress, and configure health checks against `/api/health`. Keep uploads in a private object store once document ingestion is added. Configure structured log collection without recording credentials or private documents.

## Implemented workflows and remaining setup

The repository includes JWT authentication, MongoDB persistence, Redis-backed AI sessions, menu and order APIs, deterministic inventory reservations, order lifecycle and retry handling, restaurant and delivery dashboards, text and voice input, and SSE responses from the AI assistant.

Restaurant and delivery registrations start in `PENDING`. An operator must review and activate those records before they appear in restaurant discovery or can publish menus/receive assignments. This repository does not yet include an operator/admin review console, document upload/OCR, AI menu import, live cross-client order notifications, or a production object-storage integration. Add those before treating the platform as a complete production service.

MongoDB transactions require Atlas or a replica set. Redis must be reachable before the backend starts. If AI is not configured with `GROQ_API_KEY`, manual menu ordering remains available and the assistant returns a configuration message. The health endpoint confirms that the API process is running; startup also waits for MongoDB and Redis connections.
