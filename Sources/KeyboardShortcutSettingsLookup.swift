import CmuxSettings
import CmuxSettingsUI
import Foundation

/// Cache of decoded `shortcutIfBound` results: the menu tree re-evaluates its
/// key equivalents often, and a UserDefaults read + JSONDecoder round trip per
/// lookup is measurable. Guarded by an NSLock because lookups run from
/// non-isolated contexts (menu validation, Carbon hotkey refresh).
/// Invalidation is notification-driven; an external `defaults write` that posts
/// no in-app change notification may serve stale values until the next signal.
private enum ShortcutLookupCache {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var valuesByAction: [KeyboardShortcutSettings.Action: StoredShortcut?] = [:]
    /// Bumped on every invalidation so a lookup computed outside the lock is
    /// dropped instead of cached when an invalidation raced it.
    nonisolated(unsafe) private static var generation: UInt64 = 0

    /// Registered once, lazily on the first lookup. The whole cache clears on
    /// every signal that can change a lookup result:
    /// - `KeyboardShortcutSettings.didChangeNotification`: shortcut writes,
    ///   swaps, resets, and cmux.json config reloads (the file store posts it
    ///   via `notifySettingsFileDidChange` when its shortcuts/when-clauses
    ///   change).
    /// - Both recorder-activity notifications (`menuShortcut` forces `.unbound`
    ///   while either recorder is armed).
    /// - `UserDefaults.didChangeNotification`: catches in-process writes to an
    ///   action's defaults key that bypass `setShortcut` (UI-test setup, test
    ///   restore helpers), same rationale as `SystemWideHotkeyController`.
    nonisolated(unsafe) private static let invalidationObservers: [NSObjectProtocol] = {
        let names: [Notification.Name] = [
            KeyboardShortcutSettings.didChangeNotification,
            KeyboardShortcutRecorderActivity.didChangeNotification,
            RecorderHostButton.activeRecordingDidChangeNotification,
            UserDefaults.didChangeNotification,
        ]
        return names.map { name in
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { _ in
                removeAll()
            }
        }
    }()

    static func shortcut(
        for action: KeyboardShortcutSettings.Action,
        compute: () -> StoredShortcut?
    ) -> StoredShortcut? {
        _ = invalidationObservers
        lock.lock()
        if let cached = valuesByAction[action] {
            lock.unlock()
            return cached
        }
        let generationAtMiss = generation
        lock.unlock()
        // Compute outside the lock: the closure reads UserDefaults and the
        // settings file store, and holding our lock across those reads could
        // invert lock order against a concurrent writer whose change
        // notification synchronously calls `removeAll()`.
        let computed = compute()
        lock.lock()
        if generation == generationAtMiss {
            valuesByAction[action] = computed
        }
        lock.unlock()
        return computed
    }

    private static func removeAll() {
        lock.lock()
        valuesByAction.removeAll()
        generation &+= 1
        lock.unlock()
    }
}

extension KeyboardShortcutSettings {
    static func shortcutIfBound(for action: Action) -> StoredShortcut? {
        #if DEBUG
        shortcutLookupObserver?(action)
        #endif

        return ShortcutLookupCache.shortcut(for: action) {
            if let managedShortcut = settingsFileStore.override(for: action) {
                return managedShortcut.isUnbound ? nil : managedShortcut
            }

            guard let data = UserDefaults.standard.data(forKey: action.defaultsKey),
                  let shortcut = try? JSONDecoder().decode(StoredShortcut.self, from: data) else {
                let defaultShortcut = action.defaultShortcut
                return defaultShortcut.isUnbound ? nil : defaultShortcut
            }
            return shortcut.isUnbound ? nil : shortcut
        }
    }

    static func shortcut(for action: Action) -> StoredShortcut {
        shortcutIfBound(for: action) ?? .unbound
    }

    static func menuShortcut(for action: Action) -> StoredShortcut {
        guard !KeyboardShortcutRecorderActivity.isAnyRecorderActive,
              !RecorderHostButton.isActivelyRecording else {
            return .unbound
        }

        // A static menu key equivalent fires regardless of focus, which would
        // bypass a configured `shortcuts.when` clause (e.g. fire a sidebar-gated
        // closeTab via the File menu while a terminal is focused). When the user
        // has explicitly scoped an action with `when`, drop its menu equivalent so
        // the context-gated keyDown handler is the sole dispatcher (issue #5189).
        // Built-in default contexts are left alone to preserve existing menu badges.
        if hasRestrictingConfiguredWhenClause(for: action) {
            return .unbound
        }

        let shortcut = shortcut(for: action)
        switch action {
        case .browserBack
            where !shortcut.isUnbound && shortcut == KeyboardShortcutSettings.shortcut(for: .focusHistoryBack):
            return .unbound
        case .browserForward
            where !shortcut.isUnbound && shortcut == KeyboardShortcutSettings.shortcut(for: .focusHistoryForward):
            return .unbound
        default:
            return shortcut
        }
    }

    static func isManagedBySettingsFile(_ action: Action) -> Bool {
        settingsFileStore.isManagedByFile(action)
    }

    /// The effective focus predicate gating `action`: the `shortcuts.when`
    /// override from cmux.json if present, otherwise the action's built-in
    /// ``KeyboardShortcutSettings/Action/shortcutContext`` expressed as a
    /// ``ShortcutWhenClause``. Drives both runtime availability and conflict
    /// detection so the same keystroke can be context-routed.
    static func effectiveWhenClause(for action: Action) -> ShortcutWhenClause {
        settingsFileStore.whenClause(for: action) ?? action.shortcutContext.defaultWhenClause
    }

    /// Whether `action` has an explicit `shortcuts.when` override that restricts focus.
    static func hasRestrictingConfiguredWhenClause(for action: Action) -> Bool {
        guard let clause = settingsFileStore.whenClause(for: action) else {
            return false
        }
        return clause != .always
    }

    static func unbindShortcut(for action: Action) {
        setShortcut(.unbound, for: action)
    }

    static func settingsFileManagedSubtitle(for action: Action) -> String? {
        guard isManagedBySettingsFile(action) else { return nil }
        return String(localized: "settings.shortcuts.managedByFile", defaultValue: "Managed in deppy-mux.json")
    }

}
