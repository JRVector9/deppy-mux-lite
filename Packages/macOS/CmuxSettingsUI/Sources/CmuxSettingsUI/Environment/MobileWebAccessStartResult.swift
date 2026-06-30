import Foundation

/// Result of asking the host app to create a browser Web Connect session.
public enum MobileWebAccessStartResult: Sendable, Equatable {
    /// A session was created and this Mac started heartbeating it.
    case started(MobileWebAccessSessionSnapshot)
    /// The user is not signed in, or the saved Stack session expired.
    case notSignedIn
    /// Tailscale is required for browser Web Connect, but no Tailscale address is available.
    case tailscaleUnavailable
    /// The local or configured Web Connect server is not reachable or does not expose the required API.
    case webEndpointUnavailable
    /// The server or network rejected the request.
    case failed
}
