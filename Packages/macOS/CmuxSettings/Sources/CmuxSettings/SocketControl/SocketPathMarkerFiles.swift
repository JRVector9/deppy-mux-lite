public import Foundation

public enum SocketPathMarkerFiles {
    public static let stableMarkerFileName = "last-socket-path"
    public static let stableTmpPath = "/tmp/cmux-last-socket-path"
    public static let nightlyBundleIdentifier = "com.deppy-mux.app.nightly"
    public static let stagingBundleIdentifier = "com.deppy-mux.app.staging"
    public static let defaultBaseDebugBundleIdentifier = "com.deppy-mux.app.debug"
    static let legacyNightlyBundleIdentifier = "com.cmuxterm.app.nightly"
    static let legacyStagingBundleIdentifier = "com.cmuxterm.app.staging"
    static let legacyBaseDebugBundleIdentifier = "com.cmuxterm.app.debug"
    public static let defaultDebugSocketPath = "/tmp/cmux-debug.sock"
    public static let defaultNightlySocketPath = "/tmp/cmux-nightly.sock"
    public static let defaultStagingSocketPath = "/tmp/cmux-staging.sock"

    public static func markerFileURL(
        fileName: String = stableMarkerFileName,
        directory: URL?
    ) -> URL? {
        directory?.appendingPathComponent(fileName, isDirectory: false)
    }

    public static func paths(
        bundleIdentifier: String?,
        environment: [String: String],
        directory: URL?,
        baseDebugBundleIdentifier: String = defaultBaseDebugBundleIdentifier
    ) -> [String] {
        let variant = variant(
            bundleIdentifier: bundleIdentifier,
            environment: environment,
            baseDebugBundleIdentifier: baseDebugBundleIdentifier
        )
        var candidates: [String] = []
        if let directoryPath = markerFileURL(
            fileName: variant.markerFileName,
            directory: directory
        )?.path {
            candidates.append(directoryPath)
        }
        candidates.append(variant.tmpPath)
        return dedupe(candidates)
    }

    public static func variant(
        bundleIdentifier: String?,
        environment: [String: String],
        baseDebugBundleIdentifier: String = defaultBaseDebugBundleIdentifier
    ) -> SocketPathVariant {
        let bundleId = bundleIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        for nightlyIdentifier in [nightlyBundleIdentifier, legacyNightlyBundleIdentifier] {
            if bundleId == nightlyIdentifier {
                return .nightly(slug: nil)
            }
            let nightlyPrefix = nightlyIdentifier + "."
            if bundleId.hasPrefix(nightlyPrefix) {
                return .nightly(slug: bundleSuffixSlug(bundleId, prefix: nightlyPrefix))
            }
        }

        for stagingIdentifier in [stagingBundleIdentifier, legacyStagingBundleIdentifier] {
            if bundleId == stagingIdentifier {
                return .staging(slug: nil)
            }
            let stagingPrefix = stagingIdentifier + "."
            if bundleId.hasPrefix(stagingPrefix) {
                return .staging(slug: bundleSuffixSlug(bundleId, prefix: stagingPrefix))
            }
        }

        for debugIdentifier in debugBundleIdentifiers(baseDebugBundleIdentifier) {
            if bundleId == debugIdentifier {
                if let tag = normalized(environment["CMUX_TAG"]),
                   let slug = sanitizeSocketSlug(tag) {
                    return .dev(slug: slug)
                }
                return .dev(slug: nil)
            }
            let debugPrefix = debugIdentifier + "."
            if bundleId.hasPrefix(debugPrefix) {
                return .dev(slug: bundleSuffixSlug(bundleId, prefix: debugPrefix))
            }
        }
        return .stable
    }

    public static func defaultSocketPath(
        bundleIdentifier: String?,
        environment: [String: String],
        isDebugBuild: Bool,
        stableSocketPath: String,
        baseDebugBundleIdentifier: String = defaultBaseDebugBundleIdentifier,
        debugSocketPath: String = defaultDebugSocketPath,
        nightlySocketPath: String = defaultNightlySocketPath,
        stagingSocketPath: String = defaultStagingSocketPath
    ) -> String {
        switch variant(
            bundleIdentifier: bundleIdentifier,
            environment: environment,
            baseDebugBundleIdentifier: baseDebugBundleIdentifier
        ) {
        case .stable:
            return isDebugBuild ? debugSocketPath : stableSocketPath
        case .nightly(let slug):
            if let slug {
                return "/tmp/cmux-nightly-\(slug).sock"
            }
            return nightlySocketPath
        case .staging(let slug):
            if let slug {
                return "/tmp/cmux-staging-\(slug).sock"
            }
            return stagingSocketPath
        case .dev(let slug):
            if let slug {
                return "/tmp/cmux-debug-\(slug).sock"
            }
            return debugSocketPath
        }
    }

    public static func sanitizeSocketSlug(_ raw: String) -> String? {
        let slug = raw
            .lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return slug.isEmpty ? nil : slug
    }

    private static func bundleSuffixSlug(_ bundleIdentifier: String, prefix: String) -> String? {
        let suffix = String(bundleIdentifier.dropFirst(prefix.count))
        return sanitizeSocketSlug(suffix)
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func debugBundleIdentifiers(_ baseDebugBundleIdentifier: String) -> [String] {
        dedupe([
            baseDebugBundleIdentifier,
            defaultBaseDebugBundleIdentifier,
            legacyBaseDebugBundleIdentifier,
        ])
    }

    private static func dedupe(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for value in values where seen.insert(value).inserted {
            ordered.append(value)
        }
        return ordered
    }
}
