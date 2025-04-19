-- Migration number: 0004 	 2025-04-12T05:43:37.231Z
CREATE TABLE IF NOT EXISTS AppInstance (appId INTEGER PRIMARY KEY, clientKey TEXT NOT NULL, clientDomain TEXT NOT NULL, addonKey TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT current_timestamp);

CREATE TABLE IF NOT EXISTS CustomContentVersion (contentId TEXT NOT NULL, body TEXT NOT NULL, authorId TEXT NOT NULL, createdAt TEXT NOT NULL, versionNumber INTEGER NOT NULL, appId INTEGER NOT NULL, title TEXT, message TEXT, minorEdit INTEGER, PRIMARY KEY (contentId, versionNumber, appId));

CREATE TABLE IF NOT EXISTS CustomContent (contentId TEXT, type TEXT NOT NULL, latestVersionNumber INTEGER NOT NULL, body TEXT NOT NULL, createdAt TEXT NOT NULL, appId INTEGER NOT NULL, spaceId TEXT NOT NULL, title TEXT, pageId TEXT, macroUuid TEXT, diagramType TEXT, status TEXT, PRIMARY KEY (contentId, appId));