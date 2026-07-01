import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createFileWebAccessSessionRepository,
  createMemoryWebAccessSessionRepository,
  createWebAccessSession,
  getPublicWebAccessSession,
  listOwnerWebAccessSessions,
  markWebAccessHostSeen,
  verifyWebAccessBrowserToken,
  type WebAccessSessionRepository,
} from "../services/mobile-web-access/sessions";

describe("mobile web access sessions", () => {
  test("creates an unguessable public slug and marks host presence by token", async () => {
    const repository = createMemoryWebAccessSessionRepository();
    const now = new Date("2026-06-29T00:00:00.000Z");
    const session = await createWebAccessSession(
      {
        userId: "user-1",
        teamId: "team-1",
        deviceId: "mac-1",
        displayName: "Desk Mac",
        now,
      },
      repository,
    );

    expect(session.slug.length).toBeGreaterThan(20);
    expect(session.hostToken.length).toBeGreaterThan(30);
    expect(session.browserToken.length).toBeGreaterThan(30);
    await expect(getPublicWebAccessSession(session.slug, now, repository)).resolves.toMatchObject({
      slug: session.slug,
      displayName: "Desk Mac",
      connected: false,
    });

    await expect(
      markWebAccessHostSeen(
        {
          slug: session.slug,
          hostToken: "wrong",
          now,
        },
        repository,
      ),
    ).resolves.toBe(false);
    await expect(
      markWebAccessHostSeen(
        {
          slug: session.slug,
          hostToken: session.hostToken,
          now,
        },
        repository,
      ),
    ).resolves.toBe(true);
    expect((await getPublicWebAccessSession(session.slug, now, repository))?.connected).toBe(true);
  });

  test("expires sessions", async () => {
    const repository = createMemoryWebAccessSessionRepository();
    const session = await createWebAccessSession(
      {
        userId: "user-1",
        teamId: "team-1",
        now: new Date("2026-06-29T00:00:00.000Z"),
      },
      repository,
    );

    await expect(
      getPublicWebAccessSession(
        session.slug,
        new Date("2026-06-29T09:00:00.000Z"),
        repository,
      ),
    ).resolves.toBeNull();
  });

  test("lists only active sessions for the authenticated owner teams", async () => {
    const repository = createMemoryWebAccessSessionRepository();
    const owned = await createWebAccessSession(
      {
        userId: "user-1",
        teamId: "team-1",
        deviceId: "mac-1",
        displayName: "Desk Mac",
        now: new Date("2026-06-29T00:00:00.000Z"),
      },
      repository,
    );
    await createWebAccessSession(
      {
        userId: "user-2",
        teamId: "team-1",
        deviceId: "mac-2",
        now: new Date("2026-06-29T00:01:00.000Z"),
      },
      repository,
    );
    await createWebAccessSession(
      {
        userId: "user-1",
        teamId: "team-2",
        deviceId: "mac-3",
        now: new Date("2026-06-29T00:02:00.000Z"),
      },
      repository,
    );

    const sessions = await listOwnerWebAccessSessions(
      {
        userId: "user-1",
        teamIds: ["team-1"],
        now: new Date("2026-06-29T00:03:00.000Z"),
      },
      repository,
    );

    expect(sessions).toEqual([
      {
        slug: owned.slug,
        displayName: "Desk Mac",
        deviceId: "mac-1",
        createdAt: owned.createdAt,
        expiresAt: owned.expiresAt,
        connected: false,
        publicPath: `/w/${owned.slug}`,
      },
    ]);
    expect(JSON.stringify(sessions)).not.toContain(owned.hostToken);
    expect(JSON.stringify(sessions)).not.toContain(owned.browserToken);
  });

  test("does not prune expired rows from public resolve or heartbeat paths", async () => {
    const repository = createMemoryWebAccessSessionRepository();
    let pruneCount = 0;
    const countingRepository: WebAccessSessionRepository = {
      ...repository,
      async pruneExpired(now) {
        pruneCount += 1;
        await repository.pruneExpired(now);
      },
    };
    const session = await createWebAccessSession(
      {
        userId: "user-1",
        teamId: "team-1",
        now: new Date("2026-06-29T00:00:00.000Z"),
      },
      countingRepository,
    );

    expect(pruneCount).toBe(1);
    await expect(
      getPublicWebAccessSession(
        session.slug,
        new Date("2026-06-29T09:00:00.000Z"),
        countingRepository,
      ),
    ).resolves.toBeNull();
    await expect(
      markWebAccessHostSeen(
        {
          slug: session.slug,
          hostToken: session.hostToken,
          now: new Date("2026-06-29T09:00:00.000Z"),
        },
        countingRepository,
      ),
    ).resolves.toBe(false);
    expect(pruneCount).toBe(1);
  });

  test("replaces the same owner's same-device session and caps old sessions", async () => {
    const repository = createMemoryWebAccessSessionRepository();
    const first = await createWebAccessSession(
      {
        userId: "user-1",
        teamId: "team-1",
        deviceId: "mac-1",
        now: new Date("2026-06-29T00:00:00.000Z"),
      },
      repository,
    );
    const replacement = await createWebAccessSession(
      {
        userId: "user-1",
        teamId: "team-1",
        deviceId: "mac-1",
        now: new Date("2026-06-29T00:01:00.000Z"),
      },
      repository,
    );

    await expect(
      getPublicWebAccessSession(first.slug, new Date("2026-06-29T00:01:00.000Z"), repository),
    ).resolves.toBeNull();
    await expect(
      getPublicWebAccessSession(
        replacement.slug,
        new Date("2026-06-29T00:01:00.000Z"),
        repository,
      ),
    ).resolves.not.toBeNull();

    const sessions = await Promise.all(
      ["mac-2", "mac-3", "mac-4", "mac-5"].map((deviceId, index) =>
        createWebAccessSession(
          {
            userId: "user-1",
            teamId: "team-1",
            deviceId,
            now: new Date(`2026-06-29T00:0${index + 2}:00.000Z`),
          },
          repository,
        ),
      ),
    );
    const checkTime = new Date("2026-06-29T00:06:00.000Z");

    await expect(getPublicWebAccessSession(replacement.slug, checkTime, repository)).resolves.toBeNull();
    await expect(getPublicWebAccessSession(sessions[0]!.slug, checkTime, repository)).resolves.toBeNull();
    await expect(getPublicWebAccessSession(sessions[1]!.slug, checkTime, repository)).resolves.not.toBeNull();
    await expect(getPublicWebAccessSession(sessions[2]!.slug, checkTime, repository)).resolves.not.toBeNull();
    await expect(getPublicWebAccessSession(sessions[3]!.slug, checkTime, repository)).resolves.not.toBeNull();
  });

  test("persists local-only sessions across runtime repository restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-access-sessions-"));
    try {
      const filePath = join(directory, "sessions.json");
      const firstRepository = createFileWebAccessSessionRepository(filePath);
      const createdAt = new Date("2026-06-29T00:00:00.000Z");
      const session = await createWebAccessSession(
        {
          userId: "local-user",
          teamId: "local-team",
          deviceId: "mac-1",
          displayName: "Desk Mac",
          now: createdAt,
        },
        firstRepository,
      );
      await expect(
        markWebAccessHostSeen(
          {
            slug: session.slug,
            hostToken: session.hostToken,
            now: new Date("2026-06-29T00:01:00.000Z"),
          },
          firstRepository,
        ),
      ).resolves.toBe(true);

      const restartedRepository = createFileWebAccessSessionRepository(filePath);
      await expect(
        verifyWebAccessBrowserToken(
          {
            slug: session.slug,
            browserToken: session.browserToken,
            now: new Date("2026-06-29T00:02:00.000Z"),
          },
          restartedRepository,
        ),
      ).resolves.toBe(true);
      await expect(
        markWebAccessHostSeen(
          {
            slug: session.slug,
            hostToken: session.hostToken,
            now: new Date("2026-06-29T00:02:00.000Z"),
          },
          restartedRepository,
        ),
      ).resolves.toBe(true);
      await expect(
        getPublicWebAccessSession(
          session.slug,
          new Date("2026-06-29T00:02:00.000Z"),
          restartedRepository,
        ),
      ).resolves.toMatchObject({
        slug: session.slug,
        displayName: "Desk Mac",
        connected: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
