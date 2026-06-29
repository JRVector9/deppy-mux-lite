import CmuxSettings
import Foundation

/// Host-provided visibility policy for settings surfaces that depend on
/// optional app features.
public struct SettingsFeatureAvailability: Sendable, Equatable {
    public var hiddenSections: Set<SettingsSectionID>
    public var hiddenSettingEntries: Set<String>
    public var hiddenShortcutActions: Set<ShortcutAction>

    public init(
        hiddenSections: Set<SettingsSectionID> = [],
        hiddenSettingEntries: Set<String> = [],
        hiddenShortcutActions: Set<ShortcutAction> = []
    ) {
        self.hiddenSections = hiddenSections
        self.hiddenSettingEntries = hiddenSettingEntries
        self.hiddenShortcutActions = hiddenShortcutActions
    }

    public static let all = SettingsFeatureAvailability()

    public func isSectionVisible(_ section: SettingsSectionID) -> Bool {
        !hiddenSections.contains(section)
    }

    public func isSettingEntryVisible(section: SettingsSectionID, id: String) -> Bool {
        isSectionVisible(section) && !hiddenSettingEntries.contains(Self.settingEntryKey(section: section, id: id))
    }

    public func isCuratedEntryVisible(_ entry: CuratedSettingEntry) -> Bool {
        isSettingEntryVisible(section: entry.section, id: entry.id)
    }

    public func visibleShortcutActions(from actions: [ShortcutAction]) -> [ShortcutAction] {
        actions.filter { !hiddenShortcutActions.contains($0) }
    }

    public static func settingEntryKey(section: SettingsSectionID, id: String) -> String {
        "\(section.rawValue):\(id)"
    }
}
