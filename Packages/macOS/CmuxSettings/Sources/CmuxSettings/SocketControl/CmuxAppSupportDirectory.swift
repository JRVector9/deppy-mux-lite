public import Foundation

/// The per-user Application Support directory that holds deppy-mux's persistent
/// app data: session snapshots, closed-item history, the search index, diff
/// comments, auth state, and similar app-owned files.
///
/// Resolves to `~/Library/Application Support/deppy-mux`. Before the rebrand the
/// same data lived under `~/Library/Application Support/cmux`;
/// ``migrateLegacyDirectoryIfNeeded(fileManager:)`` moves that data over once on
/// launch so existing users keep their sessions and history.
public enum CmuxAppSupportDirectory {
    /// The directory name segment under Application Support.
    public static let directoryName = "deppy-mux"

    /// The pre-rebrand directory name, read only to migrate existing data.
    public static let legacyDirectoryName = "cmux"

    /// The deppy-mux Application Support directory
    /// (`~/Library/Application Support/deppy-mux`).
    ///
    /// The `FileManager` is injected (no ambient default) so the resolution has
    /// no hidden global state; composition roots pass `.default`.
    /// - Parameter fileManager: Used to resolve Application Support.
    /// - Returns: The directory URL, or `nil` when Application Support cannot be
    ///   resolved.
    public static func url(fileManager: FileManager) -> URL? {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    /// The pre-rebrand directory (`~/Library/Application Support/cmux`).
    /// - Parameter fileManager: Used to resolve Application Support.
    public static func legacyURL(fileManager: FileManager) -> URL? {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent(legacyDirectoryName, isDirectory: true)
    }

    /// Moves each child of the legacy `cmux` directory into the `deppy-mux`
    /// directory, once, then removes the legacy directory if it is empty.
    ///
    /// A per-child merge (not a whole-directory rename) because the new
    /// directory can already exist — the Web Connect runtime installed there
    /// before this migration shipped. A child that already exists at the new
    /// location is left in place under the legacy directory rather than
    /// overwritten, so the migration can never destroy newer data.
    ///
    /// Call early on app launch, before anything reads Application Support.
    /// - Parameter fileManager: The file manager used for the moves.
    public static func migrateLegacyDirectoryIfNeeded(fileManager: FileManager) {
        guard let legacy = legacyURL(fileManager: fileManager),
              let destination = url(fileManager: fileManager),
              legacy.standardizedFileURL != destination.standardizedFileURL,
              fileManager.fileExists(atPath: legacy.path)
        else {
            return
        }
        let children = (try? fileManager.contentsOfDirectory(
            at: legacy,
            includingPropertiesForKeys: nil,
            options: []
        )) ?? []
        guard !children.isEmpty else {
            try? fileManager.removeItem(at: legacy)
            return
        }
        try? fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
        for child in children {
            let target = destination.appendingPathComponent(child.lastPathComponent)
            guard !fileManager.fileExists(atPath: target.path) else { continue }
            try? fileManager.moveItem(at: child, to: target)
        }
        if let remaining = try? fileManager.contentsOfDirectory(atPath: legacy.path), remaining.isEmpty {
            try? fileManager.removeItem(at: legacy)
        }
    }
}
