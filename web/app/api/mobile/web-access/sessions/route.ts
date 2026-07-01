import {
  createWebAccessSession,
  listOwnerWebAccessSessions,
} from "../../../../../services/mobile-web-access/sessions";
import {
  localWebAccessControlTokenAllowed,
  localWebAccessEnabled,
  webAccessSessionRepository,
} from "../../../../../services/mobile-web-access/local";
import {
  webConnectResponse,
  webConnectJsonResponse,
} from "../../../../../services/mobile-web-access/response";
import {
  resolveDeviceRegistryTeam,
} from "../../../../../services/device-registry";
import { readOptionalBoundedJsonObject } from "../../../../../services/http/bounded-json";
import { unauthorized, verifyRequest } from "../../../../../services/vms/auth";
import {
  requestedVmTeamIdFromRequest,
} from "../../../../../services/vms/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 4 * 1024;

export async function GET(request: Request): Promise<Response> {
  if (localWebAccessEnabled()) {
    if (!localWebAccessRequestAllowed(request)) return webConnectResponse(unauthorized());
    return webConnectJsonResponse({ sessions: [] });
  }

  const user = await verifyRequest(request, {
    requestedTeamId: requestedVmTeamIdFromRequest(request),
    allowCookie: true,
    includeTeams: true,
  });
  if (!user) return webConnectResponse(unauthorized());

  const team = resolveDeviceRegistryTeam(request, user);
  if (!team.ok) {
    return webConnectJsonResponse({ error: team.error }, 403);
  }

  const sessions = await listOwnerWebAccessSessions(
    {
      userId: user.id,
      teamIds: uniqueTeamIds([team.teamId, user.selectedTeamId, user.billingTeamId, ...user.teamIds]),
    },
    webAccessSessionRepository(),
  );

  return webConnectJsonResponse({ sessions });
}

export async function POST(request: Request): Promise<Response> {
  const body = await readOptionalBoundedJsonObject(request, MAX_REQUEST_BYTES);
  if (!body.ok) {
    return webConnectJsonResponse({ error: "invalid_request" }, body.status);
  }

  const localOnly = localWebAccessEnabled();
  if (localOnly && !localWebAccessRequestAllowed(request)) return webConnectResponse(unauthorized());
  const user = localOnly ? null : await verifyRequest(request, {
    requestedTeamId: requestedVmTeamIdFromRequest(request),
    allowCookie: false,
  });
  if (!user && !localOnly) return webConnectResponse(unauthorized());

  const team = user ? resolveDeviceRegistryTeam(request, user) : null;
  if (team && !team.ok) {
    return webConnectJsonResponse({ error: team.error }, 403);
  }
  const deviceId = optionalString(body.value.deviceId);

  const session = await createWebAccessSession(
    {
      userId: user?.id ?? `local:${deviceId ?? "host"}`,
      teamId: team?.teamId ?? "local-web-access",
      deviceId,
      displayName: optionalString(body.value.displayName),
    },
    webAccessSessionRepository(),
  );
  const publicUrl = publicWebAccessUrl({
    request,
    publicOrigin: optionalString(body.value.publicOrigin),
    slug: session.slug,
    browserToken: session.browserToken,
  });

  return webConnectJsonResponse({
    slug: session.slug,
    publicUrl,
    hostToken: session.hostToken,
    expiresAt: session.expiresAt,
  });
}

function localWebAccessRequestAllowed(request: Request): boolean {
  if (!localWebAccessEnabled()) {
    return false;
  }
  if (!localWebAccessControlTokenAllowed(request)) {
    return false;
  }
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function publicWebAccessUrl(input: {
  request: Request;
  publicOrigin: string | null;
  slug: string;
  browserToken: string;
}): string {
  const base = validHttpOrigin(input.publicOrigin) ?? new URL(input.request.url).origin;
  const url = new URL(`/w/${input.slug}`, base);
  url.searchParams.set("access_token", input.browserToken);
  return url.toString();
}

function validHttpOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function uniqueTeamIds(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}
