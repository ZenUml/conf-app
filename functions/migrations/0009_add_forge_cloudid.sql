-- Migration number: 0009 	 2026-03-08T00:00:00.000Z

ALTER TABLE ForgeInstallation ADD COLUMN cloudId TEXT;
ALTER TABLE ForgeInstallation ADD COLUMN clientDomain TEXT;
