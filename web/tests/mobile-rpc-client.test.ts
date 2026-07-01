import { describe, expect, test } from "bun:test";
import { MobileRpcClient, MobileRpcError } from "../services/mobile-rpc/client";
import { MockMobileRpcTransport } from "../services/mobile-rpc/mock";
import { parseMobileRenderGridFrame } from "../services/mobile-rpc/render-grid";
import { terminalReplayToText } from "../services/mobile-rpc/terminal-screen";
import type {
  MobileRpcMethod,
  MobileRpcParams,
  MobileRpcTransport,
} from "../services/mobile-rpc/types";
import { WebAccessRelayTransport } from "../services/mobile-rpc/web-access-relay-transport";

describe("mobile RPC web client", () => {
  test("sends composer text to the explicitly captured terminal target", async () => {
    const transport = new MockMobileRpcTransport();
    const client = new MobileRpcClient(transport);
    const capturedTarget = {
      workspaceId: "workspace:a",
      surfaceId: "surface:a",
      clientId: "web-client",
    };

    await client.pasteText(capturedTarget, "echo from web", {
      submitKey: "return",
      viewport: { columns: 80, rows: 24 },
    });

    expect(transport.requests).toEqual([
      {
        method: "terminal.paste",
        params: {
          workspace_id: "workspace:a",
          surface_id: "surface:a",
          client_id: "web-client",
          text: "echo from web",
          submit_key: "return",
          viewport_columns: 80,
          viewport_rows: 24,
        },
      },
    ]);
  });

  test("uses the same RPC method names as the iOS mobile client", async () => {
    const calls: Array<{ method: MobileRpcMethod; params?: MobileRpcParams }> =
      [];
    const transport: MobileRpcTransport = {
      async request(method, params) {
        calls.push({ method, params });
        return {} as never;
      },
    };
    const client = new MobileRpcClient(transport);
    const target = {
      workspaceId: "workspace:1",
      surfaceId: "surface:1",
      clientId: "web-client",
    };

    await client.hostStatus();
    await client.listWorkspaces();
    await client.subscribeEvents("stream:web-client", [
      "workspace.updated",
      "terminal.render_grid",
    ]);
    await client.replayTerminal(target);
    await client.updateViewport(target, { columns: 100, rows: 30 });
    await client.refreshWebAccessSession();
    await client.sendInput(target, "\r");
    await client.pasteImage(target, "aW1hZ2U=", "png");

    expect(calls.map((call) => call.method)).toEqual([
      "mobile.host.status",
      "mobile.workspace.list",
      "mobile.events.subscribe",
      "mobile.terminal.replay",
      "mobile.terminal.viewport",
      "web_access.session.refresh",
      "terminal.input",
      "terminal.paste_image",
    ]);
    expect(calls[6].params).toMatchObject({
      workspace_id: "workspace:1",
      surface_id: "surface:1",
      client_id: "web-client",
      text: "\r",
    });
  });

  test("renders replay render-grid rows as terminal screen text", () => {
    expect(
      terminalReplayToText({
        seq: 4,
        render_grid: {
          format: "cmux.render-grid.v1",
          surface_id: "surface:1",
          state_seq: 4,
          columns: 20,
          rows: 3,
          styles: [{ id: 0 }],
          row_spans: [
            { row: 0, column: 0, style_id: 0, text: "alpha" },
            { row: 1, column: 2, style_id: 0, text: "beta" },
          ],
        },
      }),
    ).toBe("alpha\n  beta");
  });

  test("preserves render-grid colors and text styles for the web terminal", () => {
    const frame = parseMobileRenderGridFrame({
      format: "cmux.render-grid.v1",
      surface_id: "surface:1",
      state_seq: 9,
      columns: 20,
      rows: 3,
      terminal_foreground: "#D8D8D8",
      terminal_background: "#050505",
      terminal_cursor_color: "#FFFFFF",
      cursor: { row: 1, column: 4, style: "bar", blinking: true },
      styles: [
        { id: 0, foreground: "#D8D8D8", background: "#050505" },
        {
          id: 1,
          foreground: "#00FF00",
          background: "#101010",
          bold: true,
          italic: true,
          underline: true,
        },
      ],
      row_spans: [
        { row: 1, column: 2, style_id: 1, text: "ok", cell_width: 2 },
      ],
    });

    expect(frame).toMatchObject({
      surfaceId: "surface:1",
      stateSeq: 9,
      terminalForeground: "#D8D8D8",
      terminalBackground: "#050505",
      terminalCursorColor: "#FFFFFF",
      cursor: { row: 1, column: 4, style: "bar", blinking: true },
      rowSpans: [{ row: 1, column: 2, styleId: 1, text: "ok" }],
    });
    expect(frame?.styles.find((style) => style.id === 1)).toMatchObject({
      foreground: "#00FF00",
      background: "#101010",
      bold: true,
      italic: true,
      underline: true,
    });
  });

  test("renders base64 replay fallbacks without ANSI escapes", () => {
    expect(
      terminalReplayToText({
        snapshot_data_b64: Buffer.from("\u001B[31mready\u001B[0m\n").toString(
          "base64",
        ),
      }),
    ).toBe("ready");
  });

  test("polls the web access relay until a request completes", async () => {
    const calls: string[] = [];
    const statusTokens: string[] = [];
    const browserTokens: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/mobile/web-access/sessions/slug-1/rpc")) {
        browserTokens.push(headerValue(init, "x-cmux-web-access-browser-token"));
        return json({ requestId: "request-1", statusToken: "status-token" }, 202);
      }
      if (url.endsWith("/api/mobile/web-access/sessions/slug-1/rpc/request-1")) {
        statusTokens.push(headerValue(init, "x-cmux-web-access-status-token"));
        return calls.length < 3
          ? json({ status: "claimed" })
          : json({ status: "completed", result: { workspaces: [] } });
      }
      return json({ error: "not_found" }, 404);
    }) as typeof fetch;
    try {
      const client = new MobileRpcClient(
        new WebAccessRelayTransport("slug-1", {
          browserToken: "browser-token",
          pollIntervalMs: 1,
          timeoutMs: 100,
        }),
      );

      await expect(client.listWorkspaces()).resolves.toEqual({ workspaces: [] });
      expect(calls).toEqual([
        "/api/mobile/web-access/sessions/slug-1/rpc",
        "/api/mobile/web-access/sessions/slug-1/rpc/request-1",
        "/api/mobile/web-access/sessions/slug-1/rpc/request-1",
      ]);
      expect(browserTokens).toEqual(["browser-token"]);
      expect(statusTokens).toEqual(["status-token", "status-token"]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("keeps polling after a transient web access status timeout", async () => {
    let statusPolls = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/mobile/web-access/sessions/slug-1/rpc")) {
        return json({ requestId: "request-1", statusToken: "status-token" }, 202);
      }
      statusPolls += 1;
      if (statusPolls === 1) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return json({ status: "completed", result: { status: "ok" } });
    }) as typeof fetch;
    try {
      const client = new MobileRpcClient(
        new WebAccessRelayTransport("slug-1", {
          pollIntervalMs: 1,
          timeoutMs: 100,
        }),
      );

      await expect(client.hostStatus()).resolves.toEqual({ status: "ok" });
      expect(statusPolls).toBe(2);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("raises relay failures as mobile RPC errors", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/mobile/web-access/sessions/slug-1/rpc")) {
        return json({ requestId: "request-1", statusToken: "status-token" }, 202);
      }
      return json({
        status: "failed",
        error: { code: "host_error", message: "Host failed" },
      });
    }) as typeof fetch;
    try {
      const client = new MobileRpcClient(
        new WebAccessRelayTransport("slug-1", {
          pollIntervalMs: 1,
          timeoutMs: 100,
        }),
      );

      await expect(client.hostStatus()).rejects.toBeInstanceOf(MobileRpcError);
      await expect(client.hostStatus()).rejects.toThrow("Host failed");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("surfaces stale host-claim failures before the relay timeout", async () => {
    let polls = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/mobile/web-access/sessions/slug-1/rpc")) {
        return json({ requestId: "request-1", statusToken: "status-token" }, 202);
      }
      polls += 1;
      return polls < 3
        ? json({ status: "claimed" })
        : json({
            status: "failed",
            error: {
              code: "host_claim_timeout",
              message: "The Mac did not finish the Web Access request in time.",
            },
          });
    }) as typeof fetch;
    try {
      const client = new MobileRpcClient(
        new WebAccessRelayTransport("slug-1", {
          pollIntervalMs: 1,
          timeoutMs: 100,
        }),
      );

      await expect(client.sendInput({
        workspaceId: "workspace:1",
        surfaceId: "surface:1",
        clientId: "web-client",
      }, "\r")).rejects.toMatchObject({
        code: "host_claim_timeout",
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function headerValue(init: RequestInit | undefined, name: string): string {
  return new Headers(init?.headers).get(name) ?? "";
}
