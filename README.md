# deppy-mux-lite

`deppy-mux-lite` is a lightweight macOS terminal mux built from [`cmux`](https://github.com/manaflow-ai/cmux). It keeps the local terminal workspace core: workspaces, panes, tabs, minimal settings, session restore, notifications, and an optional Web Connect path for browser access.

The goal is simple: keep terminal sessions fast and local on your personal Mac, with fewer always-on background systems than the full upstream app. Web Connect is available when you need it, but the base app stays focused on local terminal multiplexing.

## What deppy-mux-lite keeps

- **Local terminal mux**: Ghostty-backed terminals with workspaces, panes, and tabs.
- **Focused app surface**: the lite build removes heavy non-core surfaces such as the internal browser, feed/preview systems, and full diagnostics UI.
- **Minimal settings**: workspace naming/color, notifications, terminal behavior, keyboard shortcuts, and Web Connect controls remain.
- **Session restore**: terminal workspaces and panes are preserved as much as possible without reintroducing full background feature stacks.
- **Optional Web Connect**: browser/PWA access is kept as an install-on-demand runtime so the default app bundle stays lighter.
- **Apple Silicon and universal builds**: `main` tracks the Intel + Apple Silicon universal lite app; `deppy-lite-arm64` tracks the Apple Silicon-optimized release line.

## How it works

```text
deppy-mux-lite macOS app
        |
        | local mux state
        v
Workspaces / panes / tabs
        |
        | optional Web Connect runtime
        v
Browser / PWA access
```

The macOS app remains the source of truth for terminals and workspaces. Web Connect is a remote control surface for those sessions: it displays the active terminal screen and sends input back to the selected terminal when the local runtime is installed and running.

This means your shell, agent sessions, files, credentials, and local tools stay on your own machine. The browser only needs access to your private Web Connect endpoint.

## Current status

This repository is currently in a lite release preparation state.

Current product lines:

- `main`: universal lite build for Intel Macs and Apple Silicon Macs.
- `deppy-lite-arm64`: Apple Silicon-only optimized release branch.
- Web Connect runtime is downloaded separately by default instead of bundled into the base app.

Still being hardened:

- Release packaging, signing, and notarized DMG flow.
- Web Connect install/update flow and mobile browser layout.
- Long-session restore and reconnect behavior.

## Local development

Clone the repository:

```bash
git clone https://github.com/JRVector9/deppy-mux-lite.git
cd deppy-mux-lite
```

Initialize the project:

```bash
./scripts/setup.sh
```

Build the lite macOS app:

```bash
./scripts/reload.sh --tag lite-dev --lite
```

The script prints the generated `.app` path. For a tagged lite Debug build it should look like:

```text
~/Library/Developer/Xcode/DerivedData/cmux-lite-dev/Build/Products/Debug/deppy-mux-lite.app
```

Run the web server:

```bash
cd web
CMUX_PORT=9170 CMUX_PORT_RANGE=10 CMUX_PORT_END=9179 CMUX_AUTH_CALLBACK_SCHEME=deppy-mux-lite bun dev
```

Open the PWA page:

```text
http://localhost:9170/ko/pwa
```

For phone access, use your Mac's Tailscale address instead of `localhost` once the web server is reachable from your tailnet.

## Personal PC setup goal

The intended user flow is:

1. Install deppy-mux-lite on your personal Mac.
2. Start the deppy-mux-lite desktop app.
3. Start or enable the deppy-mux-lite Web Connect endpoint.
4. Open the generated/Tailscale URL from your phone.
5. Select a workspace.
6. View the same terminal screen from the browser.
7. Send terminal input from the browser back to the Mac.

The long-term target is for this to feel like installing a personal terminal gateway: one local app, one private address, and browser access from your mobile devices while the connection is active.

## Relationship to cmux

deppy-mux-lite is a fork of cmux, a native macOS terminal/workspace app powered by Ghostty/libghostty. Upstream cmux provides the core app architecture: workspaces, tabs, split panes, Ghostty rendering, browser surfaces, notifications, CLI/socket automation, and agent-focused terminal workflows.

deppy-mux-lite keeps the local terminal/workspace foundations while removing heavier non-core surfaces from the default product. Web Connect remains available as an optional browser access layer.

## Security model

deppy-mux-lite is designed around personal-device access, not a public unauthenticated terminal.

Recommended assumptions:

- Keep the web endpoint private to your own network or tailnet.
- Prefer Tailscale for mobile access.
- Do not expose the local web server directly to the public internet without authentication and transport hardening.
- Treat browser terminal input as equivalent to typing into your local shell.

## License

This project is based on cmux and remains GPL-licensed under the upstream license terms.
