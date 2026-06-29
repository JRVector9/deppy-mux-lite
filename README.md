# dodomux

`dodomux` is a fork of [`cmux`](https://github.com/manaflow-ai/cmux) focused on making your local terminal workspaces accessible from a mobile web browser.

The goal is simple: run dodomux on your personal Mac, keep your terminal sessions and workspaces there, and open a browser URL from your phone to view and control those terminals without installing a separate iPhone app.

## What dodomux adds

- **Mobile web access**: open dodomux from a mobile browser as a PWA-style web app.
- **No iOS app required**: the phone connects through the browser while the Mac app keeps owning the real terminal sessions.
- **Workspace visibility**: active dodomux workspaces are exposed to the web UI so you can select the session you want to control.
- **Terminal streaming**: terminal render-grid output is streamed to the web client, including color/style information from the active terminal screen.
- **Terminal input from the web**: text entered in the mobile web UI is sent back to the selected dodomux terminal target.
- **Tailscale-first local access**: the intended personal setup is a Mac running dodomux plus a Tailscale address you can open from your own devices.
- **cmux compatibility**: the project stays close to upstream cmux internals so existing terminal, workspace, Ghostty, browser, and agent workflows can continue to work.

## How it works

```text
Phone browser / PWA
        |
        | Tailscale or local web URL
        v
dodomux web server
        |
        | relay / mobile RPC
        v
dodomux macOS app
        |
        v
Local terminal workspaces
```

The macOS app remains the source of truth for terminals and workspaces. The web UI is a remote control surface for those sessions: it displays the active terminal screen and sends input back to the selected terminal.

This means your shell, agent sessions, files, credentials, and local tools stay on your own machine. The phone only needs browser access to the dodomux web endpoint.

## Current status

This repository is currently in a beta/development state.

Implemented in this beta:

- `dodomux-beta` macOS app naming for the beta build.
- PWA manifest naming for `dodomux-beta`.
- Web Access and PWA pages branded for dodomux.
- Mobile RPC/web access session plumbing.
- Terminal render-grid replay in the web terminal.
- Color/style preservation for streamed terminal output.
- Web input forwarding to the selected terminal target.

Still being hardened:

- Turnkey installer flow for non-developers.
- Tailscale-required setup and address discovery.
- Production packaging and release artifacts.
- More complete parity with the old iOS app controls.
- Robust reconnect/replay behavior across network changes.

## Local development

Clone the repository:

```bash
git clone https://github.com/JRVector9/dodomux.git
cd dodomux
```

Initialize the project:

```bash
./scripts/setup.sh
```

Build the beta macOS app:

```bash
./scripts/reload.sh --tag connect-pwa-web
```

The script prints the generated `.app` path. For the current beta branch it should look like:

```text
~/Library/Developer/Xcode/DerivedData/cmux-connect-pwa-web/Build/Products/Debug/dodomux-beta.app
```

Run the web server:

```bash
cd web
CMUX_PORT=9170 CMUX_PORT_RANGE=10 CMUX_PORT_END=9179 CMUX_AUTH_CALLBACK_SCHEME=cmux-dev-connect-pwa-web bun dev
```

Open the PWA page:

```text
http://localhost:9170/ko/pwa
```

For phone access, use your Mac's Tailscale address instead of `localhost` once the web server is reachable from your tailnet.

## Personal PC setup goal

The intended user flow is:

1. Install dodomux on your personal Mac.
2. Start the dodomux desktop app.
3. Start or enable the dodomux web endpoint.
4. Open the generated/Tailscale URL from your phone.
5. Select a workspace.
6. View the same terminal screen from the browser.
7. Send terminal input from the browser back to the Mac.

The long-term target is for this to feel like installing a personal terminal gateway: one local app, one private address, and browser access from your mobile devices while the connection is active.

## Relationship to cmux

dodomux is a fork of cmux, a native macOS terminal/workspace app powered by Ghostty/libghostty. Upstream cmux provides the core app architecture: workspaces, tabs, split panes, Ghostty rendering, browser surfaces, notifications, CLI/socket automation, and agent-focused terminal workflows.

dodomux keeps those foundations and adds a mobile-web connection layer so the same local terminal environment can be accessed from a browser.

## Security model

dodomux is designed around personal-device access, not a public unauthenticated terminal.

Recommended assumptions:

- Keep the web endpoint private to your own network or tailnet.
- Prefer Tailscale for mobile access.
- Do not expose the local web server directly to the public internet without authentication and transport hardening.
- Treat browser terminal input as equivalent to typing into your local shell.

## License

This project is based on cmux and remains GPL-licensed under the upstream license terms.
