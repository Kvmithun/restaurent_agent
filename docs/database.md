# Database and file storage

MongoDB contains separate User, Restaurant, DeliveryPartner, Menu, MenuImport, AccountDocument, Order, OrderAttempt, and FailedSession models. Passwords are bcrypt hashes. Geospatial data uses GeoJSON points. MongoDB transactions are required for stock reservation/restoration and order creation.

MenuImport retains extracted drafts and marks them published after the restaurant confirms the reviewed values. AccountDocument stores ownership, category, original filename, MIME type, and a random storage key. The corresponding file is stored privately under `UPLOAD_DIRECTORY`; account owners and token-authenticated operators are the only API paths to download it. Keep this directory private and backed up. A multi-instance or production deployment should replace the local adapter with private object storage.

Redis stores only expiring active AI sessions and is not the permanent order store. `SESSION_TTL_SECONDS` controls the session TTL.
