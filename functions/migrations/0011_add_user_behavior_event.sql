-- Migration number: 0011 	 2026-04-04T00:00:00.000Z

CREATE TABLE IF NOT EXISTS UserBehaviorEvent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cloudId TEXT NOT NULL,
    userAccountId TEXT NOT NULL,
    contentId TEXT NOT NULL,
    action TEXT NOT NULL,
    clientDomain TEXT,
    spaceKey TEXT,
    payload TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_behavior_cloud_time ON UserBehaviorEvent (cloudId, createdAt);
CREATE INDEX idx_user_behavior_user_time ON UserBehaviorEvent (userAccountId, createdAt);
CREATE INDEX idx_user_behavior_content ON UserBehaviorEvent (contentId);
