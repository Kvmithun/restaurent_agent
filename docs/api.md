# API overview

The Express API currently exposes `GET /api/health`. Protected domain routes will be grouped by role:

- `/api/user/*` for user profile, restaurant discovery, menu reads, carts, orders, and AI sessions.
- `/api/restaurant/*` for restaurant profile, menu management, and order decisions.
- `/api/delivery/*` for partner profile and assigned delivery actions.

Authentication will use JWT role claims and centralized authentication/role middleware. Controllers will validate requests and call services; services own transitions and persistence. Error responses use `{ "error": { "code": "...", "message": "..." } }`.

No order, auth, upload, or streaming route is implemented in this initial foundation milestone.
