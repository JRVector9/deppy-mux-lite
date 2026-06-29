import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import postgres, { type Sql } from "postgres";

import { closeCloudDbForTests } from "../db/client";

const runDbTests = process.env.CMUX_DB_TEST === "1";
const dbTest = runDbTests ? test : test.skip;

let currentUserId = "pwa-user-1";
const getUser = mock(async () => ({
  id: currentUserId,
  displayName: null,
  primaryEmail: `${currentUserId}@example.com`,
  selectedTeam: { id: "team-a" },
  listTeams: async () => [{ id: "team-a" }, { id: "team-b" }],
}));

mock.module("../app/lib/stack", () => ({
  getStackServerApp: () => ({ getUser }),
  isStackConfigured: () => true,
  stackServerApp: { getUser },
}));

const { POST } = await import("../app/api/devices/route");
const { GET } = await import("../app/api/mobile/bootstrap/route");

let sql: Sql | null = null;

const DEVICE_A = "11111111-1111-4111-8111-111111111111";

function nativeAuthHeaders(teamId?: string): Record<string, string> {
  const base: Record<string, string> = {
    authorization: "Bearer access-token",
    "x-stack-refresh-token": "refresh-token",
    "content-type": "application/json",
  };
  if (teamId) base["x-cmux-team-id"] = teamId;
  return base;
}

function browserHeaders(teamId?: string): Record<string, string> {
  const base: Record<string, string> = {
    cookie: "stack-session=test",
  };
  if (teamId) base["x-cmux-team-id"] = teamId;
  return base;
}

function registerRequest(body: Record<string, unknown>, teamId?: string): Request {
  return new Request("https://cmux.test/api/devices", {
    method: "POST",
    headers: nativeAuthHeaders(teamId),
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  if (!runDbTests) return;
  const databaseURL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseURL) {
    throw new Error("DATABASE_URL is required when CMUX_DB_TEST=1");
  }
  sql = postgres(databaseURL, { max: 1 });
});

afterAll(async () => {
  await closeCloudDbForTests();
  await sql?.end();
});

beforeEach(async () => {
  if (!sql) return;
  await sql`truncate devices, device_app_instances restart identity cascade`;
  getUser.mockClear();
  currentUserId = "pwa-user-1";
});

describe("mobile PWA bootstrap route", () => {
  dbTest("lists registered devices through a browser cookie session", async () => {
    if (!sql) throw new Error("test database not initialized");

    const register = await POST(
      registerRequest({
        deviceId: DEVICE_A,
        platform: "mac",
        displayName: "PWA Mac",
        tag: "stable",
        routes: [
          {
            id: "r1",
            kind: "tailscale",
            priority: 0,
            endpoint: { host: "100.1.2.3", port: 51001 },
          },
        ],
      }),
    );
    expect(register.status).toBe(200);

    const response = await GET(
      new Request("https://cmux.test/api/mobile/bootstrap", {
        method: "GET",
        headers: browserHeaders(),
      }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      account: { userId: string; teamId: string };
      auth: { browserCookie: boolean };
      registry: {
        teamId: string;
        devices: Array<{
          deviceId: string;
          displayName: string | null;
          instances: Array<{ tag: string; routes: unknown[] }>;
        }>;
      };
    };
    expect(body.account.userId).toBe("pwa-user-1");
    expect(body.account.teamId).toBe("team-a");
    expect(body.auth.browserCookie).toBe(true);
    expect(body.registry.teamId).toBe("team-a");
    expect(body.registry.devices[0].deviceId).toBe(DEVICE_A);
    expect(body.registry.devices[0].displayName).toBe("PWA Mac");
    expect(body.registry.devices[0].instances[0].tag).toBe("stable");
  });
});

