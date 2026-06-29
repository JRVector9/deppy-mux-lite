import { describe, expect, test } from "bun:test";
import {
  claimWebAccessRpcRequests,
  completeWebAccessRpcRequest,
  createMemoryWebAccessRelayRepository,
  enqueueWebAccessRpcRequest,
  getWebAccessRpcRequestStatus,
  isWebAccessRelayMethod,
} from "../services/mobile-web-access/relay";

describe("mobile web access relay", () => {
  test("queues browser RPC requests and lets only the host token claim them", async () => {
    const repository = createMemoryWebAccessRelayRepository({
      activeSlug: "slug-1",
      hostToken: "host-token",
      userId: "user-1",
    });
    const queued = await enqueueWebAccessRpcRequest(
      {
        slug: "slug-1",
        userId: "user-1",
        teamIds: ["team-1"],
        method: "terminal.paste",
        params: {
          workspace_id: "workspace:1",
          surface_id: "surface:1",
          client_id: "web",
          text: "echo ok",
          submit_key: "return",
        },
        now: new Date("2026-06-29T00:00:00.000Z"),
      },
      repository,
    );

    expect(queued.ok ? queued.request.id : null).toBeTruthy();
    await expect(
      claimWebAccessRpcRequests(
        {
          slug: "slug-1",
          hostToken: "wrong",
          now: new Date("2026-06-29T00:00:01.000Z"),
        },
        repository,
      ),
    ).resolves.toBeNull();

    const claimed = await claimWebAccessRpcRequests(
      {
        slug: "slug-1",
        hostToken: "host-token",
        now: new Date("2026-06-29T00:00:01.000Z"),
      },
      repository,
    );

    expect(claimed).toHaveLength(1);
    expect(claimed?.[0]).toMatchObject({
      id: queued.ok ? queued.request.id : "",
      slug: "slug-1",
      method: "terminal.paste",
      params: { text: "echo ok" },
    });
  });

  test("completes claimed requests by host token and rejects expired public sessions", async () => {
    const repository = createMemoryWebAccessRelayRepository({
      activeSlug: "slug-1",
      hostToken: "host-token",
      userId: "user-1",
    });
    const queued = await enqueueWebAccessRpcRequest(
      {
        slug: "slug-1",
        userId: "user-1",
        teamIds: ["team-1"],
        method: "mobile.workspace.list",
        now: new Date("2026-06-29T00:00:00.000Z"),
      },
      repository,
    );

    expect(
      await completeWebAccessRpcRequest(
        {
          slug: "slug-1",
          hostToken: "wrong",
          requestId: queued.ok ? queued.request.id : "",
          completion: { ok: true, result: { workspaces: [] } },
          now: new Date("2026-06-29T00:00:01.000Z"),
        },
        repository,
      ),
    ).toBe(false);
    expect(
      await completeWebAccessRpcRequest(
        {
          slug: "slug-1",
          hostToken: "host-token",
          requestId: queued.ok ? queued.request.id : "",
          completion: { ok: true, result: { workspaces: [] } },
          now: new Date("2026-06-29T00:00:01.000Z"),
        },
        repository,
      ),
    ).toBe(true);
    await expect(
      enqueueWebAccessRpcRequest(
        {
          slug: "missing",
          userId: "user-1",
          teamIds: ["team-1"],
          method: "mobile.workspace.list",
          now: new Date("2026-06-29T00:00:02.000Z"),
        },
        repository,
      ),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  test("requires the session owner and caps open requests", async () => {
    const repository = createMemoryWebAccessRelayRepository({
      activeSlug: "slug-1",
      hostToken: "host-token",
      userId: "user-1",
    });

    await expect(
      enqueueWebAccessRpcRequest(
        {
          slug: "slug-1",
          userId: "user-2",
          teamIds: ["team-1"],
          method: "mobile.workspace.list",
          now: new Date("2026-06-29T00:00:00.000Z"),
        },
        repository,
      ),
    ).resolves.toEqual({ ok: false, reason: "not_found" });

    for (let index = 0; index < 100; index++) {
      const queued = await enqueueWebAccessRpcRequest(
        {
          slug: "slug-1",
          userId: "user-1",
          teamIds: ["team-1"],
          method: "mobile.workspace.list",
          now: new Date("2026-06-29T00:00:00.000Z"),
        },
        repository,
      );
      expect(queued.ok).toBe(true);
    }
    await expect(
      enqueueWebAccessRpcRequest(
        {
          slug: "slug-1",
          userId: "user-1",
          teamIds: ["team-1"],
          method: "mobile.workspace.list",
          now: new Date("2026-06-29T00:00:00.000Z"),
        },
        repository,
      ),
    ).resolves.toEqual({ ok: false, reason: "queue_full" });
  });

  test("requires the opaque status token to read completed request status", async () => {
    const repository = createMemoryWebAccessRelayRepository({
      activeSlug: "slug-1",
      hostToken: "host-token",
      userId: "user-1",
    });
    const queued = await enqueueWebAccessRpcRequest(
      {
        slug: "slug-1",
        userId: "user-1",
        teamIds: ["team-1"],
        method: "mobile.workspace.list",
        now: new Date("2026-06-29T00:00:00.000Z"),
      },
      repository,
    );
    if (!queued.ok) {
      throw new Error("expected request to queue");
    }
    await completeWebAccessRpcRequest(
      {
        slug: "slug-1",
        hostToken: "host-token",
        requestId: queued.request.id,
        completion: { ok: true, result: { workspaces: [] } },
        now: new Date("2026-06-29T00:00:01.000Z"),
      },
      repository,
    );

    await expect(
      getWebAccessRpcRequestStatus(
        {
          slug: "slug-1",
          requestId: queued.request.id,
          statusToken: "wrong",
          now: new Date("2026-06-29T00:00:02.000Z"),
        },
        repository,
      ),
    ).resolves.toBeNull();
    await expect(
      getWebAccessRpcRequestStatus(
        {
          slug: "slug-1",
          requestId: queued.request.id,
          statusToken: queued.statusToken,
          now: new Date("2026-06-29T00:00:02.000Z"),
        },
        repository,
      ),
    ).resolves.toEqual({ status: "completed", result: { workspaces: [] } });
  });

  test("fails stale claimed requests instead of leaving the browser polling until expiry", async () => {
    const repository = createMemoryWebAccessRelayRepository({
      activeSlug: "slug-1",
      hostToken: "host-token",
      userId: "user-1",
    });
    const queued = await enqueueWebAccessRpcRequest(
      {
        slug: "slug-1",
        userId: "user-1",
        teamIds: ["team-1"],
        method: "terminal.input",
        params: { text: "\r" },
        now: new Date("2026-06-29T00:00:00.000Z"),
      },
      repository,
    );
    if (!queued.ok) {
      throw new Error("expected request to queue");
    }
    await expect(
      claimWebAccessRpcRequests(
        {
          slug: "slug-1",
          hostToken: "host-token",
          now: new Date("2026-06-29T00:00:01.000Z"),
        },
        repository,
      ),
    ).resolves.toHaveLength(1);

    await expect(
      getWebAccessRpcRequestStatus(
        {
          slug: "slug-1",
          requestId: queued.request.id,
          statusToken: queued.statusToken,
          now: new Date("2026-06-29T00:00:33.000Z"),
        },
        repository,
      ),
    ).resolves.toEqual({
      status: "failed",
      error: {
        code: "host_claim_timeout",
        message: "The Mac did not finish the Web Access request in time.",
      },
    });
    await expect(
      claimWebAccessRpcRequests(
        {
          slug: "slug-1",
          hostToken: "host-token",
          now: new Date("2026-06-29T00:00:34.000Z"),
        },
        repository,
      ),
    ).resolves.toEqual([]);
  });

  test("validates the narrow public relay method allowlist", () => {
    expect(isWebAccessRelayMethod("terminal.input")).toBe(true);
    expect(isWebAccessRelayMethod("terminal.paste_image")).toBe(true);
    expect(isWebAccessRelayMethod("mobile.terminal.replay")).toBe(true);
    expect(isWebAccessRelayMethod("mobile.terminal.viewport")).toBe(true);
    expect(isWebAccessRelayMethod("not.allowed")).toBe(false);
  });

  test("requires current membership in the session team", async () => {
    const repository = createMemoryWebAccessRelayRepository({
      activeSlug: "slug-1",
      hostToken: "host-token",
      userId: "user-1",
      teamId: "team-1",
    });

    await expect(
      enqueueWebAccessRpcRequest(
        {
          slug: "slug-1",
          userId: "user-1",
          teamIds: ["team-2"],
          method: "mobile.workspace.list",
          now: new Date("2026-06-29T00:00:00.000Z"),
        },
        repository,
      ),
    ).resolves.toEqual({ ok: false, reason: "not_found" });

    await expect(
      enqueueWebAccessRpcRequest(
        {
          slug: "slug-1",
          userId: "user-1",
          teamIds: ["team-1"],
          method: "mobile.workspace.list",
          now: new Date("2026-06-29T00:00:00.000Z"),
        },
        repository,
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  test("accepts browser link tokens without a Stack user", async () => {
    const repository = createMemoryWebAccessRelayRepository({
      activeSlug: "slug-1",
      hostToken: "host-token",
      browserToken: "browser-token",
      userId: "user-1",
      teamId: "team-1",
    });

    await expect(
      enqueueWebAccessRpcRequest(
        {
          slug: "slug-1",
          browserToken: "wrong",
          method: "mobile.workspace.list",
          now: new Date("2026-06-29T00:00:00.000Z"),
        },
        repository,
      ),
    ).resolves.toEqual({ ok: false, reason: "not_found" });

    await expect(
      enqueueWebAccessRpcRequest(
        {
          slug: "slug-1",
          browserToken: "browser-token",
          method: "mobile.workspace.list",
          now: new Date("2026-06-29T00:00:00.000Z"),
        },
        repository,
      ),
    ).resolves.toMatchObject({ ok: true });
  });
});
