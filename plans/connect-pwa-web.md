# connect-pwa-web

Branch: `connect-pwa-web`

## Goal

Build a browser/PWA client that can connect to a running cmux Mac app without installing the iOS app, show the same mobile workspace/terminal surface, and send input to the correct terminal. Fix the current iOS input-routing bugs first so the web client reuses the same behavior contract instead of copying broken semantics.

## Current Findings

- Mac already exposes a mobile RPC data plane in `Sources/Mobile/MobileHostService.swift`.
- The shared mobile protocol already models a `.websocket` route kind in `CMUXMobileCore`.
- iOS native transport currently uses raw TCP (`NWConnection`), which browsers cannot open.
- Browser/PWA access therefore needs a `wss://` relay or another HTTPS/WebSocket facade.
- Authorization must remain Stack account/team based. The Mac mobile host treats Stack auth as the sole authorization gate; attach tickets are route/workspace context, not authority.
- Direct iOS raw keyboard input mostly routes by rendered `surfaceID`, but composer submit paths still read the store selection at send time. This is the leading cause candidate for "input lands in another terminal" and "enter/submit does not affect the visible terminal".

## Non-Negotiable Behavior Contract

All clients, native iOS and PWA, must follow one shared behavior contract:

1. The visible terminal surface owns the target terminal id.
2. Text composed in an input box is sent to the terminal captured when Send was tapped.
3. Raw key data is sent with `terminal.input`.
4. Multi-line/composed text is sent with `terminal.paste`, not `terminal.input`.
5. Images are sent with `terminal.paste_image`.
6. Viewport reports use `terminal.viewport` and must include the client id.
7. Workspace mutations use the existing mobile-gated RPC handlers.
8. A stale or superseded connection must not continue sending queued text or attachments into a new session.
9. Failed sends preserve unsent draft/attachments; acknowledged sends reconcile and clear only the sent draft/attachments.

## Phase 0: Branch and Baseline

- Create and work on `connect-pwa-web`.
- Record current iOS/PWA plan in this file.
- Capture existing tests relevant to mobile input/composer routing.
- Use the `connect-pwa-web` reload tag for app builds.

Validation:

- `git status --short --branch` shows `connect-pwa-web`.

## Phase 1: Fix iOS Input Targeting

Problem statement:

- In the iOS app, input typed/composed while viewing one terminal can be sent to another terminal, or submit/enter can fail to affect the visible terminal.

Likely root:

- `GhosttySurfaceRepresentable` is created for a concrete `surfaceID`.
- Direct raw bytes from `GhosttySurfaceView` call `submitTerminalRawInput(data, surfaceID:)`, which resolves the target from the rendered surface.
- `TerminalComposerView` is also constructed with a concrete `terminalID`, but its Send path calls `store.submitComposer()` with no target.
- `submitComposer()` captures `selectedWorkspace` and `selectedTerminalID`, which can diverge from the rendered `terminalID` during fallback selection, terminal switching, reconnect, or workspace list updates.

Implementation plan:

1. Add targeted composer APIs on `MobileShellComposite`:
   - `submitComposer(forTerminalID:)`
   - `submitComposerInput(forTerminalID:)`
   - optionally `selectedWorkspaceContainingTerminal(_:)` or a value seam that resolves a `terminalID` to `(workspaceID, terminalID)`.
2. Make `TerminalComposerView.send()` call the targeted API using its `terminalID`.
3. Keep existing no-argument APIs as convenience wrappers for older call sites, but route them through the same targeted implementation after resolving the selected terminal.
4. Ensure attachments are read/removed for the captured terminal id, not the live selected id.
5. Ensure draft reconciliation clears the captured terminal draft only after ack.
6. Ensure `terminal.paste_image` and text paste both use the captured workspace and terminal.
7. Check raw Enter/accessory actions still use `surfaceID` path.

Regression coverage:

- Existing routing tests in `Packages/iOS/CmuxMobileShell/Tests/CmuxMobileShellTests/ComposerSubmitRoutingTests.swift` already cover several mid-submit switch cases.
- Add or extend tests for:
  - rendered terminal differs from `selectedTerminalID`, composer send targets rendered terminal
  - attachment plus text targets rendered terminal after selection changes
  - successful ack clears rendered terminal draft, not another terminal draft
  - failed ack keeps rendered terminal draft/attachments
  - raw input path still targets `surfaceID`

Validation:

- `swift test --package-path Packages/iOS/CmuxMobileShell`
- `swift test --package-path ios/cmuxPackage` if feature/root scene behavior changes.
- `./scripts/reload.sh --tag connect-pwa-web` after code changes.

## Phase 2: Extract a Shared Web-Compatible Mobile RPC Contract

Goal:

- Define the TypeScript-side protocol shape by mirroring the existing mobile RPC wire contract, not by inventing a parallel API.

Deliverables:

- Document request/response/event envelopes:
  - request: `{ id, method, params, auth }`
  - response: `{ id, ok, result | error }`
  - event: `{ kind: "event", topic, payload, stream_id }`
- Define web DTOs for:
  - host status
  - workspace list
  - terminal replay
  - terminal render grid event
  - terminal bytes event fallback
  - notification badge/dismiss/reconcile
  - terminal input/paste/paste image/viewport/scroll/mouse
- Add a narrow web client library rather than scattering RPC calls through React components.

Preferred location:

- `web/lib/mobile-rpc/` or `web/services/mobile-rpc/`, depending on existing web layering.

Validation:

- TypeScript unit tests for envelope parsing and event dispatch.
- No React component should assemble raw RPC envelopes directly once the client exists.

## Phase 3: Relay Architecture

Why relay:

- PWA cannot open raw TCP to the Mac mobile listener.
- HTTPS PWA requires secure WebSocket (`wss://`) for production.
- Most users' Macs are behind NAT/firewalls, so the Mac should make an outbound connection.

Design:

1. Mac cmux opens an outbound `wss://` relay connection.
2. PWA opens a `wss://` relay connection.
3. Relay verifies both sides with Stack auth and team/device scope.
4. Relay pairs sessions by user/team/device/app instance.
5. Relay forwards the mobile RPC byte/framed stream.
6. Relay never exposes the Mac local socket or raw listener publicly.

Authentication:

- Browser side uses Stack web session/cookies.
- Mac side uses existing Stack native tokens or a short-lived relay registration token minted by the backend.
- Relay authorization is Stack user/team/device based.
- Do not use email string comparison as authority. Email may be shown in UI, but user id/team id is the boundary.

Security requirements:

- TLS only in production.
- Short-lived relay session tokens.
- Per-session ids and revocation.
- Server-side rate limits on connect and input frames.
- Payload size caps for paste/image.
- Audit logging for connect/disconnect and relay errors, not terminal content.
- Long-term option: end-to-end encrypt PWA-to-Mac payloads so relay cannot read terminal contents.

## Phase 4: Mac Relay Client

Deliverables:

- A Mac-side relay client service/coordinator that:
  - authenticates with backend
  - opens outbound WebSocket
  - registers device id, app tag, capabilities, routes
  - bridges relay frames to the existing `MobileHostService`/RPC handler
  - preserves focus policy: relay commands must not steal app focus unless explicitly requested
  - tears down cleanly on sign-out, setting changes, network loss, or app quit

Architecture notes:

- Prefer a service actor for WebSocket connection lifecycle.
- Keep UI/settings in a `@MainActor @Observable` coordinator if needed.
- Do not create a parallel terminal mutation path. The relay must call the same mobile RPC handling path.

Validation:

- Unit tests for relay session state transitions.
- Behavior tests that relay-originated `terminal.input` and local mobile-host `terminal.input` reach the same handler.
- Tagged app build: `./scripts/reload.sh --tag connect-pwa-web`.

## Phase 5: PWA Client UX

Screens:

1. Sign in / restoring session.
2. Device picker / Mac list.
3. Workspace list:
   - groups
   - unread
   - pinned
   - search/filter
   - connection status
   - create workspace
4. Workspace detail:
   - terminal picker
   - terminal renderer
   - composer
   - toolbar shortcuts
   - reconnect/offline overlay
5. Settings:
   - sign out
   - active Mac/device
   - relay diagnostics

Terminal rendering:

- Prefer `terminal.render_grid` for fidelity with iOS.
- Use xterm.js only as an MVP/fallback if render-grid canvas takes too long.
- Always request replay first, then subscribe to events.
- Re-request replay after stream gaps or reconnect.

Input:

- Raw terminal keystrokes: `terminal.input`.
- Composer send: `terminal.paste`.
- Image paste/upload: `terminal.paste_image`.
- Enter button in toolbar: raw `\r` via `terminal.input`.
- Multi-line message send: `terminal.paste` with `submit_key: "return"`.
- Capture workspace/terminal target at send time.

Validation:

- Browser tests for RPC client dispatch.
- Playwright tests for workspace list and composer routing using a mock relay.
- Manual smoke against tagged Mac build.

## Phase 6: Device Registry and Presence

Deliverables:

- Browser can list the same team devices as iOS via existing `/api/devices`.
- Mac relay registration updates registry metadata with a websocket/relay route.
- PWA can reconnect to the most recent Mac after refresh.
- Presence shows online/offline/reconnecting.

Compatibility:

- Existing iOS Tailscale/manual routes continue to work.
- New relay route is additive and advertised by capability/route kind.
- Older iOS clients must ignore unknown route kinds safely.

## Phase 7: Notifications and Background Limits

Deliverables:

- Foreground PWA gets live notification events over relay.
- Optional Web Push support for Home Screen PWA.
- On foreground/resume, PWA refreshes authoritative workspace/notification state.

Constraint:

- Do not promise persistent background terminal streams in iOS Safari/PWA.

## Phase 8: Release Criteria

Must pass:

- iOS composer regression tests.
- iOS package tests touched by input/composer changes.
- Web TypeScript tests for mobile RPC client.
- Web Playwright/mock relay smoke.
- Tagged macOS reload build.
- Manual smoke:
  - iOS app: select terminal A, composer send, switch to B mid-send, confirm A receives.
  - iOS app: accessory Return sends to visible terminal.
  - PWA: sign in, pick Mac, list workspaces, open terminal, type raw input, send composer text, reconnect.

Out of scope for first branch:

- Full end-to-end encrypted relay.
- Offline background terminal stream.
- Complete parity for every iOS settings screen.
- Replacing the native iOS app.
