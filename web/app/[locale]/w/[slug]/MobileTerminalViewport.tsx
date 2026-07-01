"use client";

import { useMemo, type CSSProperties, type RefObject } from "react";
import type {
  MobileRenderGridFrame,
  MobileRenderGridSpan,
  MobileRenderGridStyle,
} from "@/services/mobile-rpc/render-grid";
import { sortedRowSpans } from "@/services/mobile-rpc/render-grid";

export type TerminalSnapshot =
  | { kind: "render-grid"; frame: MobileRenderGridFrame }
  | { kind: "text"; text: string };

type MobileTerminalViewportProps = {
  copy: {
    transcriptEmpty: string;
  };
  forceReadableLayout: boolean;
  terminalSnapshot: TerminalSnapshot | null;
  terminalViewportRef: RefObject<HTMLDivElement | null>;
  terminalViewportWidth: number;
  transcript: string[];
};

const estimatedTerminalCellWidthPx = 7.2;
const terminalLineHeightEm = 1.35;
const webTerminalDefaultForeground = "#d8d8d8";
const webTerminalDefaultBackground = "#050505";

export function MobileTerminalViewport({
  copy,
  forceReadableLayout,
  terminalSnapshot,
  terminalViewportRef,
  terminalViewportWidth,
  transcript,
}: MobileTerminalViewportProps) {
  return (
    <div
      className="web-access-scroll min-h-0 min-w-0 max-w-full flex-1 bg-[#030303] font-mono text-[15px] leading-6 text-[#e7e7e7]"
      ref={terminalViewportRef}
    >
      {terminalSnapshot?.kind === "render-grid" ? (
        <TerminalRenderGridView
          forceReadableLayout={forceReadableLayout}
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
  );
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
