-- Migration number: 0002 	 2025-03-15T22:55:50.393Z
ALTER TABLE DiagramLikes ADD COLUMN clientDomain TEXT;
ALTER TABLE DiagramLikes ADD COLUMN confluenceSpace TEXT;
ALTER TABLE DiagramLikes ADD COLUMN confluencePageId TEXT;
ALTER TABLE DiagramLikes ADD COLUMN macroId TEXT;
ALTER TABLE DiagramLikes ADD COLUMN diagramType TEXT;