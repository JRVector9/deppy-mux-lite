# macOS Resource Optimization Analysis

Date: 2026-06-29
Project: deppy-mux
Scope: macOS app resource usage, many-workspace stability, RAM/CPU reduction

## Summary

The macOS app already contains several important resource-saving mechanisms:

- Workspace mounting is limited to the selected workspace by default, with a small handoff window during switching.
- Offscreen terminal GPU renderer reclamation exists and is enabled by default.
- Hidden browser WebView discard exists and is enabled by default.
- Agent hibernation exists and can free terminal runtime surfaces, but is disabled by default.

The main remaining problem is not a single missing optimization. It is that many expensive objects and observers can still exist across many workspaces, and several periodic systems still scan all workspaces/panels. The most impactful path is to strengthen existing lifecycle policies first, then reduce global invalidation and full-tree scans.

## High-Impact Findings

### 1. Workspace and TabManager Still Broadcast Too Broadly

`Workspace` is still a large `ObservableObject` with many independent `@Published` fields:

- title/custom title/group/color/environment/current directory
- panel directories/titles/unread/pinned state
- latest submitted/conversation messages
- remote configuration/connection/daemon/ports/proxy state
- tmux flash/layout state

Relevant code:

- `Sources/Workspace.swift:2187`
- `Sources/Workspace.swift:2212`
- `Sources/Workspace.swift:2415`
- `Sources/Workspace.swift:2490`

`TabManager` has already moved some storage into `WorkspacesModel`, but it still has legacy Combine bridges and manual `objectWillChange.send()` paths.

Relevant code:

- `Sources/TabManager.swift:177`
- `Sources/TabManager.swift:209`
- `Sources/TabManager.swift:245`
- `Sources/TabManager.swift:257`

Impact:

- With many workspaces, unrelated state changes can invalidate broader SwiftUI surfaces than necessary.
- This is more likely to cause CPU churn than raw memory growth.

Recommended direction:

- Continue splitting `Workspace` into narrow state models.
- Push UI rows toward immutable snapshots only.
- Migrate remaining legacy Combine bridges when subscribers are moved.
- Avoid adding any new `@Published` state to `Workspace` unless it is truly workspace-wide and low-frequency.

### 2. Workspace Mount Policy Is Good, But Heavy Objects Can Still Live Offscreen

The mount plan is already conservative:

- `maxMountedWorkspaces = 1`
- `maxMountedWorkspacesDuringCycle = 2`

Relevant code:

- `Packages/macOS/CmuxFoundation/Sources/CmuxFoundation/Workspace/WorkspaceMountPlan.swift:7`
- `Sources/ContentView.swift:3225`

This reduces layer-tree and visible UI cost, but it does not by itself remove all heavyweight resources:

- terminal surfaces may still exist
- browser panels may still own WebViews
- background agent processes may still run
- observers and metadata state still exist

Recommended direction:

- Keep this mount policy.
- Add a stronger lifecycle policy for resources inside unmounted workspaces.
- Treat inactive workspaces as metadata-first, not UI/resource-first.

### 3. Terminal Renderer Reclamation Is Already Present

`RendererRealizationController` periodically releases offscreen terminal GPU renderer memory while keeping PTY/process state alive.

Relevant code:

- `Sources/App/RendererRealizationController.swift:8`
- `Packages/macOS/CmuxTerminal/Sources/CmuxTerminal/Surface/TerminalSurface+Renderer.swift:90`
- `Sources/GhosttyTerminalView.swift:9612`

Default settings:

- enabled: true
- idleSeconds: 30
- maxWarmRenderers: 12

Relevant code:

- `Sources/App/WorkspaceRuntimeSettings.swift:370`

Impact:

- This is a good existing RAM-saving mechanism.
- The warm renderer cap may be too generous for very large workspace counts.

Recommended direction:

- Add a "many workspace / low memory" preset:
  - `terminal.rendererRealization.idleSeconds`: 10
  - `terminal.rendererRealization.maxWarmRenderers`: 4 to 6
- Keep this default-on.
- Do not replace this with manual app-level display links or draw loops.

### 4. Agent Hibernation Is Powerful But Disabled By Default

Agent hibernation can free the runtime surface and keep the panel model alive for resume.

Relevant code:

- `Sources/App/AgentHibernationController.swift:64`
- `Sources/Panels/TerminalPanel.swift:645`
- `Packages/macOS/CmuxTerminal/Sources/CmuxTerminal/Surface/TerminalSurface+RuntimeLifecycle.swift:292`
- `Sources/Workspace.swift:4681`

Default settings:

- enabled: false
- idleSeconds: 5
- maxLiveTerminals: 12
- confirmationSeconds: 60

Relevant code:

- `Sources/App/WorkspaceRuntimeSettings.swift:255`

Impact:

- This is likely one of the biggest RAM/CPU reduction tools for many background agent terminals.
- Because it kills/suspends more than the renderer, it has more behavioral risk than renderer reclamation.

Recommended direction:

- Keep default off for compatibility if needed.
- Add an explicit "many workspace mode" or onboarding recommendation that enables it.
- Consider lowering `maxLiveTerminals` in the preset to 4 to 8.
- Add stronger tests around resume correctness before changing global defaults.

### 5. Browser Panels Are a Major RAM Target

`BrowserPanel` owns a `WKWebView` directly.

Relevant code:

- `Sources/Panels/BrowserPanel.swift:2681`
- `Sources/Panels/BrowserPanel.swift:2789`

Hidden WebView discard exists:

- enabled: true
- default hidden delay: 300 seconds

Relevant code:

- `Sources/Panels/BrowserHiddenWebViewDiscardPolicy.swift:3`
- `Sources/Panels/BrowserHiddenWebViewDiscardPolicy.swift:11`
- `Sources/Panels/BrowserHiddenWebViewDiscardManager.swift:101`
- `Sources/Panels/BrowserPanel.swift:3335`

Current discard creates a replacement WebView after detaching/stopping the old one.

Relevant code:

- `Sources/Panels/BrowserPanel.swift:3360`
- `Sources/Panels/BrowserPanel.swift:3369`

Impact:

- This helps, but a discarded browser panel may still retain a lightweight replacement WebView.
- With many browser panels, this can still add up.

Recommended direction:

- Reduce hidden discard delay in many-workspace mode from 300 seconds to 30-60 seconds.
- Evaluate a deeper discard state where no replacement WKWebView is created until the panel becomes visible or navigates again.
- Keep blockers for downloads, media playback/capture, popups, fullscreen, DevTools, and active loading.

### 6. Periodic Full-Tree Scans Need Reduction

Pane memory guardrail scans all tab managers, workspaces, and terminal panels to build descriptors.

Relevant code:

- `Sources/PaneMemoryGuardrail.swift:50`
- `Sources/PaneMemoryGuardrail.swift:105`
- `Sources/AppDelegate+PaneMemoryGuardrail.swift:4`

Agent hibernation also scans all workspaces/panels every cycle.

Relevant code:

- `Sources/App/AgentHibernationController.swift:145`
- `Sources/App/AgentHibernationController.swift:415`

Impact:

- Individual scans may be acceptable, but the cost scales with workspace/panel count.
- Descriptor collection and record construction touch main-actor workspace state.

Recommended direction:

- Create a central terminal/browser panel registry updated on panel create/delete.
- Let guardrail and hibernation iterate the registry instead of all workspaces.
- Track dirty/changed panels incrementally where possible.
- Add timing counters for each periodic pass.

### 7. Sidebar Rendering Should Not Be Rewritten First

The sidebar already contains important performance safeguards:

- `LazyVStack` is used carefully.
- Whole-content height measurement is explicitly avoided.
- Expensive row-frame preference collection is gated to drag collection.
- `TabItemView` is `Equatable` and avoids broad object subscriptions.

Relevant code:

- `Sources/ContentView.swift:11944`
- `Sources/ContentView.swift:11969`
- `Sources/ContentView.swift:11975`
- `Sources/ContentView.swift:13227`
- `Sources/ContentView.swift:13256`

Recommended direction:

- Preserve this structure.
- Do not pass observable stores into row subtrees.
- Do not remove `.equatable()`.
- Do not add `@EnvironmentObject`, `@ObservedObject`, or new bindings to `TabItemView` without updating equality and measuring.

## Recommended Execution Plan

### Phase 0: Add Measurement

Add debug/perf counters before behavior changes:

- workspace count
- mounted workspace count
- terminal panel count
- live terminal surface count
- realized terminal renderer count
- hibernated terminal count
- browser panel count
- live WKWebView count
- discarded browser count
- PaneMemoryGuardrail tick duration
- AgentHibernationController tick duration
- workspace switch latency
- typing latency / forceRefresh count

This should be visible from a debug command or log snapshot.

### Phase 1: Preset-Based Resource Policy

Add a "many workspace / low memory" preset:

- Renderer reclamation:
  - enabled: true
  - idleSeconds: 10
  - maxWarmRenderers: 4 to 6
- Browser memory saver:
  - enabled: true
  - hiddenWebViewDiscardDelaySeconds: 30 to 60
- Agent hibernation:
  - enabled: opt-in or preset-enabled
  - maxLiveTerminals: 4 to 8

This gives immediate wins without large refactors.

### Phase 2: Browser Deep Discard

Change hidden browser discard from "replace with blank WKWebView" to "metadata-only discarded panel" where possible.

Keep only:

- current URL
- restored history
- profile id
- zoom
- title/favicon metadata
- lifecycle state

Create a WKWebView lazily on visible/navigation.

### Phase 3: Registry-Based Periodic Work

Replace full workspace scans in:

- `PaneMemoryGuardrail`
- `AgentHibernationController`

with registry-based scans of active terminal/browser panels.

Expected result:

- Lower idle CPU with 100+ workspaces.
- Less main-actor traversal.
- More predictable scaling.

### Phase 4: Workspace State Decomposition

Continue splitting the large `Workspace` object:

- identity and session metadata
- sidebar presentation snapshot
- panel registry
- remote state
- ports/listening state
- notification/unread state
- tmux flash/layout state

Views should consume value snapshots and closures, not broad observable stores.

### Phase 5: Regression and Stress Tests

Create repeatable scenarios:

- 50 workspaces, 1 terminal each
- 100 workspaces, 1 terminal each
- 50 workspaces with 20 browser panels
- 30 live agent terminals
- rapid workspace cycling
- long idle session with browser pages hidden

Measure:

- idle CPU
- memory
- workspace switch p95
- typing latency p95
- browser restore latency
- hibernated agent resume success

## Things To Avoid

- Do not add an app-level display link or manual Ghostty draw loop.
- Do not remove `TabItemView` equality/snapshot optimization.
- Do not add observable stores below `LazyVStack` row boundaries.
- Do not measure full LazyVStack content height.
- Do not make all workspaces hot just to improve switching.
- Do not make browser discard ignore active download/media/DevTools/fullscreen blockers.

## Best Next Step

The highest-return next implementation is:

1. Add counters and a debug snapshot command.
2. Add a resource preset that tightens existing renderer/browser/hibernation settings.
3. Then implement browser metadata-only deep discard.

This approach uses existing mechanisms first, gives measurable improvement quickly, and avoids destabilizing the sidebar or terminal typing paths.
