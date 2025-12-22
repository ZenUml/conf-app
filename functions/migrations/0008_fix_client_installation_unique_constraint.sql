-- Migration number: 0008 	 2025-11-10T00:00:00.000Z
-- Fix: Allow same clientKey to install both Lite and Full versions

CREATE TABLE IF NOT EXISTS ClientInstallation_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    clientKey TEXT NOT NULL,
    publicKey TEXT NOT NULL,
    sharedSecret TEXT NOT NULL,
    serverVersion TEXT,
    pluginsVersion TEXT,
    baseUrl TEXT NOT NULL,
    clientDomain TEXT,
    productType TEXT,
    description TEXT,
    eventType TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(clientKey, key)
);

INSERT INTO ClientInstallation_new 
SELECT * FROM ClientInstallation;

DROP TABLE ClientInstallation;

ALTER TABLE ClientInstallation_new RENAME TO ClientInstallation;

