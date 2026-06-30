import Foundation

/// Result of asking the host app to start or stop the local Web Connect server.
public enum MobileWebAccessServerControlResult: Sendable, Equatable {
    /// The local server is running on the requested port.
    case running(port: Int)
    /// The local server has been stopped.
    case stopped
    /// The requested port is invalid.
    case invalidPort(port: Int)
    /// Another local process is already using the requested port.
    case portInUse(port: Int)
    /// The host could not find an installed Web Connect runtime.
    case runtimeMissing
    /// The host found a runtime but could not launch it.
    case failed(port: Int)
}
