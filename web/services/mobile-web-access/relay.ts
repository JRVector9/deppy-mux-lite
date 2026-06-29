import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, count, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { cloudDb } from "../../db/client";
import { webAccessRpcRequests, webAccessSessions } from "../../db/schema";
import type { MobileRpcMethod, MobileRpcParams } from "../mobile-rpc/types";

export type WebAccessRelayRequest = {
  id: string;
  slug: string;
  method: MobileRpcMethod;
  params: MobileRpcParams;
  createdAt: string;
  expiresAt: string;
};

type StoredWebAccessRelayRequest = WebAccessRelayRequest & {
  statusTokenHash: string;
};

export type WebAccessRelayEnqueueResult =
  | { ok: true; request: WebAccessRelayRequest; statusToken: string }
  | { ok: false; reason: "not_found" | "queue_full" };

export type WebAccessRelayCompletion =
  | { ok: true; result: unknown }
  | { ok: false; error: { code?: string; message: string } };

export type WebAccessRelayRequestStatus =
  | { status: "pending" | "claimed" }
  | { status: "completed"; result: unknown }
  | { status: "failed"; error: { code?: string; message: string } };

export type WebAccessRelayRepository = {
  pruneExpiredRequests(now: Date): Promise<void>;
  findActiveSessionForRequester(input: {
    slug: string;
    userId: string;
    teamIds: readonly string[];
    now: Date;
  }): Promise<boolean>;
  findActiveSessionForBrowser(input: {
    slug: string;
    browserTokenHash: string;
    now: Date;
  }): Promise<boolean>;
  findActiveHostSession(input: {
    slug: string;
    hostTokenHash: string;
    now: Date;
  }): Promise<boolean>;
  enqueueRequest(input: {
    request: StoredWebAccessRelayRequest;
    userId?: string;
    teamIds?: readonly string[];
    browserTokenHash?: string;
    maxOpenRequests: number;
    now: Date;
  }): Promise<"inserted" | "not_found" | "queue_full">;
  claimPendingRequests(input: {
    slug: string;
    now: Date;
    limit: number;
  }): Promise<WebAccessRelayRequest[]>;
  completeRequest(input: {
    slug: string;
    requestId: string;
    completion: WebAccessRelayCompletion;
    now: Date;
  }): Promise<boolean>;
  findRequestStatus(input: {
    slug: string;
    requestId: string;
    statusTokenHash: string;
    now: Date;
  }): Promise<WebAccessRelayRequestStatus | null>;
};

const RPC_REQUEST_TTL_MS = 2 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 30 * 1000;
const MAX_CLAIM_BATCH = 25;
const MAX_OPEN_REQUESTS_PER_SESSION = 100;
const hostClaimTimeoutError = {
  code: "host_claim_timeout",
  message: "The Mac did not finish the Web Access request in time.",
};

const webAccessRelayMethods = [
  "mobile.host.status",
  "mobile.workspace.list",
  "mobile.terminal.replay",
  "mobile.terminal.viewport",
  "terminal.input",
  "terminal.paste",
  "terminal.paste_image",
] as const satisfies readonly MobileRpcMethod[];
const webAccessRelayMethodSet = new Set<string>(webAccessRelayMethods);

export function isWebAccessRelayMethod(value: unknown): value is MobileRpcMethod {
  return typeof value === "string" && webAccessRelayMethodSet.has(value);
}

export async function enqueueWebAccessRpcRequest(
  input: {
    slug: string;
    userId?: string;
    teamIds?: readonly string[];
    browserToken?: string;
    method: MobileRpcMethod;
    params?: MobileRpcParams;
    now?: Date;
  },
  repository: WebAccessRelayRepository = postgresWebAccessRelayRepository,
): Promise<WebAccessRelayEnqueueResult> {
  const now = input.now ?? new Date();
  const statusToken = token(32);
  const request: StoredWebAccessRelayRequest = {
    id: randomUUID(),
    slug: input.slug,
    method: input.method,
    params: input.params ?? {},
    statusTokenHash: hashToken(statusToken),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RPC_REQUEST_TTL_MS).toISOString(),
  };
  const inserted = await repository.enqueueRequest({
    request,
    userId: input.userId,
    teamIds: input.teamIds,
    browserTokenHash: input.browserToken ? hashToken(input.browserToken) : undefined,
    maxOpenRequests: MAX_OPEN_REQUESTS_PER_SESSION,
    now,
  });
  return inserted === "inserted"
    ? { ok: true, request: withoutStatusTokenHash(request), statusToken }
    : { ok: false, reason: inserted };
}

export async function claimWebAccessRpcRequests(
  input: {
    slug: string;
    hostToken: string;
    now?: Date;
    limit?: number;
  },
  repository: WebAccessRelayRepository = postgresWebAccessRelayRepository,
): Promise<WebAccessRelayRequest[] | null> {
  const now = input.now ?? new Date();
  await repository.pruneExpiredRequests(now);
  const active = await repository.findActiveHostSession({
    slug: input.slug,
    hostTokenHash: hashToken(input.hostToken),
    now,
  });
  if (!active) {
    return null;
  }
  return repository.claimPendingRequests({
    slug: input.slug,
    now,
    limit: Math.min(Math.max(input.limit ?? MAX_CLAIM_BATCH, 1), MAX_CLAIM_BATCH),
  });
}

export async function completeWebAccessRpcRequest(
  input: {
    slug: string;
    hostToken: string;
    requestId: string;
    completion: WebAccessRelayCompletion;
    now?: Date;
  },
  repository: WebAccessRelayRepository = postgresWebAccessRelayRepository,
): Promise<boolean> {
  const now = input.now ?? new Date();
  const active = await repository.findActiveHostSession({
    slug: input.slug,
    hostTokenHash: hashToken(input.hostToken),
    now,
  });
  if (!active) {
    return false;
  }
  return repository.completeRequest({
    slug: input.slug,
    requestId: input.requestId,
    completion: input.completion,
    now,
  });
}

export async function getWebAccessRpcRequestStatus(
  input: {
    slug: string;
    requestId: string;
    statusToken: string;
    now?: Date;
  },
  repository: WebAccessRelayRepository = postgresWebAccessRelayRepository,
): Promise<WebAccessRelayRequestStatus | null> {
  return repository.findRequestStatus({
    slug: input.slug,
    requestId: input.requestId,
    statusTokenHash: hashToken(input.statusToken),
    now: input.now ?? new Date(),
  });
}

export function createMemoryWebAccessRelayRepository(input: {
  activeSlug: string;
  hostToken: string;
  browserToken?: string;
  userId?: string;
  teamId?: string;
}): WebAccessRelayRepository {
  const requests = new Map<
    string,
    WebAccessRelayRequest & {
      completion?: WebAccessRelayCompletion;
      statusTokenHash: string;
      status: "pending" | "claimed" | "done";
      claimedAt?: string;
    }
  >();
  const hostTokenHash = hashToken(input.hostToken);
  const browserTokenHash = hashToken(input.browserToken ?? `${input.hostToken}:browser`);

  return {
    async pruneExpiredRequests(now) {
      const nowMs = now.getTime();
      for (const [id, request] of requests) {
        if (Date.parse(request.expiresAt) <= nowMs) {
          requests.delete(id);
        }
      }
    },
    async findActiveSessionForRequester(check) {
      const userMatches = !input.userId || check.userId === input.userId;
      const sessionTeamId = input.teamId ?? "team-1";
      return check.slug === input.activeSlug &&
        userMatches &&
        check.teamIds.includes(sessionTeamId);
    },
    async findActiveSessionForBrowser(check) {
      return check.slug === input.activeSlug && check.browserTokenHash === browserTokenHash;
    },
    async findActiveHostSession(check) {
      return check.slug === input.activeSlug && check.hostTokenHash === hostTokenHash;
    },
    async enqueueRequest(enqueue) {
      await this.pruneExpiredRequests(enqueue.now);
      const active = enqueue.browserTokenHash
        ? await this.findActiveSessionForBrowser({
          slug: enqueue.request.slug,
          browserTokenHash: enqueue.browserTokenHash,
          now: enqueue.now,
        })
        : enqueue.userId && enqueue.teamIds
          ? await this.findActiveSessionForRequester({
            slug: enqueue.request.slug,
            userId: enqueue.userId,
            teamIds: enqueue.teamIds,
            now: enqueue.now,
          })
          : false;
      if (!active) {
        return "not_found";
      }
      const openRequests = [...requests.values()].filter(
        (request) =>
          request.slug === enqueue.request.slug &&
          request.status !== "done" &&
          Date.parse(request.expiresAt) > enqueue.now.getTime(),
      ).length;
      if (openRequests >= enqueue.maxOpenRequests) {
        return "queue_full";
      }
      requests.set(enqueue.request.id, { ...enqueue.request, status: "pending" });
      return "inserted";
    },
    async claimPendingRequests(claim) {
      const staleClaimCutoffMs = claim.now.getTime() - CLAIM_TIMEOUT_MS;
      for (const request of requests.values()) {
        if (
          request.slug === claim.slug &&
          request.status === "claimed" &&
          Date.parse(request.expiresAt) > claim.now.getTime() &&
          Date.parse(request.claimedAt ?? request.createdAt) <= staleClaimCutoffMs
        ) {
          request.status = "done";
          request.completion = { ok: false, error: hostClaimTimeoutError };
        }
      }
      const claimed: WebAccessRelayRequest[] = [];
      for (const request of [...requests.values()].sort((lhs, rhs) =>
        Date.parse(lhs.createdAt) - Date.parse(rhs.createdAt),
      )) {
        if (claimed.length >= claim.limit) {
          break;
        }
        if (
          request.slug === claim.slug &&
          request.status === "pending" &&
          Date.parse(request.expiresAt) > claim.now.getTime()
        ) {
          request.status = "claimed";
          request.claimedAt = claim.now.toISOString();
          claimed.push(stripStatus(request));
        }
      }
      return claimed;
    },
    async completeRequest(complete) {
      const request = requests.get(complete.requestId);
      if (
        !request ||
        request.slug !== complete.slug ||
        request.status === "done" ||
        Date.parse(request.expiresAt) <= complete.now.getTime()
      ) {
        return false;
      }
      request.status = "done";
      request.completion = complete.completion;
      return true;
    },
    async findRequestStatus(input) {
      const request = requests.get(input.requestId);
      if (
        !request ||
        request.slug !== input.slug ||
        request.statusTokenHash !== input.statusTokenHash ||
        Date.parse(request.expiresAt) <= input.now.getTime()
      ) {
        return null;
      }
      if (
        request.status === "claimed" &&
        Date.parse(request.claimedAt ?? request.createdAt) <= input.now.getTime() - CLAIM_TIMEOUT_MS
      ) {
        request.status = "done";
        request.completion = { ok: false, error: hostClaimTimeoutError };
      }
      if (request.status !== "done") {
        return { status: request.status };
      }
      if (request.completion?.ok === false) {
        return { status: "failed", error: request.completion.error };
      }
      return { status: "completed", result: request.completion?.result ?? null };
    },
  };
}

export const postgresWebAccessRelayRepository: WebAccessRelayRepository = {
  async pruneExpiredRequests(now) {
    await cloudDb()
      .delete(webAccessRpcRequests)
      .where(lte(webAccessRpcRequests.expiresAt, now));
  },
  async findActiveSessionForRequester(input) {
    if (input.teamIds.length === 0) {
      return false;
    }
    const [row] = await cloudDb()
      .select({ slug: webAccessSessions.slug })
      .from(webAccessSessions)
      .where(
        and(
          eq(webAccessSessions.slug, input.slug),
          eq(webAccessSessions.userId, input.userId),
          inArray(webAccessSessions.teamId, input.teamIds),
          gt(webAccessSessions.expiresAt, input.now),
        ),
      )
      .limit(1);
    return !!row;
  },
  async findActiveSessionForBrowser(input) {
    const [row] = await cloudDb()
      .select({ slug: webAccessSessions.slug })
      .from(webAccessSessions)
      .where(
        and(
          eq(webAccessSessions.slug, input.slug),
          eq(webAccessSessions.browserTokenHash, input.browserTokenHash),
          gt(webAccessSessions.expiresAt, input.now),
        ),
      )
      .limit(1);
    return !!row;
  },
  async findActiveHostSession(input) {
    const [row] = await cloudDb()
      .select({ slug: webAccessSessions.slug })
      .from(webAccessSessions)
      .where(
        and(
          eq(webAccessSessions.slug, input.slug),
          eq(webAccessSessions.hostTokenHash, input.hostTokenHash),
          gt(webAccessSessions.expiresAt, input.now),
        ),
      )
      .limit(1);
    return !!row;
  },
  async enqueueRequest(input) {
    if (!input.browserTokenHash && (!input.userId || !input.teamIds || input.teamIds.length === 0)) {
      return "not_found";
    }
    const db = cloudDb();
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.request.slug}, 25))`,
      );
      await tx
        .delete(webAccessRpcRequests)
        .where(lte(webAccessRpcRequests.expiresAt, input.now));

      const sessionWhere = input.browserTokenHash
        ? and(
          eq(webAccessSessions.slug, input.request.slug),
          eq(webAccessSessions.browserTokenHash, input.browserTokenHash),
          gt(webAccessSessions.expiresAt, input.now),
        )
        : and(
          eq(webAccessSessions.slug, input.request.slug),
          eq(webAccessSessions.userId, input.userId!),
          inArray(webAccessSessions.teamId, [...input.teamIds!]),
          gt(webAccessSessions.expiresAt, input.now),
        );
      const [session] = await tx
        .select({ slug: webAccessSessions.slug })
        .from(webAccessSessions)
        .where(sessionWhere)
        .limit(1);
      if (!session) {
        return "not_found";
      }

      const [row] = await tx
        .select({ total: count() })
        .from(webAccessRpcRequests)
        .where(
          and(
            eq(webAccessRpcRequests.slug, input.request.slug),
            inArray(webAccessRpcRequests.status, ["pending", "claimed"]),
            gt(webAccessRpcRequests.expiresAt, input.now),
          ),
        );
      if (Number(row?.total ?? 0) >= input.maxOpenRequests) {
        return "queue_full";
      }

      await tx.insert(webAccessRpcRequests).values({
        id: input.request.id,
        slug: input.request.slug,
        method: input.request.method,
        params: input.request.params,
        statusTokenHash: input.request.statusTokenHash,
        createdAt: new Date(input.request.createdAt),
        expiresAt: new Date(input.request.expiresAt),
      });
      return "inserted";
    });
  },
  async claimPendingRequests(input) {
    const db = cloudDb();
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.slug}, 24))`,
      );
      const staleClaimCutoff = new Date(input.now.getTime() - CLAIM_TIMEOUT_MS);
      await tx
        .update(webAccessRpcRequests)
        .set({
          status: "failed",
          error: hostClaimTimeoutError,
          completedAt: input.now,
        })
        .where(
          and(
            eq(webAccessRpcRequests.slug, input.slug),
            eq(webAccessRpcRequests.status, "claimed"),
            lte(webAccessRpcRequests.claimedAt, staleClaimCutoff),
            gt(webAccessRpcRequests.expiresAt, input.now),
          ),
        );
      const rows = await tx
        .select()
        .from(webAccessRpcRequests)
        .where(
          and(
            eq(webAccessRpcRequests.slug, input.slug),
            eq(webAccessRpcRequests.status, "pending"),
            gt(webAccessRpcRequests.expiresAt, input.now),
          ),
        )
        .orderBy(asc(webAccessRpcRequests.createdAt))
        .limit(input.limit);
      if (rows.length === 0) {
        return [];
      }
      const ids = rows.map((row) => row.id);
      await tx
        .update(webAccessRpcRequests)
        .set({ status: "claimed", claimedAt: input.now })
        .where(
          and(
            inArray(webAccessRpcRequests.id, ids),
            eq(webAccessRpcRequests.status, "pending"),
          ),
        );
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        method: row.method as MobileRpcMethod,
        params: normalizeParams(row.params),
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      }));
    });
  },
  async completeRequest(input) {
    const values = input.completion.ok
      ? { status: "completed", result: input.completion.result, error: null, completedAt: input.now }
      : { status: "failed", result: null, error: input.completion.error, completedAt: input.now };
    const rows = await cloudDb()
      .update(webAccessRpcRequests)
      .set(values)
      .where(
        and(
          eq(webAccessRpcRequests.slug, input.slug),
          eq(webAccessRpcRequests.id, input.requestId),
          inArray(webAccessRpcRequests.status, ["pending", "claimed"]),
          gt(webAccessRpcRequests.expiresAt, input.now),
        ),
      )
      .returning({ id: webAccessRpcRequests.id });
    return rows.length > 0;
  },
  async findRequestStatus(input) {
    const staleClaimCutoff = new Date(input.now.getTime() - CLAIM_TIMEOUT_MS);
    await cloudDb()
      .update(webAccessRpcRequests)
      .set({
        status: "failed",
        error: hostClaimTimeoutError,
        completedAt: input.now,
      })
      .where(
        and(
          eq(webAccessRpcRequests.slug, input.slug),
          eq(webAccessRpcRequests.id, input.requestId),
          eq(webAccessRpcRequests.statusTokenHash, input.statusTokenHash),
          eq(webAccessRpcRequests.status, "claimed"),
          lte(webAccessRpcRequests.claimedAt, staleClaimCutoff),
          gt(webAccessRpcRequests.expiresAt, input.now),
        ),
      );
    const [row] = await cloudDb()
      .select({
        status: webAccessRpcRequests.status,
        result: webAccessRpcRequests.result,
        error: webAccessRpcRequests.error,
      })
      .from(webAccessRpcRequests)
      .where(
        and(
          eq(webAccessRpcRequests.slug, input.slug),
          eq(webAccessRpcRequests.id, input.requestId),
          eq(webAccessRpcRequests.statusTokenHash, input.statusTokenHash),
          gt(webAccessRpcRequests.expiresAt, input.now),
        ),
      )
      .limit(1);
    if (!row) {
      return null;
    }
    if (row.status === "completed") {
      return { status: "completed", result: row.result ?? null };
    }
    if (row.status === "failed") {
      return {
        status: "failed",
        error: normalizeError(row.error),
      };
    }
    return row.status === "claimed" ? { status: "claimed" } : { status: "pending" };
  },
};

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function token(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function normalizeParams(value: unknown): MobileRpcParams {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as MobileRpcParams)
    : {};
}

function normalizeError(value: unknown): { code?: string; message: string } {
  if (value && typeof value === "object") {
    const error = value as { code?: unknown; message?: unknown };
    return {
      ...(typeof error.code === "string" ? { code: error.code } : {}),
      message: typeof error.message === "string" ? error.message : "Mobile RPC request failed",
    };
  }
  return { message: "Mobile RPC request failed" };
}

function stripStatus(
  request: StoredWebAccessRelayRequest & {
    status: "pending" | "claimed" | "done";
    claimedAt?: string;
  },
): WebAccessRelayRequest {
  const {
    status: _status,
    statusTokenHash: _statusTokenHash,
    claimedAt: _claimedAt,
    ...relayRequest
  } = request;
  void _status;
  void _statusTokenHash;
  void _claimedAt;
  return relayRequest;
}

function withoutStatusTokenHash(request: StoredWebAccessRelayRequest): WebAccessRelayRequest {
  const { statusTokenHash: _statusTokenHash, ...relayRequest } = request;
  void _statusTokenHash;
  return relayRequest;
}
