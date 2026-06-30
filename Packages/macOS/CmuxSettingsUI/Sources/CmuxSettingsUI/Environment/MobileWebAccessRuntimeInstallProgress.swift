import Foundation

/// Progress while installing the optional local Web Connect runtime.
public enum MobileWebAccessRuntimeInstallProgress: Sendable, Equatable {
    /// The installer is locating a package source or preparing the staging directory.
    case preparing
    /// The installer is downloading the runtime archive.
    case downloading(fraction: Double?)
    /// The installer is extracting or moving the runtime into place.
    case installing
}
