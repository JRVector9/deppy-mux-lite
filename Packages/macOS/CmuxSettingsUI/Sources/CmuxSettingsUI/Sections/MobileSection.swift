import CmuxFoundation
import CmuxSettings
import SwiftUI

/// **Mobile** section — Mac-side controls for pairing and syncing with
/// cmux on iOS: the pairing-host toggle, the preferred listener port (with a
/// live bound-port indicator), an optional display-name override, and
/// connection/route diagnostics.
@MainActor
public struct MobileSection: View {
    @State private var iOSPairingHost: DefaultsValueModel<Bool>
    @State private var port: DefaultsValueModel<Int>
    @State private var displayName: DefaultsValueModel<String>
    @State private var webConnectServerEnabled: DefaultsValueModel<Bool>
    @State private var webConnectPort: DefaultsValueModel<Int>
    @State private var webConnectRuntimeStatus: MobileWebAccessRuntimeStatus
    @State private var webConnectRuntimeRequired: Bool
    @State private var status: MobilePairingStatusModel
    @State private var webAccess: MobileWebAccessSessionModel

    /// The user's in-progress port edit, or `nil` when the field should track
    /// the persisted value. Local so editing does not rebind the listener; only
    /// the **Apply** button does, after checking the port is free. `nil` lets the
    /// field reflect `port.current` once `DefaultsValueModel` has loaded the
    /// saved value (it seeds the catalog default first, then yields the real one).
    @State private var editedPort: Int?
    /// Result of the most recent Apply, shown inline. Cleared when the edit changes.
    @State private var applyResult: MobilePairingPortApplyResult?
    /// Guards against overlapping Apply taps while a probe is in flight.
    @State private var isApplying = false
    /// The user's in-progress Web Connect port edit, or `nil` when tracking the persisted value.
    @State private var editedWebConnectPort: Int?
    /// Result of the most recent Web Connect server start/stop/apply action.
    @State private var webConnectServerResult: MobileWebAccessServerControlResult?
    /// Guards against overlapping Web Connect server control requests.
    @State private var isApplyingWebConnectServer = false
    /// Result of the most recent Web Connect runtime installation request.
    @State private var webConnectRuntimeInstallResult: MobileWebAccessRuntimeInstallResult?
    /// Guards against overlapping Web Connect runtime installation requests.
    @State private var isInstallingWebConnectRuntime = false

    /// Host bridge: opens the pairing window, applies the port (availability
    /// checked), and supplies the live pairing status and default display name.
    private let hostActions: SettingsHostActions

    private static let columnWidth: CGFloat = 196

    /// Creates a Mobile settings section bound to the supplied settings stores.
    ///
    /// - Parameters:
    ///   - defaultsStore: UserDefaults-backed store for the pairing settings.
    ///   - catalog: The settings catalog defining the mobile keys.
    ///   - hostActions: Host bridge for the pairing window, port apply, and the
    ///     live pairing status the package can't produce itself.
    public init(
        defaultsStore: UserDefaultsSettingsStore,
        catalog: SettingCatalog,
        hostActions: SettingsHostActions
    ) {
        _iOSPairingHost = State(initialValue: DefaultsValueModel(store: defaultsStore, key: catalog.mobile.iOSPairingHost))
        _port = State(initialValue: DefaultsValueModel(store: defaultsStore, key: catalog.mobile.iOSPairingPort))
        _displayName = State(initialValue: DefaultsValueModel(store: defaultsStore, key: catalog.mobile.iOSPairingDisplayName))
        _webConnectServerEnabled = State(initialValue: DefaultsValueModel(store: defaultsStore, key: catalog.mobile.webConnectServerEnabled))
        _webConnectPort = State(initialValue: DefaultsValueModel(store: defaultsStore, key: catalog.mobile.webConnectPort))
        _webConnectRuntimeStatus = State(initialValue: hostActions.mobileWebAccessRuntimeStatus())
        _webConnectRuntimeRequired = State(initialValue: hostActions.mobileWebAccessRuntimeRequired())
        _status = State(initialValue: MobilePairingStatusModel(hostActions: hostActions))
        _webAccess = State(initialValue: MobileWebAccessSessionModel(hostActions: hostActions))
        self.hostActions = hostActions
    }

    /// The value shown in the field: the user's edit if any, otherwise the
    /// persisted port (which updates once it loads).
    private var draftPort: Int {
        editedPort ?? port.current
    }

    /// The port currently in effect: the bound port when running, otherwise the
    /// persisted preference. Apply is offered only when the draft differs from it.
    private var effectivePort: Int {
        status.current?.boundPort ?? port.current
    }

    private var isDraftValid: Bool {
        (1...65535).contains(draftPort)
    }

    private var draftWebConnectPort: Int {
        editedWebConnectPort ?? webConnectPort.current
    }

    private var isDraftWebConnectPortValid: Bool {
        (1...65535).contains(draftWebConnectPort)
    }

    private var isWebConnectRuntimeAvailable: Bool {
        guard webConnectRuntimeRequired else {
            return true
        }
        switch webConnectRuntimeStatus {
        case .installed, .bundled, .external:
            return true
        case .missing:
            return false
        }
    }

    private var canRemoveWebConnectRuntime: Bool {
        if case .installed = webConnectRuntimeStatus {
            return true
        }
        return false
    }

    /// The Mobile settings section content.
    public var body: some View {
        Group {
            SettingsSectionHeader(String(localized: "settings.section.mobile", defaultValue: "Mobile"), section: .mobile)
            SettingsCard {
                pairDeviceRow
                SettingsCardDivider()
                webAccessRow
                webAccessOptionsRow
                if webConnectRuntimeRequired && (webConnectRuntimeInstallResult != nil || !isWebConnectRuntimeAvailable) {
                    webConnectRuntimeStatusView
                }
                if webConnectServerResult != nil {
                    webAccessServerStatusView
                }
                if webAccess.current != nil || webAccess.lastError != nil {
                    webAccessStatusView
                }
                SettingsCardDivider()
                iOSPairingHostRow
                SettingsCardDivider()
                portRow
                boundPortStatusRow
                SettingsCardDivider()
                displayNameRow
                if iOSPairingHost.current {
                    SettingsCardDivider()
                    diagnostics
                }
                SettingsCardNote(String(
                    localized: "settings.mobile.port.note",
                    defaultValue: "Click Apply to change the port. deppy-mux checks the port is free first: if it's in use, the current listener keeps running untouched; if it's free, it rebinds and connected devices reconnect on the new port."
                ))
            }
        }
        .task { startObservingSettings() }
    }

    private func startObservingSettings() {
        let models: [any SettingObservationStarting] = [
            iOSPairingHost,
            port,
            displayName,
            webConnectServerEnabled,
            webConnectPort,
            status,
        ]
        models.forEach { $0.startObserving() }
        refreshWebConnectRuntimeStatus()
        webAccess.refreshCurrentSession()
    }

    @ViewBuilder
    private var pairDeviceRow: some View {
        SettingsCardRow(
            configurationReview: .action,
            searchAnchorID: "setting:mobile:pairDevice",
            String(localized: "settings.mobile.pairDevice", defaultValue: "Pair a Device"),
            subtitle: String(localized: "settings.mobile.pairDevice.subtitle", defaultValue: "Show a QR code to pair your iPhone or iPad with this Mac.")
        ) {
            Button(String(localized: "settings.mobile.pairDevice.button", defaultValue: "Pair…")) {
                hostActions.openMobilePairingWindow()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .accessibilityIdentifier("SettingsMobilePairDeviceButton")
        }
    }

    @ViewBuilder
    private var webAccessRow: some View {
        SettingsCardRow(
            configurationReview: .action,
            searchAnchorID: "setting:mobile:webAccess",
            String(localized: "settings.mobile.webAccess", defaultValue: "Web Connect"),
            subtitle: String(localized: "settings.mobile.webAccess.subtitle", defaultValue: "Create a private Web Connect link for connecting to this Mac's deppy-mux terminal from another device.")
        ) {
            HStack(spacing: 8) {
                if webConnectRuntimeRequired {
                    webConnectRuntimeActionButton
                }

                Button(webAccess.current == nil
                    ? String(localized: "settings.mobile.webAccess.create", defaultValue: "Create Link")
                    : String(localized: "settings.mobile.webAccess.refresh", defaultValue: "Refresh Link")
                ) {
                    Task { await webAccess.start() }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(webAccess.isStarting || isInstallingWebConnectRuntime || !isWebConnectRuntimeAvailable)
                .accessibilityIdentifier("SettingsMobileWebAccessCreateButton")
            }
        }
    }

    @ViewBuilder
    private var webConnectRuntimeActionButton: some View {
        if isWebConnectRuntimeAvailable {
            Button(String(localized: "settings.mobile.webConnect.runtime.remove", defaultValue: "Remove Runtime")) {
                removeWebConnectRuntime()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(!canRemoveWebConnectRuntime || isApplyingWebConnectServer || isInstallingWebConnectRuntime)
            .accessibilityIdentifier("SettingsMobileWebConnectRuntimeRemoveButton")
        } else {
            Button(isInstallingWebConnectRuntime
                ? String(localized: "settings.mobile.webConnect.runtime.installing", defaultValue: "Installing…")
                : String(localized: "settings.mobile.webConnect.runtime.install", defaultValue: "Install Runtime")
            ) {
                installWebConnectRuntime()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(isInstallingWebConnectRuntime)
            .accessibilityIdentifier("SettingsMobileWebConnectRuntimeInstallButton")
        }
    }

    @ViewBuilder
    private var webAccessOptionsRow: some View {
        SettingsCardRow(
            configurationReview: .settingsOnly,
            searchAnchorID: "setting:mobile:webConnectServer",
            String(localized: "settings.mobile.webConnect.server", defaultValue: "Web Connect Server"),
            subtitle: String(localized: "settings.mobile.webConnect.server.subtitle", defaultValue: "Run the local Web Connect server. If the port is busy, choose another port here.")
        ) {
            HStack(spacing: 8) {
                Toggle("", isOn: Binding(
                    get: { webConnectServerEnabled.current },
                    set: { enabled in
                        Task { await applyWebConnectServer(enabled: enabled, port: draftWebConnectPort) }
                    }
                ))
                .labelsHidden()
                .controlSize(.small)
                .disabled(
                    isApplyingWebConnectServer ||
                    (!webConnectServerEnabled.current && (!isDraftWebConnectPortValid || !isWebConnectRuntimeAvailable))
                )
                .accessibilityIdentifier("SettingsMobileWebConnectServerToggle")

                TextField(
                    "",
                    value: Binding(get: { draftWebConnectPort }, set: { editedWebConnectPort = $0 }),
                    format: .number.grouping(.never)
                )
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.trailing)
                .frame(width: 90)
                .onChange(of: editedWebConnectPort) { webConnectServerResult = nil }
                .onSubmit { applyDraftWebConnectPort() }
                .accessibilityIdentifier("SettingsMobileWebConnectPortField")

                Button(String(localized: "settings.mobile.webConnect.port.apply", defaultValue: "Apply")) {
                    applyDraftWebConnectPort()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(
                    isApplyingWebConnectServer ||
                    !isWebConnectRuntimeAvailable ||
                    !isDraftWebConnectPortValid ||
                    draftWebConnectPort == webConnectPort.current
                )
                .accessibilityIdentifier("SettingsMobileWebConnectPortApplyButton")
            }
        }
    }

    @ViewBuilder
    private var webConnectRuntimeStatusView: some View {
        if let message = webConnectRuntimeStatusMessage {
            SettingsCardNote(message)
        }
    }

    private var webConnectRuntimeStatusMessage: String? {
        switch webConnectRuntimeInstallResult {
        case .installed:
            return String(
                localized: "settings.mobile.webConnect.runtime.installed",
                defaultValue: "Web Connect Runtime is installed."
            )
        case .missingSource:
            return String(
                localized: "settings.mobile.webConnect.runtime.missingSource",
                defaultValue: "No Web Connect Runtime package source is configured. Download the runtime package or run the install script, then try again."
            )
        case .failed:
            return String(
                localized: "settings.mobile.webConnect.runtime.installFailed",
                defaultValue: "Could not install Web Connect Runtime. Check your connection and try again."
            )
        case .removeFailed:
            return String(
                localized: "settings.mobile.webConnect.runtime.removeFailed",
                defaultValue: "Could not remove Web Connect Runtime. Stop the server and try again."
            )
        case nil:
            if !isWebConnectRuntimeAvailable {
                return String(
                    localized: "settings.mobile.webConnect.runtime.missing",
                    defaultValue: "Web Connect Runtime is not installed. Install it to create browser links from this app."
                )
            }
            return nil
        }
    }

    @ViewBuilder
    private var webAccessServerStatusView: some View {
        if let message = webAccessServerStatusMessage {
            SettingsCardNote(message)
        }
    }

    private var webAccessServerStatusMessage: String? {
        switch webConnectServerResult {
        case .running(let port):
            return String(
                localized: "settings.mobile.webConnect.server.running",
                defaultValue: "Web Connect server is running on port \(port)."
            )
        case .stopped:
            return String(
                localized: "settings.mobile.webConnect.server.stopped",
                defaultValue: "Web Connect server is stopped."
            )
        case .invalidPort:
            return String(
                localized: "settings.mobile.webConnect.server.invalidPort",
                defaultValue: "Choose a port between 1 and 65535."
            )
        case .portInUse(let port):
            return String(
                localized: "settings.mobile.webConnect.server.portInUse",
                defaultValue: "Port \(port) is already in use. Choose another port, then apply it."
            )
        case .runtimeMissing:
            return String(
                localized: "settings.mobile.webConnect.server.runtimeMissing",
                defaultValue: "Install Web Connect Runtime before starting the local server."
            )
        case .failed(let port):
            return String(
                localized: "settings.mobile.webConnect.server.failed",
                defaultValue: "Could not start the Web Connect server on port \(port)."
            )
        case nil:
            return nil
        }
    }

    @ViewBuilder
    private var webAccessStatusView: some View {
        if let session = webAccess.current {
            VStack(alignment: .leading, spacing: 8) {
                Text(session.publicURL)
                    .cmuxFont(.caption, design: .monospaced)
                    .lineLimit(2)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("SettingsMobileWebAccessURL")
                HStack(spacing: 8) {
                    Label(
                        String(
                            localized: "settings.mobile.webAccess.activeUntil",
                            defaultValue: "Active until \(session.expiresAt.formatted(date: .omitted, time: .shortened))"
                        ),
                        systemImage: "checkmark.circle.fill"
                    )
                    .foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Button(webAccess.didCopyCurrentURL
                        ? String(localized: "settings.mobile.webAccess.copied", defaultValue: "Copied")
                        : String(localized: "settings.mobile.webAccess.copy", defaultValue: "Copy")
                    ) {
                        webAccess.copyCurrentURL()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityIdentifier("SettingsMobileWebAccessCopyButton")
                }
            }
            .cmuxFont(.caption)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
        } else if webAccess.lastError == .notSignedIn {
            SettingsCardNote(String(
                localized: "settings.mobile.webAccess.notSignedIn",
                defaultValue: "Sign in to deppy-mux before creating a Web Connect link."
            ))
        } else if webAccess.lastError == .tailscaleUnavailable {
            SettingsCardNote(String(
                localized: "settings.mobile.webAccess.tailscaleUnavailable",
                defaultValue: "Tailscale is required for Web Connect. Install or turn on Tailscale on this Mac, then create the link again."
            ))
        } else if webAccess.lastError == .runtimeMissing {
            SettingsCardNote(String(
                localized: "settings.mobile.webAccess.runtimeMissing",
                defaultValue: "Install Web Connect Runtime before creating a browser link."
            ))
        } else if webAccess.lastError == .webServerStartFailed {
            SettingsCardNote(String(
                localized: "settings.mobile.webAccess.webServerStartFailed",
                defaultValue: "Could not start the Web Connect server on the configured port. Free the port or set a different local Web Connect URL, then create the link again."
            ))
        } else if webAccess.lastError == .webEndpointUnavailable {
            SettingsCardNote(String(
                localized: "settings.mobile.webAccess.webEndpointUnavailable",
                defaultValue: "Could not reach a compatible Web Connect server. Check the deppy-mux web setup, then create the link again."
            ))
        } else if webAccess.lastError == .failed {
            SettingsCardNote(String(
                localized: "settings.mobile.webAccess.failed",
                defaultValue: "Could not create a Web Connect link. Check your connection and try again."
            ))
        }
    }

    @ViewBuilder
    private var iOSPairingHostRow: some View {
        SettingsCardRow(
            configurationReview: .settingsOnly,
            searchAnchorID: "setting:mobile:iOSPairingHost",
            String(localized: "settings.mobile.iOSPairingHost", defaultValue: "iOS Pairing"),
            subtitle: iOSPairingHost.current
                ? String(localized: "settings.mobile.iOSPairingHost.subtitleOn", defaultValue: "Allows the iOS app to discover and sync with this Mac on your local network.")
                : String(localized: "settings.mobile.iOSPairingHost.subtitleOff", defaultValue: "Keeps the Mac-side iOS pairing listener off until you enable it here.")
        ) {
            Toggle("", isOn: Binding(get: { iOSPairingHost.current }, set: { iOSPairingHost.set($0) }))
                .labelsHidden()
                .controlSize(.small)
                .accessibilityIdentifier("SettingsMobileIOSPairingHostToggle")
        }
    }

    @ViewBuilder
    private var portRow: some View {
        SettingsCardRow(
            configurationReview: .settingsOnly,
            searchAnchorID: "setting:mobile:iOSPairingPort",
            String(localized: "settings.mobile.port", defaultValue: "Pairing Port"),
            subtitle: String(localized: "settings.mobile.port.subtitle", defaultValue: "Preferred TCP port for the iOS pairing listener (1–65535).")
        ) {
            HStack(spacing: 8) {
                TextField(
                    "",
                    value: Binding(get: { draftPort }, set: { editedPort = $0 }),
                    format: .number.grouping(.never)
                )
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.trailing)
                .frame(width: 90)
                .onChange(of: editedPort) { applyResult = nil }
                .onSubmit { applyDraftPort() }
                .accessibilityIdentifier("SettingsMobilePairingPortField")

                Button(String(localized: "settings.mobile.port.apply", defaultValue: "Apply")) {
                    applyDraftPort()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(isApplying || !isDraftValid || draftPort == effectivePort)
                .accessibilityIdentifier("SettingsMobilePairingPortApplyButton")
            }
        }
    }

    private func applyDraftPort() {
        let requested = draftPort
        guard !isApplying, isDraftValid, requested != effectivePort else { return }
        isApplying = true
        Task {
            let result = await hostActions.applyMobilePairingPort(requested)
            applyResult = result
            // Keep the field on the attempted value (with its warning) when the
            // port is in use; otherwise let it track the persisted value again.
            if case .portInUse = result {} else { editedPort = nil }
            isApplying = false
        }
    }

    private func applyDraftWebConnectPort() {
        let requested = draftWebConnectPort
        guard !isApplyingWebConnectServer, isDraftWebConnectPortValid else { return }
        if requested == webConnectPort.current {
            Task { await applyWebConnectServer(enabled: webConnectServerEnabled.current, port: requested) }
            return
        }
        if webConnectServerEnabled.current {
            Task {
                let result = await controlWebConnectServer(enabled: true, port: requested)
                if case .running = result {
                    webConnectPort.set(requested)
                    editedWebConnectPort = nil
                    webConnectServerEnabled.set(true)
                } else if case .portInUse = result {
                    webConnectServerEnabled.set(true)
                } else {
                    webConnectServerEnabled.set(false)
                }
            }
        } else {
            webConnectPort.set(requested)
            editedWebConnectPort = nil
            webConnectServerResult = .stopped
        }
    }

    private func applyWebConnectServer(enabled: Bool, port: Int) async {
        let result = await controlWebConnectServer(enabled: enabled, port: port)
        switch result {
        case .running(let port):
            webConnectPort.set(port)
            editedWebConnectPort = nil
            webConnectServerEnabled.set(true)
        case .stopped:
            webConnectServerEnabled.set(false)
        case .portInUse where webConnectServerEnabled.current:
            webConnectServerEnabled.set(true)
        case .invalidPort, .portInUse, .runtimeMissing, .failed:
            webConnectServerEnabled.set(false)
        }
    }

    private func refreshWebConnectRuntimeStatus() {
        webConnectRuntimeRequired = hostActions.mobileWebAccessRuntimeRequired()
        webConnectRuntimeStatus = hostActions.mobileWebAccessRuntimeStatus()
    }

    private func installWebConnectRuntime() {
        guard !isInstallingWebConnectRuntime else { return }
        isInstallingWebConnectRuntime = true
        webConnectRuntimeInstallResult = nil
        Task {
            let result = await hostActions.installMobileWebAccessRuntime()
            webConnectRuntimeInstallResult = result
            refreshWebConnectRuntimeStatus()
            isInstallingWebConnectRuntime = false
        }
    }

    private func removeWebConnectRuntime() {
        guard !isInstallingWebConnectRuntime, canRemoveWebConnectRuntime else { return }
        isInstallingWebConnectRuntime = true
        Task {
            _ = await hostActions.setMobileWebAccessServerEnabled(false, port: draftWebConnectPort)
            webConnectServerEnabled.set(false)
            webConnectServerResult = .stopped
            let removed = hostActions.uninstallMobileWebAccessRuntime()
            webConnectRuntimeInstallResult = removed ? nil : .removeFailed
            refreshWebConnectRuntimeStatus()
            isInstallingWebConnectRuntime = false
        }
    }

    private func controlWebConnectServer(
        enabled: Bool,
        port: Int
    ) async -> MobileWebAccessServerControlResult {
        guard !isApplyingWebConnectServer else {
            return webConnectServerResult ?? (enabled ? .failed(port: port) : .stopped)
        }
        isApplyingWebConnectServer = true
        defer { isApplyingWebConnectServer = false }
        let result = await hostActions.setMobileWebAccessServerEnabled(enabled, port: port)
        webConnectServerResult = result
        return result
    }

    /// Status under the port row: an out-of-range hint, the most recent Apply
    /// result for the cases the live indicator can't convey, or the live
    /// bound-port indicator otherwise.
    @ViewBuilder
    private var boundPortStatusRow: some View {
        if !isDraftValid {
            statusCaption {
                Label(
                    String(localized: "settings.mobile.port.status.invalid", defaultValue: "Port must be between 1 and 65535."),
                    systemImage: "exclamationmark.triangle.fill"
                )
                .foregroundStyle(.orange)
            }
        } else if case let .portInUse(requested) = applyResult, iOSPairingHost.current {
            // Only while pairing is on — toggling off stops the listener, which
            // would make "still listening on …" wrong.
            statusCaption {
                Label(
                    String(
                        localized: "settings.mobile.port.apply.inUse",
                        defaultValue: "Port \(requested) is in use. Still listening on \(status.current?.boundPort ?? requested)."
                    ),
                    systemImage: "exclamationmark.triangle.fill"
                )
                .foregroundStyle(.orange)
            }
        } else if case let .savedForLater(saved) = applyResult, !iOSPairingHost.current {
            // Only while pairing is off — once it's on, the live indicator shows
            // the actual listening port instead of this saved-for-later note.
            statusCaption {
                Label(
                    String(localized: "settings.mobile.port.apply.saved", defaultValue: "Saved. Will use port \(saved) when iOS Pairing is on."),
                    systemImage: "checkmark.circle.fill"
                )
                .foregroundStyle(.secondary)
            }
        } else if iOSPairingHost.current, let snapshot = status.current {
            statusCaption { boundPortStatusText(snapshot) }
        }
    }

    @ViewBuilder
    private func statusCaption(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .cmuxFont(.caption)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
    }

    @ViewBuilder
    private func boundPortStatusText(_ snapshot: MobilePairingStatusSnapshot) -> some View {
        if !snapshot.isRunning {
            Text(String(localized: "settings.mobile.port.status.starting", defaultValue: "Starting the pairing listener…"))
                .foregroundStyle(.secondary)
        } else if snapshot.usesEphemeralFallback, let bound = snapshot.boundPort {
            Label(
                String(
                    localized: "settings.mobile.port.status.fallback",
                    defaultValue: "Port \(snapshot.configuredPort) is in use. Listening on \(bound) instead."
                ),
                systemImage: "exclamationmark.triangle.fill"
            )
            .foregroundStyle(.orange)
        } else if let bound = snapshot.boundPort {
            Label(
                String(localized: "settings.mobile.port.status.ok", defaultValue: "Listening on port \(bound)."),
                systemImage: "checkmark.circle.fill"
            )
            .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var displayNameRow: some View {
        // Show this Mac's system name as the placeholder so the user sees the
        // actual default that applies when the override is empty.
        let resolvedName = hostActions.mobilePairingDefaultDisplayName()
        let placeholder = resolvedName.isEmpty
            ? String(localized: "settings.mobile.displayName.placeholder", defaultValue: "This Mac's name")
            : resolvedName
        SettingsCardRow(
            configurationReview: .settingsOnly,
            searchAnchorID: "setting:mobile:iOSPairingDisplayName",
            String(localized: "settings.mobile.displayName", defaultValue: "Display Name"),
            subtitle: String(localized: "settings.mobile.displayName.subtitle", defaultValue: "Name the iOS app shows for this Mac when pairing. Empty uses this Mac's name."),
            controlWidth: Self.columnWidth
        ) {
            TextField(
                placeholder,
                text: Binding(get: { displayName.current }, set: { displayName.set($0) })
            )
            .textFieldStyle(.roundedBorder)
            .accessibilityIdentifier("SettingsMobilePairingDisplayNameField")
        }
    }

    /// Read-only connection count and the reachable routes the phone can use.
    @ViewBuilder
    private var diagnostics: some View {
        let snapshot = status.current
        SettingsCardRow(
            configurationReview: .settingsOnly,
            searchAnchorID: "setting:mobile:connections",
            String(localized: "settings.mobile.connections", defaultValue: "Connected Devices"),
            subtitle: String(localized: "settings.mobile.connections.subtitle", defaultValue: "iOS devices currently attached to this Mac.")
        ) {
            Text("\(snapshot?.activeConnectionCount ?? 0)")
                .cmuxFont(size: 13, weight: .medium)
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        routesView(snapshot)
    }

    @ViewBuilder
    private func routesView(_ snapshot: MobilePairingStatusSnapshot?) -> some View {
        if let snapshot, snapshot.isRunning {
            if snapshot.routes.isEmpty {
                SettingsCardNote(String(
                    localized: "settings.mobile.routes.empty",
                    defaultValue: "No reachable addresses yet. Pairing over the network needs Tailscale running on this Mac."
                ))
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text(String(localized: "settings.mobile.routes.title", defaultValue: "Reachable at"))
                        .cmuxFont(.caption)
                        .foregroundStyle(.secondary)
                    ForEach(snapshot.routes) { route in
                        HStack(spacing: 8) {
                            Text(route.kindLabel)
                                .cmuxFont(.caption)
                                .foregroundStyle(.secondary)
                            Spacer(minLength: 8)
                            Text(route.endpoint)
                                .cmuxFont(.caption, design: .monospaced)
                                .foregroundStyle(.primary)
                                .textSelection(.enabled)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.bottom, 8)
            }
        }
    }
}
