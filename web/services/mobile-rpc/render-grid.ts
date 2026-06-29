export type MobileRenderGridStyle = {
  id: number;
  foreground?: string;
  background?: string;
  bold: boolean;
  faint: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  inverse: boolean;
  invisible: boolean;
  strikethrough: boolean;
  overline: boolean;
};

export type MobileRenderGridSpan = {
  row: number;
  column: number;
  styleId: number;
  text: string;
  cellWidth: number;
};

export type MobileRenderGridCursor = {
  row: number;
  column: number;
  visible: boolean;
  style: "block" | "bar" | "underline" | "block_hollow";
  blinking: boolean;
};

export type MobileRenderGridFrame = {
  format: "cmux.render-grid.v1";
  surfaceId: string;
  stateSeq: number;
  columns: number;
  rows: number;
  cursor: MobileRenderGridCursor | null;
  full: boolean;
  styles: MobileRenderGridStyle[];
  rowSpans: MobileRenderGridSpan[];
  terminalForeground: string | null;
  terminalBackground: string | null;
  terminalCursorColor: string | null;
};

const defaultStyle: MobileRenderGridStyle = {
  id: 0,
  bold: false,
  faint: false,
  italic: false,
  underline: false,
  blink: false,
  inverse: false,
  invisible: false,
  strikethrough: false,
  overline: false,
};

export function parseMobileRenderGridFrame(
  value: unknown,
): MobileRenderGridFrame | null {
  if (!isRecord(value) || value.format !== "cmux.render-grid.v1") {
    return null;
  }
  const columns = positiveInteger(value.columns);
  const rows = positiveInteger(value.rows);
  const surfaceId = stringValue(value.surface_id);
  if (!columns || !rows || !surfaceId) {
    return null;
  }

  const styles = Array.isArray(value.styles)
    ? value.styles.map(parseStyle).filter((style) => style !== null)
    : [];
  if (!styles.some((style) => style.id === 0)) {
    styles.unshift(defaultStyle);
  }

  const rowSpans = Array.isArray(value.row_spans)
    ? value.row_spans
        .map((span) => parseSpan(span, columns, rows))
        .filter((span) => span !== null)
    : [];

  return {
    format: "cmux.render-grid.v1",
    surfaceId,
    stateSeq: nonNegativeInteger(value.state_seq) ?? 0,
    columns,
    rows,
    cursor: parseCursor(value.cursor, columns, rows),
    full: typeof value.full === "boolean" ? value.full : true,
    styles,
    rowSpans,
    terminalForeground: stringValue(value.terminal_foreground),
    terminalBackground: stringValue(value.terminal_background),
    terminalCursorColor: stringValue(value.terminal_cursor_color),
  };
}

export function renderGridFrameToText(
  frame: MobileRenderGridFrame | null,
): string {
  if (!frame) {
    return "";
  }
  const rows = Array.from({ length: frame.rows }, () => "");
  for (const span of sortedRowSpans(frame)) {
    rows[span.row] = padToColumn(rows[span.row] ?? "", span.column) + span.text;
    if (span.cellWidth > span.text.length) {
      rows[span.row] += " ".repeat(span.cellWidth - span.text.length);
    }
  }
  return rows.map((row) => row.trimEnd()).join("\n").trimEnd();
}

export function sortedRowSpans(
  frame: Pick<MobileRenderGridFrame, "rowSpans">,
): MobileRenderGridSpan[] {
  return [...frame.rowSpans].sort((lhs, rhs) =>
    lhs.row === rhs.row ? lhs.column - rhs.column : lhs.row - rhs.row,
  );
}

function parseStyle(value: unknown): MobileRenderGridStyle | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = nonNegativeInteger(value.id);
  if (id === null) {
    return null;
  }
  return {
    id,
    foreground: stringValue(value.foreground) ?? undefined,
    background: stringValue(value.background) ?? undefined,
    bold: value.bold === true,
    faint: value.faint === true,
    italic: value.italic === true,
    underline: value.underline === true,
    blink: value.blink === true,
    inverse: value.inverse === true,
    invisible: value.invisible === true,
    strikethrough: value.strikethrough === true,
    overline: value.overline === true,
  };
}

function parseSpan(
  value: unknown,
  columns: number,
  rows: number,
): MobileRenderGridSpan | null {
  if (!isRecord(value)) {
    return null;
  }
  const row = nonNegativeInteger(value.row);
  const column = nonNegativeInteger(value.column);
  const styleId = nonNegativeInteger(value.style_id) ?? 0;
  const text = stringValue(value.text);
  if (row === null || column === null || text === null) {
    return null;
  }
  const cellWidth = positiveInteger(value.cell_width) ?? text.length;
  if (row >= rows || column >= columns || cellWidth <= 0) {
    return null;
  }
  return {
    row,
    column,
    styleId,
    text,
    cellWidth: Math.min(cellWidth, columns - column),
  };
}

function parseCursor(
  value: unknown,
  columns: number,
  rows: number,
): MobileRenderGridCursor | null {
  if (!isRecord(value)) {
    return null;
  }
  const row = nonNegativeInteger(value.row);
  const column = nonNegativeInteger(value.column);
  if (row === null || column === null || row >= rows || column >= columns) {
    return null;
  }
  const rawStyle = stringValue(value.style);
  return {
    row,
    column,
    visible: value.visible !== false,
    style:
      rawStyle === "bar" ||
      rawStyle === "underline" ||
      rawStyle === "block_hollow"
        ? rawStyle
        : "block",
    blinking: value.blinking === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const integer = nonNegativeInteger(value);
  return integer !== null && integer > 0 ? integer : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? Math.floor(value)
    : null;
}

function padToColumn(value: string, column: number): string {
  return value.length >= column ? value : value + " ".repeat(column - value.length);
}
