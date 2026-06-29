import Foundation

/// Result of asking the host app to create a browser web access session.
public enum MobileWebAccessStartResult: Sendable, Equatable {
    /// A session was created and this Mac started heartbeating it.
    case started(MobileWebAccessSessionSnapshot)
    /// The user is not signed in, or the saved Stack session expired.
    case notSignedIn
    /// Tailscale is required for browser web access, but no Tailscale address is available.
    case tailscaleUnavailable
    /// The server or network rejected the request.
    case failed
}
