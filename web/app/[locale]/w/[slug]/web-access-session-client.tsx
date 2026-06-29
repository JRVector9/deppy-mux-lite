"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { MobileRpcClient } from "@/services/mobile-rpc/client";
import type {
  MobileRenderGridFrame,
  MobileRenderGridSpan,
  MobileRenderGridStyle,
} from "@/services/mobile-rpc/render-grid";
import {
  parseMobileRenderGridFrame,
  sortedRowSpans,
} from "@/services/mobile-rpc/render-grid";
import { terminalReplayToText } from "@/services/mobile-rpc/terminal-screen";
import type {
  MobileTerminalPreview,
  MobileTerminalReplayResponse,
  MobileTerminalTarget,
  MobileWorkspacePreview,
} from "@/services/mobile-rpc/types";
import { WebAccessRelayTransport } from "@/services/mobile-rpc/web-access-relay-transport";

type WebAccessSessionCopy = {
  clear: string;
  composerPlaceholder: string;
  connected: string;
  enter: string;
  selected: string;
  send: string;
  signIn: string;
  status: string;
  terminal: string;
  transcriptEmpty: string;
  signInRequired: string;
  waiting: string;
  workspaceList: string;
};

type WebAccessSessionClientProps = {
  authEnabled: boolean;
  copy: WebAccessSessionCopy;
  initialConnected: boolean;
  signInHref: string;
  slug: string;
};

const webClientId = "web-access";
const terminalLineHeightEm = 1.35;
const webTerminalDefaultForeground = "#d8d8d8";
const webTerminalDefaultBackground = "#050505";
const estimatedTerminalFontPx = 12;
const estimatedTerminalCellWidthPx = 7.2;

type TerminalSnapshot =
  | { kind: "render-grid"; frame: MobileRenderGridFrame }
  | { kind: "text"; text: string };

export function WebAccessSessionClient({
  authEnabled,
  copy,
  initialConnected,
  signInHref,
  slug,
}: WebAccessSessionClientProps) {
  const [browserToken] = useState(() => browserTokenFromLocation(slug));
  const client = useMemo(
    () =>
      new MobileRpcClient(
        new WebAccessRelayTransport(slug, {
          browserToken,
          pollIntervalMs: 250,
          timeoutMs: 45_000,
        }),
      ),
    [browserToken, slug],
  );
  const [connected, setConnected] = useState(initialConnected);
  const [workspaces, setWorkspaces] = useState<MobileWorkspacePreview[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedTerminalId, setSelectedTerminalId] = useState("");
  const [composer, setComposer] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [terminalSnapshot, setTerminalSnapshot] = useState<TerminalSnapshot | null>(
    null,
  );
  const terminalViewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ columns: 80, rows: 24 });

  useEffect(() => {
    let cancelled = false;

    async function refreshStatus() {
      try {
        const response = await fetch(`/api/mobile/web-access/sessions/${slug}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          if (!cancelled) {
            setConnected(false);
          }
          return;
        }
        const payload = await response.json();
        const nextConnected = payload?.session?.connected === true;
        if (!cancelled) {
          setConnected(nextConnected);
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
        }
      }
    }

    const interval = globalThis.setInterval(() => void refreshStatus(), 5000);
    void refreshStatus();

    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [slug]);

  useEffect(() => {
    if (!connected) {
      return;
    }
    let cancelled = false;

    async function refreshWorkspaces() {
      try {
        const response = await client.listWorkspaces();
        if (cancelled) {
          return;
        }
        setWorkspaces(response.workspaces);
        setSignInRequired(false);
        setSelectedWorkspaceId((current) => current || response.workspaces[0]?.id || "");
        setSelectedTerminalId((current) => current || response.workspaces[0]?.terminals[0]?.id || "");
      } catch (error) {
        if (!cancelled) {
          setSignInRequired(authEnabled && error instanceof Error && /unauthorized|forbidden/i.test(error.message));
          setWorkspaces([]);
        }
      }
    }

    void refreshWorkspaces();
    const interval = globalThis.setInterval(() => void refreshWorkspaces(), 10_000);
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [authEnabled, client, connected]);

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
    workspaces[0];
  const selectedTerminal =
    selectedWorkspace?.terminals.find((terminal) => terminal.id === selectedTerminalId) ??
    selectedWorkspace?.terminals[0];
  const target = selectedWorkspace && selectedTerminal
    ? terminalTarget(selectedWorkspace, selectedTerminal)
    : null;

  useEffect(() => {
    const element = terminalViewportRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateViewport = () => {
      const rect = element.getBoundingClientRect();
      const columns = Math.max(
        32,
        Math.min(160, Math.floor(rect.width / estimatedTerminalCellWidthPx)),
      );
      const rows = Math.max(
        12,
        Math.min(
          60,
          Math.floor(rect.height / (estimatedTerminalFontPx * terminalLineHeightEm)),
        ),
      );
      setViewport((current) =>
        current.columns === columns && current.rows === rows
          ? current
          : { columns, rows },
      );
    };

    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    updateViewport();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!connected || !target) {
      setTerminalSnapshot(null);
      return;
    }
    const capturedTarget = target;
    let cancelled = false;
    let inFlight = false;

    async function refreshTerminalScreen() {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const replay = await client.replayTerminal(capturedTarget);
        if (!cancelled) {
          setTerminalSnapshot(terminalSnapshotFromReplay(replay));
        }
      } catch {
        if (!cancelled) {
          setTerminalSnapshot(null);
        }
      } finally {
        inFlight = false;
      }
    }

    void client
      .updateViewport(capturedTarget, viewport)
      .catch(() => {});
    void refreshTerminalScreen();
    const interval = globalThis.setInterval(
      () => void refreshTerminalScreen(),
      500,
    );
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [client, connected, target?.surfaceId, target?.workspaceId, viewport]);

  async function refreshTerminalScreen(capturedTarget: MobileTerminalTarget) {
    try {
      const replay = await client.replayTerminal(capturedTarget);
      setTerminalSnapshot(terminalSnapshotFromReplay(replay));
    } catch {
      // The polling effect will keep trying while the host remains connected.
    }
  }

  async function sendComposer() {
    const text = composer.trimEnd();
    if (!target || !text) {
      return;
    }
    const capturedTarget = target;
    await client.pasteText(capturedTarget, text, {
      submitKey: "return",
      viewport,
    });
    setComposer((current) => (current.trimEnd() === text ? "" : current));
    setTranscript((current) => [
      ...current,
      `${capturedTarget.surfaceId} $ ${text}`,
    ]);
    void refreshTerminalScreen(capturedTarget);
  }

  async function sendEnter() {
    if (!target) {
      return;
    }
    const capturedTarget = target;
    await client.sendInput(capturedTarget, "\r");
    setTranscript((current) => [
      ...current,
      `${capturedTarget.surfaceId} ${copy.enter}`,
    ]);
    void refreshTerminalScreen(capturedTarget);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 py-3 text-sm lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-4 lg:py-5">
      <aside className="min-w-0 space-y-3 lg:space-y-4">
        <div className="rounded border border-border bg-code-bg p-3">
          <div className="text-xs text-muted">{copy.status}</div>
          <div className="mt-1">{connected ? copy.connected : copy.waiting}</div>
        </div>
        {signInRequired ? (
          <a
            className="block rounded bg-foreground px-3 py-2 text-center text-sm font-medium text-background"
            href={signInHref}
          >
            {copy.signIn}
          </a>
        ) : null}
        {signInRequired ? (
          <div className="text-xs text-muted">{copy.signInRequired}</div>
        ) : null}
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-normal text-muted">
            {copy.workspaceList}
          </h2>
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 lg:mx-0 lg:block lg:space-y-2 lg:overflow-visible lg:px-0 lg:pb-0">
            {workspaces.map((workspace) => (
              <button
                className={`min-w-56 flex-none rounded border px-3 py-2 text-left lg:w-full ${
                  workspace.id === selectedWorkspace?.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background hover:bg-code-bg"
                }`}
                key={workspace.id}
                onClick={() => {
                  setSelectedWorkspaceId(workspace.id);
                  setSelectedTerminalId(workspace.terminals[0]?.id ?? "");
                }}
                type="button"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{workspace.title}</span>
                  {workspace.id === selectedWorkspace?.id ? (
                    <span className="shrink-0 text-xs">{copy.selected}</span>
                  ) : null}
                </span>
                {workspace.currentDirectory ? (
                  <span className="mt-1 block truncate font-mono text-xs opacity-75">
                    {workspace.currentDirectory}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="flex min-h-[58svh] min-w-0 flex-1 flex-col rounded border border-border bg-code-bg lg:min-h-0">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs text-muted">{copy.terminal}</div>
            <div className="truncate font-mono text-sm">{selectedTerminal?.title ?? "..."}</div>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            {selectedWorkspace?.terminals.map((terminal) => (
              <button
                className={`shrink-0 rounded border px-2 py-1 text-xs ${
                  terminal.id === selectedTerminal?.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background hover:bg-code-bg"
                }`}
                key={terminal.id}
                onClick={() => setSelectedTerminalId(terminal.id)}
                type="button"
              >
                {terminal.title}
              </button>
            ))}
          </div>
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto p-2 sm:p-3"
          ref={terminalViewportRef}
        >
          {terminalSnapshot?.kind === "render-grid" ? (
            <TerminalRenderGridView frame={terminalSnapshot.frame} />
          ) : terminalSnapshot?.kind === "text" && terminalSnapshot.text ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">
              {terminalSnapshot.text}
            </pre>
          ) : transcript.length === 0 ? (
            <div className="text-muted">{copy.transcriptEmpty}</div>
          ) : (
            <div className="space-y-1">
              {transcript.map((line, index) => (
                <div key={`${line}:${index}`}>{line}</div>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-t border-border p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:p-3">
          <input
            className="min-w-0 rounded border border-border bg-background px-3 py-3 text-base outline-none sm:py-2 sm:text-sm"
            disabled={!target}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendComposer();
              }
            }}
            placeholder={copy.composerPlaceholder}
            value={composer}
          />
          <button
            className="rounded bg-foreground px-3 py-3 text-sm font-medium text-background disabled:opacity-40 sm:py-2"
            disabled={!target || composer.trimEnd().length === 0}
            onClick={() => void sendComposer()}
            type="button"
          >
            {copy.send}
          </button>
          <button
            className="rounded border border-border px-3 py-3 text-sm disabled:opacity-40 sm:py-2"
            disabled={!target}
            onClick={() => void sendEnter()}
            type="button"
          >
            {copy.enter}
          </button>
          <button
            className="col-span-3 rounded border border-border px-3 py-3 text-sm sm:col-span-1 sm:py-2"
            onClick={() => setTranscript([])}
            type="button"
          >
            {copy.clear}
          </button>
        </div>
      </section>
    </div>
  );
}

function terminalSnapshotFromReplay(
  replay: MobileTerminalReplayResponse,
): TerminalSnapshot | null {
  const frame = parseMobileRenderGridFrame(replay.render_grid);
  if (frame) {
    return { kind: "render-grid", frame };
  }
  const text = terminalReplayToText(replay);
  return text ? { kind: "text", text } : null;
}

function TerminalRenderGridView({ frame }: { frame: MobileRenderGridFrame }) {
  const stylesById = useMemo(() => {
    const map = new Map<number, MobileRenderGridStyle>();
    for (const style of frame.styles) {
      map.set(style.id, style);
    }
    return map;
  }, [frame.styles]);
  const rows = useMemo(() => rowsFromRenderGrid(frame), [frame]);
  const defaultStyle = stylesById.get(0);
  const inheritedBackground = defaultStyle?.background;
  const inheritedForeground = defaultStyle?.foreground;
  const background = frame.terminalBackground ?? webTerminalDefaultBackground;
  const foreground = frame.terminalForeground ?? webTerminalDefaultForeground;
  const cursorColor = frame.terminalCursorColor ?? foreground;

  return (
    <div
      className="relative inline-block min-w-full overflow-hidden rounded-sm border border-border font-mono text-[12px] tracking-normal"
      style={{
        backgroundColor: background,
        color: foreground,
        fontFamily:
          '"SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontVariantLigatures: "none",
        lineHeight: terminalLineHeightEm,
        minHeight: `${frame.rows * terminalLineHeightEm}em`,
        minWidth: `${frame.columns}ch`,
      }}
    >
      <div aria-label={`terminal ${frame.columns} by ${frame.rows}`} role="img">
        {rows.map((row, index) => (
          <div
            className="h-[1.35em] whitespace-pre"
            key={`${frame.surfaceId}:${frame.stateSeq}:${index}`}
          >
            {row.length === 0 ? " " : row.map((span, spanIndex) => (
              <span
                key={`${span.column}:${spanIndex}`}
                style={styleForRenderSpan(
                  stylesById.get(span.styleId),
                  foreground,
                  background,
                  inheritedForeground,
                  inheritedBackground,
                )}
              >
                {displayTextForSpan(span)}
              </span>
            ))}
          </div>
        ))}
      </div>
      {frame.cursor?.visible ? (
        <TerminalCursor
          background={background}
          color={cursorColor}
          cursor={frame.cursor}
        />
      ) : null}
    </div>
  );
}

function TerminalCursor({
  background,
  color,
  cursor,
}: {
  background: string;
  color: string;
  cursor: NonNullable<MobileRenderGridFrame["cursor"]>;
}) {
  const commonStyle = {
    left: `${cursor.column}ch`,
    top: `${cursor.row * terminalLineHeightEm}em`,
    height: `${terminalLineHeightEm}em`,
  };
  const blinkClass = cursor.blinking ? "animate-pulse" : "";

  if (cursor.style === "bar") {
    return (
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute w-px ${blinkClass}`}
        style={{ ...commonStyle, backgroundColor: color }}
      />
    );
  }
  if (cursor.style === "underline") {
    return (
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute h-0.5 w-[1ch] ${blinkClass}`}
        style={{
          left: commonStyle.left,
          top: `${cursor.row * terminalLineHeightEm + terminalLineHeightEm - 0.18}em`,
          backgroundColor: color,
        }}
      />
    );
  }
  if (cursor.style === "block_hollow") {
    return (
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute w-[1ch] border ${blinkClass}`}
        style={{ ...commonStyle, borderColor: color }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute w-[1ch] opacity-80 mix-blend-difference ${blinkClass}`}
      style={{ ...commonStyle, backgroundColor: color || background }}
    />
  );
}

function rowsFromRenderGrid(frame: MobileRenderGridFrame) {
  const rows: Array<Array<MobileRenderGridSpan>> = Array.from(
    { length: frame.rows },
    () => [],
  );
  for (const span of sortedRowSpans(frame)) {
    const row = rows[span.row];
    if (!row) {
      continue;
    }
    const previousEnd = row.reduce(
      (end, current) => Math.max(end, current.column + current.cellWidth),
      0,
    );
    if (span.column > previousEnd) {
      row.push({
        row: span.row,
        column: previousEnd,
        styleId: 0,
        text: " ".repeat(span.column - previousEnd),
        cellWidth: span.column - previousEnd,
      });
    }
    row.push(span);
  }
  for (const [rowIndex, row] of rows.entries()) {
    const end = row.reduce(
      (max, span) => Math.max(max, span.column + span.cellWidth),
      0,
    );
    if (end < frame.columns) {
      row.push({
        row: rowIndex,
        column: end,
        styleId: 0,
        text: " ".repeat(frame.columns - end),
        cellWidth: frame.columns - end,
      });
    }
  }
  return rows;
}

function displayTextForSpan(span: MobileRenderGridSpan): string {
  if (span.cellWidth <= span.text.length) {
    return span.text;
  }
  return span.text + " ".repeat(span.cellWidth - span.text.length);
}

function styleForRenderSpan(
  style: MobileRenderGridStyle | undefined,
  defaultForeground: string,
  defaultBackground: string,
  inheritedForeground?: string,
  inheritedBackground?: string,
): CSSProperties {
  const foreground =
    !style?.foreground || style.foreground === inheritedForeground
      ? defaultForeground
      : style.foreground;
  const background =
    !style?.background || style.background === inheritedBackground
      ? "transparent"
      : style.background;
  const resolvedForeground = style?.inverse
    ? (background === "transparent" ? defaultBackground : background)
    : foreground;
  const resolvedBackground = style?.inverse
    ? foreground
    : background;
  return {
    backgroundColor: resolvedBackground,
    color: style?.invisible ? resolvedBackground : resolvedForeground,
    fontStyle: style?.italic ? "italic" : undefined,
    fontWeight: style?.bold ? 700 : undefined,
    opacity: style?.faint ? 0.65 : undefined,
    textDecorationLine: [
      style?.underline ? "underline" : "",
      style?.strikethrough ? "line-through" : "",
      style?.overline ? "overline" : "",
    ].filter(Boolean).join(" ") || undefined,
  };
}

function terminalTarget(
  workspace: MobileWorkspacePreview,
  terminal: MobileTerminalPreview,
): MobileTerminalTarget {
  return {
    workspaceId: workspace.id,
    surfaceId: terminal.id,
    clientId: webClientId,
  };
}

function browserTokenFromLocation(slug: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storageKey = `cmux:web-access:${slug}:browser-token`;
  const fromUrl = tokenFromUrl(window.location.href);
  if (fromUrl) {
    window.sessionStorage.setItem(storageKey, fromUrl);
    return fromUrl;
  }
  return window.sessionStorage.getItem(storageKey);
}

function tokenFromUrl(href: string): string | null {
  try {
    const url = new URL(href);
    const fromSearch = url.searchParams.get("access_token")?.trim();
    if (fromSearch) {
      return fromSearch;
    }
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const hashParams = new URLSearchParams(hash);
    return hashParams.get("access_token")?.trim() || null;
  } catch {
    return null;
  }
}
