import Foundation

/// Mobile integration settings for pairing and syncing with cmux on iOS.
public struct MobileCatalogSection: SettingCatalogSection {
    /// Mac-side iOS pairing host. Release defaults OFF so macOS never asks for
    /// Local Network permission until the user opts in from Settings. DEBUG
    /// (dev) builds default ON so a dev Mac advertises its attach route without a
    /// manual Settings toggle — this is what lets a fresh dev iOS build discover
    /// the Mac automatically (see MacPairedMacBackupPublisher). An explicit user
    /// toggle still wins on either build.
    public let iOSPairingHost = DefaultsKey<Bool>(
        id: "mobile.iOSPairingHost.enabled",
        defaultValue: Self.iOSPairingHostDefault,
        userDefaultsKey: "mobile.iOSPairingHost.enabled"
    )

    #if DEBUG
    private static let iOSPairingHostDefault = true
    #else
    private static let iOSPairingHostDefault = false
    #endif

    /// TCP port the Mac-side iOS pairing listener prefers to bind.
    ///
    /// This is a *preference*: if the port is already in use the listener
    /// falls back to an OS-assigned ephemeral port, and the iOS app is always
    /// handed the actual bound port (so pairing still works). Configure a fixed
    /// port when you need predictable firewall rules or to avoid a conflict.
    /// The default mirrors `CmxMobileDefaults.defaultHostPort`, the protocol
    /// default mobile clients dial when a pairing payload omits a port.
    public let iOSPairingPort = DefaultsKey<Int>(
        id: "mobile.iOSPairingHost.port",
        defaultValue: 58_465,
        userDefaultsKey: "mobile.iOSPairingHost.port"
    )

    /// Optional override for the name the iOS app shows for this Mac during
    /// pairing. Empty means use the Mac's name from System Settings
    /// (`Host.current().localizedName`). Useful when pairing against several
    /// Macs that would otherwise share a name.
    public let iOSPairingDisplayName = DefaultsKey<String>(
        id: "mobile.iOSPairingHost.displayName",
        defaultValue: "",
        userDefaultsKey: "mobile.iOSPairingHost.displayName"
    )

    /// Whether the local Web Connect server should stay running.
    ///
    /// Creating a Web Connect link turns this on automatically. Users can turn
    /// it off from Settings to stop the bundled local server.
    public let webConnectServerEnabled = DefaultsKey<Bool>(
        id: "mobile.webConnect.server.enabled",
        defaultValue: false,
        userDefaultsKey: "mobile.webConnect.server.enabled"
    )

    /// TCP port used by the local Web Connect server.
    ///
    /// The default is intentionally fixed so Tailscale links and firewall rules
    /// stay predictable. If another process owns the port, the server does not
    /// randomize; the user chooses a different port here.
    public let webConnectPort = DefaultsKey<Int>(
        id: "mobile.webConnect.port",
        defaultValue: 9_170,
        userDefaultsKey: "mobile.webConnect.port"
    )

    /// Creates the Mobile settings catalog section.
    public init() {}
}
