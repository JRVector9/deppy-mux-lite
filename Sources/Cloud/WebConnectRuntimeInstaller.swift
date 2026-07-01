import CmuxFoundation
import CmuxSettingsUI
import Foundation

/// Installs and removes the optional Web Connect runtime outside the app bundle.
struct WebConnectRuntimeInstaller {
    private let fileManager: FileManager
    private let session: URLSession
    private let commandRunner: any CommandRunning
    private let environment: [String: String]
    private let installDirectory: URL

    init(
        fileManager: FileManager = .default,
        session: URLSession = .shared,
        commandRunner: any CommandRunning = CommandRunner(),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        installDirectory: URL? = nil
    ) {
        self.fileManager = fileManager
        self.session = session
        self.commandRunner = commandRunner
        self.environment = environment
        self.installDirectory = installDirectory ?? Self.defaultInstallDirectory(
            environment: environment,
            fileManager: fileManager
        )
    }

    /// The per-user runtime location used by lite builds.
    static func defaultInstallDirectory(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL {
        if let override = directoryURL(environment["DEPPY_WEB_CONNECT_RUNTIME_DIR"]) {
            return override
        }
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ??
            URL(fileURLWithPath: NSString(string: "~/Library/Application Support").expandingTildeInPath, isDirectory: true)
        return appSupport
            .appendingPathComponent("deppy-mux", isDirectory: true)
            .appendingPathComponent("WebConnectRuntime", isDirectory: true)
            .appendingPathComponent("current", isDirectory: true)
    }

    func install(
        progress: @escaping @MainActor (MobileWebAccessRuntimeInstallProgress) -> Void = { _ in }
    ) async -> MobileWebAccessRuntimeInstallResult {
        let stagingRoot = fileManager.temporaryDirectory
            .appendingPathComponent("deppy-web-connect-runtime-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: stagingRoot) }

        do {
            await progress(.preparing)
            try fileManager.createDirectory(at: stagingRoot, withIntermediateDirectories: true)
            let stagedRuntime = try await stageRuntime(in: stagingRoot, progress: progress)
            guard Self.isUsableRuntime(at: stagedRuntime, fileManager: fileManager) else {
                return .failed
            }
            await progress(.installing)
            try replaceInstalledRuntime(with: stagedRuntime)
            return .installed(path: installDirectory.path)
        } catch InstallSourceError.missing {
            return .missingSource
        } catch {
            return .failed
        }
    }

    func uninstall() -> Bool {
        do {
            if fileManager.fileExists(atPath: installDirectory.path) {
                try fileManager.removeItem(at: installDirectory)
            }
            return !fileManager.fileExists(atPath: installDirectory.path)
        } catch {
            return false
        }
    }

    private func stageRuntime(
        in stagingRoot: URL,
        progress: @escaping @MainActor (MobileWebAccessRuntimeInstallProgress) -> Void
    ) async throws -> URL {
        if let archive = localArchiveURL() {
            await progress(.installing)
            return try await extractArchive(archive, under: stagingRoot)
        }
        if let script = installScriptURL() {
            await progress(.installing)
            let output = stagingRoot.appendingPathComponent("script-output", isDirectory: true)
            try await runInstallScript(script, output: output)
            guard let runtime = Self.normalizedRuntimeDirectory(in: output, fileManager: fileManager) else {
                throw InstallSourceError.invalid
            }
            return runtime
        }
        guard let downloadURL = runtimeArchiveURL() else {
            throw InstallSourceError.missing
        }
        let archive = try await downloadArchive(downloadURL, to: stagingRoot, progress: progress)
        await progress(.installing)
        return try await extractArchive(archive, under: stagingRoot)
    }

    private func localArchiveURL() -> URL? {
        guard let value = environment["DEPPY_WEB_CONNECT_RUNTIME_ARCHIVE_PATH"] else {
            return nil
        }
        let url = URL(fileURLWithPath: NSString(string: value).expandingTildeInPath)
        return fileManager.fileExists(atPath: url.path) ? url : nil
    }

    private func installScriptURL() -> URL? {
        if let value = environment["DEPPY_WEB_CONNECT_RUNTIME_INSTALL_SCRIPT"] {
            let url = URL(fileURLWithPath: NSString(string: value).expandingTildeInPath)
            if fileManager.isExecutableFile(atPath: url.path) {
                return url
            }
        }
        guard environment["CMUX_WEB_CONNECT_ALLOW_SOURCE_FALLBACK"] == "1" else {
            return nil
        }
        let candidate = sourceRepoRoot()
            .appendingPathComponent("scripts", isDirectory: true)
            .appendingPathComponent("install-web-connect-runtime.sh")
        return fileManager.isExecutableFile(atPath: candidate.path) ? candidate : nil
    }

    private func runtimeArchiveURL() -> URL? {
        if let value = environment["DEPPY_WEB_CONNECT_RUNTIME_ARCHIVE_URL"],
           let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
           !value.isEmpty {
            return url
        }
        return URL(string: "https://github.com/JRVector9/deppy-mux-lite/releases/latest/download/deppy-web-connect-runtime-\(Self.runtimeArch).zip")
    }

    private func downloadArchive(
        _ url: URL,
        to stagingRoot: URL,
        progress: @escaping @MainActor (MobileWebAccessRuntimeInstallProgress) -> Void
    ) async throws -> URL {
        await progress(.downloading(fraction: nil))
        let archive = stagingRoot.appendingPathComponent("runtime.zip")
        if fileManager.fileExists(atPath: archive.path) {
            try fileManager.removeItem(at: archive)
        }
        let downloader = RuntimeArchiveDownloadDelegate(
            destinationURL: archive,
            fileManager: fileManager,
            progress: progress
        )
        let response = try await downloader.download(url, configuration: session.configuration)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            try? fileManager.removeItem(at: archive)
            throw InstallSourceError.invalid
        }
        await progress(.downloading(fraction: 1))
        return archive
    }

    private func extractArchive(_ archive: URL, under stagingRoot: URL) async throws -> URL {
        let extractDirectory = stagingRoot.appendingPathComponent("extracted", isDirectory: true)
        try fileManager.createDirectory(at: extractDirectory, withIntermediateDirectories: true)
        let result = await commandRunner.run(
            directory: stagingRoot.path,
            executable: "/usr/bin/ditto",
            arguments: ["-x", "-k", archive.path, extractDirectory.path],
            timeout: 120
        )
        guard result.exitStatus == 0, !result.timedOut, result.executionError == nil else {
            throw InstallSourceError.invalid
        }
        guard let runtime = Self.normalizedRuntimeDirectory(in: extractDirectory, fileManager: fileManager) else {
            throw InstallSourceError.invalid
        }
        return runtime
    }

    private func runInstallScript(_ script: URL, output: URL) async throws {
        let result = await commandRunner.run(
            directory: script.deletingLastPathComponent().deletingLastPathComponent().path,
            executable: script.path,
            arguments: ["--output", output.path],
            timeout: 600
        )
        guard result.exitStatus == 0, !result.timedOut, result.executionError == nil else {
            throw InstallSourceError.invalid
        }
    }

    private func replaceInstalledRuntime(with stagedRuntime: URL) throws {
        let parent = installDirectory.deletingLastPathComponent()
        try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)

        let replacement = parent.appendingPathComponent(".current-\(UUID().uuidString)", isDirectory: true)
        try fileManager.moveItem(at: stagedRuntime, to: replacement)

        let backup = parent.appendingPathComponent(".previous-\(UUID().uuidString)", isDirectory: true)
        if fileManager.fileExists(atPath: installDirectory.path) {
            try fileManager.moveItem(at: installDirectory, to: backup)
        }
        do {
            try fileManager.moveItem(at: replacement, to: installDirectory)
            try? fileManager.removeItem(at: backup)
        } catch {
            if fileManager.fileExists(atPath: backup.path) {
                try? fileManager.moveItem(at: backup, to: installDirectory)
            }
            throw error
        }
    }

    private static func normalizedRuntimeDirectory(in directory: URL, fileManager: FileManager) -> URL? {
        if isUsableRuntime(at: directory, fileManager: fileManager) {
            return directory
        }
        for name in ["web-connect", "current"] {
            let candidate = directory.appendingPathComponent(name, isDirectory: true)
            if isUsableRuntime(at: candidate, fileManager: fileManager) {
                return candidate
            }
        }
        guard let children = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return nil
        }
        for child in children {
            guard (try? child.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
                continue
            }
            if isUsableRuntime(at: child, fileManager: fileManager) {
                return child
            }
        }
        return nil
    }

    private static func isUsableRuntime(at directory: URL, fileManager: FileManager) -> Bool {
        let server = directory.appendingPathComponent("server.js")
        let bun = directory.appendingPathComponent("bin/bun")
        let node = directory.appendingPathComponent("bin/node")
        return fileManager.fileExists(atPath: server.path) &&
            (fileManager.isExecutableFile(atPath: bun.path) || fileManager.isExecutableFile(atPath: node.path))
    }

    private static func directoryURL(_ rawPath: String?) -> URL? {
        guard let rawPath = rawPath?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawPath.isEmpty else {
            return nil
        }
        return URL(fileURLWithPath: NSString(string: rawPath).expandingTildeInPath, isDirectory: true)
    }

    private func sourceRepoRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private static var runtimeArch: String {
        #if arch(arm64)
            return "arm64"
        #elseif arch(x86_64)
            return "x86_64"
        #else
            return "unknown"
        #endif
    }

    private enum InstallSourceError: Error {
        case missing
        case invalid
    }
}

private final class RuntimeArchiveDownloadDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let destinationURL: URL
    private let fileManager: FileManager
    private let progress: @MainActor (MobileWebAccessRuntimeInstallProgress) -> Void
    private let lock = NSLock()
    private var continuation: CheckedContinuation<URLResponse, Error>?
    private var session: URLSession?
    private var didResume = false
    private var lastReportedPercent = -1

    init(
        destinationURL: URL,
        fileManager: FileManager,
        progress: @escaping @MainActor (MobileWebAccessRuntimeInstallProgress) -> Void
    ) {
        self.destinationURL = destinationURL
        self.fileManager = fileManager
        self.progress = progress
    }

    func download(_ url: URL, configuration: URLSessionConfiguration) async throws -> URLResponse {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                self.continuation = continuation
                lock.unlock()

                let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
                lock.lock()
                self.session = session
                lock.unlock()

                session.downloadTask(with: url).resume()
            }
        } onCancel: {
            cancel()
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let percent = min(
            100,
            max(0, Int((Double(totalBytesWritten) / Double(totalBytesExpectedToWrite) * 100).rounded(.down)))
        )
        guard percent != lastReportedPercent else { return }
        lastReportedPercent = percent
        Task { @MainActor in
            progress(.downloading(fraction: Double(percent) / 100.0))
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        do {
            if fileManager.fileExists(atPath: destinationURL.path) {
                try fileManager.removeItem(at: destinationURL)
            }
            try fileManager.moveItem(at: location, to: destinationURL)
            resume(.success(downloadTask.response ?? URLResponse()))
        } catch {
            resume(.failure(error))
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            resume(.failure(error))
        }
    }

    private func cancel() {
        lock.lock()
        let session = self.session
        lock.unlock()
        session?.invalidateAndCancel()
    }

    private func resume(_ result: Result<URLResponse, Error>) {
        lock.lock()
        guard !didResume else {
            lock.unlock()
            return
        }
        didResume = true
        let continuation = self.continuation
        self.continuation = nil
        let session = self.session
        self.session = nil
        lock.unlock()

        session?.finishTasksAndInvalidate()
        continuation?.resume(with: result)
    }
}
