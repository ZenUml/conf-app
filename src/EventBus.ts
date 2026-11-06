// @ts-ignore
import emitter from 'tiny-emitter/instance'
import type { Diagram, DiagramType } from '@/model/Diagram/Diagram'
import type { Draft } from '@/utils/draftStore'

export interface DraftEventPayload {
  /** `edit:<custom-content-id>` or `new:<diagram-type>`. */
  scope: string
  draft: Draft
}

/**
 * Every event on the global bus and the arguments it carries (#936). An
 * unknown name or a wrong payload is a type error in `.ts` callers;
 * tests/unit/eventBusEvents.spec.ts checks every emitted name has a listener.
 */
export interface EventBusEvents {
  // Viewer
  edit: [params?: Record<string, unknown>]
  fullscreen: [options?: { openExport?: boolean }]
  closeFullscreen: []
  viewerRenderSettled: [kind: string]
  diagramLoaded: [code: string, diagramType: DiagramType]
  // Editor
  save: []
  'save-embed': [selected: unknown]
  saved: [id: string]
  'save-error': [error: unknown]
  /** Omitted (DocumentList) means exit without the unsaved-changes warning. */
  exit: [showWarning?: boolean]
  updateContent: [diagram: Diagram]
  'flash-title-error': []
  'draft-available': [payload: DraftEventPayload]
  'draft-restore': [payload: DraftEventPayload]
}

export type EventBusEvent = keyof EventBusEvents
type Handler<E extends EventBusEvent> = (...args: EventBusEvents[E]) => unknown

export default {
  $on: <E extends EventBusEvent>(event: E, handler: Handler<E>) => emitter.on(event, handler),
  $once: <E extends EventBusEvent>(event: E, handler: Handler<E>) => emitter.once(event, handler),
  $off: <E extends EventBusEvent>(event: E, handler?: Handler<E>) => emitter.off(event, handler),
  $emit: <E extends EventBusEvent>(event: E, ...args: EventBusEvents[E]) => emitter.emit(event, ...args),
}
