import Foundation

/// Result of installing the local Web Connect runtime.
public enum MobileWebAccessRuntimeInstallResult: Sendable, Equatable {
    /// The runtime was installed at the given path.
    case installed(path: String)
    /// The host has no runtime package source available.
    case missingSource
    /// The runtime installation failed.
    case failed
    /// The runtime removal failed.
    case removeFailed
}
