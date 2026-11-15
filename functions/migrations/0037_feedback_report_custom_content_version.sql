-- Which version of the diagram's Confluence custom content the reporter saw.
-- Integer only (the version number the viewer/editor loaded); never diagram
-- source or body, since Confluence is the system of record. NULL when unknown
-- (older reports, new diagrams, dashboard surfaces, or an invalid client value).
-- Lets support open that exact version via the CustomContentVersion mirror or
-- Confluence's ?version=N.
ALTER TABLE FeedbackReport ADD COLUMN customContentVersion INTEGER;
