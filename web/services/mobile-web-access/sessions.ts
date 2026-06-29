import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { cloudDb } from "../../db/client";
import { webAccessSessions } from "../../db/schema";

export type WebAccessSession = {
  slug: string;
  hostToken: string;
  browserToken: string;
  userId: string;
  teamId: string;
  deviceId: string | null;
  displayName: string | null;
  createdAt: string;
  expiresAt: string;
  lastHostSeenAt: string | null;
};

export type PublicWebAccessSession = {
  slug: string;
  displayName: string | null;
  createdAt: string;
  expiresAt: string;
  connected: boolean;
};

export type OwnerWebAccessSession = PublicWebAccessSession & {
  deviceId: string | null;
  publicPath: string;
};

export type StoredWebAccessSession = Omit<WebAccessSession, "hostToken"> & {
  hostTokenHash: string;
};

export type WebAccessSessionRepository = {
  pruneExpired(now: Date): Promise<void>;
  insert(session: StoredWebAccessSession): Promise<void>;
  deleteSameDevice(input: {
    userId: string;
    teamId: string;
    deviceId: string | null;
  }): Promise<void>;
  enforceOwnerLimit(input: {
    userId: string;
    teamId: string;
    maxActiveSessions: number;
  }): Promise<void>;
  findActiveBySlug(slug: string, now: Date): Promise<StoredWebAccessSession | null>;
  listActiveForRequester(input: {
    userId: string;
    teamIds: readonly string[];
    now: Date;
  }): Promise<StoredWebAccessSession[]>;
  markHostSeen(input: {
    slug: string;
    hostTokenHash: string;
    now: Date;
  }): Promise<boolean>;
  findActiveByBrowserToken(input: {
    slug: string;
    browserTokenHash: string;
    now: Date;
  }): Promise<StoredWebAccessSession | null>;
  withOwnerMutation?<T>(
    input: { userId: string; teamId: string },
    operation: (repository: WebAccessSessionRepository) => Promise<T>,
  ): Promise<T>;
};

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const HOST_STALE_MS = 45 * 1000;
const MAX_ACTIVE_SESSIONS_PER_OWNER = 3;

export async function createWebAccessSession(
  input: {
    userId: string;
    teamId: string;
    deviceId?: string | null;
    displayName?: string | null;
    now?: Date;
  },
  repository: WebAccessSessionRepository = postgresWebAccessSessionRepository,
): Promise<WebAccessSession> {
  const now = input.now ?? new Date();
  const hostToken = token(32);
  const browserToken = token(32);
  const operation = async (scopedRepository: WebAccessSessionRepository) => {
    const stored: StoredWebAccessSession = {
      slug: await uniqueSlug(scopedRepository, now),
      hostTokenHash: hashToken(hostToken),
      browserToken,
      userId: input.userId,
      teamId: input.teamId,
      deviceId: cleanOptional(input.deviceId),
      displayName: cleanOptional(input.displayName),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      lastHostSeenAt: null,
    };

    await scopedRepository.pruneExpired(now);
    await scopedRepository.deleteSameDevice({
      userId: stored.userId,
      teamId: stored.teamId,
      deviceId: stored.deviceId,
    });
    await scopedRepository.insert(stored);
    await scopedRepository.enforceOwnerLimit({
      userId: stored.userId,
      teamId: stored.teamId,
      maxActiveSessions: MAX_ACTIVE_SESSIONS_PER_OWNER,
    });

    return { ...withoutPrivateTokenHashes(stored), hostToken };
  };

  if (repository.withOwnerMutation) {
    return repository.withOwnerMutation(
      { userId: input.userId, teamId: input.teamId },
      operation,
    );
  }
  return operation(repository);
}

export async function verifyWebAccessBrowserToken(
  input: {
    slug: string;
    browserToken: string;
    now?: Date;
  },
  repository: WebAccessSessionRepository = postgresWebAccessSessionRepository,
): Promise<boolean> {
  const token = input.browserToken.trim();
  if (!token) {
    return false;
  }
  const session = await repository.findActiveByBrowserToken({
    slug: input.slug,
    browserTokenHash: hashToken(token),
    now: input.now ?? new Date(),
  });
  return !!session;
}

export async function getPublicWebAccessSession(
  slug: string,
  now = new Date(),
  repository: WebAccessSessionRepository = postgresWebAccessSessionRepository,
): Promise<PublicWebAccessSession | null> {
  const session = await repository.findActiveBySlug(slug, now);
  if (!session) {
    return null;
  }
  return {
    slug: session.slug,
    displayName: session.displayName,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    connected: isHostConnected(session, now),
  };
}

export async function markWebAccessHostSeen(
  input: {
    slug: string;
    hostToken: string;
    now?: Date;
  },
  repository: WebAccessSessionRepository = postgresWebAccessSessionRepository,
): Promise<boolean> {
  const now = input.now ?? new Date();
  return repository.markHostSeen({
    slug: input.slug,
    hostTokenHash: hashToken(input.hostToken),
    now,
  });
}

export async function listOwnerWebAccessSessions(
  input: {
    userId: string;
    teamIds: readonly string[];
    now?: Date;
  },
  repository: WebAccessSessionRepository = postgresWebAccessSessionRepository,
): Promise<OwnerWebAccessSession[]> {
  const now = input.now ?? new Date();
  if (input.teamIds.length === 0) {
    return [];
  }
  const sessions = await repository.listActiveForRequester({
    userId: input.userId,
    teamIds: input.teamIds,
    now,
  });
  return sessions.map((session) => ({
    slug: session.slug,
    displayName: session.displayName,
    deviceId: session.deviceId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    connected: isHostConnected(session, now),
    publicPath: `/w/${session.slug}`,
  }));
}

export function createMemoryWebAccessSessionRepository(): WebAccessSessionRepository {
  const sessions = new Map<string, StoredWebAccessSession>();

  return {
    async pruneExpired(now) {
      const nowMs = now.getTime();
      for (const [slug, session] of sessions) {
        if (Date.parse(session.expiresAt) <= nowMs) {
          sessions.delete(slug);
        }
      }
    },
    async insert(session) {
      sessions.set(session.slug, session);
    },
    async deleteSameDevice(input) {
      if (!input.deviceId) {
        return;
      }
      for (const [slug, session] of sessions) {
        if (
          session.userId === input.userId &&
          session.teamId === input.teamId &&
          session.deviceId === input.deviceId
        ) {
          sessions.delete(slug);
        }
      }
    },
    async enforceOwnerLimit(input) {
      const ownerSessions = [...sessions.values()]
        .filter((session) => session.userId === input.userId && session.teamId === input.teamId)
        .sort((lhs, rhs) => Date.parse(lhs.createdAt) - Date.parse(rhs.createdAt));
      for (const stale of ownerSessions.slice(
        0,
        Math.max(0, ownerSessions.length - input.maxActiveSessions),
      )) {
        sessions.delete(stale.slug);
      }
    },
    async findActiveBySlug(slug, now) {
      const session = sessions.get(slug);
      if (!session || Date.parse(session.expiresAt) <= now.getTime()) {
        return null;
      }
      return session;
    },
    async listActiveForRequester(input) {
      return [...sessions.values()]
        .filter(
          (session) =>
            session.userId === input.userId &&
            input.teamIds.includes(session.teamId) &&
            Date.parse(session.expiresAt) > input.now.getTime(),
        )
        .sort((lhs, rhs) => Date.parse(rhs.createdAt) - Date.parse(lhs.createdAt));
    },
    async markHostSeen(input) {
      const session = sessions.get(input.slug);
      if (
        !session ||
        session.hostTokenHash !== input.hostTokenHash ||
        Date.parse(session.expiresAt) <= input.now.getTime()
      ) {
        return false;
      }
      session.lastHostSeenAt = input.now.toISOString();
      return true;
    },
    async findActiveByBrowserToken(input) {
      const session = sessions.get(input.slug);
      if (
        !session ||
        hashToken(session.browserToken) !== input.browserTokenHash ||
        Date.parse(session.expiresAt) <= input.now.getTime()
      ) {
        return null;
      }
      return session;
    },
  };
}

type WebAccessDb = Pick<
  ReturnType<typeof cloudDb>,
  "delete" | "execute" | "insert" | "select" | "update"
> &
  Partial<Pick<ReturnType<typeof cloudDb>, "transaction">>;

export const postgresWebAccessSessionRepository: WebAccessSessionRepository = {
  async pruneExpired(now) {
    return createPostgresWebAccessSessionRepository(cloudDb()).pruneExpired(now);
  },
  async insert(session) {
    return createPostgresWebAccessSessionRepository(cloudDb()).insert(session);
  },
  async deleteSameDevice(input) {
    return createPostgresWebAccessSessionRepository(cloudDb()).deleteSameDevice(input);
  },
  async enforceOwnerLimit(input) {
    return createPostgresWebAccessSessionRepository(cloudDb()).enforceOwnerLimit(input);
  },
  async findActiveBySlug(slug, now) {
    return createPostgresWebAccessSessionRepository(cloudDb()).findActiveBySlug(slug, now);
  },
  async listActiveForRequester(input) {
    return createPostgresWebAccessSessionRepository(cloudDb()).listActiveForRequester(input);
  },
  async markHostSeen(input) {
    return createPostgresWebAccessSessionRepository(cloudDb()).markHostSeen(input);
  },
  async findActiveByBrowserToken(input) {
    return createPostgresWebAccessSessionRepository(cloudDb()).findActiveByBrowserToken(input);
  },
  async withOwnerMutation(input, operation) {
    return createPostgresWebAccessSessionRepository(cloudDb()).withOwnerMutation!(input, operation);
  },
};

function createPostgresWebAccessSessionRepository(db: WebAccessDb): WebAccessSessionRepository {
  const repository: WebAccessSessionRepository = {
    async pruneExpired(now) {
      await db.delete(webAccessSessions).where(lte(webAccessSessions.expiresAt, now));
    },
    async insert(session) {
      await db.insert(webAccessSessions).values(toDbInsert(session));
    },
    async deleteSameDevice(input) {
      if (!input.deviceId) {
        return;
      }
      await db
        .delete(webAccessSessions)
        .where(
          and(
            eq(webAccessSessions.userId, input.userId),
            eq(webAccessSessions.teamId, input.teamId),
            eq(webAccessSessions.deviceId, input.deviceId),
          ),
        );
    },
    async enforceOwnerLimit(input) {
      const rows = await db
        .select({
          slug: webAccessSessions.slug,
        })
        .from(webAccessSessions)
        .where(
          and(
            eq(webAccessSessions.userId, input.userId),
            eq(webAccessSessions.teamId, input.teamId),
          ),
        )
        .orderBy(desc(webAccessSessions.createdAt));

      const staleSlugs = rows.slice(input.maxActiveSessions).map((row) => row.slug);
      if (staleSlugs.length === 0) {
        return;
      }
      await db.delete(webAccessSessions).where(inArray(webAccessSessions.slug, staleSlugs));
    },
    async findActiveBySlug(slug, now) {
      const [row] = await db
        .select()
        .from(webAccessSessions)
        .where(and(eq(webAccessSessions.slug, slug), gt(webAccessSessions.expiresAt, now)))
        .orderBy(asc(webAccessSessions.createdAt))
        .limit(1);
      return row ? fromDbRow(row) : null;
    },
    async listActiveForRequester(input) {
      if (input.teamIds.length === 0) {
        return [];
      }
      const rows = await db
        .select()
        .from(webAccessSessions)
        .where(
          and(
            eq(webAccessSessions.userId, input.userId),
            inArray(webAccessSessions.teamId, [...input.teamIds]),
            gt(webAccessSessions.expiresAt, input.now),
          ),
        )
        .orderBy(desc(webAccessSessions.createdAt));
      return rows.map(fromDbRow);
    },
    async markHostSeen(input) {
      const rows = await db
        .update(webAccessSessions)
        .set({ lastHostSeenAt: input.now })
        .where(
          and(
            eq(webAccessSessions.slug, input.slug),
            eq(webAccessSessions.hostTokenHash, input.hostTokenHash),
            gt(webAccessSessions.expiresAt, input.now),
          ),
        )
        .returning({ slug: webAccessSessions.slug });
      return rows.length > 0;
    },
    async findActiveByBrowserToken(input) {
      const [row] = await db
        .select()
        .from(webAccessSessions)
        .where(
          and(
            eq(webAccessSessions.slug, input.slug),
            eq(webAccessSessions.browserTokenHash, input.browserTokenHash),
            gt(webAccessSessions.expiresAt, input.now),
          ),
        )
        .limit(1);
      return row ? fromDbRow(row) : null;
    },
  };
  if (db.transaction) {
    repository.withOwnerMutation = async (input, operation) =>
      db.transaction!(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${input.teamId}:${input.userId}`}, 23))`,
        );
        return operation(createPostgresWebAccessSessionRepository(tx as WebAccessDb));
      });
  }
  return repository;
}

function toDbInsert(session: StoredWebAccessSession) {
  return {
    slug: session.slug,
    hostTokenHash: session.hostTokenHash,
    browserTokenHash: hashToken(session.browserToken),
    userId: session.userId,
    teamId: session.teamId,
    deviceId: session.deviceId,
    displayName: session.displayName,
    createdAt: new Date(session.createdAt),
    expiresAt: new Date(session.expiresAt),
    lastHostSeenAt: session.lastHostSeenAt ? new Date(session.lastHostSeenAt) : null,
  };
}

function fromDbRow(row: typeof webAccessSessions.$inferSelect): StoredWebAccessSession {
  return {
    slug: row.slug,
    hostTokenHash: row.hostTokenHash,
    browserToken: "",
    userId: row.userId,
    teamId: row.teamId,
    deviceId: row.deviceId,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastHostSeenAt: row.lastHostSeenAt?.toISOString() ?? null,
  };
}

function withoutPrivateTokenHashes(session: StoredWebAccessSession): Omit<WebAccessSession, "hostToken"> {
  return {
    slug: session.slug,
    browserToken: session.browserToken,
    userId: session.userId,
    teamId: session.teamId,
    deviceId: session.deviceId,
    displayName: session.displayName,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastHostSeenAt: session.lastHostSeenAt,
  };
}

function isHostConnected(session: StoredWebAccessSession, now: Date): boolean {
  if (!session.lastHostSeenAt) {
    return false;
  }
  return now.getTime() - Date.parse(session.lastHostSeenAt) <= HOST_STALE_MS;
}

async function uniqueSlug(repository: WebAccessSessionRepository, now: Date): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = token(18);
    if (!(await repository.findActiveBySlug(slug, now))) {
      return slug;
    }
  }
  throw new Error("failed to allocate web access slug");
}

function token(bytes: number): string {
  return randomBytes(bytes)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cleanOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 128) : null;
}
