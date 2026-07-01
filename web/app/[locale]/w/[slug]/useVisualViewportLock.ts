"use client";

import { useEffect, useState } from "react";

export type VisualViewportLockState = {
  height: number;
  left: number;
  top: number;
  width: number;
};

const fallbackViewport: VisualViewportLockState = {
  height: 0,
  left: 0,
  top: 0,
  width: 0,
};

export function useVisualViewportLock(): VisualViewportLockState {
  const [viewport, setViewport] = useState<VisualViewportLockState>(fallbackViewport);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.add("web-access-viewport-lock");
    body.classList.add("web-access-viewport-lock");

    const updateViewport = () => {
      const visualViewport = window.visualViewport;
      const nextHeight = Math.floor(visualViewport?.height ?? window.innerHeight);
      const nextWidth = Math.floor(visualViewport?.width ?? window.innerWidth);
      const nextTop = Math.floor(visualViewport?.offsetTop ?? 0);
      const nextLeft = Math.floor(visualViewport?.offsetLeft ?? 0);

      if (nextHeight <= 0 || nextWidth <= 0) {
        return;
      }

      setViewport((current) => {
        if (
          current.height === nextHeight &&
          current.left === nextLeft &&
          current.top === nextTop &&
          current.width === nextWidth
        ) {
          return current;
        }
        return {
          height: nextHeight,
          left: nextLeft,
          top: nextTop,
          width: nextWidth,
        };
      });
    };

    updateViewport();
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    window.addEventListener("resize", updateViewport);

    return () => {
      root.classList.remove("web-access-viewport-lock");
      body.classList.remove("web-access-viewport-lock");
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  return viewport;
}
