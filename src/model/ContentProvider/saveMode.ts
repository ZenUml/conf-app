import type { Diagram } from '@/model/Diagram/Diagram';

/**
 * Whether saving this diagram creates it for the first time (no saved id yet)
 * or edits an existing one. One predicate for every consumer of the answer:
 * saveToPlatform picks macro_create_succeeded vs macro_save_succeeded with it,
 * and the Publish handler reports macro_publish_completed.operation_mode with
 * it. Read BEFORE the save runs; a page copy keeps the source id, so it is an
 * edit here, matching the save event.
 */
export function isFirstSave(diagram: Pick<Diagram, 'id'>): boolean {
  return !diagram.id;
}
