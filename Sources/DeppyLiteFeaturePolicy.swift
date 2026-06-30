import CmuxWorkspaces
import Foundation

/// Central switchboard for the deppy-lite branch.
struct DeppyLiteFeaturePolicy: Sendable {
    #if DEPPY_LITE
    static let isEnabled = true
    #else
    static let isEnabled = false
    #endif

    static var internalBrowserEnabled: Bool { !isEnabled }
    static var taskManagerEnabled: Bool { !isEnabled }
    static var resourceDiagnosticsEnabled: Bool { !isEnabled }
    static var customSidebarProvidersEnabled: Bool { !isEnabled }
    static var extensionSidebarProvidersEnabled: Bool { !isEnabled }
    static var paneMemoryPollingEnabled: Bool { !isEnabled }
    static var previewPanelsEnabled: Bool { !isEnabled }
    static var feedEnabled: Bool { !isEnabled }
    static var cloudVMEnabled: Bool { !isEnabled }
    static var pwaWebAccessEnabled: Bool { true }
    static var sessionRestoreEnabled: Bool { true }
    static var mobileWorkspaceObserverEnabled: Bool { !isEnabled }

    private static let mobileTerminalSocketAliases: Set<String> = [
        "terminal.create",
        "terminal.input",
        "terminal.paste",
        "terminal.paste_image",
        "terminal.replay",
        "terminal.viewport",
        "terminal.scroll",
        "terminal.mouse",
        "terminal.set_font",
    ]

    static func supportedSessionPanelType(_ panelType: PanelType) -> Bool {
        guard isEnabled else { return true }
        return panelType == .terminal
    }

    static func canCreatePanel(_ panelType: PanelType) -> Bool {
        guard isEnabled else { return true }
        return panelType == .terminal
    }

    static func resolvedInitialSurface(_ initialSurface: NewWorkspaceInitialSurface) -> NewWorkspaceInitialSurface {
        guard isEnabled else { return initialSurface }
        switch initialSurface {
        case .terminal:
            return .terminal
        case .browser:
            return .terminal
        }
    }

    static func hidesCommandPaletteCommand(_ commandId: String) -> Bool {
        guard isEnabled else { return false }
        let normalized = commandId.lowercased()
        return normalized.contains("browser") ||
            normalized.contains("diffviewer") ||
            normalized.hasPrefix("palette.markdown") ||
            normalized == "palette.openfilespane" ||
            normalized == "palette.openfindpane" ||
            normalized == "palette.openfolderinvscodeinline" ||
            normalized == "palette.openvaultpane"
    }

    static func blocksSocketMethod(_ method: String) -> Bool {
        guard isEnabled else { return false }
        return method.hasPrefix("browser.") ||
            method.hasPrefix("feed.") ||
            method.hasPrefix("vm.") ||
            method.hasPrefix("remotes.") ||
            method.hasPrefix("workspace.remote.") ||
            method.hasPrefix("remote.tmux.") ||
            method.hasPrefix("mobile.") ||
            mobileTerminalSocketAliases.contains(method) ||
            method.hasPrefix("sidebar.custom.") ||
            method.hasPrefix("debug.") ||
            method == "extension.sidebar.snapshot" ||
            method == "file.open" ||
            method == "markdown.open" ||
            method == "system.top" ||
            method == "system.memory"
    }

    static func hidesSocketCapability(_ method: String) -> Bool {
        guard isEnabled else { return false }
        return blocksSocketMethod(method)
    }
}
