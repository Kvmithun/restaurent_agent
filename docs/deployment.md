# Local development and deployment

## Local services

Use MongoDB Atlas or a local MongoDB replica set (transactions are required for inventory/order consistency). Start Redis locally or configure a managed Redis URL. Set the root `.env` from `.env.example`, install workspace dependencies from the root, then run `./dev.sh`. The backend connects to both stores before listening.

## Production deployment requirements

Set secrets through the deployment environment, restrict CORS to the deployed frontend origin, use managed MongoDB and Redis with TLS and authentication, terminate HTTPS at the ingress, and configure health checks against `/api/health`. Keep uploads in a private object store once document ingestion is added. Configure structured log collection without recording credentials or private documents.

The current scaffold is not production deployable yet: authentication, persistence models, operational health checks, and the application workflows remain future milestones.
