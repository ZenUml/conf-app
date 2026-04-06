-- Migration number: 0010 	 2026-03-28T00:00:00.000Z

CREATE TABLE IF NOT EXISTS AtlassianInstance (
    cloudId TEXT PRIMARY KEY,
    clientDomain TEXT
);

-- Seed from existing ForgeInstallation data (pick the most recent non-empty domain per cloudId)
INSERT OR IGNORE INTO AtlassianInstance (cloudId, clientDomain)
SELECT cloudId, clientDomain
FROM (
    SELECT cloudId, clientDomain,
           ROW_NUMBER() OVER (PARTITION BY cloudId ORDER BY createdAt DESC) AS rn
    FROM ForgeInstallation
    WHERE cloudId IS NOT NULL
      AND clientDomain IS NOT NULL
      AND clientDomain != ''
)
WHERE rn = 1;
