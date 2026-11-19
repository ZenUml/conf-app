/**
 * SPIKE ONLY — not for merge. Statsig session replay routed through
 * stats.zenuml.com, so no new Forge egress host (manifest already allows
 * https://*.zenuml.com). Runs only when VITE_STATSIG_CLIENT_KEY is set at
 * Vite start, i.e. only in a local forge tunnel session.
 */
import { StatsigClient } from "@statsig/js-client";
import { runStatsigSessionReplay } from "@statsig/session-replay";

const PROXY = "https://stats.zenuml.com";
const STATSIG_HOSTS = /^https:\/\/(featureassets\.org|prodregistryv2\.org|statsigapi\.net)/;

let started = false;

function ping(stage: string, detail = ""): void {
  try {
    fetch(`${PROXY}/spike-debug?stage=${encodeURIComponent(stage)}&d=${encodeURIComponent(detail.slice(0, 200))}`, { mode: "no-cors" }).catch(() => {});
  } catch {}
}
ping("module_loaded");

export function startStatsigReplaySpike(accountId?: string, moduleKey?: string): void {
  const key = import.meta.env.VITE_STATSIG_CLIENT_KEY as string | undefined;
  ping("start_called", `key=${!!key} started=${started} mk=${moduleKey}`);
  if (!key || started) return;
  started = true;
  try {
    const client = new StatsigClient(
      key,
      { userID: accountId || "anonymous-spike", custom: { moduleKey: moduleKey || "unknown" } },
      {
        networkConfig: {
          api: `${PROXY}/v1`,
          networkOverrideFunc: (url: string, init: RequestInit) =>
            fetch(url.replace(STATSIG_HOSTS, PROXY), init),
        },
      },
    );
    runStatsigSessionReplay(client);
    client
      .initializeAsync()
      .then(() => {
        client.logEvent("statsig_spike_iframe_loaded", moduleKey || "unknown");
        ping("init_ok", String(client.loadingStatus));
      })
      .catch((e) => ping("init_failed", String(e?.message || e)));
    (window as any).__statsigSpike = client;
  } catch (e) {
    ping("setup_threw", String((e as any)?.message || e));
  }
}
