# Database plan

MongoDB stores durable account, restaurant, delivery partner, menu, order, and attempt records. Recommended collections are User, Restaurant, DeliveryPartner, Menu, Order, and OrderAttempt, with document metadata collections added when upload support is implemented.

Restaurant and user locations should use GeoJSON points with `2dsphere` indexes. Inventory updates and order creation must use atomic conditional updates or transactions so the available quantity cannot become negative. Prices and item identity are snapshotted onto order items at purchase time.

Redis is not a database for completed orders. Its session key is short lived and expires according to `SESSION_TTL_SECONDS`.

Mongoose connection startup is scaffolded; schemas, indexes, repositories, and transaction workflows have not yet been implemented.
