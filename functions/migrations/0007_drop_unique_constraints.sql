-- Migration number: 0007 	 2025-10-18T10:03:00.000Z

-- Drop unique constraints from ForgeInstallation table
-- Note: SQLite doesn't support dropping constraints directly, so we need to recreate the table

-- Create a temporary table with the same structure but without unique constraints
CREATE TABLE IF NOT EXISTS ForgeInstallation_temp (
    installationId TEXT PRIMARY KEY,
    context TEXT NOT NULL,
    installerAccountId TEXT NOT NULL,
    eventType TEXT,
    appId TEXT NOT NULL REFERENCES ForgeApp(appId),
    environmentId TEXT NOT NULL,
    permissions TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Copy data from original table to temporary table
INSERT INTO ForgeInstallation_temp 
SELECT * FROM ForgeInstallation;

-- Drop the original table
DROP TABLE ForgeInstallation;

-- Rename the temporary table to the original name
ALTER TABLE ForgeInstallation_temp RENAME TO ForgeInstallation;
