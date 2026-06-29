import type {
  MobileEventsSubscribeResponse,
  MobileHostStatusResponse,
  MobileRpcMethod,
  MobileRpcParams,
  MobileRpcTransport,
  MobileTerminalReplayResponse,
  MobileTerminalTarget,
  MobileTerminalViewportResponse,
  MobileWorkspaceListResponse,
} from "./types";

export class MobileRpcError extends Error {
  readonly method: MobileRpcMethod;
  readonly code?: string;

  constructor(method: MobileRpcMethod, message: string, code?: string) {
    super(message);
    this.name = "MobileRpcError";
    this.method = method;
    this.code = code;
  }
}

export class MobileRpcClient {
  constructor(private readonly transport: MobileRpcTransport) {}

  hostStatus(): Promise<MobileHostStatusResponse> {
    return this.request("mobile.host.status");
  }

  listWorkspaces(): Promise<MobileWorkspaceListResponse> {
    return this.request("mobile.workspace.list");
  }

  subscribeEvents(
    streamId: string,
    topics: string[],
  ): Promise<MobileEventsSubscribeResponse> {
    return this.request("mobile.events.subscribe", {
      stream_id: streamId,
      topics,
    });
  }

  unsubscribeEvents(streamId: string): Promise<Record<string, never>> {
    return this.request("mobile.events.unsubscribe", {
      stream_id: streamId,
    });
  }

  replayTerminal(
    target: Pick<MobileTerminalTarget, "workspaceId" | "surfaceId">,
  ): Promise<MobileTerminalReplayResponse> {
    return this.request("mobile.terminal.replay", {
      workspace_id: target.workspaceId,
      surface_id: target.surfaceId,
    });
  }

  updateViewport(
    target: MobileTerminalTarget,
    viewport: { columns: number; rows: number },
  ): Promise<MobileTerminalViewportResponse> {
    return this.request("mobile.terminal.viewport", {
      ...targetParams(target),
      viewport_columns: viewport.columns,
      viewport_rows: viewport.rows,
    });
  }

  clearViewport(target: MobileTerminalTarget): Promise<Record<string, never>> {
    return this.request("mobile.terminal.viewport", {
      ...targetParams(target),
      clear: true,
    });
  }

  sendInput(target: MobileTerminalTarget, input: string): Promise<void> {
    return this.request("terminal.input", {
      ...targetParams(target),
      text: input,
    });
  }

  pasteText(
    target: MobileTerminalTarget,
    text: string,
    options: {
      submitKey?: "return" | "none";
      viewport?: { columns: number; rows: number };
    } = {},
  ): Promise<void> {
    const params: MobileRpcParams = {
      ...targetParams(target),
      text,
      submit_key: options.submitKey ?? "return",
    };
    if (options.viewport) {
      params.viewport_columns = options.viewport.columns;
      params.viewport_rows = options.viewport.rows;
    }
    return this.request("terminal.paste", params);
  }

  pasteImage(
    target: MobileTerminalTarget,
    imageBase64: string,
    imageFormat: string,
  ): Promise<void> {
    return this.request("terminal.paste_image", {
      ...targetParams(target),
      image_base64: imageBase64,
      image_format: imageFormat,
    });
  }

  close() {
    this.transport.close?.();
  }

  private async request<T>(
    method: MobileRpcMethod,
    params?: MobileRpcParams,
  ): Promise<T> {
    try {
      return await this.transport.request<T>(method, params);
    } catch (error) {
      if (error instanceof MobileRpcError) {
        throw error;
      }
      throw new MobileRpcError(
        method,
        error instanceof Error ? error.message : "Mobile RPC request failed",
      );
    }
  }
}

export function targetParams(target: MobileTerminalTarget): MobileRpcParams {
  return {
    workspace_id: target.workspaceId,
    surface_id: target.surfaceId,
    client_id: target.clientId,
  };
}
