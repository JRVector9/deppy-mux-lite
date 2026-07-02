public import Foundation

/// The per-user directory that holds cmux's control-plane runtime state: the
/// control socket, its `last-socket-path` marker files, the socket password, and
/// the cached remote daemon binaries.
///
/// ## Why not Application Support
///
/// These files are read and written by **two separately code-signed binaries** —
/// the cmux app (bundle id `com.cmuxterm.app`) and the standalone `cmux` CLI
/// installed at `/usr/local/bin/cmux`. On macOS Sequoia, a non-sandboxed process
/// that reaches into another app's data under `~/Library/Application Support`,
/// `~/Library/Containers`, or `~/Library/Group Containers` triggers the
/// "<app> would like to access data from other apps" TCC ("App Data") prompt.
/// The CLI touches the control socket and the socket password on **every** agent
/// session-start and session-stop hook, so keeping those files in Application
/// Support made the prompt fire constantly
/// (https://github.com/manaflow-ai/cmux/issues/5146).
///
/// This directory therefore resolves to `~/.local/state/deppy-mux`, a plain dotfolder
/// macOS does **not** treat as protected app data. It is the sibling of the
/// legacy `~/.local/state/cmux/crash` breadcrumb directory GhosttyKit writes to.
///
/// ```swift
/// // The stable control socket; app and CLI agree on the same path by passing
/// // the real account home (`FileManager.default.homeDirectoryForCurrentUser`):
/// let home = FileManager.default.homeDirectoryForCurrentUser
/// let socket = CmuxStateDirectory.url(homeDirectory: home).appendingPathComponent("cmux.sock")
/// ```
public enum CmuxStateDirectory {
    /// The directory name segment under `~/.local/state`.
    public static let directoryName = "deppy-mux"

    /// The pre-rebrand directory name (`~/.local/state/cmux`, and the legacy
    /// name under `~/Library/Application Support`). Read to migrate existing
    /// state; GhosttyKit still writes crash reports under this name (its
    /// `crash-report-subdir` is baked in at build time), so crash pickup must
    /// keep reading both directories.
    public static let legacyDirectoryName = "cmux"

    /// The deppy-mux state directory: `<home>/.local/state/deppy-mux`.
    ///
    /// The home directory is injected (no ambient `FileManager.default` default)
    /// so this stays a pure, testable function with no hidden global state.
    /// Composition roots pass `FileManager.default.homeDirectoryForCurrentUser`,
    /// which resolves the real account home independently of the `HOME`
    /// environment variable, so the app and CLI always agree on the path even
    /// when a shell overrides `HOME`.
    ///
    /// - Parameter homeDirectory: The user's home directory.
    /// - Returns: The state directory URL (its parents are created on first write
    ///   by the socket listener, marker writer, and password store).
    public static func url(homeDirectory: URL) -> URL {
        homeDirectory
            .appendingPathComponent(".local", isDirectory: true)
            .appendingPathComponent("state", isDirectory: true)
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    /// The legacy Application Support control directory
    /// (`~/Library/Application Support/cmux`).
    ///
    /// Retained only so the app can migrate persistent files (the socket
    /// password) out of TCC-protected storage on launch. New reads and writes go
    /// through ``url(homeDirectory:)``; nothing on the CLI hook path should touch
    /// this location. The `FileManager` is injected (no ambient default) to keep
    /// the seam explicit for tests and alternate callers.
    ///
    /// - Parameter fileManager: Used to resolve Application Support.
    /// - Returns: The legacy directory, or `nil` when Application Support cannot
    ///   be resolved.
    public static func legacyApplicationSupportURL(fileManager: FileManager) -> URL? {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent(legacyDirectoryName, isDirectory: true)
    }

    /// The pre-rebrand state directory: `<home>/.local/state/cmux`.
    /// - Parameter homeDirectory: The user's home directory.
    public static func legacyURL(homeDirectory: URL) -> URL {
        homeDirectory
            .appendingPathComponent(".local", isDirectory: true)
            .appendingPathComponent("state", isDirectory: true)
            .appendingPathComponent(legacyDirectoryName, isDirectory: true)
    }

    /// Moves each child of the legacy `~/.local/state/cmux` directory into
    /// `~/.local/state/deppy-mux`, once.
    ///
    /// A per-child merge (not a whole-directory rename) so re-runs are safe and
    /// newer files are never overwritten. Ephemeral socket files (`*.sock`) are
    /// skipped: a still-running pre-rename instance may be listening on them,
    /// and every listener recreates its socket on launch anyway. The legacy
    /// directory itself is intentionally left in place — GhosttyKit keeps
    /// writing crash reports under it (path baked in at build time).
    /// - Parameter fileManager: The file manager used for the moves.
    public static func migrateLegacyStateDirectoryIfNeeded(fileManager: FileManager) {
        let home = fileManager.homeDirectoryForCurrentUser
        let legacy = legacyURL(homeDirectory: home)
        let destination = url(homeDirectory: home)
        guard legacy.standardizedFileURL != destination.standardizedFileURL,
              fileManager.fileExists(atPath: legacy.path)
        else {
            return
        }
        let children = (try? fileManager.contentsOfDirectory(
            at: legacy,
            includingPropertiesForKeys: nil,
            options: []
        )) ?? []
        guard !children.isEmpty else { return }
        try? fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
        for child in children {
            guard child.pathExtension != "sock" else { continue }
            let target = destination.appendingPathComponent(child.lastPathComponent)
            guard !fileManager.fileExists(atPath: target.path) else { continue }
            try? fileManager.moveItem(at: child, to: target)
        }
    }
}
