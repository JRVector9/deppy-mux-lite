import { describe, expect, test } from "bun:test";

import { webAccessBrowserMutationOriginAllowed } from "../app/api/mobile/web-access/sessions/[slug]/rpc/route";

function rpcRequest(
  url: string,
  headers: Record<string, string>,
): Request {
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ method: "mobile.workspace.list", params: {} }),
  });
}

describe("mobile web access rpc route", () => {
  test("allows same-origin browser mutations", () => {
    expect(
      webAccessBrowserMutationOriginAllowed(
        rpcRequest("http://localhost:9170/api/mobile/web-access/sessions/slug/rpc", {
          origin: "http://localhost:9170",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
  });

  test("allows same-port loopback and Tailscale browser mutations", () => {
    expect(
      webAccessBrowserMutationOriginAllowed(
        rpcRequest("http://localhost:9170/api/mobile/web-access/sessions/slug/rpc", {
          origin: "http://100.75.156.51:9170",
          "sec-fetch-site": "same-site",
        }),
      ),
    ).toBe(true);
  });

  test("rejects cross-site and different-port browser mutations", () => {
    expect(
      webAccessBrowserMutationOriginAllowed(
        rpcRequest("http://localhost:9170/api/mobile/web-access/sessions/slug/rpc", {
          origin: "http://100.75.156.51:9170",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(false);

    expect(
      webAccessBrowserMutationOriginAllowed(
        rpcRequest("http://localhost:9170/api/mobile/web-access/sessions/slug/rpc", {
          origin: "http://100.75.156.51:9171",
          "sec-fetch-site": "same-site",
        }),
      ),
    ).toBe(false);
  });

  test("rejects public origins that are not the request origin", () => {
    expect(
      webAccessBrowserMutationOriginAllowed(
        rpcRequest("http://localhost:9170/api/mobile/web-access/sessions/slug/rpc", {
          origin: "http://example.test:9170",
          "sec-fetch-site": "same-site",
        }),
      ),
    ).toBe(false);
  });
});
