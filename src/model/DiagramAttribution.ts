export interface DiagramAttribution {
  customContentId: string;
  createdByAccountId?: string;
  lastUpdatedByAccountId?: string;
}

type AttributionCustomContent = {
  id: string | number;
  authorId?: string;
  version?: { authorId?: string };
};

function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Maps the V2 custom-content envelope into ephemeral viewer metadata. This
 * deliberately never touches Diagram: Diagram is persisted to Confluence.
 */
export function attributionFromCustomContent(
  content: AttributionCustomContent | undefined | null,
): DiagramAttribution | null {
  const customContentId = content?.id == null ? undefined : String(content.id).trim();
  if (!customContentId) return null;
  return {
    customContentId,
    ...(nonBlank(content?.authorId) && { createdByAccountId: nonBlank(content?.authorId) }),
    ...(nonBlank(content?.version?.authorId) && { lastUpdatedByAccountId: nonBlank(content?.version?.authorId) }),
  };
}
