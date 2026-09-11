/**
 * Policy for when the AI Repair CTA may be offered.
 *
 * `useSustainedFlag` is the mechanism (a rising-edge delay); this module owns
 * the single number that decides how long a syntax error must stand still
 * before the button is worth showing. Import it — do not restate the value in
 * a component, a spec, a story, or a doc comment, or the four copies drift.
 *
 * Why a delay at all: Editor.vue clears the Vuex error on every keystroke and
 * the debounced validator restores it one second after typing stops. Gating
 * the button on the raw error therefore made it blink in and out once per
 * typing pause, and fired one `ai_repair_button_shown` per blink. Waiting for
 * the error to stand still means the button appears at roughly
 * AI_REPAIR_ARM_DELAY_MS + the editor's own 1s validation debounce — the point
 * at which the author has genuinely stopped, rather than paused mid-sentence.
 *
 * Raising this makes the CTA rarer and the impression event a stronger signal
 * of a stuck author; lowering it does the reverse. Changing it changes what
 * `ai_repair_button_shown` counts, so record the date in
 * src/utils/analytics/catalog.ts when you do.
 */
export const AI_REPAIR_ARM_DELAY_MS = 2000;
