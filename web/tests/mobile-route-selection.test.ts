import { describe, expect, test } from "bun:test";
import { browserAttachEndpoints } from "../services/mobile-rpc/route-selection";
import type { MobilePwaBootstrapDevice } from "../services/mobile-rpc/bootstrap";

describe("mobile PWA route selection", () => {
  test("selects registered websocket URL routes by priority", () => {
    const devices: MobilePwaBootstrapDevice[] = [
      {
        deviceId: "mac-1",
        platform: "mac",
        displayName: "Mac",
        labels: {},
        lastSeenAt: new Date(0).toISOString(),
        instances: [
          {
            tag: "stable",
            labels: {},
            lastSeenAt: new Date(0).toISOString(),
            routes: [
              {
                id: "slow",
                kind: "websocket",
                priority: 10,
                endpoint: { type: "url", url: "wss://slow.example.test/mobile-rpc" },
              },
              {
                id: "fast",
                kind: "websocket",
                priority: 0,
                endpoint: { type: "url", url: "wss://fast.example.test/mobile-rpc" },
              },
              "junk",
              { id: "bad", kind: "websocket", endpoint: { type: "url", url: "https://not-ws.test" } },
            ],
          },
        ],
      },
    ];

    expect(browserAttachEndpoints(devices)).toEqual([
      {
        deviceId: "mac-1",
        tag: "stable",
        routeId: "fast",
        kind: "websocket",
        url: "wss://fast.example.test/mobile-rpc",
      },
      {
        deviceId: "mac-1",
        tag: "stable",
        routeId: "slow",
        kind: "websocket",
        url: "wss://slow.example.test/mobile-rpc",
      },
    ]);
  });

  test("does not advertise native host-port routes as browser websocket endpoints", () => {
    const devices: MobilePwaBootstrapDevice[] = [
      {
        deviceId: "mac-1",
        platform: "mac",
        displayName: "Mac",
        labels: {},
        lastSeenAt: new Date(0).toISOString(),
        instances: [
          {
            tag: "stable",
            labels: {},
            lastSeenAt: new Date(0).toISOString(),
            routes: [
              {
                id: "native",
                kind: "tailscale",
                priority: 0,
                endpoint: { type: "host_port", host: "100.64.1.2", port: 51001 },
              },
            ],
          },
        ],
      },
    ];

    expect(browserAttachEndpoints(devices)).toEqual([]);
  });
});
