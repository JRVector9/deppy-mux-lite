import Foundation
import Observation

/// `@Observable` view-model for the Mobile section's browser Web Connect row.
@MainActor
@Observable
final class MobileWebAccessSessionModel {
    /// The latest session the host app knows about.
    private(set) var current: MobileWebAccessSessionSnapshot?
    /// Whether a session creation request is in flight.
    private(set) var isStarting = false
    /// The last start failure, cleared on success.
    private(set) var lastError: MobileWebAccessStartResult?
    /// Whether the currently visible URL has been copied from this model.
    private(set) var didCopyCurrentURL = false

    @ObservationIgnored private let currentSession: () -> MobileWebAccessSessionSnapshot?
    @ObservationIgnored private let startSession: () async -> MobileWebAccessStartResult
    @ObservationIgnored private let copyURL: (String) -> Void

    /// Creates a model bound to the host's browser Web Connect actions.
    ///
    /// - Parameter hostActions: The host bridge that creates sessions and copies URLs.
    convenience init(hostActions: SettingsHostActions) {
        self.init(
            currentSession: { hostActions.currentMobileWebAccessSession() },
            startSession: { await hostActions.startMobileWebAccessSession() },
            copyURL: { hostActions.copyMobileWebAccessURL($0) }
        )
    }

    init(
        currentSession: @escaping () -> MobileWebAccessSessionSnapshot?,
        startSession: @escaping () async -> MobileWebAccessStartResult,
        copyURL: @escaping (String) -> Void
    ) {
        self.currentSession = currentSession
        self.startSession = startSession
        self.copyURL = copyURL
    }

    /// Refreshes the visible session from host state.
    func refreshCurrentSession() {
        current = currentSession()
    }

    /// Creates a new session through the host and stores the result.
    func start() async {
        guard !isStarting else { return }
        isStarting = true
        didCopyCurrentURL = false
        defer { isStarting = false }

        let result = await startSession()
        switch result {
        case let .started(snapshot):
            current = snapshot
            lastError = nil
        case .notSignedIn, .tailscaleUnavailable, .runtimeMissing, .webServerStartFailed, .webEndpointUnavailable, .failed:
            lastError = result
        }
    }

    /// Copies the current browser URL through the host app.
    func copyCurrentURL() {
        guard let current else { return }
        copyURL(current.publicURL)
        didCopyCurrentURL = true
    }
}
