-- Migration number: 0005 	 2025-04-13T06:18:20.615Z

-- Migration to create the client_installations table with UNIQUE constraint on clientKey
CREATE TABLE IF NOT EXISTS ClientInstallation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    clientKey TEXT NOT NULL UNIQUE,
    publicKey TEXT NOT NULL,
    sharedSecret TEXT NOT NULL,
    serverVersion TEXT,
    pluginsVersion TEXT,
    baseUrl TEXT NOT NULL,
    clientDomain TEXT,
    productType TEXT,
    description TEXT,
    eventType TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);
