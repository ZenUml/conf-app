import yaml from 'js-yaml';
import { DataSource, Diagram, DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import OpenApiExample from '@/model/OpenApi/OpenApiExample';

/**
 * Build the Vuex diagram state used by the Swagger editor.
 *
 * A new OpenAPI macro has no persisted Diagram yet, but Swagger still renders
 * OpenApiExample. Keep that visible spec and its type in Vuex as well so
 * consumers such as SyntaxErrorBox/AIRepair read the actual editor content.
 */
export function createOpenApiEditorState(doc?: Diagram): Diagram {
  return {
    ...(doc ?? NULL_DIAGRAM),
    diagramType: DiagramType.OpenApi,
    code: doc?.code || OpenApiExample,
  };
}

/**
 * Return the title only when the parsed document explicitly contains a string
 * info.title. `undefined` means callers should preserve their current title;
 * an empty string is intentional and may clear it.
 */
export function getOpenApiTitleField(document: unknown): string | undefined {
  if (!document || typeof document !== 'object') return undefined;

  const info = (document as Record<string, unknown>).info;
  if (!info || typeof info !== 'object') return undefined;

  const title = (info as Record<string, unknown>).title;
  return typeof title === 'string' ? title : undefined;
}

export function extractOpenApiTitle(spec: string | undefined): string | undefined {
  if (!spec) return undefined;

  try {
    const document = yaml.load(spec) as Record<string, any> | null;
    const title = getOpenApiTitleField(document);
    if (title === undefined) return undefined;

    const trimmed = title.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export interface BuildOpenApiSaveDiagramArgs {
  existing?: Diagram;
  spec: string;
  pinToId?: string;
}

/**
 * Build the OpenAPI custom-content body from the live editor state. Parsing
 * info.title is a fallback for create flows so the persisted title cannot be
 * lost even if React's title field and the shared diagram state briefly race.
 */
export function buildOpenApiSaveDiagram({
  existing,
  spec,
  pinToId,
}: BuildOpenApiSaveDiagramArgs): Diagram {
  const explicitTitle = existing?.title?.trim();
  const resolvedTitle = explicitTitle || extractOpenApiTitle(spec);

  return {
    ...(existing ?? {}),
    code: spec,
    diagramType: DiagramType.OpenApi,
    source: DataSource.CustomContent,
    ...(resolvedTitle ? { title: resolvedTitle } : {}),
    ...(pinToId ? { id: pinToId, isCopy: false } : {}),
  } as Diagram;
}
