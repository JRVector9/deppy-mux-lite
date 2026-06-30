import { getWebAccessRpcRequestStatus } from "../../../../../../../../services/mobile-web-access/relay";
import { webAccessRelayRepository } from "../../../../../../../../services/mobile-web-access/local";
import { jsonResponse } from "../../../../../../../../services/vms/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RelayRpcStatusRouteProps = {
  params: Promise<{ slug: string; requestId: string }>;
};

export async function GET(
  request: Request,
  { params }: RelayRpcStatusRouteProps,
): Promise<Response> {
  const { slug, requestId } = await params;
  const statusToken = request.headers.get("x-cmux-web-access-status-token")?.trim();
  if (!statusToken) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const status = await getWebAccessRpcRequestStatus(
    {
      slug,
      requestId,
      statusToken,
    },
    webAccessRelayRepository(),
  );
  if (!status) {
    return jsonResponse({ error: "web_access_rpc_request_not_found" }, 404);
  }
  return jsonResponse(status);
}
