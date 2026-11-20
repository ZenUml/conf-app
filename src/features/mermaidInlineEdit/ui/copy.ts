import type { EditRejection } from '../types';

/** Toast text per rejection. Final wording: sentence case, no jargon. */
export const REJECTION_MESSAGES: Record<EditRejection, string> = {
  stale_source: 'The diagram changed while you were editing. Try again.',
  name_exists: 'A participant with that name already exists.',
  invalid_characters: "That text has characters Mermaid can't use here.",
  empty: "A name can't be empty.",
  position_mismatch: "Couldn't edit this element. Edit it in the code instead.",
};

export const INPUT_LABELS = {
  participantLabel: 'Edit participant name',
  messageText: 'Edit message text',
} as const;
