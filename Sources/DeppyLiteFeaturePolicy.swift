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
}
