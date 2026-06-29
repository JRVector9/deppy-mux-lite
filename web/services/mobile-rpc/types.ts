export type MobileRpcMethod =
  | "mobile.host.status"
  | "mobile.workspace.list"
  | "mobile.events.subscribe"
  | "mobile.events.unsubscribe"
  | "mobile.terminal.replay"
  | "mobile.terminal.viewport"
  | "terminal.input"
  | "terminal.paste"
  | "terminal.paste_image";

export const MOBILE_RPC_METHODS = [
  "mobile.host.status",
  "mobile.workspace.list",
  "mobile.events.subscribe",
  "mobile.events.unsubscribe",
  "mobile.terminal.replay",
  "mobile.terminal.viewport",
  "terminal.input",
  "terminal.paste",
  "terminal.paste_image",
] as const satisfies readonly MobileRpcMethod[];

export type MobileRpcParams = Record<string, unknown>;

export type MobileRpcEnvelope<T = unknown> =
  | {
      id: string;
      ok: true;
      result: T;
    }
  | {
      id: string;
      ok: false;
      error: {
        code?: string;
        message: string;
      };
    };

export type MobileTerminalTarget = {
  workspaceId: string;
  surfaceId: string;
  clientId: string;
};

export type MobileTerminalPreview = {
  id: string;
  title: string;
  currentDirectory?: string;
  isReady: boolean;
  isFocused: boolean;
};

export type MobileWorkspacePreview = {
  id: string;
  title: string;
  currentDirectory?: string;
  isSelected: boolean;
  terminals: MobileTerminalPreview[];
};

export type MobileWorkspaceListResponse = {
  workspaces: MobileWorkspacePreview[];
};

export type MobileHostStatusResponse = {
  terminal_fidelity?: string;
  capabilities: string[];
};

export type MobileEventsSubscribeResponse = {
  stream_id: string;
  topics: string[];
  already_subscribed: boolean;
};

export type MobileTerminalViewportResponse = {
  columns?: number;
  rows?: number;
};

export type MobileTerminalReplayResponse = {
  data_b64?: string;
  snapshot_data_b64?: string;
  seq?: number;
  columns?: number;
  rows?: number;
  render_grid?: unknown;
};

export type MobileRpcTransport = {
  request<T = unknown>(
    method: MobileRpcMethod,
    params?: MobileRpcParams,
  ): Promise<T>;
  close?(): void;
};
