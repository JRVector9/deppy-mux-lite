import AppKit
import CmuxSettingsUI
import Darwin
import Foundation
import Security

/// Starts the local Web Connect development server when the app is using a
/// loopback Web Connect API endpoint.
@MainActor
final class WebConnectServerController {
    nonisolated static let localControlTokenHeader = "X-Deppy-Web-Connect-Local-Token"
    nonisolated private static let localControlTokenEnvironmentKey = "CMUX_WEB_CONNECT_LOCAL_TOKEN"
    nonisolated static let localControlToken: String = makeLocalControlToken()

    private let session: URLSession
    private var process: Process?
    private var runningPort: Int?
    private var logFile: FileHandle?
    private var terminationObserver: NSObjectProtocol?
    var onUnexpectedTermination: (() -> Void)?

    init(session: URLSession = .shared) {
        self.session = session
        terminationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            Task { @MainActor in
                self?.stop()
            }
        }
    }

    deinit {
        if let terminationObserver {
            NotificationCenter.default.removeObserver(terminationObserver)
        }
    }

    nonisolated static func canAutoStart(baseURL: URL) -> Bool {
        guard let scheme = baseURL.scheme?.lowercased(), scheme == "http" else {
            return false
        }
        guard let host = normalizedHost(baseURL.host) else {
            return false
        }
        return host == "localhost" || host == "127.0.0.1"
    }

    func setEnabled(_ enabled: Bool, baseURL: URL) async -> MobileWebAccessServerControlResult {
        let port = Self.port(baseURL: baseURL)
        guard enabled else {
            return await stop(baseURL: baseURL)
        }
        guard (1...65535).contains(port) else {
            return .invalidPort(port: port)
        }
        return await ensureStarted(baseURL: baseURL)
    }

    func ensureStarted(baseURL: URL) async -> MobileWebAccessServerControlResult {
        let port = Self.port(baseURL: baseURL)
        guard (1...65535).contains(port) else {
            return .invalidPort(port: port)
        }
        guard Self.canAutoStart(baseURL: baseURL) else {
            return .running(port: port)
        }
        switch await compatibilityProbe(baseURL: baseURL) {
        case .compatible:
            return process?.isRunning == true && runningPort == port ? .running(port: port) : .portInUse(port: port)
        case .incompatible:
            return .portInUse(port: port)
        case .unreachable:
            break
        }
        clearFinishedProcess()
        if process?.isRunning == true, runningPort == port {
            return await waitForReachable(baseURL: baseURL, timeout: 60) ? .running(port: port) : .failed(port: port)
        }
        guard Self.canBindLocalPort(port) else {
            return .portInUse(port: port)
        }
        guard Self.serverCommand(environment: ProcessInfo.processInfo.environment) != nil else {
            return .runtimeMissing
        }

        if process?.isRunning == true, runningPort != port {
            stop()
        }
        let didLaunch = process?.isRunning != true
        guard process?.isRunning == true || startProcess(baseURL: baseURL) else {
            return .failed(port: port)
        }
        let ready = await waitForReachable(baseURL: baseURL, timeout: 60)
        if !ready, didLaunch {
            stop()
        }
        return ready ? .running(port: port) : .failed(port: port)
    }

    private func startProcess(baseURL: URL) -> Bool {
        let environment = ProcessInfo.processInfo.environment
        guard let command = Self.serverCommand(environment: environment) else {
            return false
        }

        let port = Self.port(baseURL: baseURL)
        let process = Process()
        process.executableURL = command.executableURL
        process.arguments = command.arguments
        process.currentDirectoryURL = command.workingDirectory
        process.environment = Self.serverEnvironment(
            environment: environment,
            port: port,
            callbackScheme: AuthEnvironment.callbackScheme
        )

        let logFile = Self.openLogFile(port: port)
        if let logFile {
            process.standardOutput = logFile
            process.standardError = logFile
            self.logFile = logFile
        }

        process.terminationHandler = { [weak self, weak process] _ in
            Task { @MainActor in
                guard let process else { return }
                self?.processDidTerminate(process)
            }
        }

        do {
            try process.run()
            self.process = process
            runningPort = port
            return true
        } catch {
            closeLogFile()
            return false
        }
    }

    private func waitForReachable(baseURL: URL, timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let clock = ContinuousClock()

        while Date() < deadline {
            if await isReachable(baseURL: baseURL) {
                return true
            }
            if let process, !process.isRunning {
                clearFinishedProcess()
                return false
            }
            // Bounded startup readiness check for Next.js, which exposes no
            // native async readiness signal to the host app.
            guard (try? await clock.sleep(for: .milliseconds(500))) != nil else {
                return false
            }
        }
        return await isReachable(baseURL: baseURL)
    }

    private func isReachable(baseURL: URL) async -> Bool {
        await compatibilityProbe(baseURL: baseURL) == .compatible
    }

    private enum CompatibilityProbe {
        case compatible
        case incompatible
        case unreachable
    }

    private func compatibilityProbe(baseURL: URL) async -> CompatibilityProbe {
        guard let healthURL = Self.healthURL(baseURL: baseURL) else {
            return .unreachable
        }
        let requiresLocalControl = Self.canAutoStart(baseURL: baseURL)
        var request = URLRequest(url: healthURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 2
        if requiresLocalControl {
            request.setValue(Self.localControlToken, forHTTPHeaderField: Self.localControlTokenHeader)
        }

        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .incompatible
            }
            guard Self.isCompatibleWebConnectResponse(http) else {
                return .incompatible
            }
            if requiresLocalControl, !(200...299).contains(http.statusCode) {
                // Older optional runtimes localize POST /sessions before GET
                // /sessions. Treat their 401 as a recognizable Web Connect
                // process; ensureStarted still reports portInUse unless this
                // app launched the process it is probing.
                return http.statusCode == 401 ? .compatible : .incompatible
            }
            return .compatible
        } catch {
            return .unreachable
        }
    }

    nonisolated static func isCompatibleWebConnectResponse(_ response: HTTPURLResponse) -> Bool {
        response.value(forHTTPHeaderField: "X-Deppy-Web-Connect") == "1"
    }

    func stop() {
        if let process, process.isRunning {
            process.terminate()
        }
        process = nil
        runningPort = nil
        closeLogFile()
    }

    func stop(baseURL: URL) async -> MobileWebAccessServerControlResult {
        let port = Self.port(baseURL: baseURL)
        guard (1...65535).contains(port) else {
            return .invalidPort(port: port)
        }
        clearFinishedProcess()
        if process?.isRunning == true {
            return await stopOwnedProcessAndWait(port: port) ? .stopped : .externalProcess(port: port)
        }
        guard Self.canAutoStart(baseURL: baseURL) else {
            return .stopped
        }
        switch await compatibilityProbe(baseURL: baseURL) {
        case .compatible:
            return await stopLocalRuntimeListeners(port: port) ? .stopped : .externalProcess(port: port)
        case .incompatible:
            return .externalProcess(port: port)
        case .unreachable:
            let stoppedRuntime = await stopLocalRuntimeListeners(port: port)
            if Self.canBindLocalPort(port) {
                return .stopped
            }
            return stoppedRuntime ? .stopped : .externalProcess(port: port)
        }
    }

    private func stopOwnedProcessAndWait(port: Int) async -> Bool {
        guard let process, process.isRunning else {
            stop()
            return Self.canBindLocalPort(port)
        }
        let pid = process.processIdentifier
        process.terminate()
        let clock = ContinuousClock()
        for _ in 0..<20 {
            if Self.canBindLocalPort(port) {
                self.process = nil
                runningPort = nil
                closeLogFile()
                return true
            }
            guard (try? await clock.sleep(for: .milliseconds(100))) != nil else {
                return false
            }
        }
        if process.isRunning {
            _ = Self.sendSignal("KILL", pid: pid)
        }
        for _ in 0..<10 {
            if Self.canBindLocalPort(port) {
                self.process = nil
                runningPort = nil
                closeLogFile()
                return true
            }
            guard (try? await clock.sleep(for: .milliseconds(100))) != nil else {
                return false
            }
        }
        return Self.canBindLocalPort(port)
    }

    private func stopLocalRuntimeListeners(port: Int) async -> Bool {
        let environment = ProcessInfo.processInfo.environment
        let runtimePath = Self.runtimeDirectory(environment: environment)?.path
        let listenerPIDs = Self.listenerPIDs(port: port).filter { pid in
            Self.isWebConnectRuntimeCommandLine(Self.commandLine(pid: pid), runtimePath: runtimePath)
        }
        let runtimePIDs = Self.runtimeServerPIDs(runtimePath: runtimePath)
        let pids = Array(Set(listenerPIDs + runtimePIDs))
        guard !pids.isEmpty else {
            return Self.canBindLocalPort(port)
        }
        for pid in pids {
            _ = Self.sendSignal("TERM", pid: pid)
        }
        let clock = ContinuousClock()
        for _ in 0..<20 {
            if Self.canBindLocalPort(port), pids.allSatisfy({ !Self.isProcessRunning($0) }) {
                return true
            }
            // Bounded shutdown grace period after SIGTERM for a same-runtime server.
            try? await clock.sleep(for: .milliseconds(100))
        }
        for pid in pids {
            _ = Self.sendSignal("KILL", pid: pid)
        }
        for _ in 0..<10 {
            if Self.canBindLocalPort(port), pids.allSatisfy({ !Self.isProcessRunning($0) }) {
                return true
            }
            try? await clock.sleep(for: .milliseconds(100))
        }
        return Self.canBindLocalPort(port)
    }

    private func processDidTerminate(_ finishedProcess: Process) {
        guard process === finishedProcess else {
            return
        }
        process = nil
        runningPort = nil
        closeLogFile()
        onUnexpectedTermination?()
    }

    private func clearFinishedProcess() {
        guard let process, !process.isRunning else {
            return
        }
        self.process = nil
        runningPort = nil
        closeLogFile()
    }

    private func closeLogFile() {
        try? logFile?.close()
        logFile = nil
    }

    nonisolated private static func normalizedHost(_ host: String?) -> String? {
        guard let host else {
            return nil
        }
        return host
            .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            .lowercased()
    }

    private static func healthURL(baseURL: URL) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = (components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path)
            + "/api/mobile/web-access/sessions"
        components.query = nil
        components.fragment = nil
        return components.url
    }

    private static func listenerPIDs(port: Int) -> [Int32] {
        commandOutput(
            executable: "/usr/sbin/lsof",
            arguments: ["-nP", "-tiTCP:\(port)", "-sTCP:LISTEN"]
        )
        .split(whereSeparator: \.isNewline)
        .compactMap { Int32(String($0).trimmingCharacters(in: .whitespacesAndNewlines)) }
    }

    private static func commandLine(pid: Int32) -> String {
        commandOutput(
            executable: "/bin/ps",
            arguments: ["-p", String(pid), "-o", "command="]
        )
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func runtimeServerPIDs(runtimePath: String?) -> [Int32] {
        commandOutput(
            executable: "/bin/ps",
            arguments: ["-axo", "pid=,command="]
        )
        .split(whereSeparator: \.isNewline)
        .compactMap { line -> Int32? in
            let raw = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
            let pieces = raw.split(maxSplits: 1, whereSeparator: \.isWhitespace)
            guard let pidText = pieces.first,
                  let pid = Int32(pidText)
            else {
                return nil
            }
            let commandLine = pieces.count > 1 ? String(pieces[1]) : ""
            return isWebConnectRuntimeCommandLine(commandLine, runtimePath: runtimePath) ? pid : nil
        }
    }

    private static func isWebConnectRuntimeCommandLine(_ commandLine: String, runtimePath: String?) -> Bool {
        guard commandLine.contains("server.js") else {
            return false
        }
        if let runtimePath, commandLine.contains(runtimePath) {
            return true
        }
        return commandLine.contains("/WebConnectRuntime/current/")
    }

    private static func sendSignal(_ signal: String, pid: Int32) -> Bool {
        runCommand(executable: "/bin/kill", arguments: ["-\(signal)", String(pid)]).exitCode == 0
    }

    private static func isProcessRunning(_ pid: Int32) -> Bool {
        if Darwin.kill(pid, 0) == 0 {
            return true
        }
        return errno == EPERM
    }

    private static func commandOutput(executable: String, arguments: [String]) -> String {
        let result = runCommand(executable: executable, arguments: arguments)
        return result.exitCode == 0 ? result.output : ""
    }

    private static func runCommand(executable: String, arguments: [String]) -> (exitCode: Int32, output: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return (process.terminationStatus, String(data: data, encoding: .utf8) ?? "")
        } catch {
            return (1, "")
        }
    }

    private struct ServerCommand {
        let executableURL: URL
        let arguments: [String]
        let workingDirectory: URL
    }

    private static func serverCommand(environment: [String: String]) -> ServerCommand? {
        if shouldPreferSourceRuntime(environment: environment),
           let webDirectory = webDirectory(environment: environment) {
            return sourceServerCommand(environment: environment, webDirectory: webDirectory)
        }
        if let runtimeDirectory = runtimeDirectory(environment: environment),
           let command = standaloneRuntimeCommand(environment: environment, runtimeDirectory: runtimeDirectory) {
            return ServerCommand(
                executableURL: command.executableURL,
                arguments: command.arguments + ["server.js"],
                workingDirectory: runtimeDirectory
            )
        }
        guard let webDirectory = webDirectory(environment: environment) else {
            return nil
        }
        return sourceServerCommand(environment: environment, webDirectory: webDirectory)
    }

    private static func sourceServerCommand(
        environment: [String: String],
        webDirectory: URL
    ) -> ServerCommand {
        let bun = bunCommand(environment: environment)
        return ServerCommand(
            executableURL: bun.executableURL,
            arguments: bun.arguments,
            workingDirectory: webDirectory
        )
    }

    private static func shouldPreferSourceRuntime(environment: [String: String]) -> Bool {
        if directoryURL(environment["CMUX_WEB_CONNECT_WEB_DIR"]) != nil {
            return true
        }
        let raw = environment["CMUX_WEB_CONNECT_PREFER_SOURCE"] ?? environment["DEPPY_WEB_CONNECT_PREFER_SOURCE"]
        return raw == "1" || raw?.lowercased() == "true"
    }

    static func runtimeStatus(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> MobileWebAccessRuntimeStatus {
        if let external = explicitRuntimeDirectory(environment: environment) {
            return .external(path: external.path)
        }
        if let installed = installedRuntimeDirectory(environment: environment) {
            return .installed(path: installed.path)
        }
        if let bundled = bundledRuntimeDirectory(environment: environment) {
            return .bundled(path: bundled.path)
        }
        if let source = webDirectory(environment: environment) {
            return .external(path: source.path)
        }
        return .missing
    }

    private static func runtimeDirectory(environment: [String: String]) -> URL? {
        switch runtimeStatus(environment: environment) {
        case .installed(let path), .bundled(let path), .external(let path):
            let directory = URL(fileURLWithPath: path, isDirectory: true)
            return hasStandaloneRuntime(at: directory, environment: environment) ? directory : nil
        case .missing:
            return nil
        }
    }

    private static func explicitRuntimeDirectory(environment: [String: String]) -> URL? {
        guard let candidate = directoryURL(environment["CMUX_WEB_CONNECT_BUNDLE_DIR"]) else {
            return nil
        }
        return hasStandaloneRuntime(at: candidate, environment: environment) ? candidate.standardizedFileURL : nil
    }

    private static func installedRuntimeDirectory(environment: [String: String]) -> URL? {
        let candidate = WebConnectRuntimeInstaller.defaultInstallDirectory(environment: environment)
        return hasStandaloneRuntime(at: candidate, environment: environment) ? candidate.standardizedFileURL : nil
    }

    private static func bundledRuntimeDirectory(environment: [String: String]) -> URL? {
        let candidates: [URL?] = [
            Bundle.main.resourceURL?.appendingPathComponent("web-connect", isDirectory: true),
        ]
        for candidate in candidates.compactMap({ $0 }) {
            if hasStandaloneRuntime(at: candidate, environment: environment) {
                return candidate.standardizedFileURL
            }
        }
        return nil
    }

    private static func hasStandaloneRuntime(at directory: URL, environment: [String: String]) -> Bool {
        FileManager.default.fileExists(atPath: directory.appendingPathComponent("server.js").path) &&
            standaloneRuntimeCommand(environment: environment, runtimeDirectory: directory) != nil
    }

    private static func standaloneRuntimeCommand(
        environment: [String: String],
        runtimeDirectory: URL
    ) -> (executableURL: URL, arguments: [String])? {
        if let bun = bundledBunCommand(environment: environment, runtimeDirectory: runtimeDirectory) {
            return bun
        }
        return nodeCommand(environment: environment, runtimeDirectory: runtimeDirectory)
    }

    private static func bundledBunCommand(
        environment: [String: String],
        runtimeDirectory: URL
    ) -> (executableURL: URL, arguments: [String])? {
        let candidates = [
            environment["CMUX_WEB_CONNECT_BUN_PATH"],
            runtimeDirectory.appendingPathComponent("bin/bun").path,
            Bundle.main.resourceURL?.appendingPathComponent("bin/bun").path,
        ].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if let bun = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
            return (URL(fileURLWithPath: bun), [])
        }
        return nil
    }

    private static func nodeCommand(
        environment: [String: String],
        runtimeDirectory: URL
    ) -> (executableURL: URL, arguments: [String])? {
        let candidates = [
            environment["CMUX_WEB_CONNECT_NODE_PATH"],
            runtimeDirectory.appendingPathComponent("bin/node").path,
            Bundle.main.resourceURL?.appendingPathComponent("bin/node").path,
        ].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if let node = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
            return (URL(fileURLWithPath: node), [])
        }
        return nil
    }

    private static func webDirectory(environment: [String: String]) -> URL? {
        var candidates: [URL?] = [
            directoryURL(environment["CMUX_WEB_CONNECT_WEB_DIR"]),
        ]
        if environment["CMUX_WEB_CONNECT_ALLOW_SOURCE_FALLBACK"] == "1" {
            candidates.append(contentsOf: [
                repoRoot(environment: environment)?.appendingPathComponent("web"),
                URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("web"),
                sourceRepoRoot().appendingPathComponent("web"),
            ])
        }

        for candidate in candidates.compactMap({ $0 }) {
            let packageJSON = candidate.appendingPathComponent("package.json").path
            let devScript = candidate.appendingPathComponent("scripts/dev-local.sh").path
            if FileManager.default.fileExists(atPath: packageJSON),
               FileManager.default.fileExists(atPath: devScript) {
                return candidate.standardizedFileURL
            }
        }
        return nil
    }

    private static func directoryURL(_ rawPath: String?) -> URL? {
        guard let rawPath = rawPath?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawPath.isEmpty
        else {
            return nil
        }
        return URL(fileURLWithPath: NSString(string: rawPath).expandingTildeInPath, isDirectory: true)
    }

    private static func repoRoot(environment: [String: String]) -> URL? {
        directoryURL(environment["CMUXTERM_REPO_ROOT"])
    }

    private static func sourceRepoRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private static func bunCommand(environment: [String: String]) -> (executableURL: URL, arguments: [String]) {
        if let bunPath = bunPath(environment: environment) {
            return (URL(fileURLWithPath: bunPath), ["dev"])
        }
        return (URL(fileURLWithPath: "/usr/bin/env"), ["bun", "dev"])
    }

    private static func bunPath(environment: [String: String]) -> String? {
        for path in bunPathCandidates(environment: environment) {
            if FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
        }
        return nil
    }

    private static func bunPathCandidates(environment: [String: String]) -> [String] {
        let home = environment["HOME"] ?? NSHomeDirectory()
        return [
            environment["BUN_PATH"],
            "\(home)/.bun/bin/bun",
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun",
        ].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private static func serverEnvironment(
        environment: [String: String],
        port: Int,
        callbackScheme: String
    ) -> [String: String] {
        var result = environment
        let range = Int(environment["CMUX_PORT_RANGE"] ?? "") ?? 10
        result["CMUX_PORT"] = String(port)
        result["PORT"] = String(port)
        result["HOSTNAME"] = environment["CMUX_WEB_CONNECT_HOSTNAME"] ?? "0.0.0.0"
        result["CMUX_WEB_CONNECT_LOCAL_ONLY"] = "1"
        result[Self.localControlTokenEnvironmentKey] = Self.localControlToken
        result["CMUX_WEB_CONNECT_STATE_FILE"] = environment["CMUX_WEB_CONNECT_STATE_FILE"] ?? defaultStateFilePath()
        result["SKIP_ENV_VALIDATION"] = "1"
        result["CMUX_PORT_RANGE"] = String(range)
        result["CMUX_PORT_END"] = environment["CMUX_PORT_END"] ?? String(port + max(range, 1) - 1)
        result["CMUX_AUTH_CALLBACK_SCHEME"] = environment["CMUX_AUTH_CALLBACK_SCHEME"] ?? callbackScheme
        result["NEXT_PUBLIC_STACK_PROJECT_ID"] = environment["NEXT_PUBLIC_STACK_PROJECT_ID"] ?? "00000000-0000-4000-8000-000000000000"
        result["NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"] = environment["NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"] ?? "preview-publishable-client-key"
        result["STACK_SECRET_SERVER_KEY"] = environment["STACK_SECRET_SERVER_KEY"] ?? "preview-secret-server-key"
        result["PATH"] = executableSearchPath(environment: environment)
        return result
    }

    private static func defaultStateFilePath() -> String {
        let fallback = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("deppy-web-connect", isDirectory: true)
            .appendingPathComponent("sessions.json")
        guard let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            return fallback.path
        }
        let directory = applicationSupport
            .appendingPathComponent("deppy-mux", isDirectory: true)
            .appendingPathComponent("WebConnectRuntime", isDirectory: true)
            .appendingPathComponent("state", isDirectory: true)
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            return directory.appendingPathComponent("sessions.json").path
        } catch {
            return fallback.path
        }
    }

    nonisolated private static func makeLocalControlToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess {
            return bytes.map { String(format: "%02x", $0) }.joined()
        }
        return UUID().uuidString + UUID().uuidString
    }

    private static func executableSearchPath(environment: [String: String]) -> String {
        let home = environment["HOME"] ?? NSHomeDirectory()
        let preferred = [
            "\(home)/.bun/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        let existing = (environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
        var seen = Set<String>()
        return (preferred + existing)
            .filter { !$0.isEmpty }
            .filter { seen.insert($0).inserted }
            .joined(separator: ":")
    }

    private static func port(baseURL: URL) -> Int {
        if let port = baseURL.port {
            return port
        }
        return baseURL.scheme?.lowercased() == "https" ? 443 : 80
    }

    private static func canBindLocalPort(_ port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else {
            return false
        }
        defer { Darwin.close(fd) }

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: in_addr_t(INADDR_ANY))

        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                bind(fd, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }

    private static func openLogFile(port: Int) -> FileHandle? {
        let path = "/tmp/deppy-web-connect-\(port).log"
        if !FileManager.default.fileExists(atPath: path) {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
        guard let file = FileHandle(forWritingAtPath: path) else {
            return nil
        }
        try? file.seekToEnd()
        return file
    }
}
