import Foundation

/// Conventional on-disk locations for the deppy-mux JSON config.
///
/// A small value-typed bundle of URLs. Construct one with an explicit `home`
/// directory and inject it into the parts of the app that need to know where
/// the config file lives. No shared singletons; tests use a custom `home` URL
/// pointing into a temp directory.
///
/// The primary location is `~/.config/deppy-mux/deppy-mux.json`. Before the
/// rebrand the config lived at `~/.config/cmux/cmux.json` (with a
/// `settings.json` fallback); when the primary file is absent but a legacy
/// file exists, ``userConfigFile`` resolves to the legacy path so processes
/// that have not run the one-time migration (e.g. the standalone CLI) keep
/// reading and writing the user's real config.
///
/// ```swift
/// let locations = CmuxConfigLocation()
/// let store = JSONConfigStore(fileURL: locations.userConfigFile)
/// ```
public struct CmuxConfigLocation: Sendable, Hashable {
    /// The active config file: the primary deppy-mux path, or the legacy cmux
    /// path when only the legacy file exists.
    public let userConfigFile: URL

    /// The primary config file: `<home>/.config/deppy-mux/deppy-mux.json`.
    public let primaryConfigFile: URL

    /// The pre-rebrand config file: `<home>/.config/cmux/cmux.json`.
    public let legacyUserConfigFile: URL

    /// The oldest fallback: `<home>/.config/cmux/settings.json`. The app's
    /// settings reader checks this when the other files are absent.
    public let legacyFallbackFile: URL

    /// Creates a location bundle anchored at the given home directory.
    ///
    /// - Parameters:
    ///   - home: The home directory to anchor paths to. Defaults to
    ///     `FileManager.default.homeDirectoryForCurrentUser`. Pass a temp URL
    ///     in tests.
    ///   - fileManager: Used to check which config files exist when resolving
    ///     ``userConfigFile``.
    public init(
        home: URL = FileManager.default.homeDirectoryForCurrentUser,
        fileManager: FileManager = .default
    ) {
        // `URL.appending(path:)` is the modern Foundation API (macOS 13+);
        // returns a non-optional URL without the legacy `isDirectory` flag.
        let primary = home.appending(path: ".config/deppy-mux/deppy-mux.json")
        let legacy = home.appending(path: ".config/cmux/cmux.json")
        self.primaryConfigFile = primary
        self.legacyUserConfigFile = legacy
        self.legacyFallbackFile = home.appending(path: ".config/cmux/settings.json")
        if !fileManager.fileExists(atPath: primary.path), fileManager.fileExists(atPath: legacy.path) {
            self.userConfigFile = legacy
        } else {
            self.userConfigFile = primary
        }
    }

    /// Moves each child of the legacy `~/.config/cmux` directory into
    /// `~/.config/deppy-mux`, once, renaming `cmux.json` to `deppy-mux.json`.
    ///
    /// A per-child merge so re-runs are safe and existing files at the new
    /// location are never overwritten. The legacy directory is removed when the
    /// migration leaves it empty.
    /// - Parameters:
    ///   - home: The home directory to anchor paths to.
    ///   - fileManager: The file manager used for the moves.
    public static func migrateLegacyConfigDirectoryIfNeeded(
        home: URL = FileManager.default.homeDirectoryForCurrentUser,
        fileManager: FileManager = .default
    ) {
        let legacyDirectory = home.appending(path: ".config/cmux")
        let destinationDirectory = home.appending(path: ".config/deppy-mux")
        guard legacyDirectory.standardizedFileURL != destinationDirectory.standardizedFileURL,
              fileManager.fileExists(atPath: legacyDirectory.path)
        else {
            return
        }
        let children = (try? fileManager.contentsOfDirectory(
            at: legacyDirectory,
            includingPropertiesForKeys: nil,
            options: []
        )) ?? []
        guard !children.isEmpty else {
            try? fileManager.removeItem(at: legacyDirectory)
            return
        }
        try? fileManager.createDirectory(at: destinationDirectory, withIntermediateDirectories: true)
        for child in children {
            let targetName = child.lastPathComponent == "cmux.json" ? "deppy-mux.json" : child.lastPathComponent
            let target = destinationDirectory.appendingPathComponent(targetName)
            guard !fileManager.fileExists(atPath: target.path) else { continue }
            try? fileManager.moveItem(at: child, to: target)
        }
        if let remaining = try? fileManager.contentsOfDirectory(atPath: legacyDirectory.path), remaining.isEmpty {
            try? fileManager.removeItem(at: legacyDirectory)
        }
    }
}
