import {
  claimWebAccessRpcRequests,
  completeWebAccessRpcRequest,
} from "../../../../../../../services/mobile-web-access/relay";
import { readBoundedJsonObject } from "../../../../../../../services/http/bounded-json";
import { jsonResponse } from "../../../../../../../services/vms/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 512 * 1024;

type HostRelayRpcRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(
  request: Request,
  { params }: HostRelayRpcRouteProps,
): Promise<Response> {
  const { slug } = await params;
  const hostToken = hostTokenFromRequest(request);
  if (!hostToken) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? "25");
  const requests = await claimWebAccessRpcRequests({
    slug,
    hostToken,
    limit: Number.isFinite(requestedLimit) ? requestedLimit : 25,
  });
  if (!requests) {
    return jsonResponse({ error: "web_access_session_not_found" }, 404);
  }
  return jsonResponse({ requests });
}

export async function POST(
  request: Request,
  { params }: HostRelayRpcRouteProps,
): Promise<Response> {
  const { slug } = await params;
  const hostToken = hostTokenFromRequest(request);
  if (!hostToken) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const body = await readBoundedJsonObject(request, MAX_REQUEST_BYTES);
  if (!body.ok) {
    return jsonResponse({ error: "invalid_request" }, body.status);
  }
  const requestId = typeof body.value.requestId === "string" ? body.value.requestId.trim() : "";
  if (!requestId) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const ok = await completeWebAccessRpcRequest({
    slug,
    hostToken,
    requestId,
    completion: completionFromBody(body.value),
  });
  if (!ok) {
    return jsonResponse({ error: "web_access_rpc_request_not_found" }, 404);
  }
  return jsonResponse({ ok: true });
}

function completionFromBody(value: Record<string, unknown>) {
  if (value.ok === false) {
    const error = value.error;
    const message = error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "Mobile RPC request failed")
      : "Mobile RPC request failed";
    const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
    return { ok: false as const, error: { ...(code ? { code } : {}), message } };
  }
  return { ok: true as const, result: value.result ?? null };
}

function hostTokenFromRequest(request: Request): string | null {
  return request.headers.get("x-cmux-web-access-host-token")?.trim() || null;
}
