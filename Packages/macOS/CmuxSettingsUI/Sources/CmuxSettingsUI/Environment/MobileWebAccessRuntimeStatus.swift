import Foundation

/// Runtime availability for the local Web Connect server.
public enum MobileWebAccessRuntimeStatus: Sendable, Equatable {
    /// A user-installed runtime is available at the given path.
    case installed(path: String)
    /// A runtime is bundled with the app.
    case bundled(path: String)
    /// A runtime was supplied outside the app or standard install location.
    case external(path: String)
    /// No Web Connect runtime is available.
    case missing
}
