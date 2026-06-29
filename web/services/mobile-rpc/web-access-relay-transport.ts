import { MobileRpcError } from "./client";
import type { MobileRpcMethod, MobileRpcParams, MobileRpcTransport } from "./types";

type WebAccessRelayTransportOptions = {
  browserToken?: string | null;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

type RelayStatus =
  | { status: "pending" | "claimed" }
  | { status: "completed"; result: unknown }
  | { status: "failed"; error: { code?: string; message: string } };

export class WebAccessRelayTransport implements MobileRpcTransport {
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly browserToken: string | null;

  constructor(
    private readonly slug: string,
    options: WebAccessRelayTransportOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.browserToken = options.browserToken?.trim() || null;
  }

  async request<T = unknown>(
    method: MobileRpcMethod,
    params?: MobileRpcParams,
  ): Promise<T> {
    const queued = await this.enqueue(method, params);
    const startedAt = Date.now();
    while (Date.now() - startedAt <= this.timeoutMs) {
      const status = await this.status(method, queued.requestId, queued.statusToken);
      if (status.status === "completed") {
        return status.result as T;
      }
      if (status.status === "failed") {
        throw new MobileRpcError(method, status.error.message, status.error.code);
      }
      await delay(this.pollIntervalMs);
    }
    throw new MobileRpcError(method, "Mobile RPC relay request timed out", "timeout");
  }

  private async enqueue(
    method: MobileRpcMethod,
    params?: MobileRpcParams,
  ): Promise<{ requestId: string; statusToken: string }> {
    const response = await fetch(`/api/mobile/web-access/sessions/${this.slug}/rpc`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ method, params: params ?? {} }),
    });
    const payload = await response.json().catch(() => null);
    if (
      !response.ok ||
      typeof payload?.requestId !== "string" ||
      typeof payload?.statusToken !== "string"
    ) {
      throw new MobileRpcError(
        method,
        errorMessage(payload) ?? "Failed to enqueue mobile RPC relay request",
      );
    }
    return { requestId: payload.requestId, statusToken: payload.statusToken };
  }

  private async status(
    method: MobileRpcMethod,
    requestId: string,
    statusToken: string,
  ): Promise<RelayStatus> {
    const response = await fetch(
      `/api/mobile/web-access/sessions/${this.slug}/rpc/${requestId}`,
      {
        cache: "no-store",
        headers: { "x-cmux-web-access-status-token": statusToken },
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new MobileRpcError(
        method,
        errorMessage(payload) ?? "Failed to read mobile RPC relay request status",
      );
    }
    return payload as RelayStatus;
  }

  private headers(base: Record<string, string>): Record<string, string> {
    return this.browserToken
      ? { ...base, "x-cmux-web-access-browser-token": this.browserToken }
      : base;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function errorMessage(payload: unknown): string | null {
  return payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
    ? (payload as { error: string }).error
    : null;
}
