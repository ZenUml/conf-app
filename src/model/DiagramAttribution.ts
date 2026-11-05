export interface DiagramAttribution {
  customContentId: string;
  createdByAccountId?: string;
  lastUpdatedByAccountId?: string;
  /** The stored version number; a diagram comment records it as "posted on vN". */
  version?: number;
}

type AttributionCustomContent = {
  id: string | number;
  authorId?: string;
  version?: { authorId?: string; number?: number };
};

function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
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
    ...(positiveInt(content?.version?.number) !== undefined && { version: positiveInt(content?.version?.number) }),
  };
}
