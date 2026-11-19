/**
 * SPIKE ONLY — not for merge. Microsoft Clarity bundled from npm (no remote
 * script, so Forge CSP script-src is not touched) and uploading through
 * stats.zenuml.com/clarity/collect (no new egress host). Runs only when
 * VITE_CLARITY_PROJECT_ID is set at Vite start (local forge tunnel).
 */
import { clarity } from "clarity-js";

const UPLOAD = "https://stats.zenuml.com/clarity/collect";
let started = false;

export function startClarityReplaySpike(accountId?: string, moduleKey?: string): void {
  const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined;
  if (!projectId || started) return;
  started = true;
  try {
    clarity.start({ projectId, upload: UPLOAD, track: true, content: true });
    if (accountId) clarity.identify(accountId);
    clarity.set("moduleKey", moduleKey || "unknown");
    fetch(`https://stats.zenuml.com/spike-debug?stage=clarity_started&d=${encodeURIComponent(moduleKey || "")}`, { mode: "no-cors" }).catch(() => {});
  } catch (e) {
    fetch(`https://stats.zenuml.com/spike-debug?stage=clarity_threw&d=${encodeURIComponent(String((e as any)?.message || e))}`, { mode: "no-cors" }).catch(() => {});
  }
}
