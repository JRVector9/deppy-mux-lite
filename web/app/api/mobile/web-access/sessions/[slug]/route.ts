import {
  getPublicWebAccessSession,
  markWebAccessHostSeen,
} from "../../../../../../services/mobile-web-access/sessions";
import {
  webAccessSessionRepository,
} from "../../../../../../services/mobile-web-access/local";
import {
  webConnectJsonResponse,
} from "../../../../../../services/mobile-web-access/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(
  _request: Request,
  { params }: SessionRouteProps,
): Promise<Response> {
  const { slug } = await params;
  const session = await getPublicWebAccessSession(slug, new Date(), webAccessSessionRepository());
  if (!session) {
    return webConnectJsonResponse({ error: "web_access_session_not_found" }, 404);
  }
  return webConnectJsonResponse({ session });
}

export async function POST(
  request: Request,
  { params }: SessionRouteProps,
): Promise<Response> {
  const { slug } = await params;
  const hostToken = request.headers.get("x-cmux-web-access-host-token")?.trim();
  if (!hostToken) {
    return webConnectJsonResponse({ error: "unauthorized" }, 401);
  }
  const now = new Date();
  const ok = await markWebAccessHostSeen({ slug, hostToken, now }, webAccessSessionRepository());
  if (!ok) {
    return webConnectJsonResponse({ error: "web_access_session_not_found" }, 404);
  }
  return webConnectJsonResponse({ ok: true, hostSeenAt: now.toISOString() });
}
