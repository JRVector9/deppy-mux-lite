import Foundation

#if DEBUG
private enum CustomSidebarDirectoryOverrideForTesting {
    @TaskLocal static var value: URL?
}
#endif

extension CmuxExtensionSidebarSelection {
    #if DEBUG
    static var customSidebarsDirectoryOverrideForTesting: URL? {
        CustomSidebarDirectoryOverrideForTesting.value
    }

    static func withCustomSidebarsDirectoryForTesting<T>(_ directory: URL, _ body: () throws -> T) rethrows -> T {
        try CustomSidebarDirectoryOverrideForTesting.$value.withValue(directory) {
            try body()
        }
    }
    #endif

    static func customSidebarFileURL(forName name: String) -> URL? {
        guard DeppyLiteFeaturePolicy.customSidebarProvidersEnabled else { return nil }
        return customSidebarFileURL(forName: name, sidebarsDirectory: customSidebarsDirectory)
    }

    static func customSidebarFileURL(forName name: String, sidebarsDirectory: URL) -> URL? {
        guard DeppyLiteFeaturePolicy.customSidebarProvidersEnabled else { return nil }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return customSidebarFileURL(
            forProviderId: customSidebarProviderPrefix + trimmed,
            sidebarsDirectory: sidebarsDirectory
        )
    }
}
