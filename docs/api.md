# API overview

All routes are under `/api`. Protected routes use `Authorization: Bearer <JWT>`. Errors use `{ "error": { "code": "...", "message": "..." } }`.

## Authentication

- `POST /auth/register` — create a user, restaurant, or delivery partner account.
- `POST /auth/login` — authenticate by account role, email, and password.

Restaurant and delivery accounts start as `PENDING` and require operator review.

## Customer

- `GET /restaurants?lat=<latitude>&lon=<longitude>` — active verified restaurants, optionally within 30 km.
- `GET /restaurants/:restaurantId/menu` — published menu.
- `POST /orders`, `GET /orders`, `GET /orders/:orderId` — create and view customer orders.
- `POST /orders/:orderId/transition` — cancel while the order is pending.
- `POST /ai/sessions`, `POST /ai/sessions/:sessionId/chat`, `POST /ai/chat`, `POST /ai/chat/stream` — AI ordering sessions and responses.

## Restaurant

- `PUT /restaurant/menu` — replace and publish the restaurant menu.
- `GET /orders` — restaurant orders.
- `POST /orders/:orderId/transition` — accept, reject, and update preparation status.
- `POST /orders/:orderId/assign-delivery` — assign an available active delivery partner.
- `POST /orders/:orderId/failures` — record cooking failure and apply configured retries.
- `GET /restaurant/menu/own` — read the restaurant's current menu, including unpublished state.
- `POST /restaurant/menu/import` — extract a PDF, image, CSV, JSON, or text upload into a draft.
- `GET /restaurant/menu/imports` — list menu import drafts.
- `PATCH /restaurant/menu/imports/:importId` — save the restaurant's reviewed corrections.
- `POST /restaurant/menu/imports/:importId/publish` — publish the reviewed draft.
- `POST /documents` and `GET /documents` — upload/list FSSAI or delivery verification documents. `GET /documents/:id/file` downloads an owned file.

## Delivery partner

- `GET /orders` — assigned deliveries.
- `GET`, `PATCH /delivery/availability` — read/update availability.
- `PATCH /delivery/location` — update current location.
- `POST /orders/:orderId/transition` — accept, pick up, and complete assigned deliveries.
- `POST /orders/:orderId/failures` — report delivery failure and apply configured retries.

## Operator review

Configure a private `ADMIN_REVIEW_TOKEN` with at least 32 characters. Send it in the `x-admin-review-token` header. Keep it in a secrets manager in production.

- `GET /admin/pending` — list pending restaurant and delivery partner accounts.
- `POST /admin/restaurants/:id/activate` — activate and verify a restaurant.
- `POST /admin/delivery-partners/:id/activate` — activate a delivery partner.
- `POST /admin/restaurants/:id/reject` and `POST /admin/delivery-partners/:id/reject` — reject pending applications with a reason.
- `GET /admin/documents/:id/file` — download a pending account's verification document.

Menu imports use Groq text extraction and vision OCR, then persist a draft for restaurant review. Uploads are private local files in `UPLOAD_DIRECTORY`; configure durable private object storage before deploying multiple backend instances.
