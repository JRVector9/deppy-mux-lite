"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MobileRpcClient } from "@/services/mobile-rpc/client";
import { parseMobileRenderGridFrame } from "@/services/mobile-rpc/render-grid";
import { terminalReplayToText } from "@/services/mobile-rpc/terminal-screen";
import type {
  MobileTerminalPreview,
  MobileTerminalReplayResponse,
  MobileTerminalTarget,
  MobileWorkspacePreview,
} from "@/services/mobile-rpc/types";
import { WebAccessRelayTransport } from "@/services/mobile-rpc/web-access-relay-transport";
import { MobileComposerBar } from "./MobileComposerBar";
import { MobileTerminalViewport, type TerminalSnapshot } from "./MobileTerminalViewport";
import { MobileTopMenuButton, MobileTopMenuPanel } from "./MobileTopMenu";
import { MobileWebAccessShell } from "./MobileWebAccessShell";
import { useVisualViewportLock } from "./useVisualViewportLock";

type WebAccessSessionCopy = {
  attachmentTooLarge: string;
  appVersion: string;
  clear: string;
  composerPlaceholder: string;
  connected: string;
  enter: string;
  fitWidth?: string;
  fontLarger?: string;
  fontSmaller?: string;
  menu: string;
  refreshSession: string;
  refreshSessionFailed: string;
  refreshingSession: string;
  readableWrap?: string;
  reconnecting?: string;
  savedMacList: string;
  sendFailed: string;
  sessionExtended?: string;
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
  workspaceUpdated?: string;
  workspaceUpdatedBadge?: string;
  commandSection: string;
  modelCommand: string;
  modelSection: string;
  skillPickerTitle: string;
};

type WebMobileWorkspacePreview = MobileWorkspacePreview & {
  hasUnread?: boolean;
  preview?: string;
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
const maxImageAttachmentBytes = 256 * 1024;
const sessionRefreshLeadMs = 10 * 60 * 1000;
const sessionRefreshPollMs = 60 * 1000;
const terminalFontSizeStorageKey = "cmux:web-access:terminal-font-size";
const terminalFitWidthStorageKey = "cmux:web-access:fit-width";
const terminalReadableWrapStorageKey = "cmux:web-access:readable-wrap";
const terminalFontSizeDefault = 15;
const terminalFontSizeMin = 10;
const terminalFontSizeMax = 24;

export function WebAccessSessionClient({
  authEnabled,
  copy,
  expiresAt,
  initialConnected,
  signInHref,
  slug,
}: WebAccessSessionClientProps) {
  const pwaT = useTranslations("pwa");
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
  const [hasConnected, setHasConnected] = useState(initialConnected);
  const [workspaces, setWorkspaces] = useState<WebMobileWorkspacePreview[]>([]);
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionRefreshError, setSessionRefreshError] = useState<string | null>(null);
  const [sessionRefreshNotice, setSessionRefreshNotice] = useState<string | null>(null);
  const [completionToast, setCompletionToast] = useState<string | null>(null);
  const seenUnreadWorkspaceIdsRef = useRef(new Set<string>());
  const completionNoticeInitializedRef = useRef(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [terminalSnapshot, setTerminalSnapshot] = useState<TerminalSnapshot | null>(
    null,
  );
  const terminalSnapshotCacheRef = useRef(new Map<string, TerminalSnapshot>());
  const activeTerminalTargetKeyRef = useRef("");
  const terminalViewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const [terminalViewportWidth, setTerminalViewportWidth] = useState(0);
  const [terminalFontSize, setTerminalFontSize] = useState(() =>
    readStoredNumber(
      terminalFontSizeStorageKey,
      terminalFontSizeDefault,
      terminalFontSizeMin,
      terminalFontSizeMax,
    ),
  );
  const [fitWidthEnabled, setFitWidthEnabled] = useState(() =>
    readStoredBoolean(terminalFitWidthStorageKey, true),
  );
  const [readableWrapEnabled, setReadableWrapEnabled] = useState(() =>
    readStoredBoolean(terminalReadableWrapStorageKey, true),
  );
  const viewport = useVisualViewportLock();
  const attachmentName = attachment?.name ?? "";

  useEffect(() => {
    setSessionExpiresAt(expiresAt);
  }, [expiresAt]);

  useEffect(() => {
    if (connected) {
      setHasConnected(true);
    }
  }, [connected]);

  function applySessionExpiresAt(nextExpiresAt: string) {
    setSessionExpiresAt(nextExpiresAt);
    if (browserToken) {
      storeLocalWebAccessSession(localWebAccessSession(slug, browserToken, nextExpiresAt));
    }
  }

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
        const nextWorkspaces = response.workspaces.map(normalizeWorkspacePreview);
        updateUnreadWorkspaceNotices(nextWorkspaces);
        setWorkspaces(nextWorkspaces);
        setSignInRequired(false);
        setSelectedWorkspaceId((current) =>
          nextWorkspaces.some((workspace) => workspace.id === current)
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
  }, [authEnabled, client, connected, pwaT, selectedWorkspaceId]);

  useEffect(() => {
    writeStoredNumber(terminalFontSizeStorageKey, terminalFontSize);
  }, [terminalFontSize]);

  useEffect(() => {
    writeStoredBoolean(terminalFitWidthStorageKey, fitWidthEnabled);
  }, [fitWidthEnabled]);

  useEffect(() => {
    writeStoredBoolean(terminalReadableWrapStorageKey, readableWrapEnabled);
  }, [readableWrapEnabled]);

  useEffect(() => {
    if (!completionToast) {
      return;
    }
    const timeout = globalThis.setTimeout(() => setCompletionToast(null), 3500);
    return () => globalThis.clearTimeout(timeout);
  }, [completionToast]);

  useEffect(() => {
    if (!sessionRefreshNotice) {
      return;
    }
    const timeout = globalThis.setTimeout(() => setSessionRefreshNotice(null), 2500);
    return () => globalThis.clearTimeout(timeout);
  }, [sessionRefreshNotice]);

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
  const targetKey = useMemo(() => (target ? terminalTargetKey(target) : ""), [target]);

  function applyCachedTerminalSnapshot(nextTarget: MobileTerminalTarget | null) {
    if (!nextTarget) {
      activeTerminalTargetKeyRef.current = "";
      setTerminalSnapshot(null);
      return;
    }
    const nextTargetKey = terminalTargetKey(nextTarget);
    activeTerminalTargetKeyRef.current = nextTargetKey;
    setTerminalSnapshot(
      terminalSnapshotCacheRef.current.get(nextTargetKey) ?? null,
    );
  }

  useEffect(() => {
    activeTerminalTargetKeyRef.current = targetKey;
  }, [targetKey]);

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
    const capturedTargetKey = terminalTargetKey(capturedTarget);
    let cancelled = false;
    let inFlight = false;

    setTerminalSnapshot(
      terminalSnapshotCacheRef.current.get(capturedTargetKey) ?? null,
    );

    async function refreshTerminalScreen() {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const replay = await client.replayTerminal(capturedTarget);
        const nextSnapshot = terminalSnapshotFromReplay(replay);
        updateTerminalSnapshotCache(
          terminalSnapshotCacheRef.current,
          capturedTargetKey,
          nextSnapshot,
        );
        if (!cancelled) {
          setTerminalSnapshot(nextSnapshot);
        }
      } catch {
        // Keep the cached screen visible while relay replay retries.
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
        setSessionRefreshNotice(pwaT("sessionExtended"));
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
      const capturedTargetKey = terminalTargetKey(capturedTarget);
      const nextSnapshot = terminalSnapshotFromReplay(replay);
      updateTerminalSnapshotCache(
        terminalSnapshotCacheRef.current,
        capturedTargetKey,
        nextSnapshot,
      );
      if (activeTerminalTargetKeyRef.current === capturedTargetKey) {
        setTerminalSnapshot(nextSnapshot);
      }
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
        if (!capturedAttachment && shouldSendRawInteractiveInput(text)) {
          await client.sendInput(capturedTarget, `${text}\r`);
        } else {
          await client.pasteText(capturedTarget, text, {
            submitKey: "return",
          });
        }
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

  function shouldSendRawInteractiveInput(text: string): boolean {
    return /^[0-9]$/.test(text);
  }

  function openWorkspace(workspace: MobileWorkspacePreview) {
    const nextTerminal = workspace.terminals[0] ?? null;
    setSelectedWorkspaceId(workspace.id);
    setSelectedTerminalId(nextTerminal?.id ?? "");
    setWorkspacePickerOpen(false);
    setSkillPickerOpen(false);
    setMenuOpen(false);
    applyCachedTerminalSnapshot(
      nextTerminal ? terminalTarget(workspace, nextTerminal) : null,
    );
  }

  function selectSkill(command: string) {
    setComposer((current) => {
      const trimmed = current.trimStart();
      return trimmed.length === 0 || trimmed === "/"
        ? command
        : command + " " + current;
    });
    setSkillPickerOpen(false);
    focusComposerSoon();
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
    applyCachedTerminalSnapshot(
      nextTerminal ? terminalTarget(selectedWorkspace, nextTerminal) : null,
    );
  }

  function updateUnreadWorkspaceNotices(nextWorkspaces: WebMobileWorkspacePreview[]) {
    const previous = seenUnreadWorkspaceIdsRef.current;
    const initialized = completionNoticeInitializedRef.current;
    const next = new Set<string>();
    for (const workspace of nextWorkspaces) {
      if (workspaceAppearsComplete(workspace)) {
        next.add(workspace.id);
        if (initialized && !previous.has(workspace.id) && workspace.id !== selectedWorkspaceId) {
          setCompletionToast(pwaT("workspaceCompleteToast", { title: workspace.title }));
        }
      }
    }
    seenUnreadWorkspaceIdsRef.current = next;
    completionNoticeInitializedRef.current = true;
  }

  function adjustTerminalFontSize(delta: number) {
    setTerminalFontSize((current) =>
      clampNumber(current + delta, terminalFontSizeMin, terminalFontSizeMax),
    );
  }

  function focusComposerSoon() {
    composerInputRef.current?.focus();
    globalThis.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  const showWorkspacePicker = workspacePickerOpen || !selectedWorkspace || !selectedTerminal;
  const connectionStatusLabel = connected
    ? copy.connected
    : hasConnected
      ? pwaT("reconnecting")
      : copy.waiting;
  const sessionExpiryTime = formatSessionExpiryTime(sessionExpiresAt);
  const sessionExpiryLabel = sessionExpiryTime
    ? pwaT("sessionExpires", { time: sessionExpiryTime })
    : null;
  const activeNotice = signInRequired
    ? copy.signInRequired
    : sessionRefreshError
      ? sessionRefreshError
      : sessionRefreshNotice
        ? sessionRefreshNotice
        : connected
          ? ""
          : connectionStatusLabel;
  const modelCommands = ["/model"];
  const skillCommands = ["/review", "/test", "/mcp", "/release-note"];
  const selectedWorkspaceHasUnread = selectedWorkspace
    ? workspaceAppearsComplete(selectedWorkspace)
    : false;
  const pwaHomeHref = useMemo(() => pwaHomePathFromLocation(), []);
  const menuButton = (
    <MobileTopMenuButton
      label={copy.menu}
      onToggle={() => setMenuOpen((open) => !open)}
      open={menuOpen}
    />
  );

  return (
    <MobileWebAccessShell
      activeNotice={activeNotice}
      attachmentName={attachmentName}
      completionToast={completionToast}
      menuPanel={
        <MobileTopMenuPanel
          appVersion={copy.appVersion}
          connected={connected}
          copy={{
            connectionStatus: copy.status,
            decreaseFontSize: pwaT("decreaseFontSize"),
            extendSession: pwaT("extendSession"),
            fitWidth: pwaT("fitWidth"),
            fontSize: pwaT("fontSize"),
            increaseFontSize: pwaT("increaseFontSize"),
            off: pwaT("off"),
            on: pwaT("on"),
            readableWrap: pwaT("readableWrap"),
            savedMacList: copy.savedMacList,
          }}
          connectionStatusLabel={connectionStatusLabel}
          fitWidthEnabled={fitWidthEnabled}
          fontSizePx={terminalFontSize}
          isRefreshingSession={isRefreshingSession}
          onDecreaseFontSize={() => adjustTerminalFontSize(-1)}
          onIncreaseFontSize={() => adjustTerminalFontSize(1)}
          onRefreshSession={() => void refreshSessionManually()}
          onToggleFitWidth={() => setFitWidthEnabled((enabled) => !enabled)}
          onToggleReadableWrap={() => setReadableWrapEnabled((enabled) => !enabled)}
          open={menuOpen}
          pwaHomeHref={pwaHomeHref}
          readableWrapEnabled={readableWrapEnabled}
          refreshingLabel={copy.refreshingSession}
          sessionExpiryLabel={sessionExpiryLabel}
        />
      }
      viewport={viewport}
    >
      {showWorkspacePicker ? (
        <section className="web-access-no-x flex min-h-0 flex-1 flex-col px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))]">
          <header className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-0.5">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-normal">{copy.title}</h1>
              <div className="mt-0.5 truncate text-xs text-[#a8a8a8]">{connectionStatusLabel}</div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-[#2a2a2a] bg-[#0d0d0d] px-2.5 text-xs text-[#a8a8a8]">
                <span className={connected ? "h-1.5 w-1.5 rounded-full bg-emerald-400" : "h-1.5 w-1.5 rounded-full bg-amber-400"} />
                {workspaces.length} {copy.workspaceList}
              </span>
              {menuButton}
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
                  {workspaceAppearsComplete(workspace) ? (
                    <span className="mt-1 inline-flex rounded-full bg-emerald-400 px-2 py-0.5 text-[11px] font-bold leading-none text-[#04130a]">
                      {pwaT("done")}
                    </span>
                  ) : null}
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
            <div className="grid min-h-10 grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[#1f1f1f] bg-[#0d0d0d] px-2 pb-1.5 pt-[max(5px,env(safe-area-inset-top))]">
              <button
                aria-label={copy.workspaceList}
                className="grid h-7 w-7 place-items-center rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] text-base font-semibold"
                onClick={() => setWorkspacePickerOpen(true)}
                type="button"
              >
                ‹
              </button>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold tracking-normal">
                    {selectedWorkspace?.title}
                  </span>
                  {selectedWorkspaceHasUnread ? (
                    <span className="shrink-0 rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] font-extrabold leading-none text-[#04130a]">
                      {pwaT("done")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate text-[11px] leading-none text-[#8e8e8e]">
                  {connectionStatusLabel}
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-1">
                <button
                  className="h-7 max-w-24 truncate rounded-full border border-[#2a2a2a] bg-[#101010] px-2 py-0.5 text-[11px] text-[#a8a8a8] disabled:opacity-70"
                  disabled={(selectedWorkspace?.terminals.length ?? 0) < 2}
                  onClick={cycleTerminal}
                  type="button"
                >
                  {selectedTerminal?.title ?? copy.terminal}
                </button>
                {menuButton}
              </div>
            </div>

            <MobileTerminalViewport
              copy={{
                terminal: copy.terminal,
                transcriptEmpty: copy.transcriptEmpty,
              }}
              fitWidthEnabled={fitWidthEnabled}
              fontSizePx={terminalFontSize}
              onFocusComposer={focusComposerSoon}
              readableWrapEnabled={readableWrapEnabled}
              terminalSnapshot={terminalSnapshot}
              terminalViewportRef={terminalViewportRef}
              terminalViewportWidth={terminalViewportWidth}
              transcript={transcript}
            />

            <MobileComposerBar
              attachmentName={attachmentName}
              composer={composer}
              composerError={composerError}
              composerInputRef={composerInputRef}
              copy={{
                clear: copy.clear,
                composerPlaceholder: copy.composerPlaceholder,
                send: copy.send,
              }}
              disabled={!target}
              fileInputRef={fileInputRef}
              isSending={isSending}
              onChangeComposer={setComposer}
              onClearAttachment={() => setAttachment(null)}
              onOpenSkillPicker={() => setSkillPickerOpen(true)}
              onPickAttachment={selectImageAttachment}
              onSubmit={() => {
                if (composer.trimEnd().length > 0 || attachment) {
                  void sendComposer();
                } else {
                  void sendEnter();
                }
                focusComposerSoon();
              }}
            />
          </div>

          {skillPickerOpen ? (
            <div className="absolute inset-x-0 bottom-0 z-20 max-h-[58%] overflow-hidden rounded-t-2xl border-t border-[#2a2a2a] bg-[#101010] shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#2a2a2a] px-3 py-3">
                <div className="text-sm font-semibold">{copy.skillPickerTitle}</div>
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
                <div className="bg-[#101010] px-3 py-2 text-[11px] font-semibold uppercase tracking-normal text-[#8e8e8e]">
                  {copy.modelSection}
                </div>
                {modelCommands.map((command) => (
                  <button
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-[#101010] px-3 py-3 text-left"
                    key={command}
                    onClick={() => selectSkill(command)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm">{command}</span>
                      <span className="mt-0.5 block truncate text-xs text-[#8e8e8e]">
                        {copy.modelCommand}
                      </span>
                    </span>
                    <span className="rounded-full border border-[#2a2a2a] px-2 py-1 text-xs text-[#a8a8a8]">↵</span>
                  </button>
                ))}
                <div className="bg-[#101010] px-3 py-2 text-[11px] font-semibold uppercase tracking-normal text-[#8e8e8e]">
                  {copy.commandSection}
                </div>
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
    </MobileWebAccessShell>
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

function normalizeWorkspacePreview(
  workspace: MobileWorkspacePreview,
): WebMobileWorkspacePreview {
  const raw = workspace as unknown as Record<string, unknown>;
  const rawTerminals = Array.isArray(raw.terminals)
    ? raw.terminals
    : Array.isArray(workspace.terminals)
      ? workspace.terminals
      : [];
  return {
    ...workspace,
    currentDirectory:
      optionalString(raw.currentDirectory ?? raw.current_directory) ??
      workspace.currentDirectory,
    hasUnread: booleanValue(raw.hasUnread ?? raw.has_unread, false),
    id: stringValue(raw.id, workspace.id),
    isSelected: booleanValue(
      raw.isSelected ?? raw.is_selected,
      workspace.isSelected === true,
    ),
    preview: optionalString(raw.preview ?? raw.previewText ?? raw.preview_text),
    terminals: rawTerminals.map((terminal) =>
      normalizeTerminalPreview(terminal as MobileTerminalPreview),
    ),
    title: stringValue(raw.title, workspace.title),
  };
}

function normalizeTerminalPreview(
  terminal: MobileTerminalPreview,
): MobileTerminalPreview {
  const raw = terminal as unknown as Record<string, unknown>;
  return {
    ...terminal,
    currentDirectory:
      optionalString(raw.currentDirectory ?? raw.current_directory) ??
      terminal.currentDirectory,
    id: stringValue(raw.id, terminal.id),
    isFocused: booleanValue(
      raw.isFocused ?? raw.is_focused,
      terminal.isFocused === true,
    ),
    isReady: booleanValue(raw.isReady ?? raw.is_ready, terminal.isReady === true),
    title: stringValue(raw.title, terminal.title),
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

function terminalTargetKey(target: MobileTerminalTarget): string {
  return JSON.stringify([target.workspaceId, target.surfaceId, target.clientId]);
}

function updateTerminalSnapshotCache(
  cache: Map<string, TerminalSnapshot>,
  targetKey: string,
  snapshot: TerminalSnapshot | null,
) {
  if (snapshot) {
    cache.set(targetKey, snapshot);
  } else {
    cache.delete(targetKey);
  }
}

function workspaceAppearsComplete(workspace: WebMobileWorkspacePreview): boolean {
  return workspace.hasUnread === true;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function formatSessionExpiryTime(expiresAt: string): string | null {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(expiresAtMs));
}

function readStoredNumber(
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof window === "undefined") {
    return defaultValue;
  }
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed)
      ? clampNumber(parsed, minimum, maximum)
      : defaultValue;
  } catch {
    return defaultValue;
  }
}

function writeStoredNumber(key: string, value: number) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    return;
  }
}

function readStoredBoolean(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") {
    return defaultValue;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    return;
  }
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

type StoredLocalWebAccessSession = {
  browserToken: string;
  displayName?: string;
  expiresAt: string;
  origin?: string;
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
    storeLocalWebAccessSession(localWebAccessSession(slug, fromUrl, expiresAt));
    removeTokenFromLocation();
    return fromUrl;
  }
  const fromSessionStorage = window.sessionStorage.getItem(storageKey);
  if (fromSessionStorage) {
    storeLocalWebAccessSession(localWebAccessSession(slug, fromSessionStorage, expiresAt));
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
      displayName: typeof session.displayName === "string" ? session.displayName : undefined,
      expiresAt: session.expiresAt,
      origin: typeof session.origin === "string" ? session.origin : undefined,
      slug,
    };
  } catch {
    return null;
  }
}

function localWebAccessSession(
  slug: string,
  browserToken: string,
  expiresAt: string,
): StoredLocalWebAccessSession {
  return {
    browserToken,
    displayName: window.location.host,
    expiresAt,
    origin: window.location.origin,
    slug,
  };
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

function pwaHomePathFromLocation(): string {
  if (typeof window === "undefined") {
    return "/pwa";
  }
  const firstPathSegment = window.location.pathname.split("/").filter(Boolean)[0];
  return firstPathSegment && firstPathSegment !== "w"
    ? `/${firstPathSegment}/pwa`
    : "/pwa";
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
