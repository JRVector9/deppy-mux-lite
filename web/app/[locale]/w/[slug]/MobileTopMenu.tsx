"use client";

type MobileTopMenuButtonProps = {
  label: string;
  onToggle: () => void;
  open: boolean;
};

type MobileTopMenuPanelProps = {
  appVersion: string;
  connected: boolean;
  copy: {
    connectionStatus: string;
    decreaseFontSize: string;
    extendSession: string;
    fitWidth: string;
    fontSize: string;
    increaseFontSize: string;
    off: string;
    on: string;
    readableWrap: string;
    savedMacList: string;
  };
  connectionStatusLabel: string;
  fitWidthEnabled: boolean;
  fontSizePx: number;
  isRefreshingSession: boolean;
  onDecreaseFontSize: () => void;
  onIncreaseFontSize: () => void;
  onRefreshSession: () => void;
  onToggleFitWidth: () => void;
  onToggleReadableWrap: () => void;
  open: boolean;
  pwaHomeHref: string;
  readableWrapEnabled: boolean;
  refreshingLabel: string;
  sessionExpiryLabel: string | null;
};

export function MobileTopMenuButton({
  label,
  onToggle,
  open,
}: MobileTopMenuButtonProps) {
  return (
    <button
      aria-expanded={open}
      aria-label={label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#2a2a2a] bg-[#101010] text-base font-semibold leading-none text-[#f2f2f2]"
      onClick={onToggle}
      type="button"
    >
      ⋯
    </button>
  );
}

export function MobileTopMenuPanel({
  appVersion,
  connected,
  copy,
  connectionStatusLabel,
  fitWidthEnabled,
  fontSizePx,
  isRefreshingSession,
  onDecreaseFontSize,
  onIncreaseFontSize,
  onRefreshSession,
  onToggleFitWidth,
  onToggleReadableWrap,
  open,
  pwaHomeHref,
  readableWrapEnabled,
  refreshingLabel,
  sessionExpiryLabel,
}: MobileTopMenuPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="absolute right-2 top-[calc(max(8px,env(safe-area-inset-top))+38px)] z-40 w-[min(15.5rem,calc(100vw-1rem))] rounded-xl border border-[#2a2a2a] bg-[#101010]/98 p-1.5 text-xs text-[#f2f2f2] shadow-2xl backdrop-blur">
      <div className="mb-1 rounded-lg bg-[#050505] px-2.5 py-1.5 text-[11px] text-[#a8a8a8]">
        <div className="font-semibold uppercase tracking-normal text-[#737373]">
          {copy.connectionStatus}
        </div>
        <div className="mt-0.5 truncate text-xs font-semibold text-[#f2f2f2]">
          {connectionStatusLabel}
        </div>
        {sessionExpiryLabel ? (
          <div className="mt-0.5 truncate">{sessionExpiryLabel}</div>
        ) : null}
      </div>
      <button
        className="mb-1 grid w-full rounded-lg bg-[#f5f5f5] px-2.5 py-1.5 text-left text-xs font-semibold text-[#080808] disabled:opacity-45"
        disabled={!connected || isRefreshingSession}
        onClick={onRefreshSession}
        type="button"
      >
        {isRefreshingSession ? refreshingLabel : copy.extendSession}
      </button>
      <a
        className="mb-1 grid w-full rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] px-2.5 py-1.5 text-left text-xs font-semibold"
        href={pwaHomeHref}
      >
        {copy.savedMacList}
      </a>
      <div className="mb-1 grid gap-1 rounded-lg bg-[#050505] p-1.5">
        <div className="flex min-w-0 items-center justify-between gap-2 px-1 text-[11px] text-[#a8a8a8]">
          <span className="truncate font-semibold">{copy.fontSize}</span>
          <span className="shrink-0 font-mono">{fontSizePx}px</span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button
            aria-label={copy.decreaseFontSize}
            className="h-7 rounded-md border border-[#2a2a2a] bg-[#101010] text-xs font-bold"
            onClick={onDecreaseFontSize}
            type="button"
          >
            A-
          </button>
          <button
            aria-label={copy.increaseFontSize}
            className="h-7 rounded-md border border-[#2a2a2a] bg-[#101010] text-xs font-bold"
            onClick={onIncreaseFontSize}
            type="button"
          >
            A+
          </button>
        </div>
      </div>
      <DisplayToggleRow
        copy={copy}
        enabled={fitWidthEnabled}
        label={copy.fitWidth}
        onToggle={onToggleFitWidth}
      />
      <DisplayToggleRow
        copy={copy}
        enabled={readableWrapEnabled}
        label={copy.readableWrap}
        onToggle={onToggleReadableWrap}
      />
      <div className="rounded-lg bg-[#050505] px-2.5 py-1.5 text-[11px] font-semibold">
        {appVersion}
      </div>
    </div>
  );
}

function DisplayToggleRow({
  copy,
  enabled,
  label,
  onToggle,
}: {
  copy: Pick<MobileTopMenuPanelProps["copy"], "off" | "on">;
  enabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={enabled}
      className="mb-1 grid h-8 w-full grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] px-2.5 text-left text-xs"
      onClick={onToggle}
      type="button"
    >
      <span className="min-w-0 truncate font-semibold">{label}</span>
      <span
        className={
          enabled
            ? "rounded-full bg-emerald-400 px-1.5 py-0.5 text-center text-[10px] font-extrabold text-[#04140b]"
            : "rounded-full bg-[#2a2a2a] px-1.5 py-0.5 text-center text-[10px] font-extrabold text-[#f2f2f2]"
        }
      >
        {enabled ? copy.on : copy.off}
      </span>
    </button>
  );
}
