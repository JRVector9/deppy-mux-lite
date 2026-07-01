import CmuxAuthRuntime
import CmuxSettings
import CmuxSettingsUI
import Foundation

/// Creates and keeps alive browser Web Connect sessions for this Mac.
@MainActor
final class MobileWebAccessClient {
    static let shared = MobileWebAccessClient()

    private let session: URLSession = .shared
    private let webConnectServer = WebConnectServerController()
    private var auth: AuthCoordinator?
    private var current: MobileWebAccessSessionSnapshot?
    private var currentHostToken: String?
    private var heartbeatTask: Task<Void, Never>?
    private var relayTask: Task<Void, Never>?
    private var didRestorePersistedServer = false

    private init() {
        webConnectServer.onUnexpectedTermination = { [weak self] in
            self?.handleWebConnectServerTerminated()
        }
    }

    /// Injects auth at the app composition root.
    func configure(auth: AuthCoordinator) {
        self.auth = auth
        restorePersistedServerIfNeeded()
    }

    /// Returns the current in-process session, if any.
    func currentSession() -> MobileWebAccessSessionSnapshot? {
        clearExpiredSessionIfNeeded()
        return current
    }

    /// Creates a session and starts the heartbeat loop that marks this Mac online.
    func startSession() async -> MobileWebAccessStartResult {
        let baseURL = Self.webConnectBaseURL()
        let requiresLocalServer = WebConnectServerController.canAutoStart(baseURL: baseURL)
        guard let url = Self.apiURL(path: "/api/mobile/web-access/sessions", baseURL: baseURL) else {
            return .failed
        }
        let publicOrigin: URL?
        if requiresLocalServer {
            guard let tailscaleOrigin = Self.tailscalePublicOrigin(baseURL: baseURL) else {
                return .tailscaleUnavailable
            }
            publicOrigin = tailscaleOrigin
        } else {
            publicOrigin = nil
        }
        let serverResult = await webConnectServer.ensureStarted(baseURL: baseURL)
        if case .runtimeMissing = serverResult {
            if requiresLocalServer {
                Self.setWebConnectServerEnabled(false)
            }
            return .runtimeMissing
        }
        guard case .running = serverResult else {
            if requiresLocalServer {
                Self.setWebConnectServerEnabled(false)
            }
            return .webServerStartFailed
        }
        let tokens = requiresLocalServer ? nil : try? await auth?.currentTokens()
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        if let tokens {
            request.setValue("Bearer \(tokens.accessToken)", forHTTPHeaderField: "Authorization")
            request.setValue(tokens.refreshToken, forHTTPHeaderField: "X-Stack-Refresh-Token")
        }
        if !requiresLocalServer, let teamID = auth?.resolvedTeamID, !teamID.isEmpty {
            request.setValue(teamID, forHTTPHeaderField: "X-Cmux-Team-Id")
        }
        if requiresLocalServer {
            request.setValue(
                WebConnectServerController.localControlToken,
                forHTTPHeaderField: WebConnectServerController.localControlTokenHeader
            )
        }
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = Self.createSessionBody(publicOrigin: publicOrigin)

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .failed }
            if http.statusCode == 401 { return requiresLocalServer ? .webEndpointUnavailable : .notSignedIn }
            if Self.isWebConnectEndpointUnavailableStatus(http.statusCode) { return .webEndpointUnavailable }
            guard (200...299).contains(http.statusCode) else { return .failed }
            guard let parsed = Self.parseCreateResponse(data) else { return .failed }

            current = parsed.snapshot
            currentHostToken = parsed.hostToken
            await sendHeartbeat(slug: parsed.snapshot.slug, hostToken: parsed.hostToken)
            startHeartbeatLoop(slug: parsed.snapshot.slug, hostToken: parsed.hostToken, expiresAt: parsed.snapshot.expiresAt)
            startRelayLoop(slug: parsed.snapshot.slug, hostToken: parsed.hostToken, expiresAt: parsed.snapshot.expiresAt)
            return .started(current ?? parsed.snapshot)
        } catch {
            if Self.isWebConnectEndpointUnavailableError(error) {
                return .webEndpointUnavailable
            }
            return .failed
        }
    }

    private func startRelayLoop(slug: String, hostToken: String, expiresAt: Date) {
        relayTask?.cancel()
        relayTask = Task { [weak self] in
            let clock = ContinuousClock()
            var emptyPollCount = 0
            while !Task.isCancelled {
                guard let self else { return }
                guard Date() < self.currentExpirationDate(slug: slug, fallback: expiresAt) else {
                    self.clearSession(slug: slug)
                    return
                }
                let didHandleRequests = await self.pollRelay(slug: slug, hostToken: hostToken)
                emptyPollCount = didHandleRequests ? 0 : min(emptyPollCount + 1, 7)
                let delayMs = didHandleRequests ? 100 : min(2_000, 250 + (emptyPollCount * 250))
                guard (try? await clock.sleep(for: .milliseconds(Int64(delayMs)))) != nil else { return }
            }
        }
    }

    private func startHeartbeatLoop(slug: String, hostToken: String, expiresAt: Date) {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            let clock = ContinuousClock()
            while !Task.isCancelled {
                guard let self else { return }
                guard Date() < self.currentExpirationDate(slug: slug, fallback: expiresAt) else {
                    self.clearSession(slug: slug)
                    return
                }
                // Bounded, cancellable, intended cadence delay for server liveness.
                guard (try? await clock.sleep(for: .seconds(15))) != nil else { return }
                await self.sendHeartbeat(slug: slug, hostToken: hostToken)
            }
        }
    }

    private func clearExpiredSessionIfNeeded() {
        guard let existing = current, Date() >= existing.expiresAt else { return }
        clearSession(slug: existing.slug)
    }

    private func clearSession(slug: String) {
        guard current?.slug == slug else { return }
        clearCurrentSession()
    }

    private func currentExpirationDate(slug: String, fallback: Date) -> Date {
        current?.slug == slug ? current?.expiresAt ?? fallback : fallback
    }

    private func clearCurrentSession() {
        current = nil
        currentHostToken = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
        relayTask?.cancel()
        relayTask = nil
        if !Self.isWebConnectServerEnabled() {
            webConnectServer.stop()
        }
    }

    private func handleWebConnectServerTerminated() {
        Self.setWebConnectServerEnabled(false)
        clearCurrentSession()
    }

    /// Starts or stops the local Web Connect server using a user-selected port.
    func setServerEnabled(_ enabled: Bool, port: Int) async -> MobileWebAccessServerControlResult {
        let baseURL = Self.webConnectBaseURL(port: port)
        if enabled, WebConnectServerController.canAutoStart(baseURL: baseURL), Self.tailscalePublicOrigin(baseURL: baseURL) == nil {
            Self.setWebConnectServerEnabled(false)
            return .tailscaleUnavailable
        }
        let result = await webConnectServer.setEnabled(enabled, baseURL: baseURL)
        switch result {
        case .running:
            Self.setWebConnectPort(port)
            Self.setWebConnectServerEnabled(true)
        case .stopped:
            Self.setWebConnectServerEnabled(false)
            clearCurrentSession()
        case .invalidPort, .portInUse, .tailscaleUnavailable, .runtimeMissing, .failed:
            break
        }
        return result
    }

    private func restorePersistedServerIfNeeded() {
        guard !didRestorePersistedServer else { return }
        didRestorePersistedServer = true
        guard Self.isWebConnectServerEnabled() else { return }
        let port = Self.webConnectPort()
        Task { [weak self] in
            _ = await self?.setServerEnabled(true, port: port)
        }
    }

    private func sendHeartbeat(slug: String, hostToken: String) async {
        guard let url = Self.apiURL(path: "/api/mobile/web-access/sessions/\(slug)") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue(hostToken, forHTTPHeaderField: "X-Cmux-Web-Access-Host-Token")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return }
            guard let hostSeenAt = Self.parseHeartbeatResponse(data) else { return }
            guard let existing = current, existing.slug == slug else { return }
            current = MobileWebAccessSessionSnapshot(
                slug: existing.slug,
                publicURL: existing.publicURL,
                expiresAt: existing.expiresAt,
                hostSeenAt: hostSeenAt
            )
        } catch {
            return
        }
    }

    private func pollRelay(slug: String, hostToken: String) async -> Bool {
        guard let url = Self.apiURL(path: "/api/mobile/web-access/sessions/\(slug)/host-rpc") else { return false }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        request.setValue(hostToken, forHTTPHeaderField: "X-Cmux-Web-Access-Host-Token")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return false }
            let relayRequests = Self.parseRelayRequests(data)
            for relayRequest in relayRequests {
                await handleRelayRequest(relayRequest, slug: slug, hostToken: hostToken)
            }
            return !relayRequests.isEmpty
        } catch {
            return false
        }
    }

    private func handleRelayRequest(_ relayRequest: RelayRPCRequest, slug: String, hostToken: String) async {
        if relayRequest.method == "web_access.session.refresh" {
            let result = await refreshSessionForRelay(slug: slug, hostToken: hostToken)
            await completeRelayRequest(id: relayRequest.id, result: result, slug: slug, hostToken: hostToken)
            return
        }
        let rpcRequest = MobileHostRPCRequest(
            id: relayRequest.id,
            method: relayRequest.method,
            params: relayRequest.params,
            auth: nil
        )
        let result = await TerminalController.shared.mobileHostHandleRPC(rpcRequest)
        await completeRelayRequest(id: relayRequest.id, result: result, slug: slug, hostToken: hostToken)
    }

    private func refreshSessionForRelay(slug: String, hostToken: String) async -> MobileHostRPCResult {
        guard let url = Self.apiURL(path: "/api/mobile/web-access/sessions/\(slug)") else {
            return .failure(MobileHostRPCError(code: "invalid_endpoint", message: "Missing Web Connect session endpoint"))
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue(hostToken, forHTTPHeaderField: "X-Cmux-Web-Access-Host-Token")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["action": "refresh"])

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return .failure(MobileHostRPCError(code: "refresh_failed", message: "Web Connect session refresh was rejected"))
            }
            guard let expiresAtRaw = Self.parseRefreshExpiresAt(data),
                  let expiresAt = Self.parseDate(expiresAtRaw)
            else {
                return .failure(MobileHostRPCError(code: "invalid_response", message: "Web Connect session refresh response was invalid"))
            }
            if let existing = current, existing.slug == slug {
                current = MobileWebAccessSessionSnapshot(
                    slug: existing.slug,
                    publicURL: existing.publicURL,
                    expiresAt: expiresAt,
                    hostSeenAt: Date()
                )
            }
            return .ok(["expiresAt": expiresAtRaw])
        } catch {
            return .failure(MobileHostRPCError(code: "refresh_failed", message: "Could not refresh Web Connect session"))
        }
    }

    private func completeRelayRequest(
        id: String,
        result: MobileHostRPCResult,
        slug: String,
        hostToken: String
    ) async {
        guard let url = Self.apiURL(path: "/api/mobile/web-access/sessions/\(slug)/host-rpc") else { return }
        guard let body = Self.relayCompletionBody(requestID: id, result: result) else { return }

        let clock = ContinuousClock()
        for attempt in 0..<3 {
            if await postRelayCompletion(url: url, body: body, hostToken: hostToken) {
                return
            }
            guard attempt < 2 else { return }
            let delay: Duration = attempt == 0 ? .milliseconds(250) : .seconds(1)
            // Bounded, cancellable retry backoff for recording already-executed Web Connect RPC completion.
            guard (try? await clock.sleep(for: delay)) != nil else { return }
        }
    }

    private func postRelayCompletion(url: URL, body: Data, hostToken: String) async -> Bool {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue(hostToken, forHTTPHeaderField: "X-Cmux-Web-Access-Host-Token")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = body

        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return false }
            return true
        } catch {
            return false
        }
    }

    private static func apiURL(path: String) -> URL? {
        apiURL(path: path, baseURL: webConnectBaseURL())
    }

    nonisolated static func apiURL(path: String, baseURL: URL) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = (components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path) + path
        return components.url
    }

    nonisolated static func webConnectBaseURL(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> URL {
        webConnectBaseURL(environment: environment, liteEnabled: DeppyLiteFeaturePolicy.isEnabled)
    }

    nonisolated static func webConnectRuntimeRequired(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        liteEnabled: Bool = DeppyLiteFeaturePolicy.isEnabled
    ) -> Bool {
        WebConnectServerController.canAutoStart(baseURL: webConnectBaseURL(environment: environment, liteEnabled: liteEnabled))
    }

    nonisolated static func webConnectBaseURL(
        environment: [String: String],
        liteEnabled: Bool,
        localPort: Int? = nil
    ) -> URL {
        if let override = environmentURL("CMUX_WEB_CONNECT_API_BASE_URL", environment: environment) {
            return override
        }
        if let override = environmentURL("CMUX_VM_API_BASE_URL", environment: environment) {
            return override
        }
        if liteEnabled {
            return webConnectBaseURL(port: localPort ?? webConnectPort())
        }
        return AuthEnvironment.vmAPIBaseURL
    }

    nonisolated static func webConnectBaseURL(port: Int) -> URL {
        URL(string: "http://localhost:\(port)")!
    }

    private nonisolated static func webConnectPort() -> Int {
        let key = SettingCatalog().mobile.webConnectPort
        let stored = UserDefaults.standard.object(forKey: key.userDefaultsKey) as? Int
        let port = stored ?? key.defaultValue
        guard (1...65535).contains(port) else {
            return key.defaultValue
        }
        return port
    }

    private nonisolated static func setWebConnectPort(_ port: Int) {
        guard (1...65535).contains(port) else { return }
        let key = SettingCatalog().mobile.webConnectPort
        UserDefaults.standard.set(port, forKey: key.userDefaultsKey)
    }

    private nonisolated static func isWebConnectServerEnabled() -> Bool {
        let key = SettingCatalog().mobile.webConnectServerEnabled
        guard UserDefaults.standard.object(forKey: key.userDefaultsKey) != nil else {
            return key.defaultValue
        }
        return UserDefaults.standard.bool(forKey: key.userDefaultsKey)
    }

    private nonisolated static func setWebConnectServerEnabled(_ enabled: Bool) {
        let key = SettingCatalog().mobile.webConnectServerEnabled
        UserDefaults.standard.set(enabled, forKey: key.userDefaultsKey)
    }

    private static func createSessionBody(publicOrigin: URL?) -> Data? {
        var body: [String: Any] = [
            "deviceId": MobileHostIdentity.deviceID(),
        ]
        if let publicOrigin {
            body["publicOrigin"] = publicOrigin.absoluteString
        }
        if let displayName = MobileHostIdentity.displayName(), !displayName.isEmpty {
            body["displayName"] = displayName
        }
        return try? JSONSerialization.data(withJSONObject: body, options: [])
    }

    private static func tailscalePublicOrigin(baseURL: URL = webConnectBaseURL()) -> URL? {
        guard let tailscaleHost = MobileRouteResolver.tailscaleRouteHosts(resolveDNS: false).first,
              let url = webConnectPublicOrigin(baseURL: baseURL, tailscaleHost: tailscaleHost)
        else {
            return nil
        }
        return url
    }

    nonisolated static func webConnectPublicOrigin(baseURL: URL, tailscaleHost: String) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.host = tailscaleHost
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }

    private static func parseCreateResponse(_ data: Data) -> (snapshot: MobileWebAccessSessionSnapshot, hostToken: String)? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let slug = object["slug"] as? String,
              let publicURL = object["publicUrl"] as? String,
              let hostToken = object["hostToken"] as? String,
              let expiresAtRaw = object["expiresAt"] as? String,
              let expiresAt = parseDate(expiresAtRaw)
        else {
            return nil
        }
        return (
            MobileWebAccessSessionSnapshot(
                slug: slug,
                publicURL: publicURL,
                expiresAt: expiresAt,
                hostSeenAt: nil
            ),
            hostToken
        )
    }

    private static func parseHeartbeatResponse(_ data: Data) -> Date? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let hostSeenAtRaw = object["hostSeenAt"] as? String
        else {
            return nil
        }
        return parseDate(hostSeenAtRaw)
    }

    private static func parseRefreshExpiresAt(_ data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let expiresAt = object["expiresAt"] as? String,
              parseDate(expiresAt) != nil
        else {
            return nil
        }
        return expiresAt
    }

    private static func parseRelayRequests(_ data: Data) -> [RelayRPCRequest] {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawRequests = object["requests"] as? [[String: Any]]
        else {
            return []
        }
        return rawRequests.compactMap { raw in
            guard let id = raw["id"] as? String,
                  let method = raw["method"] as? String
            else {
                return nil
            }
            return RelayRPCRequest(
                id: id,
                method: method,
                params: raw["params"] as? [String: Any] ?? [:]
            )
        }
    }

    private static func relayCompletionBody(requestID: String, result: MobileHostRPCResult) -> Data? {
        let object: [String: Any]
        switch result {
        case let .ok(payload):
            object = [
                "requestId": requestID,
                "ok": true,
                "result": jsonValue(payload)
            ]
        case let .failure(error):
            object = [
                "requestId": requestID,
                "ok": false,
                "error": [
                    "code": error.code,
                    "message": error.message
                ]
            ]
        }
        guard JSONSerialization.isValidJSONObject(object) else { return nil }
        return try? JSONSerialization.data(withJSONObject: object)
    }

    private static func jsonValue(_ value: Any?) -> Any {
        guard let value else {
            return NSNull()
        }
        if JSONSerialization.isValidJSONObject(["value": value]) {
            return value
        }
        return String(describing: value)
    }

    private static func parseDate(_ raw: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }

    private nonisolated static func environmentURL(
        _ key: String,
        environment: [String: String]
    ) -> URL? {
        guard let raw = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty
        else {
            return nil
        }
        return URL(string: raw)
    }

    private nonisolated static func isWebConnectEndpointUnavailableStatus(_ statusCode: Int) -> Bool {
        statusCode == 404 || statusCode == 503
    }

    private nonisolated static func isWebConnectEndpointUnavailableError(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .cannotFindHost, .cannotConnectToHost, .networkConnectionLost, .timedOut:
            return true
        default:
            return false
        }
    }
}

private struct RelayRPCRequest {
    let id: String
    let method: String
    let params: [String: Any]
}
