import {
  enqueueWebAccessRpcRequest,
  isWebAccessRelayMethod,
} from "../../../../../../../services/mobile-web-access/relay";
import {
  webAccessRelayRepository,
} from "../../../../../../../services/mobile-web-access/local";
import { readBoundedJsonObject } from "../../../../../../../services/http/bounded-json";
import { unauthorized, verifyRequest } from "../../../../../../../services/vms/auth";
import {
  webAccessBrowserMutationOriginAllowed,
} from "../../../../../../../services/mobile-web-access/browser-origin";
import {
  webConnectJsonResponse,
  webConnectResponse,
} from "../../../../../../../services/mobile-web-access/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 512 * 1024;

type RelayRpcRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function POST(
  request: Request,
  { params }: RelayRpcRouteProps,
): Promise<Response> {
  if (!webAccessBrowserMutationOriginAllowed(request)) {
    return webConnectJsonResponse({ error: "forbidden" }, 403);
  }
  const { slug } = await params;
  const browserToken = browserTokenFromRequest(request);
  const user = browserToken
    ? null
    : await verifyRequest(request, {
      allowCookie: true,
      includeTeams: true,
    });
  if (!browserToken && !user) return webConnectResponse(unauthorized());

  const body = await readBoundedJsonObject(request, MAX_REQUEST_BYTES);
  if (!body.ok) {
    return webConnectJsonResponse({ error: "invalid_request" }, body.status);
  }
  if (!isWebAccessRelayMethod(body.value.method)) {
    return webConnectJsonResponse({ error: "invalid_method" }, 400);
  }

  const queued = await enqueueWebAccessRpcRequest(
    {
      slug,
      ...(browserToken
        ? { browserToken }
        : {
          userId: user!.id,
          teamIds: uniqueTeamIds([user!.id, user!.selectedTeamId, user!.billingTeamId, ...user!.teamIds]),
        }),
      method: body.value.method,
      params: recordOrEmpty(body.value.params),
    },
    webAccessRelayRepository(),
  );
  if (!queued.ok && queued.reason === "not_found") {
    return webConnectJsonResponse({ error: "web_access_session_not_found" }, 404);
  }
  if (!queued.ok) {
    return webConnectJsonResponse({ error: "web_access_relay_queue_full" }, 429);
  }

  return webConnectJsonResponse({
    requestId: queued.request.id,
    statusToken: queued.statusToken,
    status: "pending",
    expiresAt: queued.request.expiresAt,
  }, 202);
}

function browserTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("x-cmux-web-access-browser-token")?.trim();
  return header || null;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueTeamIds(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}
