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
    terminal: string;
    transcriptEmpty: string;
  };
  fitWidthEnabled: boolean;
  fontSizePx: number;
  onFocusComposer: () => void;
  readableWrapEnabled: boolean;
  terminalSnapshot: TerminalSnapshot | null;
  terminalViewportRef: RefObject<HTMLDivElement | null>;
  terminalViewportWidth: number;
  transcript: string[];
};

const estimatedTerminalCellWidthEm = 0.62;
const terminalLineHeightEm = 1.35;
const webTerminalDefaultForeground = "#d8d8d8";
const webTerminalDefaultBackground = "#050505";

export function MobileTerminalViewport({
  copy,
  fitWidthEnabled,
  fontSizePx,
  onFocusComposer,
  readableWrapEnabled,
  terminalSnapshot,
  terminalViewportRef,
  terminalViewportWidth,
  transcript,
}: MobileTerminalViewportProps) {
  return (
    <div
      className="web-access-scroll min-h-0 min-w-0 max-w-full flex-1 bg-[#030303] font-mono text-[#e7e7e7]"
      onClick={onFocusComposer}
      ref={terminalViewportRef}
    >
      {terminalSnapshot?.kind === "render-grid" ? (
        <TerminalRenderGridView
          fitWidth={fitWidthEnabled}
          fontSizePx={fontSizePx}
          frame={terminalSnapshot.frame}
          readableWrap={readableWrapEnabled}
          terminalLabel={copy.terminal}
          viewportWidth={terminalViewportWidth}
        />
      ) : terminalSnapshot?.kind === "text" && terminalSnapshot.text ? (
        <pre
          className="min-w-0 max-w-full whitespace-pre-wrap break-words p-3 font-mono [overflow-wrap:anywhere] [word-break:break-all]"
          style={{
            fontSize: `${fontSizePx}px`,
            lineHeight: terminalLineHeightEm,
          }}
        >
          {terminalSnapshot.text}
        </pre>
      ) : transcript.length === 0 ? (
        <div className="p-3 text-sm text-[#8e8e8e]">{copy.transcriptEmpty}</div>
      ) : (
        <div
          className="space-y-1 p-3"
          style={{
            fontSize: `${fontSizePx}px`,
            lineHeight: terminalLineHeightEm,
          }}
        >
          {transcript.map((line, index) => (
            <div key={line + ":" + index}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function TerminalRenderGridView({
  fitWidth,
  fontSizePx,
  frame,
  readableWrap,
  terminalLabel,
  viewportWidth,
}: {
  fitWidth: boolean;
  fontSizePx: number;
  frame: MobileRenderGridFrame;
  readableWrap: boolean;
  terminalLabel: string;
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
  const fittedFontSizePx =
    fitWidth && viewportWidth > 0
      ? Math.min(
          fontSizePx,
          Math.max(
            4,
            (viewportWidth - 2) /
              Math.max(1, frame.columns * estimatedTerminalCellWidthEm),
          ),
        )
      : fontSizePx;

  if (readableWrap) {
    return (
      <TerminalReadableGridView
        background={background}
        fontSizePx={fittedFontSizePx}
        foreground={foreground}
        frame={frame}
        inheritedBackground={inheritedBackground}
        inheritedForeground={inheritedForeground}
        rows={rowsFromRenderGrid(frame, false)}
        stylesById={stylesById}
        terminalLabel={terminalLabel}
      />
    );
  }

  return (
    <div
      className="min-h-full w-full max-w-full overflow-hidden font-mono text-[12px] tracking-normal"
      style={{
        backgroundColor: background,
        color: foreground,
      }}
    >
      <div
        className="relative block min-w-0 max-w-full overflow-hidden font-mono tracking-normal"
        style={{
          backgroundColor: background,
          color: foreground,
          fontFamily:
            '"SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontVariantLigatures: "none",
          fontSize: `${fittedFontSizePx}px`,
          lineHeight: terminalLineHeightEm,
          minHeight: `${frame.rows * terminalLineHeightEm}em`,
          width: fitWidth ? "100%" : `${frame.columns}ch`,
        }}
      >
        <div aria-label={`${terminalLabel} ${frame.columns} by ${frame.rows}`} role="img">
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
  fontSizePx,
  foreground,
  frame,
  inheritedBackground,
  inheritedForeground,
  rows,
  stylesById,
  terminalLabel,
}: {
  background: string;
  fontSizePx: number;
  foreground: string;
  frame: MobileRenderGridFrame;
  inheritedBackground?: string;
  inheritedForeground?: string;
  rows: Array<Array<MobileRenderGridSpan>>;
  stylesById: Map<number, MobileRenderGridStyle>;
  terminalLabel: string;
}) {
  return (
    <div
      className="web-access-no-x min-h-full w-full max-w-full font-mono tracking-normal"
      style={{
        backgroundColor: background,
        color: foreground,
        fontFamily:
          '"SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontVariantLigatures: "none",
        fontSize: `${fontSizePx}px`,
        lineHeight: terminalLineHeightEm,
      }}
    >
      <div
        aria-label={`${terminalLabel} ${frame.columns} by ${frame.rows}`}
        className="web-access-no-x w-full max-w-full px-3 py-3"
        role="img"
      >
        {rows.map((row, index) => (
          <div
            className="web-access-no-x min-h-[1.35em] whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word]"
            key={`${frame.surfaceId}:${frame.stateSeq}:readable:${index}`}
          >
            {row.length === 0 ? "\u00A0" : row.map((span, spanIndex) => (
              <span
                className="[overflow-wrap:anywhere] [word-break:break-word]"
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
