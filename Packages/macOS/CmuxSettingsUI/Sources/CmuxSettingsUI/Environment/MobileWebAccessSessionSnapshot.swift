import Foundation

/// Public URL session state for browser-based mobile access.
public struct MobileWebAccessSessionSnapshot: Sendable, Equatable {
    /// The unguessable session slug used by `/w/<slug>`.
    public let slug: String
    /// The browser URL the user can open from another device.
    public let publicURL: String
    /// When the server will expire this session if it is not recreated.
    public let expiresAt: Date
    /// When the server last accepted a heartbeat from this Mac, if known.
    public let hostSeenAt: Date?

    /// Creates a web access session snapshot.
    ///
    /// - Parameters:
    ///   - slug: The unguessable session slug used by `/w/<slug>`.
    ///   - publicURL: The browser URL the user can open from another device.
    ///   - expiresAt: When the server will expire this session.
    ///   - hostSeenAt: When the server last accepted a host heartbeat.
    public init(slug: String, publicURL: String, expiresAt: Date, hostSeenAt: Date?) {
        self.slug = slug
        self.publicURL = publicURL
        self.expiresAt = expiresAt
        self.hostSeenAt = hostSeenAt
    }
}
