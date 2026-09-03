import { mixpanelImportServiceEvents } from '../../service/mixpanelService';
import type { AnalyticsEventName } from '../../service/analyticsTypes';
import {
  executeExtensionAction,
  ExtensionActionError,
  type ExtensionAction,
  type ExtensionCommand,
} from '../../service/extensionActionService';
import {
  createExtensionActionRuntime,
  type ExtensionActionEnv,
} from '../../service/extensionActionRuntime';

interface Env extends ExtensionActionEnv {
  EXTENSION_AUTOMATION_SECRET?: string;
  MIXPANEL_TOKEN?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function hasValidAutomationSecret(request: Request, env: Env): boolean {
  if (!env.EXTENSION_AUTOMATION_SECRET) return false;
  return request.headers.get('Authorization') === `Bearer ${env.EXTENSION_AUTOMATION_SECRET}`;
}

async function readCommand(request: Request): Promise<ExtensionCommand | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { outcome: 'validation_failed', error: 'invalid_json' });
  }

  if (!body || typeof body !== 'object') {
    return jsonResponse(400, { outcome: 'validation_failed', error: 'invalid_command' });
  }

  const command = body as Partial<ExtensionCommand>;
  if (command.action !== 'initial' && command.action !== 'feedback') {
    return jsonResponse(400, { outcome: 'validation_failed', error: 'invalid_action' });
  }

  if (
    typeof command.ticketKey !== 'string'
    || typeof command.requestTypeId !== 'string'
    || typeof command.planOptionId !== 'string'
    || typeof command.description !== 'string'
  ) {
    return jsonResponse(400, { outcome: 'validation_failed', error: 'invalid_command' });
  }
  if ('days' in body || 'scope' in body) {
    return jsonResponse(400, { outcome: 'validation_failed', error: 'policy_override_rejected' });
  }

  return command as ExtensionCommand;
}

function emitEvent(
  env: Env,
  event: AnalyticsEventName,
  action: ExtensionAction,
  properties: Record<string, string | number | boolean | null>,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  if (!env.MIXPANEL_TOKEN) return;
  const delivery = mixpanelImportServiceEvents([{
    event,
    distinctId: 'support-extension-automation',
    insertId: crypto.randomUUID(),
    time: Math.floor(Date.now() / 1000),
    properties: {
      feature_area: 'upgrade',
      surface: 'support_automation',
      source: 'jsm_manual_action',
      extension_action: action,
      extension_scope: 'user',
      extension_days: action === 'initial' ? 7 : 15,
      ...properties,
    },
  }], env.MIXPANEL_TOKEN).catch((error) => {
    console.warn('[extension-action] Mixpanel delivery failed', {
      event,
      reason: error instanceof Error ? error.name : 'unknown_error',
    });
  });
  if (waitUntil) waitUntil(delivery);
  else void delivery;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method !== 'POST') {
    return jsonResponse(405, { outcome: 'validation_failed', error: 'method_not_allowed' });
  }
  if (!env.EXTENSION_AUTOMATION_SECRET) {
    return jsonResponse(500, { outcome: 'temporary_failure', error: 'server_configuration' });
  }
  if (!hasValidAutomationSecret(request, env)) {
    return jsonResponse(401, {
      outcome: 'validation_failed',
      error: 'unauthorized',
    });
  }

  const command = await readCommand(request);
  if (command instanceof Response) return command;
  const startedAt = Date.now();
  emitEvent(env, 'extension_action_requested', command.action, {}, waitUntil);

  try {
    const result = await executeExtensionAction(command, createExtensionActionRuntime(env));
    emitEvent(env, 'extension_action_succeeded', command.action, {
      extension_action_outcome: result.outcome,
      macro_count: result.macroCount,
      client_domain: result.clientDomain,
      confluence_space: result.spaceKey,
      duration_ms: Date.now() - startedAt,
    }, waitUntil);
    return jsonResponse(200, result);
  } catch (error) {
    if (error instanceof ExtensionActionError) {
      emitEvent(env, 'extension_action_failed', command.action, {
        extension_failure_stage: error.stage,
        failure_reason: error.code,
        duration_ms: Date.now() - startedAt,
      }, waitUntil);
      return jsonResponse(error.status, {
        outcome: error.retryable ? 'temporary_failure' : 'validation_failed',
        error: error.code,
        retryable: error.retryable,
      });
    }
    emitEvent(env, 'extension_action_failed', command.action, {
      extension_failure_stage: 'unexpected',
      failure_reason: 'unexpected_error',
      duration_ms: Date.now() - startedAt,
    }, waitUntil);
    console.error('[extension-action] unexpected failure', {
      reason: error instanceof Error ? error.name : 'unknown_error',
    });
    return jsonResponse(500, {
      outcome: 'temporary_failure',
      error: 'unexpected_error',
      retryable: true,
    });
  }
};
