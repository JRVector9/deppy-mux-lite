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

    func install() async -> MobileWebAccessRuntimeInstallResult {
        let stagingRoot = fileManager.temporaryDirectory
            .appendingPathComponent("deppy-web-connect-runtime-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: stagingRoot) }

        do {
            try fileManager.createDirectory(at: stagingRoot, withIntermediateDirectories: true)
            let stagedRuntime = try await stageRuntime(in: stagingRoot)
            guard Self.isUsableRuntime(at: stagedRuntime, fileManager: fileManager) else {
                return .failed
            }
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

    private func stageRuntime(in stagingRoot: URL) async throws -> URL {
        if let archive = localArchiveURL() {
            return try await extractArchive(archive, under: stagingRoot)
        }
        if let script = installScriptURL() {
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
        let archive = try await downloadArchive(downloadURL, to: stagingRoot)
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
        return URL(string: "https://github.com/manaflow-ai/cmux/releases/latest/download/deppy-web-connect-runtime-\(Self.runtimeArch).zip")
    }

    private func downloadArchive(_ url: URL, to stagingRoot: URL) async throws -> URL {
        let (downloaded, response) = try await session.download(from: url)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw InstallSourceError.invalid
        }
        let archive = stagingRoot.appendingPathComponent("runtime.zip")
        if fileManager.fileExists(atPath: archive.path) {
            try fileManager.removeItem(at: archive)
        }
        try fileManager.moveItem(at: downloaded, to: archive)
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
