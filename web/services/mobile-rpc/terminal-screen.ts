import type { MobileTerminalReplayResponse } from "./types";
import {
  parseMobileRenderGridFrame,
  renderGridFrameToText,
} from "./render-grid";

type BufferLike = {
  from(value: string, encoding: "base64"): { toString(encoding: "utf8"): string };
};

const ansiPattern =
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

export function terminalReplayToText(
  replay: MobileTerminalReplayResponse,
): string {
  const renderGridText = renderGridFrameToText(
    parseMobileRenderGridFrame(replay.render_grid),
  );
  if (renderGridText) {
    return renderGridText;
  }

  const encoded = replay.snapshot_data_b64 ?? replay.data_b64;
  if (!encoded) {
    return "";
  }
  return stripAnsi(decodeBase64Utf8(encoded)).trimEnd();
}

function decodeBase64Utf8(value: string): string {
  const maybeBuffer = (globalThis as typeof globalThis & { Buffer?: BufferLike })
    .Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(value, "base64").toString("utf8");
  }
  const binary = globalThis.atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}
