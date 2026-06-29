import { MobileRpcClient } from "./client";
import type {
  MobileEventsSubscribeResponse,
  MobileHostStatusResponse,
  MobileRpcMethod,
  MobileRpcParams,
  MobileRpcTransport,
  MobileTerminalReplayResponse,
  MobileTerminalViewportResponse,
  MobileWorkspaceListResponse,
} from "./types";

export type MockMobileRpcRequest = {
  method: MobileRpcMethod;
  params?: MobileRpcParams;
};

export class MockMobileRpcTransport implements MobileRpcTransport {
  readonly requests: MockMobileRpcRequest[] = [];
  private readonly transcriptBySurfaceId = new Map<string, string[]>();

  async request<T = unknown>(
    method: MobileRpcMethod,
    params?: MobileRpcParams,
  ): Promise<T> {
    this.requests.push({ method, params });

    switch (method) {
      case "mobile.host.status":
        return ({
          terminal_fidelity: "render_grid",
          capabilities: [
            "events.v1",
            "terminal.render_grid.v1",
            "terminal.replay.v1",
          ],
        } satisfies MobileHostStatusResponse) as T;
      case "mobile.workspace.list":
        return ({
          workspaces: [
            {
              id: "workspace:demo",
              title: "cmux-web",
              currentDirectory: "~/Projects/deppy-mux",
              isSelected: true,
              terminals: [
                {
                  id: "surface:web-demo",
                  title: "Terminal",
                  currentDirectory: "~/Projects/deppy-mux",
                  isReady: true,
                  isFocused: true,
                },
              ],
            },
          ],
        } satisfies MobileWorkspaceListResponse) as T;
      case "mobile.events.subscribe":
        return ({
          stream_id: String(params?.stream_id ?? "web-stream"),
          topics: Array.isArray(params?.topics)
            ? params.topics.map(String)
            : ["workspace.updated", "terminal.render_grid"],
          already_subscribed: false,
        } satisfies MobileEventsSubscribeResponse) as T;
      case "mobile.events.unsubscribe":
      case "mobile.terminal.viewport":
        return ({ columns: 80, rows: 24 } satisfies
          MobileTerminalViewportResponse) as T;
      case "mobile.terminal.replay": {
        const surfaceId = String(params?.surface_id ?? "");
        const lines = replayRows(this.transcriptBySurfaceId.get(surfaceId) ?? []);
        return ({
          seq: this.transcriptBySurfaceId.get(surfaceId)?.length ?? 0,
          columns: 80,
          rows: 24,
          render_grid: {
            format: "cmux.render-grid.v1",
            surface_id: surfaceId,
            state_seq: this.transcriptBySurfaceId.get(surfaceId)?.length ?? 0,
            columns: 80,
            rows: 24,
            styles: [{ id: 0 }],
            row_spans: lines.map((line, index) => ({
              row: index,
              column: 0,
              style_id: 0,
              text: line,
            })),
          },
        } satisfies MobileTerminalReplayResponse) as T;
      }
      case "terminal.input":
        this.appendTranscript(params, String(params?.text ?? ""));
        return undefined as T;
      case "terminal.paste":
        this.appendTranscript(
          params,
          String(params?.text ?? "") +
            (params?.submit_key === "none" ? "" : "\r"),
        );
        return undefined as T;
      case "terminal.paste_image":
        this.appendTranscript(params, `[image:${params?.image_format ?? "png"}]`);
        return undefined as T;
    }
  }

  transcript(surfaceId: string): string[] {
    return this.transcriptBySurfaceId.get(surfaceId) ?? [];
  }

  private appendTranscript(params: MobileRpcParams | undefined, text: string) {
    const surfaceId = String(params?.surface_id ?? "");
    const current = this.transcriptBySurfaceId.get(surfaceId) ?? [];
    current.push(text);
    this.transcriptBySurfaceId.set(surfaceId, current);
  }
}

export function createMockMobileRpcClient() {
  const transport = new MockMobileRpcTransport();
  return {
    client: new MobileRpcClient(transport),
    transport,
  };
}

function replayRows(transcript: string[]): string[] {
  const text = transcript.length === 0
    ? "cmux web demo\n$ "
    : transcript.join("").replace(/\r/g, "\n");
  return text.split("\n").slice(-24).filter((line) => line.length > 0);
}
