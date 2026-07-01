"use client";

import { useEffect, useState } from "react";

type PwaCopy = {
  title: string;
  subtitle: string;
  connected: string;
  loadingDevices: string;
  open: string;
  expires: string;
  pwaListSavedMacs: string;
  pwaListLocalOnlyBadge: string;
  pwaListLocalOnlyTitle: string;
  pwaListLocalOnlyBody: string;
  pwaListPairingTitle: string;
  pwaListPairingBody: string;
  pwaListForget: string;
  pwaListLastSeen: string;
  pwaListThisOrigin: string;
  pwaListWaitingForMac: string;
  pwaListExpired: string;
  pwaListTailscaleTitle: string;
  pwaListTailscaleLoopbackBody: string;
  pwaListTailscaleHttpBody: string;
  pwaListTailscaleReadyBody: string;
  pwaListTailscaleOtherBody: string;
};

type SavedWebAccessSession = {
  slug: string;
  displayName: string | null;
  deviceId: string | null;
  createdAt: string;
  expiresAt: string;
  connected: boolean;
  expired: boolean;
  lastSeenAt: string | null;
  origin: string | null;
  pairedAt: string | null;
  publicPath: string;
};

type StoredLocalWebAccessSession = {
  browserToken: string;
  createdAt?: string;
  deviceId?: string | null;
  displayName?: string | null;
  expiresAt: string;
  lastSeenAt?: string | null;
  origin?: string | null;
  pairedAt?: string | null;
  slug: string;
};

const localWebAccessSessionStoragePrefix = "cmux:web-access:session:";

type MobilePwaClientProps = {
  copy: PwaCopy;
};

type OriginGuidance = {
  kind: "loopback" | "tailscale-ready" | "tailscale-http" | "other";
  origin: string;
};

type PublicSessionPayload = {
  session?: {
    slug?: unknown;
    displayName?: unknown;
    deviceId?: unknown;
    createdAt?: unknown;
    expiresAt?: unknown;
    connected?: unknown;
  };
};

export function MobilePwaClient({ copy }: MobilePwaClientProps) {
  const [sessions, setSessions] = useState<SavedWebAccessSession[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [originGuidance, setOriginGuidance] = useState<OriginGuidance | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const result = await loadSessions();
      if (cancelled) {
        return;
      }
      setOriginGuidance(currentOriginGuidance());
      setSessions(result);
      setStatus("ready");
    }

    void refresh();
    const interval = globalThis.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, []);

  function forgetSession(slug: string) {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(`${localWebAccessSessionStoragePrefix}${slug}`);
      } catch {
        // Keep the in-memory removal responsive even if storage is blocked.
      }
    }
    setSessions((current) => current.filter((session) => session.slug !== slug));
  }

  return (
    <main className="flex h-svh min-h-0 flex-col overflow-hidden bg-[#050505] text-[#f2f2f2]">
      <section className="flex min-h-0 flex-1 flex-col px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))]">
        <header className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-0.5">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-normal">{copy.title}</h1>
            <div className="mt-0.5 text-xs leading-4 text-[#a8a8a8]">{copy.subtitle}</div>
          </div>
          <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-[#2a2a2a] bg-[#0d0d0d] px-2.5 text-xs text-[#a8a8a8]">
            <span
              className={
                status === "ready" && sessions.some((session) => session.connected)
                  ? "h-1.5 w-1.5 rounded-full bg-emerald-400"
                  : status === "loading"
                    ? "h-1.5 w-1.5 rounded-full bg-[#707070]"
                    : "h-1.5 w-1.5 rounded-full bg-amber-400"
                }
            />
            {sessions.length} {copy.pwaListSavedMacs}
          </span>
        </header>

        <div className="mt-3 grid gap-2">
          <section className="rounded-lg border border-[#2a2a2a] bg-[#101010] p-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-normal">{copy.pwaListLocalOnlyTitle}</h2>
              <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-200">
                {copy.pwaListLocalOnlyBadge}
              </span>
            </div>
            <p className="mt-2 text-sm leading-5 text-[#bdbdbd]">{copy.pwaListLocalOnlyBody}</p>
          </section>

          {originGuidance ? (
            <section className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-3">
              <div className="text-sm font-semibold tracking-normal">{copy.pwaListTailscaleTitle}</div>
              <p className="mt-2 text-sm leading-5 text-[#bdbdbd]">
                {originGuidanceBody(copy, originGuidance)}
              </p>
              <div className="mt-2 truncate font-mono text-[11px] text-[#8a8a8a]">
                {copy.pwaListThisOrigin}: {originGuidance.origin}
              </div>
            </section>
          ) : null}
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-1">
          {status === "loading" ? (
            <div className="rounded-lg border border-[#2a2a2a] bg-[#101010] p-4 text-sm text-[#a8a8a8]">
              {copy.loadingDevices}
            </div>
          ) : null}

          {status === "ready" && sessions.length === 0 ? (
            <div className="rounded-lg border border-[#2a2a2a] bg-[#101010] p-4">
              <h2 className="text-sm font-semibold tracking-normal">{copy.pwaListPairingTitle}</h2>
              <p className="mt-2 text-sm leading-5 text-[#a8a8a8]">{copy.pwaListPairingBody}</p>
            </div>
          ) : null}

          {sessions.map((session) => {
            const statusText = session.connected
              ? copy.connected
              : session.expired
                ? copy.pwaListExpired
                : copy.pwaListWaitingForMac;
            return (
              <article
                className="rounded-lg border border-[#2a2a2a] bg-gradient-to-b from-[#151515] to-[#101010] p-3"
                key={session.slug}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold tracking-normal">
                      {session.displayName ?? session.deviceId ?? session.slug}
                    </h2>
                    <div className="mt-1 truncate font-mono text-xs text-[#a8a8a8]">
                      {session.origin ?? session.slug}
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#333] px-2 py-1 text-[11px] leading-none text-[#dcdcdc]">
                    <span
                      className={
                        session.connected
                          ? "h-1.5 w-1.5 rounded-full bg-emerald-400"
                          : session.expired
                            ? "h-1.5 w-1.5 rounded-full bg-[#707070]"
                            : "h-1.5 w-1.5 rounded-full bg-amber-400"
                      }
                    />
                    {statusText}
                  </span>
                </div>

                <div className="mt-3 grid gap-1.5 text-xs text-[#a8a8a8]">
                  <div className="flex min-w-0 justify-between gap-3">
                    <span className="shrink-0 text-[#777]">{copy.expires}</span>
                    <span className="min-w-0 truncate text-right">{formatDate(session.expiresAt)}</span>
                  </div>
                  {session.lastSeenAt ? (
                    <div className="flex min-w-0 justify-between gap-3">
                      <span className="shrink-0 text-[#777]">{copy.pwaListLastSeen}</span>
                      <span className="min-w-0 truncate text-right">{formatDate(session.lastSeenAt)}</span>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <a
                    className="rounded-lg bg-[#f5f5f5] px-3 py-2 text-center text-sm font-bold text-[#080808] active:translate-y-px"
                    href={session.publicPath}
                  >
                    {copy.open}
                  </a>
                  <button
                    className="rounded-lg border border-[#333] bg-[#0b0b0b] px-3 py-2 text-sm font-semibold text-[#dcdcdc] active:translate-y-px"
                    onClick={() => forgetSession(session.slug)}
                    type="button"
                  >
                    {copy.pwaListForget}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

async function loadSessions(): Promise<SavedWebAccessSession[]> {
  const storedSessions = loadStoredLocalWebAccessSessions();
  const sessions = await Promise.all(storedSessions.map(enrichLocalWebAccessSession));
  return mergeSavedMacSessions(sessions).sort(compareSavedSessions);
}

function loadStoredLocalWebAccessSessions(): StoredLocalWebAccessSession[] {
  if (typeof window === "undefined") {
    return [];
  }
  const sessions: StoredLocalWebAccessSession[] = [];
  const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
    window.localStorage.key(index),
  );
  for (const key of keys) {
    if (!key?.startsWith(localWebAccessSessionStoragePrefix)) {
      continue;
    }
    try {
      const raw = window.localStorage.getItem(key);
      const stored = raw ? (JSON.parse(raw) as Partial<StoredLocalWebAccessSession>) : null;
      const expiresAtMs =
        typeof stored?.expiresAt === "string" ? Date.parse(stored.expiresAt) : NaN;
      if (
        !stored ||
        typeof stored.slug !== "string" ||
        !stored.slug ||
        typeof stored.browserToken !== "string" ||
        !stored.browserToken ||
        typeof stored.expiresAt !== "string" ||
        Number.isNaN(expiresAtMs)
      ) {
        window.localStorage.removeItem(key);
        continue;
      }
      sessions.push(normalizeStoredSession(stored));
    } catch {
      window.localStorage.removeItem(key);
    }
  }
  return sessions;
}

async function enrichLocalWebAccessSession(
  stored: StoredLocalWebAccessSession,
): Promise<SavedWebAccessSession> {
  const fallback = savedSessionFromStored(stored, false);
  try {
    const response = await fetch(
      webAccessSessionStatusURL(stored),
      { cache: "no-store" },
    );
    if (!response.ok) {
      return fallback;
    }
    const payload = (await response.json()) as PublicSessionPayload;
    const publicSession = parsePublicSession(payload, stored.slug);
    if (!publicSession) {
      return fallback;
    }
    const nextStored: StoredLocalWebAccessSession = {
      ...stored,
      createdAt: publicSession.createdAt,
      deviceId: publicSession.deviceId,
      displayName: publicSession.displayName,
      expiresAt: publicSession.expiresAt,
      lastSeenAt: new Date().toISOString(),
      origin: stored.origin ?? currentOrigin(),
      pairedAt: stored.pairedAt ?? publicSession.createdAt,
    };
    storeLocalWebAccessSession(nextStored);
    return savedSessionFromStored(nextStored, publicSession.connected);
  } catch {
    return fallback;
  }
}

function parsePublicSession(
  payload: PublicSessionPayload,
  expectedSlug: string,
): (StoredLocalWebAccessSession & { connected: boolean }) | null {
  const session = payload.session;
  if (!session || typeof session !== "object") {
    return null;
  }
  const slug = typeof session.slug === "string" && session.slug ? session.slug : expectedSlug;
  if (slug !== expectedSlug) {
    return null;
  }
  const createdAt = typeof session.createdAt === "string" ? session.createdAt : null;
  const expiresAt = typeof session.expiresAt === "string" ? session.expiresAt : null;
  if (!createdAt || !expiresAt || Number.isNaN(Date.parse(expiresAt))) {
    return null;
  }
  return {
    browserToken: "",
    slug,
    createdAt,
    deviceId: cleanOptionalString(session.deviceId),
    displayName: cleanOptionalString(session.displayName),
    expiresAt,
    connected: session.connected === true,
  };
}

function normalizeStoredSession(
  stored: Partial<StoredLocalWebAccessSession>,
): StoredLocalWebAccessSession {
  return {
    browserToken: stored.browserToken!,
    createdAt: validDateString(stored.createdAt) ?? undefined,
    deviceId: cleanOptionalString(stored.deviceId),
    displayName: cleanOptionalString(stored.displayName),
    expiresAt: stored.expiresAt!,
    lastSeenAt: validDateString(stored.lastSeenAt) ?? null,
    origin: cleanOptionalString(stored.origin),
    pairedAt: validDateString(stored.pairedAt) ?? null,
    slug: stored.slug!,
  };
}

function savedSessionFromStored(
  stored: StoredLocalWebAccessSession,
  connected: boolean,
): SavedWebAccessSession {
  return {
    slug: stored.slug,
    displayName: cleanOptionalString(stored.displayName),
    deviceId: cleanOptionalString(stored.deviceId),
    createdAt: validDateString(stored.createdAt) ?? stored.expiresAt,
    expiresAt: stored.expiresAt,
    connected,
    expired: Date.parse(stored.expiresAt) <= Date.now(),
    lastSeenAt: validDateString(stored.lastSeenAt),
    origin: cleanOptionalString(stored.origin) ?? currentOrigin(),
    pairedAt: validDateString(stored.pairedAt),
    publicPath: localWebAccessPath(stored.slug, stored.browserToken, stored.origin),
  };
}

function storeLocalWebAccessSession(session: StoredLocalWebAccessSession) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      `${localWebAccessSessionStoragePrefix}${session.slug}`,
      JSON.stringify({
        slug: session.slug,
        browserToken: session.browserToken,
        createdAt: session.createdAt,
        deviceId: session.deviceId,
        displayName: session.displayName,
        expiresAt: session.expiresAt,
        lastSeenAt: session.lastSeenAt,
        origin: session.origin,
        pairedAt: session.pairedAt,
      }),
    );
  } catch {
    return;
  }
}

function mergeSavedMacSessions(
  sessions: SavedWebAccessSession[],
): SavedWebAccessSession[] {
  const merged = new Map<string, SavedWebAccessSession>();
  for (const session of sessions) {
    const key = session.deviceId ? `device:${session.deviceId}` : `slug:${session.slug}`;
    const existing = merged.get(key);
    if (!existing || compareSavedSessions(session, existing) < 0) {
      merged.set(key, session);
    }
  }
  return [...merged.values()];
}

function compareSavedSessions(left: SavedWebAccessSession, right: SavedWebAccessSession): number {
  if (left.connected !== right.connected) {
    return left.connected ? -1 : 1;
  }
  if (left.expired !== right.expired) {
    return left.expired ? 1 : -1;
  }
  return Date.parse(right.expiresAt) - Date.parse(left.expiresAt);
}

function localWebAccessPath(
  slug: string,
  browserToken: string,
  origin?: string | null,
): string {
  const firstPathSegment = window.location.pathname.split("/").filter(Boolean)[0];
  const localePrefix = firstPathSegment && firstPathSegment !== "pwa" ? `/${firstPathSegment}` : "";
  const path = `${localePrefix}/w/${encodeURIComponent(slug)}?access_token=${encodeURIComponent(browserToken)}`;
  return origin && /^https?:\/\//.test(origin) ? `${origin}${path}` : path;
}

function webAccessSessionStatusURL(stored: StoredLocalWebAccessSession): string {
  const path = `/api/mobile/web-access/sessions/${encodeURIComponent(stored.slug)}`;
  return stored.origin && /^https?:\/\//.test(stored.origin) ? `${stored.origin}${path}` : path;
}

function currentOriginGuidance(): OriginGuidance | null {
  if (typeof window === "undefined") {
    return null;
  }
  const url = new URL(window.location.href);
  const host = url.hostname.toLowerCase();
  const origin = url.origin;
  if (hostIsLoopback(host)) {
    return { kind: "loopback", origin };
  }
  if (hostIsTailscale(host) && url.protocol === "https:") {
    return { kind: "tailscale-ready", origin };
  }
  if (hostIsTailscale(host) || url.protocol === "http:") {
    return { kind: "tailscale-http", origin };
  }
  return { kind: "other", origin };
}

function originGuidanceBody(copy: PwaCopy, guidance: OriginGuidance): string {
  switch (guidance.kind) {
    case "loopback":
      return copy.pwaListTailscaleLoopbackBody;
    case "tailscale-ready":
      return copy.pwaListTailscaleReadyBody;
    case "tailscale-http":
      return copy.pwaListTailscaleHttpBody;
    case "other":
      return copy.pwaListTailscaleOtherBody;
  }
}

function currentOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}

function hostIsLoopback(rawHost: string): boolean {
  let host = rawHost.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host === "0.0.0.0" ||
    host.startsWith("127.")
  );
}

function hostIsTailscale(host: string): boolean {
  if (host.endsWith(".ts.net")) {
    return true;
  }
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

function cleanOptionalString(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function validDateString(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
