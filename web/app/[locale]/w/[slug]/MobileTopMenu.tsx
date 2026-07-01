"use client";

type MobileTopMenuButtonProps = {
  label: string;
  onToggle: () => void;
  open: boolean;
};

type MobileTopMenuPanelProps = {
  appVersion: string;
  connected: boolean;
  isRefreshingSession: boolean;
  onRefreshSession: () => void;
  open: boolean;
  refreshLabel: string;
  refreshingLabel: string;
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
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#2a2a2a] bg-[#101010] text-lg font-semibold leading-none text-[#f2f2f2]"
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
  isRefreshingSession,
  onRefreshSession,
  open,
  refreshLabel,
  refreshingLabel,
}: MobileTopMenuPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="absolute right-3 top-[calc(max(12px,env(safe-area-inset-top))+42px)] z-40 min-w-44 rounded-2xl border border-[#2a2a2a] bg-[#101010]/98 p-2 text-sm text-[#f2f2f2] shadow-2xl backdrop-blur">
      <button
        className="mb-1 grid w-full rounded-xl bg-[#f5f5f5] px-3 py-2 text-left text-sm font-semibold text-[#080808] disabled:opacity-45"
        disabled={!connected || isRefreshingSession}
        onClick={onRefreshSession}
        type="button"
      >
        {isRefreshingSession ? refreshingLabel : refreshLabel}
      </button>
      <div className="rounded-xl bg-[#050505] px-3 py-2 font-semibold">
        {appVersion}
      </div>
    </div>
  );
}
