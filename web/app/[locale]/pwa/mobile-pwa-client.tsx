"use client";

import { useEffect, useState } from "react";

type PwaCopy = {
  title: string;
  subtitle: string;
  connected: string;
  loadingDevices: string;
  signInRequired: string;
  registryUnavailable: string;
  signIn: string;
  retry: string;
  webAccessSessions: string;
  open: string;
  noWebAccessSessions: string;
  expires: string;
};

type OwnerWebAccessSession = {
  slug: string;
  displayName: string | null;
  deviceId: string | null;
  createdAt: string;
  expiresAt: string;
  connected: boolean;
  publicPath: string;
};

type StoredLocalWebAccessSession = {
  browserToken: string;
  expiresAt: string;
  slug: string;
};

const localWebAccessSessionStoragePrefix = "cmux:web-access:session:";

type MobilePwaClientProps = {
  authEnabled: boolean;
  copy: PwaCopy;
  signInHref: string;
};

export function MobilePwaClient({ authEnabled, copy, signInHref }: MobilePwaClientProps) {
  const [sessions, setSessions] = useState<OwnerWebAccessSession[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unauthorized" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const result = await loadSessions();
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setSessions(result.sessions);
        setStatus("ready");
      } else {
        setSessions([]);
        setStatus(!authEnabled && result.status === "unauthorized" ? "ready" : result.status);
      }
    }

    void refresh();
    const interval = globalThis.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [authEnabled]);

  async function refreshNow() {
    setStatus("loading");
    const result = await loadSessions();
    if (result.ok) {
      setSessions(result.sessions);
      setStatus("ready");
    } else {
      setSessions([]);
      setStatus(!authEnabled && result.status === "unauthorized" ? "ready" : result.status);
    }
  }

  return (
    <main className="flex h-svh min-h-0 flex-col overflow-hidden bg-[#050505] text-[#f2f2f2]">
      <section className="flex min-h-0 flex-1 flex-col px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))]">
        <header className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-0.5">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-normal">{copy.title}</h1>
            <div className="mt-0.5 truncate text-xs text-[#a8a8a8]">{statusLabel(copy, status)}</div>
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
            {sessions.length} {copy.webAccessSessions}
          </span>
        </header>

        {status === "unauthorized" ? (
          <a
            className="mt-4 rounded-xl bg-[#f5f5f5] px-3 py-3 text-center text-sm font-semibold text-[#080808]"
            href={signInHref}
          >
            {copy.signIn}
          </a>
        ) : null}

        {status === "error" ? (
          <button
            className="mt-4 rounded-xl border border-[#2a2a2a] bg-[#101010] px-3 py-3 text-sm font-semibold"
            onClick={() => void refreshNow()}
            type="button"
          >
            {copy.retry}
          </button>
        ) : null}

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-1">
          {status !== "unauthorized" && sessions.length === 0 ? (
            <div className="rounded-xl border border-[#2a2a2a] bg-[#101010] p-4 text-sm text-[#a8a8a8]">
              {status === "loading" ? copy.loadingDevices : copy.noWebAccessSessions}
            </div>
          ) : null}

          {sessions.map((session) => (
            <a
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl border border-[#2a2a2a] bg-gradient-to-b from-[#151515] to-[#101010] p-3 text-left active:translate-y-px"
              href={session.publicPath}
              key={session.slug}
            >
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold tracking-normal">
                  {session.displayName ?? session.deviceId ?? session.slug}
                </span>
                <span className="mt-1 block truncate font-mono text-xs text-[#a8a8a8]">
                  {session.slug}
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#333] px-2 py-1 text-[11px] leading-none text-[#dcdcdc]">
                    <span className={session.connected ? "h-1.5 w-1.5 rounded-full bg-emerald-400" : "h-1.5 w-1.5 rounded-full bg-amber-400"} />
                    {session.connected ? copy.connected : copy.loadingDevices}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#333] px-2 py-1 text-[11px] leading-none text-[#dcdcdc]">
                    {copy.expires}: {formatDate(session.expiresAt)}
                  </span>
                </span>
              </span>
              <span className="self-start rounded-full bg-[#f5f5f5] px-2 py-1 text-xs font-bold text-[#080808]">
                {copy.open}
              </span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}

async function loadSessions(): Promise<
  | { ok: true; sessions: OwnerWebAccessSession[] }
  | { ok: false; status: "unauthorized" | "error" }
> {
  try {
    const response = await fetch("/api/mobile/web-access/sessions", {
      cache: "no-store",
    });
    if (response.status === 401) {
      const localSessions = loadLocalWebAccessSessions();
      if (localSessions.length > 0) {
        return { ok: true, sessions: localSessions };
      }
      return { ok: false, status: "unauthorized" };
    }
    if (!response.ok) {
      const localSessions = loadLocalWebAccessSessions();
      if (localSessions.length > 0) {
        return { ok: true, sessions: localSessions };
      }
      return { ok: false, status: "error" };
    }
    const payload = await response.json();
    const remoteSessions = Array.isArray(payload?.sessions)
      ? (payload.sessions as OwnerWebAccessSession[])
      : [];
    const localSessions = loadLocalWebAccessSessions();
    return {
      ok: true,
      sessions: mergeSessions(remoteSessions, localSessions),
    };
  } catch {
    const localSessions = loadLocalWebAccessSessions();
    if (localSessions.length > 0) {
      return { ok: true, sessions: localSessions };
    }
    return { ok: false, status: "error" };
  }
}

function loadLocalWebAccessSessions(): OwnerWebAccessSession[] {
  if (typeof window === "undefined") {
    return [];
  }
  const sessions: OwnerWebAccessSession[] = [];
  const now = Date.now();
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
        Number.isNaN(expiresAtMs) ||
        expiresAtMs <= now
      ) {
        window.localStorage.removeItem(key);
        continue;
      }
      sessions.push({
        slug: stored.slug,
        displayName: null,
        deviceId: null,
        createdAt: stored.expiresAt,
        expiresAt: stored.expiresAt,
        connected: false,
        publicPath: localWebAccessPath(stored.slug, stored.browserToken),
      });
    } catch {
      window.localStorage.removeItem(key);
    }
  }
  return sessions.sort((left, right) => right.expiresAt.localeCompare(left.expiresAt));
}

function mergeSessions(
  remoteSessions: OwnerWebAccessSession[],
  localSessions: OwnerWebAccessSession[],
): OwnerWebAccessSession[] {
  const merged = new Map<string, OwnerWebAccessSession>();
  for (const session of remoteSessions) {
    merged.set(session.slug, session);
  }
  for (const session of localSessions) {
    const remote = merged.get(session.slug);
    merged.set(session.slug, remote ? { ...session, ...remote, publicPath: session.publicPath } : session);
  }
  return [...merged.values()];
}

function localWebAccessPath(slug: string, browserToken: string): string {
  const firstPathSegment = window.location.pathname.split("/").filter(Boolean)[0];
  const localePrefix = firstPathSegment && firstPathSegment !== "pwa" ? `/${firstPathSegment}` : "";
  return `${localePrefix}/w/${encodeURIComponent(slug)}?access_token=${encodeURIComponent(browserToken)}`;
}

function statusLabel(
  copy: PwaCopy,
  status: "loading" | "ready" | "unauthorized" | "error",
) {
  switch (status) {
    case "loading":
      return copy.loadingDevices;
    case "ready":
      return copy.connected;
    case "unauthorized":
      return copy.signInRequired;
    case "error":
      return copy.registryUnavailable;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
