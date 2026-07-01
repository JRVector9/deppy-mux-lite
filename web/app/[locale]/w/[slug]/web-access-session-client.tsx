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
  attachmentTooLarge: string;
  clear: string;
  composerPlaceholder: string;
  connected: string;
  enter: string;
  refreshSession: string;
  refreshSessionFailed: string;
  refreshingSession: string;
  sendFailed: string;
  selected: string;
  send: string;
  signIn: string;
  status: string;
  terminal: string;
  title: string;
  transcriptEmpty: string;
  signInRequired: string;
  waiting: string;
  workspaceList: string;
};

type WebAccessSessionClientProps = {
  authEnabled: boolean;
  copy: WebAccessSessionCopy;
  expiresAt: string;
  initialConnected: boolean;
  signInHref: string;
  slug: string;
};

const webClientId = "web-access";
const estimatedTerminalCellWidthPx = 7.2;
const terminalLineHeightEm = 1.35;
const webTerminalDefaultForeground = "#d8d8d8";
const webTerminalDefaultBackground = "#050505";
const maxImageAttachmentBytes = 256 * 1024;
const sessionRefreshLeadMs = 10 * 60 * 1000;
const sessionRefreshPollMs = 60 * 1000;

type TerminalSnapshot =
  | { kind: "render-grid"; frame: MobileRenderGridFrame }
  | { kind: "text"; text: string };

export function WebAccessSessionClient({
  authEnabled,
  copy,
  expiresAt,
  initialConnected,
  signInHref,
  slug,
}: WebAccessSessionClientProps) {
  const [browserToken] = useState(() => browserTokenFromLocation(slug, expiresAt));
  const [sessionExpiresAt, setSessionExpiresAt] = useState(expiresAt);
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
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(true);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [sessionRefreshError, setSessionRefreshError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [terminalSnapshot, setTerminalSnapshot] = useState<TerminalSnapshot | null>(
    null,
  );
  const terminalViewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [terminalViewportWidth, setTerminalViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState("100svh");
  const [viewportWidth, setViewportWidth] = useState(0);
  const attachmentName = attachment?.name ?? "";

  useEffect(() => {
    setSessionExpiresAt(expiresAt);
  }, [expiresAt]);

  function applySessionExpiresAt(nextExpiresAt: string) {
    setSessionExpiresAt(nextExpiresAt);
    if (browserToken) {
      storeLocalWebAccessSession({ browserToken, expiresAt: nextExpiresAt, slug });
    }
  }

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.add("web-access-viewport-lock");
    body.classList.add("web-access-viewport-lock");

    const updateViewportSize = () => {
      const height = Math.floor(window.visualViewport?.height ?? window.innerHeight);
      const width = Math.floor(window.visualViewport?.width ?? window.innerWidth);
      if (height > 0) {
        setViewportHeight((current) => {
          const next = `${height}px`;
          return current === next ? current : next;
        });
      }
      if (width > 0) {
        setViewportWidth((current) => (current === width ? current : width));
      }
    };

    updateViewportSize();
    window.visualViewport?.addEventListener("resize", updateViewportSize);
    window.visualViewport?.addEventListener("scroll", updateViewportSize);
    window.addEventListener("orientationchange", updateViewportSize);
    window.addEventListener("resize", updateViewportSize);

    return () => {
      root.classList.remove("web-access-viewport-lock");
      body.classList.remove("web-access-viewport-lock");
      window.visualViewport?.removeEventListener("resize", updateViewportSize);
      window.visualViewport?.removeEventListener("scroll", updateViewportSize);
      window.removeEventListener("orientationchange", updateViewportSize);
      window.removeEventListener("resize", updateViewportSize);
    };
  }, []);

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
        setSelectedWorkspaceId((current) =>
          response.workspaces.some((workspace) => workspace.id === current)
            ? current
            : "",
        );
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
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const selectedTerminal =
    selectedWorkspace?.terminals.find((terminal) => terminal.id === selectedTerminalId) ?? null;
  const target = useMemo(
    () =>
      selectedWorkspace && selectedTerminal
        ? terminalTarget(selectedWorkspace, selectedTerminal)
        : null,
    [selectedWorkspace, selectedTerminal],
  );

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setSelectedTerminalId("");
      return;
    }
    const workspace = workspaces.find((item) => item.id === selectedWorkspaceId);
    if (!workspace) {
      setSelectedTerminalId("");
      setWorkspacePickerOpen(true);
      return;
    }
    setSelectedTerminalId((current) =>
      workspace.terminals.some((terminal) => terminal.id === current)
        ? current
        : workspace.terminals[0]?.id ?? "",
    );
  }, [selectedWorkspaceId, workspaces]);

  useEffect(() => {
    const element = terminalViewportRef.current;
    if (!element) {
      return;
    }

    const updateViewportWidth = () => {
      const width = Math.floor(element.getBoundingClientRect().width);
      setTerminalViewportWidth((current) => (current === width ? current : width));
    };

    updateViewportWidth();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateViewportWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selectedTerminalId, workspacePickerOpen]);

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

    void refreshTerminalScreen();
    const interval = globalThis.setInterval(
      () => void refreshTerminalScreen(),
      500,
    );
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [client, connected, target]);

  useEffect(() => {
    if (!connected) {
      return;
    }
    let cancelled = false;
    let inFlight = false;

    async function refreshSessionIfNeeded() {
      if (inFlight) {
        return;
      }
      const expiresAtMs = Date.parse(sessionExpiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs - Date.now() > sessionRefreshLeadMs) {
        return;
      }
      inFlight = true;
      try {
        const refreshed = await client.refreshWebAccessSession();
        if (!cancelled && typeof refreshed.expiresAt === "string") {
          applySessionExpiresAt(refreshed.expiresAt);
        }
      } catch {
        // The status and terminal polling loops keep surfacing connection state.
      } finally {
        inFlight = false;
      }
    }

    void refreshSessionIfNeeded();
    const interval = globalThis.setInterval(
      () => void refreshSessionIfNeeded(),
      sessionRefreshPollMs,
    );
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [client, connected, sessionExpiresAt]);

  async function refreshSessionManually() {
    if (!connected || isRefreshingSession) {
      return;
    }
    setSessionRefreshError(null);
    setIsRefreshingSession(true);
    try {
      const refreshed = await client.refreshWebAccessSession();
      if (typeof refreshed.expiresAt === "string") {
        applySessionExpiresAt(refreshed.expiresAt);
      }
    } catch {
      setSessionRefreshError(copy.refreshSessionFailed);
    } finally {
      setIsRefreshingSession(false);
    }
  }

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
    const capturedAttachment = attachment;
    if (!target || isSending || (!text && !capturedAttachment)) {
      return;
    }
    const capturedTarget = target;
    setComposerError(null);
    setIsSending(true);
    try {
      if (capturedAttachment) {
        const payload = await imagePayloadFromFile(capturedAttachment);
        await client.pasteImage(capturedTarget, payload.base64, payload.format);
      }
      if (text) {
        await client.pasteText(capturedTarget, text, {
          submitKey: "return",
        });
      }
      setComposer((current) => (current.trimEnd() === text ? "" : current));
      setAttachment((current) => (current === capturedAttachment ? null : current));
      setTranscript((current) => [
        ...current,
        `${capturedTarget.surfaceId} $ ${text || capturedAttachment?.name || ""}`,
      ]);
      void refreshTerminalScreen(capturedTarget);
    } catch {
      setComposerError(copy.sendFailed);
    } finally {
      setIsSending(false);
    }
  }

  async function sendEnter() {
    if (!target || isSending) {
      return;
    }
    const capturedTarget = target;
    setComposerError(null);
    setIsSending(true);
    try {
      await client.sendInput(capturedTarget, "\r");
      setTranscript((current) => [
        ...current,
        `${capturedTarget.surfaceId} ${copy.enter}`,
      ]);
      void refreshTerminalScreen(capturedTarget);
    } catch {
      setComposerError(copy.sendFailed);
    } finally {
      setIsSending(false);
    }
  }

  function openWorkspace(workspace: MobileWorkspacePreview) {
    setSelectedWorkspaceId(workspace.id);
    setSelectedTerminalId(workspace.terminals[0]?.id ?? "");
    setWorkspacePickerOpen(false);
    setSkillPickerOpen(false);
    setTerminalSnapshot(null);
  }

  function selectSkill(command: string) {
    setComposer((current) => {
      const trimmed = current.trimStart();
      return trimmed.length === 0 || trimmed === "/"
        ? command
        : command + " " + current;
    });
    setSkillPickerOpen(false);
  }

  function selectImageAttachment(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) {
      return;
    }
    if (file.size > maxImageAttachmentBytes) {
      setAttachment(null);
      setComposerError(copy.attachmentTooLarge);
      return;
    }
    setComposerError(null);
    setAttachment(file);
  }

  function cycleTerminal() {
    if (!selectedWorkspace || selectedWorkspace.terminals.length < 2 || !selectedTerminal) {
      return;
    }
    const currentIndex = selectedWorkspace.terminals.findIndex(
      (terminal) => terminal.id === selectedTerminal.id,
    );
    const nextTerminal = selectedWorkspace.terminals[(currentIndex + 1) % selectedWorkspace.terminals.length];
    setSelectedTerminalId(nextTerminal?.id ?? "");
    setTerminalSnapshot(null);
  }

  const showWorkspacePicker = workspacePickerOpen || !selectedWorkspace || !selectedTerminal;
  const activeNotice = signInRequired
    ? copy.signInRequired
    : sessionRefreshError
      ? sessionRefreshError
      : connected
        ? ""
        : copy.waiting;
  const skillCommands = ["/review", "/test", "/mcp", "/release-note"];
  const forceMobileReadableTerminal = viewportWidth === 0 || viewportWidth <= 768;

  return (
    <main
      className="web-access-no-x fixed inset-0 flex min-h-0 max-w-[100vw] flex-col overscroll-none bg-[#050505] text-[#f2f2f2] [height:var(--web-access-viewport-height)] [width:var(--web-access-viewport-width)]"
      style={
        {
          "--web-access-viewport-height": viewportHeight,
          "--web-access-viewport-width": viewportWidth > 0 ? `${viewportWidth}px` : "100vw",
        } as CSSProperties
      }
    >
      <div className="pointer-events-none absolute left-3 right-3 top-[max(12px,env(safe-area-inset-top))] z-30 grid gap-2">
        {activeNotice ? (
          <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-[#121212]/95 px-3 py-2 text-sm shadow-2xl backdrop-blur">
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
            <span className="min-w-0 truncate">{activeNotice}</span>
          </div>
        ) : null}
        {attachmentName ? (
          <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-[#121212]/95 px-3 py-2 text-sm shadow-2xl backdrop-blur">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
            <span className="min-w-0 truncate">{attachmentName}</span>
          </div>
        ) : null}
      </div>

      {showWorkspacePicker ? (
        <section className="web-access-no-x flex min-h-0 flex-1 flex-col px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))]">
          <header className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-0.5">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-normal">{copy.title}</h1>
              <div className="mt-0.5 truncate text-xs text-[#a8a8a8]">{connected ? copy.connected : copy.waiting}</div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <button
                className="h-8 max-w-24 truncate rounded-full border border-[#2a2a2a] bg-[#101010] px-2.5 text-xs font-semibold text-[#f2f2f2] disabled:opacity-45"
                disabled={!connected || isRefreshingSession}
                onClick={() => void refreshSessionManually()}
                type="button"
              >
                {isRefreshingSession ? copy.refreshingSession : copy.refreshSession}
              </button>
              <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-[#2a2a2a] bg-[#0d0d0d] px-2.5 text-xs text-[#a8a8a8]">
                <span className={connected ? "h-1.5 w-1.5 rounded-full bg-emerald-400" : "h-1.5 w-1.5 rounded-full bg-amber-400"} />
                {workspaces.length} {copy.workspaceList}
              </span>
            </div>
          </header>

          {signInRequired ? (
            <a className="mt-4 rounded-xl bg-[#f5f5f5] px-3 py-3 text-center text-sm font-semibold text-[#080808]" href={signInHref}>
              {copy.signIn}
            </a>
          ) : null}

          <div className="web-access-scroll mt-3 flex min-h-0 min-w-0 max-w-full flex-1 flex-col gap-2 pb-1">
            {workspaces.length === 0 ? (
              <div className="rounded-xl border border-[#2a2a2a] bg-[#101010] p-4 text-sm text-[#a8a8a8]">
                {connected ? copy.transcriptEmpty : copy.waiting}
              </div>
            ) : null}
            {workspaces.map((workspace) => (
              <button
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl border border-[#2a2a2a] bg-gradient-to-b from-[#151515] to-[#101010] p-3 text-left active:translate-y-px"
                key={workspace.id}
                onClick={() => openWorkspace(workspace)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold tracking-normal">{workspace.title}</span>
                  {workspace.currentDirectory ? (
                    <span className="mt-1 block truncate font-mono text-xs text-[#a8a8a8]">{workspace.currentDirectory}</span>
                  ) : null}
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {workspace.terminals.slice(0, 3).map((terminal) => (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#333] px-2 py-1 text-[11px] leading-none text-[#dcdcdc]" key={terminal.id}>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        {terminal.title}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="min-w-7 self-start rounded-full bg-[#f5f5f5] px-2 py-1 text-center text-xs font-bold text-[#080808]">
                  {workspace.terminals.length}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="web-access-no-x relative flex min-h-0 flex-1 flex-col bg-[#030303]">
          <div className="web-access-no-x flex min-h-0 flex-1 flex-col bg-[#030303]">
            <div className="grid min-h-10 grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[#1f1f1f] bg-[#0d0d0d] px-2 pb-2 pt-[max(8px,env(safe-area-inset-top))]">
              <button
                aria-label={copy.workspaceList}
                className="grid h-9 w-9 place-items-center rounded-xl border border-[#2a2a2a] bg-[#0b0b0b] text-lg font-semibold"
                onClick={() => setWorkspacePickerOpen(true)}
                type="button"
              >
                ‹
              </button>
              <div className="min-w-0 truncate text-sm font-semibold tracking-normal">{selectedWorkspace?.title}</div>
              <div className="flex min-w-0 items-center gap-1">
                <button
                  className="h-8 max-w-24 truncate rounded-full border border-[#2a2a2a] bg-[#101010] px-2 text-xs font-semibold text-[#f2f2f2] disabled:opacity-45"
                  disabled={!connected || isRefreshingSession}
                  onClick={() => void refreshSessionManually()}
                  type="button"
                >
                  {isRefreshingSession ? copy.refreshingSession : copy.refreshSession}
                </button>
                <button
                  className="h-8 max-w-28 truncate rounded-full border border-[#2a2a2a] bg-[#101010] px-2 py-1 text-xs text-[#a8a8a8] disabled:opacity-70"
                  disabled={(selectedWorkspace?.terminals.length ?? 0) < 2}
                  onClick={cycleTerminal}
                  type="button"
                >
                  {selectedTerminal?.title ?? copy.terminal}
                </button>
              </div>
            </div>

            <div
              className="web-access-scroll min-h-0 min-w-0 max-w-full flex-1 bg-[#030303] font-mono text-[15px] leading-6 text-[#e7e7e7]"
              ref={terminalViewportRef}
            >
              {terminalSnapshot?.kind === "render-grid" ? (
                <TerminalRenderGridView
                  forceReadableLayout={forceMobileReadableTerminal}
                  frame={terminalSnapshot.frame}
                  viewportWidth={terminalViewportWidth}
                />
              ) : terminalSnapshot?.kind === "text" && terminalSnapshot.text ? (
                <pre className="min-w-0 max-w-full whitespace-pre-wrap break-words p-3 font-mono text-[15px] leading-6 [overflow-wrap:anywhere] [word-break:break-all]">
                  {terminalSnapshot.text}
                </pre>
              ) : transcript.length === 0 ? (
                <div className="p-3 text-sm text-[#8e8e8e]">{copy.transcriptEmpty}</div>
              ) : (
                <div className="space-y-1 p-3 text-sm">
                  {transcript.map((line, index) => (
                    <div key={line + ":" + index}>{line}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="web-access-no-x border-t border-[#1f1f1f] bg-[#0a0a0a] px-2 pb-[max(4px,env(safe-area-inset-bottom))] pt-1">
              {composerError ? (
                <div className="mb-1.5 rounded-lg border border-[#5a2d2d] bg-[#211010] px-2 py-1.5 text-xs leading-4 text-[#ffb6b6]">
                  {composerError}
                </div>
              ) : null}
              {attachmentName ? (
                <div className="mb-1.5 flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#151515] px-2 py-1 text-xs text-[#a8a8a8]">
                  <span className="h-5 w-5 shrink-0 rounded bg-gradient-to-br from-[#77a8ff] to-[#59d185]" />
                  <span className="min-w-0 flex-1 truncate">{attachmentName}</span>
                  <button
                    aria-label={copy.clear}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[#2a2a2a] bg-[#0b0b0b]"
                    onClick={() => setAttachment(null)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ) : null}
              <form
                className="grid min-w-0 grid-cols-[30px_30px_minmax(0,1fr)_34px] items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (composer.trimEnd().length > 0 || attachment) {
                    void sendComposer();
                  } else {
                    void sendEnter();
                  }
                }}
              >
                <input
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    selectImageAttachment(event.target.files);
                    event.currentTarget.value = "";
                  }}
                  ref={fileInputRef}
                  type="file"
                />
                <button
                  className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] text-sm font-semibold"
                  disabled={isSending}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  +
                </button>
                <button
                  className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] text-sm font-semibold"
                  disabled={isSending}
                  onClick={() => setSkillPickerOpen(true)}
                  type="button"
                >
                  /
                </button>
                <input
                  autoComplete="off"
                  className="h-[30px] min-w-0 rounded-lg border border-[#2a2a2a] bg-[#050505] px-2 text-[14px] text-[#f2f2f2] outline-none focus:border-[#5b5b5b] disabled:opacity-60"
                  disabled={!target}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "/" && composer.length === 0) {
                      setSkillPickerOpen(true);
                    }
                  }}
                  placeholder={copy.composerPlaceholder}
                  value={composer}
                />
                <button
                  aria-label={copy.send}
                  className="grid h-[30px] w-[34px] place-items-center rounded-lg bg-[#f5f5f5] text-sm font-extrabold text-[#080808] disabled:opacity-40"
                  disabled={!target || isSending}
                  type="submit"
                >
                  ↵
                </button>
              </form>
            </div>
          </div>

          {skillPickerOpen ? (
            <div className="absolute inset-x-0 bottom-0 z-20 max-h-[58%] overflow-hidden rounded-t-2xl border-t border-[#2a2a2a] bg-[#101010] shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#2a2a2a] px-3 py-3">
                <div className="text-sm font-semibold">/skill</div>
                <button
                  aria-label={copy.clear}
                  className="grid h-9 w-9 place-items-center rounded-xl border border-[#2a2a2a] bg-[#0b0b0b] text-lg font-semibold"
                  onClick={() => setSkillPickerOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <div className="web-access-scroll grid max-h-80 gap-px bg-[#2a2a2a]">
                {skillCommands.map((command) => (
                  <button
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-[#101010] px-3 py-3 text-left"
                    key={command}
                    onClick={() => selectSkill(command)}
                    type="button"
                  >
                    <span className="font-mono text-sm">{command}</span>
                    <span className="rounded-full border border-[#2a2a2a] px-2 py-1 text-xs text-[#a8a8a8]">↵</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      )}
    </main>
  );
}

function imagePayloadFromFile(
  file: File,
): Promise<{ base64: string; format: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("image_read_failed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      resolve({
        base64: commaIndex >= 0 ? result.slice(commaIndex + 1) : result,
        format: imageFormatFromMimeType(file.type),
      });
    };
    reader.readAsDataURL(file);
  });
}

function imageFormatFromMimeType(mimeType: string): string {
  const [, subtype] = mimeType.split("/");
  if (!subtype) {
    return "png";
  }
  return subtype === "jpeg" ? "jpg" : subtype;
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

function TerminalRenderGridView({
  forceReadableLayout,
  frame,
  viewportWidth,
}: {
  forceReadableLayout: boolean;
  frame: MobileRenderGridFrame;
  viewportWidth: number;
}) {
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
  const naturalWidthPx = Math.max(1, frame.columns * estimatedTerminalCellWidthPx);
  const useReadableMobileLayout =
    forceReadableLayout || (viewportWidth > 0 && viewportWidth < naturalWidthPx);

  if (useReadableMobileLayout) {
    return (
      <TerminalReadableGridView
        background={background}
        foreground={foreground}
        frame={frame}
        inheritedBackground={inheritedBackground}
        inheritedForeground={inheritedForeground}
        rows={rowsFromRenderGrid(frame, false)}
        stylesById={stylesById}
      />
    );
  }

  return (
    <div
      className="min-h-full w-full overflow-hidden font-mono text-[12px] tracking-normal"
      style={{
        backgroundColor: background,
        color: foreground,
      }}
    >
      <div
        className="relative inline-block min-w-full overflow-hidden font-mono text-[12px] tracking-normal"
        style={{
          backgroundColor: background,
          color: foreground,
          fontFamily:
            '"SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontVariantLigatures: "none",
          lineHeight: terminalLineHeightEm,
          minHeight: `${frame.rows * terminalLineHeightEm}em`,
          width: `${frame.columns}ch`,
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
    </div>
  );
}

function TerminalReadableGridView({
  background,
  foreground,
  frame,
  inheritedBackground,
  inheritedForeground,
  rows,
  stylesById,
}: {
  background: string;
  foreground: string;
  frame: MobileRenderGridFrame;
  inheritedBackground?: string;
  inheritedForeground?: string;
  rows: Array<Array<MobileRenderGridSpan>>;
  stylesById: Map<number, MobileRenderGridStyle>;
}) {
  return (
    <div
      className="web-access-no-x min-h-full font-mono text-[15px] leading-6 tracking-normal"
      style={{
        backgroundColor: background,
        color: foreground,
        fontFamily:
          '"SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontVariantLigatures: "none",
      }}
    >
      <div
        aria-label={`terminal ${frame.columns} by ${frame.rows}`}
        className="web-access-no-x px-3 py-3"
        role="img"
      >
        {rows.map((row, index) => (
          <div
            className="web-access-no-x min-h-6 whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-all]"
            key={`${frame.surfaceId}:${frame.stateSeq}:readable:${index}`}
          >
            {row.length === 0 ? "\u00A0" : row.map((span, spanIndex) => (
              <span
                className="[overflow-wrap:anywhere] [word-break:break-all]"
                key={`${span.column}:${spanIndex}`}
                style={styleForRenderSpan(
                  stylesById.get(span.styleId),
                  foreground,
                  background,
                  inheritedForeground,
                  inheritedBackground,
                )}
              >
                {displayTextForReadableSpan(span)}
              </span>
            ))}
          </div>
        ))}
      </div>
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

function rowsFromRenderGrid(
  frame: MobileRenderGridFrame,
  fillTrailingCells = true,
) {
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
  if (fillTrailingCells) {
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
  }
  return rows;
}

function displayTextForSpan(span: MobileRenderGridSpan): string {
  if (span.cellWidth <= span.text.length) {
    return span.text;
  }
  return span.text + " ".repeat(span.cellWidth - span.text.length);
}

function displayTextForReadableSpan(span: MobileRenderGridSpan): string {
  if (span.text.length > 0) {
    if (/^\s+$/.test(span.text)) {
      return " ".repeat(Math.min(span.text.length, 8));
    }
    return span.text;
  }
  return span.cellWidth > 0 ? " ".repeat(Math.min(span.cellWidth, 8)) : "";
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

type StoredLocalWebAccessSession = {
  browserToken: string;
  expiresAt: string;
  slug: string;
};

const localWebAccessSessionStoragePrefix = "cmux:web-access:session:";

function browserTokenFromLocation(slug: string, expiresAt: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storageKey = `cmux:web-access:${slug}:browser-token`;
  const fromUrl = tokenFromUrl(window.location.href);
  if (fromUrl) {
    window.sessionStorage.setItem(storageKey, fromUrl);
    storeLocalWebAccessSession({ browserToken: fromUrl, expiresAt, slug });
    removeTokenFromLocation();
    return fromUrl;
  }
  const fromSessionStorage = window.sessionStorage.getItem(storageKey);
  if (fromSessionStorage) {
    storeLocalWebAccessSession({ browserToken: fromSessionStorage, expiresAt, slug });
    return fromSessionStorage;
  }
  return storedLocalWebAccessSession(slug)?.browserToken ?? null;
}

function storeLocalWebAccessSession(session: StoredLocalWebAccessSession) {
  try {
    window.localStorage.setItem(
      `${localWebAccessSessionStoragePrefix}${session.slug}`,
      JSON.stringify(session),
    );
  } catch {
    return;
  }
}

function storedLocalWebAccessSession(slug: string): StoredLocalWebAccessSession | null {
  try {
    const raw = window.localStorage.getItem(`${localWebAccessSessionStoragePrefix}${slug}`);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as Partial<StoredLocalWebAccessSession>;
    const expiresAtMs = typeof session.expiresAt === "string" ? Date.parse(session.expiresAt) : NaN;
    if (
      session.slug !== slug ||
      typeof session.browserToken !== "string" ||
      !session.browserToken ||
      typeof session.expiresAt !== "string" ||
      Number.isNaN(expiresAtMs) ||
      expiresAtMs <= Date.now()
    ) {
      window.localStorage.removeItem(`${localWebAccessSessionStoragePrefix}${slug}`);
      return null;
    }
    return {
      browserToken: session.browserToken,
      expiresAt: session.expiresAt,
      slug,
    };
  } catch {
    return null;
  }
}

function removeTokenFromLocation() {
  const url = new URL(window.location.href);
  let changed = false;
  if (url.searchParams.has("access_token")) {
    url.searchParams.delete("access_token");
    changed = true;
  }
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    if (hashParams.has("access_token")) {
      hashParams.delete("access_token");
      url.hash = hashParams.toString() ? `#${hashParams.toString()}` : "";
      changed = true;
    }
  }
  if (changed) {
    window.history.replaceState(window.history.state, "", url.toString());
  }
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
