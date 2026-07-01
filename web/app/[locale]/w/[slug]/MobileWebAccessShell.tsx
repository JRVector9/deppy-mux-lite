"use client";

import type { CSSProperties, ReactNode } from "react";
import type { VisualViewportLockState } from "./useVisualViewportLock";

type MobileWebAccessShellProps = {
  activeNotice: string;
  attachmentName: string;
  children: ReactNode;
  menuPanel: ReactNode;
  viewport: VisualViewportLockState;
};

export function MobileWebAccessShell({
  activeNotice,
  attachmentName,
  children,
  menuPanel,
  viewport,
}: MobileWebAccessShellProps) {
  const style = {
    height: viewport.height > 0 ? `${viewport.height}px` : "100svh",
    left: viewport.left > 0 ? `${viewport.left}px` : 0,
    top: viewport.top > 0 ? `${viewport.top}px` : 0,
    width: viewport.width > 0 ? `${viewport.width}px` : "100vw",
  } satisfies CSSProperties;

  return (
    <main
      className="web-access-no-x fixed flex min-h-0 max-w-[100vw] flex-col overflow-hidden overscroll-none bg-[#050505] text-[#f2f2f2]"
      style={style}
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
      {menuPanel}
      {children}
    </main>
  );
}
