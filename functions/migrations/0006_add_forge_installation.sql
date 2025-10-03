-- Migration number: 0006 	 2025-09-27T10:03:00.000Z

CREATE TABLE IF NOT EXISTS ForgeApp (
    appId TEXT PRIMARY KEY, 
    name TEXT NOT NULL, 
    ownerAccountId TEXT NOT NULL,
    version TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS ForgeInstallation (
    installationId TEXT PRIMARY KEY,
    context TEXT NOT NULL UNIQUE,
    installerAccountId TEXT NOT NULL UNIQUE,
    eventType TEXT,
    appId TEXT NOT NULL REFERENCES ForgeApp(appId),
    environmentId TEXT NOT NULL,
    permissions TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
