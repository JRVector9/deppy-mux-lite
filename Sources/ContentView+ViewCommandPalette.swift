import CmuxCommandPalette
import Foundation

extension ContentView {
    static func commandPaletteViewCommandContributions() -> [CommandPaletteCommandContribution] {
        func constant(_ value: String) -> (CommandPaletteContextSnapshot) -> String {
            { _ in value }
        }

        var contributions = [
            CommandPaletteCommandContribution(
                commandId: "palette.triggerFlash",
                title: constant(String(localized: "command.triggerFlash.title", defaultValue: "Flash Focused Panel")),
                subtitle: constant(String(localized: "command.triggerFlash.subtitle", defaultValue: "View")),
                keywords: ["flash", "highlight", "focus", "panel"]
            ),
            CommandPaletteCommandContribution(
                commandId: "palette.sleepyMode",
                title: constant(String(localized: "command.sleepyMode.title", defaultValue: "Sleepy Mode")),
                subtitle: constant(String(localized: "command.sleepyMode.subtitle", defaultValue: "View")),
                keywords: ["sleepy", "screensaver", "caffeinate", "keep awake", "do not sleep", "lock", "pets", "night"]
            ),
        ]
        if DeppyLiteFeaturePolicy.taskManagerEnabled {
            contributions.append(
                CommandPaletteCommandContribution(
                    commandId: "palette.openTaskManager",
                    title: constant(String(localized: "taskManager.title", defaultValue: "Task Manager")),
                    subtitle: constant(String(localized: "command.closeWindow.subtitle", defaultValue: "Window")),
                    keywords: ["task", "manager", "process", "cpu", "memory", "kill"]
                )
            )
        }
        return contributions
    }

    func registerViewCommandHandlers(_ registry: inout CommandPaletteHandlerRegistry) {
        registry.register(commandId: "palette.triggerFlash") {
            tabManager.triggerFocusFlash()
        }
        if DeppyLiteFeaturePolicy.taskManagerEnabled {
            registry.register(commandId: "palette.openTaskManager") {
                TaskManagerWindowController.shared.show()
            }
        }
        registry.register(commandId: "palette.sleepyMode") {
            SleepyModeController.shared.activate()
        }
    }
}
