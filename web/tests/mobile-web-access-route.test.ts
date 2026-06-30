import { describe, expect, test } from "bun:test";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.NEXT_PUBLIC_STACK_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY = "test-publishable-key";
process.env.STACK_SECRET_SERVER_KEY = "test-secret-key";

const {
  GET: listSessions,
  POST: createSession,
} = await import("../app/api/mobile/web-access/sessions/route");
const {
  GET: getSession,
} = await import("../app/api/mobile/web-access/sessions/[slug]/route");
const {
  POST: enqueueRpc,
} = await import("../app/api/mobile/web-access/sessions/[slug]/rpc/route");
const {
  GET: claimHostRpc,
  POST: completeHostRpc,
} = await import("../app/api/mobile/web-access/sessions/[slug]/host-rpc/route");
const {
  GET: getRpcStatus,
} = await import("../app/api/mobile/web-access/sessions/[slug]/rpc/[requestId]/route");
const {
  WEB_CONNECT_COMPATIBILITY_HEADER,
  WEB_CONNECT_COMPATIBILITY_VALUE,
  webConnectResponse,
} = await import("../services/mobile-web-access/response");

describe("mobile web access route", () => {
  test("marks responses as Web Connect compatible", () => {
    const response = webConnectResponse(new Response("unauthorized", { status: 401 }));

    expect(response.status).toBe(401);
    expect(response.headers.get(WEB_CONNECT_COMPATIBILITY_HEADER)).toBe(WEB_CONNECT_COMPATIBILITY_VALUE);
  });

  test("rejects unauthenticated localhost create when local-only mode is disabled", async () => {
    const previous = process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
    delete process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
    try {
      const response = await createSession(createSessionRequest("http://localhost:49152"));

      expect(response.status).toBe(401);
      expect(response.headers.get(WEB_CONNECT_COMPATIBILITY_HEADER)).toBe(WEB_CONNECT_COMPATIBILITY_VALUE);
    } finally {
      restoreLocalOnly(previous);
    }
  });

  test("allows unauthenticated localhost create in local-only mode", async () => {
    const previousLocalOnly = process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
    const previousToken = process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN;
    process.env.CMUX_WEB_CONNECT_LOCAL_ONLY = "1";
    process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN = "test-local-token";
    try {
      const response = await createSession(createSessionRequest("http://localhost:49153", "test-local-token"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get(WEB_CONNECT_COMPATIBILITY_HEADER)).toBe(WEB_CONNECT_COMPATIBILITY_VALUE);
      expect(typeof body.slug).toBe("string");
      expect(typeof body.hostToken).toBe("string");
      expect(typeof body.publicUrl).toBe("string");
      expect(body.publicUrl.startsWith("http://deppy-test.tailnet.test/w/")).toBe(true);
    } finally {
      restoreLocalOnly(previousLocalOnly);
      restoreLocalToken(previousToken);
    }
  });

  test("allows local-only localhost session list probe with the local token", async () => {
    const previousLocalOnly = process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
    const previousToken = process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN;
    process.env.CMUX_WEB_CONNECT_LOCAL_ONLY = "1";
    process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN = "test-local-token";
    try {
      const response = await listSessions(localSessionListRequest("http://localhost:49158", "test-local-token"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get(WEB_CONNECT_COMPATIBILITY_HEADER)).toBe(WEB_CONNECT_COMPATIBILITY_VALUE);
      expect(body).toEqual({ sessions: [] });
    } finally {
      restoreLocalOnly(previousLocalOnly);
      restoreLocalToken(previousToken);
    }
  });

  test("allows local-only session list probe when the standalone server reports 0.0.0.0", async () => {
    const previousLocalOnly = process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
    const previousToken = process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN;
    process.env.CMUX_WEB_CONNECT_LOCAL_ONLY = "1";
    process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN = "test-local-token";
    try {
      const response = await listSessions(localSessionListRequest("http://0.0.0.0:49160", "test-local-token"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get(WEB_CONNECT_COMPATIBILITY_HEADER)).toBe(WEB_CONNECT_COMPATIBILITY_VALUE);
      expect(body).toEqual({ sessions: [] });
    } finally {
      restoreLocalOnly(previousLocalOnly);
      restoreLocalToken(previousToken);
    }
  });

  test("rejects local-only localhost session list probe without the local token", async () => {
    const previousLocalOnly = process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
    const previousToken = process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN;
    process.env.CMUX_WEB_CONNECT_LOCAL_ONLY = "1";
    process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN = "test-local-token";
    try {
      const response = await listSessions(localSessionListRequest("http://localhost:49159"));

      expect(response.status).toBe(401);
      expect(response.headers.get(WEB_CONNECT_COMPATIBILITY_HEADER)).toBe(WEB_CONNECT_COMPATIBILITY_VALUE);
    } finally {
      restoreLocalOnly(previousLocalOnly);
      restoreLocalToken(previousToken);
    }
  });

  test("rejects unauthenticated localhost create when local-only token is missing", async () => {
    const previousLocalOnly = process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
    const previousToken = process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN;
    process.env.CMUX_WEB_CONNECT_LOCAL_ONLY = "1";
    process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN = "test-local-token";
    try {
      const response = await createSession(createSessionRequest("http://localhost:49154"));

      expect(response.status).toBe(401);
      expect(response.headers.get(WEB_CONNECT_COMPATIBILITY_HEADER)).toBe(WEB_CONNECT_COMPATIBILITY_VALUE);
    } finally {
      restoreLocalOnly(previousLocalOnly);
      restoreLocalToken(previousToken);
    }
  });

  test("rejects unauthenticated localhost create when local-only token is wrong", async () => {
    const previousLocalOnly = process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
    const previousToken = process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN;
    process.env.CMUX_WEB_CONNECT_LOCAL_ONLY = "1";
    process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN = "test-local-token";
    try {
      const response = await createSession(createSessionRequest("http://localhost:49155", "wrong-token"));

      expect(response.status).toBe(401);
      expect(response.headers.get(WEB_CONNECT_COMPATIBILITY_HEADER)).toBe(WEB_CONNECT_COMPATIBILITY_VALUE);
    } finally {
      restoreLocalOnly(previousLocalOnly);
      restoreLocalToken(previousToken);
    }
  });

  test("rejects local-only create for non-loopback request hosts even with token", async () => {
    const previousLocalOnly = process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
    const previousToken = process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN;
    process.env.CMUX_WEB_CONNECT_LOCAL_ONLY = "1";
    process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN = "test-local-token";
    try {
      const response = await createSession(createSessionRequest("http://example.test:49156", "test-local-token"));

      expect(response.status).toBe(401);
      expect(response.headers.get(WEB_CONNECT_COMPATIBILITY_HEADER)).toBe(WEB_CONNECT_COMPATIBILITY_VALUE);
    } finally {
      restoreLocalOnly(previousLocalOnly);
      restoreLocalToken(previousToken);
    }
  });

  test("uses the local in-memory repositories from create through browser RPC completion", async () => {
    const previousLocalOnly = process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
    const previousToken = process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN;
    process.env.CMUX_WEB_CONNECT_LOCAL_ONLY = "1";
    process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN = "test-local-token";
    try {
      const origin = "http://localhost:49157";
      const createResponse = await createSession(createSessionRequest(origin, "test-local-token", origin));
      const created = await createResponse.json();
      const slug = String(created.slug);
      const hostToken = String(created.hostToken);
      const browserToken = new URL(String(created.publicUrl)).searchParams.get("access_token") ?? "";

      expect(createResponse.status).toBe(200);
      expect(slug).toBeTruthy();
      expect(hostToken).toBeTruthy();
      expect(browserToken).toBeTruthy();

      const publicResponse = await getSession(
        new Request(`${origin}/api/mobile/web-access/sessions/${slug}`),
        routeParams({ slug }),
      );
      const publicBody = await publicResponse.json();
      expect(publicResponse.status).toBe(200);
      expect(publicBody.session.slug).toBe(slug);

      const enqueueResponse = await enqueueRpc(
        new Request(`${origin}/api/mobile/web-access/sessions/${slug}/rpc`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            "x-cmux-web-access-browser-token": browserToken,
          },
          body: JSON.stringify({
            method: "terminal.input",
            params: { text: "echo ok" },
          }),
        }),
        routeParams({ slug }),
      );
      const queued = await enqueueResponse.json();
      expect(enqueueResponse.status).toBe(202);
      expect(queued.requestId).toBeTruthy();
      expect(queued.statusToken).toBeTruthy();

      const claimResponse = await claimHostRpc(
        new Request(`${origin}/api/mobile/web-access/sessions/${slug}/host-rpc?limit=10`, {
          headers: { "x-cmux-web-access-host-token": hostToken },
        }),
        routeParams({ slug }),
      );
      const claimed = await claimResponse.json();
      expect(claimResponse.status).toBe(200);
      expect(claimed.requests).toHaveLength(1);
      expect(claimed.requests[0].id).toBe(queued.requestId);

      const completeResponse = await completeHostRpc(
        new Request(`${origin}/api/mobile/web-access/sessions/${slug}/host-rpc`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-cmux-web-access-host-token": hostToken,
          },
          body: JSON.stringify({
            requestId: queued.requestId,
            ok: true,
            result: { accepted: true },
          }),
        }),
        routeParams({ slug }),
      );
      expect(completeResponse.status).toBe(200);

      const statusResponse = await getRpcStatus(
        new Request(`${origin}/api/mobile/web-access/sessions/${slug}/rpc/${queued.requestId}`, {
          headers: { "x-cmux-web-access-status-token": queued.statusToken },
        }),
        routeParams({ slug, requestId: queued.requestId }),
      );
      const statusBody = await statusResponse.json();
      expect(statusResponse.status).toBe(200);
      expect(statusBody).toEqual({ status: "completed", result: { accepted: true } });
    } finally {
      restoreLocalOnly(previousLocalOnly);
      restoreLocalToken(previousToken);
    }
  });
});

function createSessionRequest(origin: string, localToken?: string, publicOrigin = "http://deppy-test.tailnet.test"): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (localToken) {
    headers.set("x-deppy-web-connect-local-token", localToken);
  }
  return new Request(`${origin}/api/mobile/web-access/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      deviceId: "test-device",
      displayName: "Test Mac",
      publicOrigin,
    }),
  });
}

function localSessionListRequest(origin: string, localToken?: string): Request {
  const headers = new Headers();
  if (localToken) {
    headers.set("x-deppy-web-connect-local-token", localToken);
  }
  return new Request(`${origin}/api/mobile/web-access/sessions`, { headers });
}

function routeParams<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

function restoreLocalOnly(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.CMUX_WEB_CONNECT_LOCAL_ONLY;
  } else {
    process.env.CMUX_WEB_CONNECT_LOCAL_ONLY = value;
  }
}

function restoreLocalToken(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN;
  } else {
    process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN = value;
  }
}
