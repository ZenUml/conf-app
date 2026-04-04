import { MixpanelTrackPayload } from "./mixpanelService";

export interface ForgeConfluenceSpace {
  id?: number;
  key?: string;
  alias?: string;
  name?: string;
  type?: string;
  status?: string;
}

export interface ForgeConfluenceVersion {
  by?: {
    accountId?: string;
  };
  when?: string;
  number?: number;
}

export interface ForgeConfluenceContent {
  id: string;
  type: "page" | "blogpost";
  subType?: "live";
  status?: string;
  title?: string;
  space?: ForgeConfluenceSpace;
  version?: ForgeConfluenceVersion;
}

export interface ForgeUserBehaviorEventBody {
  eventType: string;
  atlassianId?: string;
  eventCreatedDate?: string;
  suppressNotifications?: boolean;
  updateTrigger?: string;
  content: ForgeConfluenceContent;
}

interface ForgeInvocationTokenPayload {
  payload?: {
    principal?: string;
    app?: {
      id?: string;
      version?: string;
      appVersion?: string;
      installationId?: string;
      apiBaseUrl?: string;
      module?: {
        key?: string;
      };
      environment?: {
        id?: string;
        type?: string;
      };
      installation?: {
        id?: string;
      };
    };
    context?: {
      cloudId?: string;
      environmentId?: string;
      environmentType?: string;
      moduleKey?: string;
      siteUrl?: string;
    };
  };
}

interface ForgeUserBehaviorOptions {
  clientDomain?: string | null;
}

const EVENT_ACTIONS: Record<ForgeUserBehaviorEventBody["eventType"], string> = {
  "avi:confluence:viewed:page": "page_viewed",
  "avi:confluence:updated:page": "page_updated",
};

function extractCloudId(apiBaseUrl?: string): string | undefined {
  if (!apiBaseUrl) {
    return undefined;
  }

  const match = apiBaseUrl.match(/\/ex\/confluence\/([a-f0-9-]+)/i);
  return match?.[1];
}

function getClientDomain(siteUrl?: string, fallbackClientDomain?: string | null): string {
  if (!siteUrl) {
    return fallbackClientDomain || "unknown_atlassian_domain";
  }

  try {
    return new URL(siteUrl).hostname;
  } catch (error) {
    console.log("Could not parse siteUrl for Forge behavior event", error);
    return fallbackClientDomain || "unknown_atlassian_domain";
  }
}

export function mapForgeUserBehaviorEvent(
  event: ForgeUserBehaviorEventBody,
  forgeContext: ForgeInvocationTokenPayload,
  options: ForgeUserBehaviorOptions = {},
): MixpanelTrackPayload | null {
  if (event.content.type !== "page") {
    return null;
  }

  if (event.content.subType === "live") {
    return null;
  }

  const action = EVENT_ACTIONS[event.eventType];
  if (!action) {
    return null;
  }

  const payload = forgeContext.payload;
  const tokenContext = payload?.context;
  const app = payload?.app;
  const cloudId = tokenContext?.cloudId || extractCloudId(app?.apiBaseUrl) || "unknown_cloud_id";
  const distinctId = event.atlassianId || payload?.principal || "unknown_user_account_id";

  return {
    action,
    event_source: "forge_trigger",
    event_category: "user",
    event_label: event.content.id,
    event_type: event.eventType,
    event_created_date: event.eventCreatedDate,
    suppress_notifications: event.suppressNotifications ?? false,
    update_trigger: event.updateTrigger,
    user_account_id: distinctId,
    atlassian_user_id: distinctId,
    client_domain: getClientDomain(tokenContext?.siteUrl, options.clientDomain),
    confluence_space: event.content.space?.key || "unknown_space",
    isForge: true,
    forge_app_id: app?.id,
    forge_app_version: app?.appVersion || app?.version,
    forge_environment_id: app?.environment?.id || tokenContext?.environmentId,
    forge_environment_type: app?.environment?.type || tokenContext?.environmentType,
    forge_installation_id: app?.installationId || app?.installation?.id,
    forge_module_key: tokenContext?.moduleKey || app?.module?.key,
    cloud_id: cloudId,
    content_id: event.content.id,
    content_type: event.content.type,
    content_status: event.content.status,
    content_sub_type: event.content.subType || "none",
    content_title: event.content.title,
    content_version_number: event.content.version?.number,
    content_version_when: event.content.version?.when,
    content_version_by: event.content.version?.by?.accountId,
    space_id: event.content.space?.id,
    space_key: event.content.space?.key,
    space_name: event.content.space?.name,
  };
}
