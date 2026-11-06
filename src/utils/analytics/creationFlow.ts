// src/utils/analytics/creationFlow.ts
//
// Create-funnel attribution (#614): which surface started a create, and one key
// that joins its start, success and cancel events.
//
// Origin
// ------
// Every editor-hosted create records `entry_point: page_editor`, so the byline
// and the dashboard are invisible on macro_create_started / _succeeded. The
// initiating surface opens the editor with `openModal({ context })`, and Forge
// hands that object to the modal iframe as `extension.modal`; the surface puts
// `creationOrigin` there and the editor reads it back here. Nothing carried
// means the ordinary page-editor path.
//
// Correlation key
// ---------------
// `creation_flow_id` is generated the first time a create event is emitted in
// an editor iframe and reused by every later one. One editor per iframe (same
// reasoning as editorCloseOutcome), so module state is enough: start, success
// and cancel all happen in the iframe that mounted the editor, even though the
// byline that opened it is a different iframe. Existing keys do not cover it:
// `macro_uuid` is the Forge localId and a byline create has no macro yet;
// `journey_id` rides only on macro_authoring_ended.

import forgeGlobal from "@/model/globals/forgeGlobal";
import { CREATION_ORIGINS, type CreationOrigin } from "./catalog";

export type CreationFlowProps = {
  creation_origin: CreationOrigin;
  creation_flow_id: string;
};

function isCreationOrigin(value: unknown): value is CreationOrigin {
  return (CREATION_ORIGINS as readonly unknown[]).includes(value);
}

/** The origin a byline stamps on the modal it opens, from the host page mode. */
export function bylineCreationOrigin(hostInEditor: boolean): CreationOrigin {
  return hostInEditor ? "byline_editor" : "byline_view";
}

/**
 * Read the origin from a Forge context. Not carried → `page_editor`. Carried
 * but unrecognised → `unknown`, so a typo or a newer surface shows up as its
 * own bucket rather than inflating the page-editor one. A byline modal opened
 * by a build that predates `creationOrigin` also lands in `unknown`: its
 * `origin: 'byline'` marker rules out the page editor but not the host mode.
 */
export function resolveCreationOrigin(context: unknown): CreationOrigin {
  const modal = (context as any)?.extension?.modal;
  const carried = modal?.creationOrigin;
  if (carried !== undefined && carried !== null) {
    return isCreationOrigin(carried) ? carried : "unknown";
  }
  if (modal?.origin === "byline") return "unknown";
  return "page_editor";
}

function newFlowId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let flow: CreationFlowProps | null = null;

/**
 * The create-funnel properties for this editor iframe. Spread into
 * macro_create_started, macro_create_succeeded and macro_create_cancelled;
 * never into the edit events. Safe to call from any of them first: a success
 * that fires without a start (the paywall defers the DSL editor's start) still
 * gets a flow id, and every later call returns the same one.
 */
export function getCreationFlowProps(): CreationFlowProps {
  if (!flow) {
    flow = {
      creation_origin: resolveCreationOrigin(forgeGlobal.forgeContext),
      creation_flow_id: newFlowId(),
    };
  }
  return flow;
}

// Test-only: reset module state between cases.
export function _resetCreationFlowForTesting(): void {
  flow = null;
}
