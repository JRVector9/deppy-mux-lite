import { getWebAccessRpcRequestStatus } from "../../../../../../../../services/mobile-web-access/relay";
import { webAccessRelayRepository } from "../../../../../../../../services/mobile-web-access/local";
import {
  webConnectJsonResponse,
} from "../../../../../../../../services/mobile-web-access/response";

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
    return webConnectJsonResponse({ error: "unauthorized" }, 401);
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
    return webConnectJsonResponse({ error: "web_access_rpc_request_not_found" }, 404);
  }
  return webConnectJsonResponse(status);
}
