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
  }, []);

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
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
              {copy.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {copy.subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                status === "ready" && sessions.some((session) => session.connected)
                  ? "bg-emerald-500"
                  : status === "error" || status === "unauthorized"
                    ? "bg-amber-500"
                    : "bg-muted"
              }`}
            />
            <span>{statusLabel(copy, status)}</span>
          </div>
        </header>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xs font-medium uppercase tracking-normal text-muted">
              {copy.webAccessSessions}
            </h2>
            {status === "error" ? (
              <button
                className="rounded border border-border px-3 py-2 text-sm hover:bg-code-bg"
                onClick={() => void refreshNow()}
                type="button"
              >
                {copy.retry}
              </button>
            ) : null}
          </div>

          {status === "unauthorized" ? (
            <a
              className="block rounded bg-foreground px-3 py-2 text-center text-sm font-medium text-background"
              href={signInHref}
            >
              {copy.signIn}
            </a>
          ) : null}

          {status !== "unauthorized" && sessions.length === 0 ? (
            <div className="rounded border border-border bg-code-bg p-4 text-sm text-muted">
              {status === "loading" ? copy.loadingDevices : copy.noWebAccessSessions}
            </div>
          ) : null}

          <div className="grid gap-3">
            {sessions.map((session) => (
              <a
                className="rounded border border-border bg-code-bg p-4 transition-colors hover:border-foreground"
                href={session.publicPath}
                key={session.slug}
              >
                <span className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <span className="block font-medium">
                      {session.displayName ?? session.deviceId ?? session.slug}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-muted">
                      {session.slug}
                    </span>
                  </span>
                  <span className="rounded border border-border px-2 py-1 text-xs">
                    {session.connected ? copy.connected : copy.loadingDevices}
                  </span>
                </span>
                <span className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
                  <span>
                    {copy.expires}: {formatDate(session.expiresAt)}
                  </span>
                  <span className="font-medium text-foreground">{copy.open}</span>
                </span>
              </a>
            ))}
          </div>
        </section>
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
      return { ok: false, status: "unauthorized" };
    }
    if (!response.ok) {
      return { ok: false, status: "error" };
    }
    const payload = await response.json();
    return {
      ok: true,
      sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
    };
  } catch {
    return { ok: false, status: "error" };
  }
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
