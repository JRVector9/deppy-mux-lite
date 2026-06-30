import CmuxAuthRuntime
import CmuxSettingsUI
import Foundation

/// Creates and keeps alive browser Web Access sessions for this Mac.
@MainActor
final class MobileWebAccessClient {
    static let shared = MobileWebAccessClient()

    private let session: URLSession = .shared
    private var auth: AuthCoordinator?
    private var current: MobileWebAccessSessionSnapshot?
    private var currentHostToken: String?
    private var heartbeatTask: Task<Void, Never>?
    private var relayTask: Task<Void, Never>?

    private init() {}

    /// Injects auth at the app composition root.
    func configure(auth: AuthCoordinator) {
        self.auth = auth
    }

    /// Returns the current in-process session, if any.
    func currentSession() -> MobileWebAccessSessionSnapshot? {
        clearExpiredSessionIfNeeded()
        return current
    }

    /// Creates a session and starts the heartbeat loop that marks this Mac online.
    func startSession() async -> MobileWebAccessStartResult {
        guard let url = Self.apiURL(path: "/api/mobile/web-access/sessions") else {
            return .failed
        }
        guard let publicOrigin = Self.tailscalePublicOrigin() else {
            return .tailscaleUnavailable
        }

        let tokens = try? await auth?.currentTokens()
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        if let tokens {
            request.setValue("Bearer \(tokens.accessToken)", forHTTPHeaderField: "Authorization")
            request.setValue(tokens.refreshToken, forHTTPHeaderField: "X-Stack-Refresh-Token")
        }
        if let teamID = auth?.resolvedTeamID, !teamID.isEmpty {
            request.setValue(teamID, forHTTPHeaderField: "X-Cmux-Team-Id")
        }
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = Self.createSessionBody(publicOrigin: publicOrigin)

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .failed }
            if http.statusCode == 401 { return .notSignedIn }
            guard (200...299).contains(http.statusCode) else { return .failed }
            guard let parsed = Self.parseCreateResponse(data) else { return .failed }

            current = parsed.snapshot
            currentHostToken = parsed.hostToken
            await sendHeartbeat(slug: parsed.snapshot.slug, hostToken: parsed.hostToken)
            startHeartbeatLoop(slug: parsed.snapshot.slug, hostToken: parsed.hostToken, expiresAt: parsed.snapshot.expiresAt)
            startRelayLoop(slug: parsed.snapshot.slug, hostToken: parsed.hostToken, expiresAt: parsed.snapshot.expiresAt)
            return .started(current ?? parsed.snapshot)
        } catch {
            return .failed
        }
    }

    private func startRelayLoop(slug: String, hostToken: String, expiresAt: Date) {
        relayTask?.cancel()
        relayTask = Task { [weak self] in
            let clock = ContinuousClock()
            while !Task.isCancelled {
                guard let self else { return }
                guard Date() < expiresAt else {
                    self.clearSession(slug: slug)
                    return
                }
                await self.pollRelay(slug: slug, hostToken: hostToken)
                // Browser Web Access is interactive terminal I/O; keep relay
                // pickup noticeably below a second while the session is active.
                guard (try? await clock.sleep(for: .milliseconds(250))) != nil else { return }
            }
        }
    }

    private func startHeartbeatLoop(slug: String, hostToken: String, expiresAt: Date) {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            let clock = ContinuousClock()
            while !Task.isCancelled {
                guard let self else { return }
                guard Date() < expiresAt else {
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
        current = nil
        currentHostToken = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
        relayTask?.cancel()
        relayTask = nil
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

    private func pollRelay(slug: String, hostToken: String) async {
        guard let url = Self.apiURL(path: "/api/mobile/web-access/sessions/\(slug)/host-rpc") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        request.setValue(hostToken, forHTTPHeaderField: "X-Cmux-Web-Access-Host-Token")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return }
            for relayRequest in Self.parseRelayRequests(data) {
                await handleRelayRequest(relayRequest, slug: slug, hostToken: hostToken)
            }
        } catch {
            return
        }
    }

    private func handleRelayRequest(_ relayRequest: RelayRPCRequest, slug: String, hostToken: String) async {
        let rpcRequest = MobileHostRPCRequest(
            id: relayRequest.id,
            method: relayRequest.method,
            params: relayRequest.params,
            auth: nil
        )
        let result = await TerminalController.shared.mobileHostHandleRPC(rpcRequest)
        await completeRelayRequest(id: relayRequest.id, result: result, slug: slug, hostToken: hostToken)
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
            // Bounded, cancellable retry backoff for recording already-executed Web Access RPC completion.
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
        guard var components = URLComponents(url: AuthEnvironment.vmAPIBaseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = (components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path) + path
        return components.url
    }

    private static func createSessionBody(publicOrigin: URL) -> Data? {
        var body: [String: Any] = [
            "deviceId": MobileHostIdentity.deviceID(),
            "publicOrigin": publicOrigin.absoluteString,
        ]
        if let displayName = MobileHostIdentity.displayName(), !displayName.isEmpty {
            body["displayName"] = displayName
        }
        return try? JSONSerialization.data(withJSONObject: body, options: [])
    }

    private static func tailscalePublicOrigin() -> URL? {
        guard let tailscaleHost = MobileRouteResolver.tailscaleRouteHosts(resolveDNS: false).first,
              var components = URLComponents(url: AuthEnvironment.signInWebsiteOrigin, resolvingAgainstBaseURL: false)
        else {
            return nil
        }
        components.host = tailscaleHost
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
}

private struct RelayRPCRequest {
    let id: String
    let method: String
    let params: [String: Any]
}
