#if DEPPY_LITE
import AppKit
import Bonsplit
import CMUXAgentLaunch
import CmuxAppKitSupportUI
import CmuxControlSocket
import CmuxCore
import CmuxSettings
import Combine
import Foundation
import SwiftUI
import WebKit

enum GhosttyBackgroundTheme {
    static func clampedOpacity(_ opacity: Double) -> CGFloat {
        WindowAppearanceSnapshot.clampedOpacity(opacity)
    }

    static func color(backgroundColor: NSColor, opacity: Double) -> NSColor {
        WindowAppearanceSnapshot.compositedTerminalColor(
            backgroundColor: backgroundColor,
            opacity: opacity
        )
    }

    static func color(
        from notification: Notification?,
        fallbackColor: NSColor,
        fallbackOpacity: Double
    ) -> NSColor {
        let userInfo = notification?.userInfo
        let backgroundColor =
            (userInfo?[GhosttyNotificationKey.backgroundColor] as? NSColor)
            ?? fallbackColor

        let opacity: Double
        if let value = userInfo?[GhosttyNotificationKey.backgroundOpacity] as? Double {
            opacity = value
        } else if let value = userInfo?[GhosttyNotificationKey.backgroundOpacity] as? NSNumber {
            opacity = value.doubleValue
        } else {
            opacity = fallbackOpacity
        }

        return color(backgroundColor: backgroundColor, opacity: opacity)
    }

    static func color(from notification: Notification?) -> NSColor {
        color(
            from: notification,
            fallbackColor: GhosttyApp.shared.defaultBackgroundColor,
            fallbackOpacity: GhosttyApp.shared.defaultBackgroundOpacity
        )
    }

    static func currentColor() -> NSColor {
        color(
            backgroundColor: GhosttyApp.shared.defaultBackgroundColor,
            opacity: GhosttyApp.shared.defaultBackgroundOpacity
        )
    }
}

extension NSColor {
    var markdownOpaqueSRGB: NSColor {
        (usingColorSpace(.sRGB) ?? self).withAlphaComponent(1)
    }

    var markdownCSSColor: String {
        let color = usingColorSpace(.sRGB) ?? self
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 1
        color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        let r = min(255, max(0, Int((red * 255).rounded())))
        let g = min(255, max(0, Int((green * 255).rounded())))
        let b = min(255, max(0, Int((blue * 255).rounded())))
        let a = min(1, max(0, alpha))
        return String(format: "rgba(%d, %d, %d, %.3f)", r, g, b, Double(a))
    }

    func markdownThemeOverlay(targetContrast: CGFloat, of color: NSColor) -> NSColor {
        let base = markdownOpaqueSRGB
        let overlay = color.markdownOpaqueSRGB
        var low: CGFloat = 0
        var high: CGFloat = 1
        var result: CGFloat = 1

        for _ in 0..<18 {
            let mid = (low + high) / 2
            let candidate = base.blended(withFraction: mid, of: overlay) ?? base
            if candidate.markdownContrastRatio(with: base) < Double(targetContrast) {
                low = mid
            } else {
                high = mid
                result = mid
            }
        }

        return overlay.withAlphaComponent(result)
    }

    var markdownRelativeLuminance: Double {
        let color = usingColorSpace(.sRGB) ?? self
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 1
        color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)

        func linear(_ component: CGFloat) -> Double {
            let value = Double(component)
            if value <= 0.04045 {
                return value / 12.92
            }
            return pow((value + 0.055) / 1.055, 2.4)
        }

        return (0.2126 * linear(red)) + (0.7152 * linear(green)) + (0.0722 * linear(blue))
    }

    func markdownContrastRatio(with other: NSColor) -> Double {
        let first = markdownRelativeLuminance
        let second = other.markdownRelativeLuminance
        let lighter = max(first, second)
        let darker = min(first, second)
        return (lighter + 0.05) / (darker + 0.05)
    }
}

private struct CanvasInlineBrowserHostingKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var cmuxCanvasInlineBrowserHosting: Bool {
        get { self[CanvasInlineBrowserHostingKey.self] }
        set { self[CanvasInlineBrowserHostingKey.self] = newValue }
    }
}

enum BrowserThemeSettings {
    static let modeKey = "browserThemeMode"
    static let legacyForcedDarkModeEnabledKey = "browserForcedDarkModeEnabled"
    static let defaultMode: BrowserThemeMode = .system

    static func mode(for rawValue: String?) -> BrowserThemeMode {
        guard let rawValue, let mode = BrowserThemeMode(rawValue: rawValue) else {
            return defaultMode
        }
        return mode
    }

    static func mode(defaults: UserDefaults = .standard) -> BrowserThemeMode {
        mode(for: defaults.string(forKey: modeKey))
    }

    static func apply(_ mode: BrowserThemeMode, to webView: WKWebView) {
        switch mode {
        case .system:
            webView.appearance = nil
        case .light:
            webView.appearance = NSAppearance(named: .aqua)
        case .dark:
            webView.appearance = NSAppearance(named: .darkAqua)
        }
    }
}

nonisolated enum BrowserHiddenWebViewDiscardPolicy {
    struct ResolvedPolicy: Equatable {
        let isEnabled: Bool
        let hiddenDelay: TimeInterval
    }

    static let enabledKey = "browserHiddenWebViewDiscardEnabled"
    static let hiddenDelayKey = "browserHiddenWebViewDiscardDelaySeconds"
    static let defaultEnabled = false
    static let defaultHiddenDelay: TimeInterval = 300
    static let minimumHiddenDelay: TimeInterval = 0
    static let maximumHiddenDelay: TimeInterval = 3600

    static var isEnabled: Bool { false }
    static var hiddenDelay: TimeInterval { defaultHiddenDelay }

    static func resolved(defaults: UserDefaults = .standard) -> ResolvedPolicy {
        ResolvedPolicy(isEnabled: false, hiddenDelay: defaultHiddenDelay)
    }

    static func isEnabled(defaults: UserDefaults) -> Bool { false }

    static func clampedHiddenDelay(_ value: TimeInterval) -> TimeInterval {
        guard value.isFinite else { return defaultHiddenDelay }
        return min(max(value, minimumHiddenDelay), maximumHiddenDelay)
    }

    static func resolvedHiddenDelay(_ value: TimeInterval) -> TimeInterval? {
        guard value.isFinite, value >= minimumHiddenDelay, value <= maximumHiddenDelay else { return nil }
        return clampedHiddenDelay(value)
    }

    static func hiddenDelay(defaults: UserDefaults) -> TimeInterval { defaultHiddenDelay }
}

enum BrowserInsecureHTTPSettings {
    static let allowlistKey = "browserInsecureHTTPAllowlist"
    static let defaultAllowlistPatterns = [
        "localhost",
        "*.localhost",
        "127.0.0.1",
        "::1",
        "0.0.0.0",
        "*.localtest.me",
    ]
    static let defaultAllowlistText = defaultAllowlistPatterns.joined(separator: "\n")

    static func normalizedAllowlistPatterns(defaults: UserDefaults = .standard) -> [String] {
        normalizedAllowlistPatterns(rawValue: defaults.string(forKey: allowlistKey))
    }

    static func normalizedAllowlistPatterns(rawValue: String?) -> [String] {
        let source: String
        if let rawValue, !rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            source = rawValue
        } else {
            source = defaultAllowlistText
        }
        let parsed = parsePatterns(from: source)
        return parsed.isEmpty ? defaultAllowlistPatterns : parsed
    }

    static func isHostAllowed(_ host: String, defaults: UserDefaults = .standard) -> Bool {
        isHostAllowed(host, rawAllowlist: defaults.string(forKey: allowlistKey))
    }

    static func isHostAllowed(_ host: String, rawAllowlist: String?) -> Bool {
        guard let normalizedHost = normalizeHost(host) else { return false }
        return normalizedAllowlistPatterns(rawValue: rawAllowlist).contains { pattern in
            hostMatchesPattern(normalizedHost, pattern: pattern)
        }
    }

    static func addAllowedHost(_ host: String, defaults: UserDefaults = .standard) {
        guard let normalizedHost = normalizeHost(host) else { return }
        var patterns = normalizedAllowlistPatterns(defaults: defaults)
        guard !patterns.contains(normalizedHost) else { return }
        patterns.append(normalizedHost)
        defaults.set(patterns.joined(separator: "\n"), forKey: allowlistKey)
    }

    static func normalizeHost(_ rawHost: String) -> String? {
        RemoteLoopbackProxyAlias.normalizeHost(rawHost)
    }

    private static func parsePatterns(from rawValue: String) -> [String] {
        let separators = CharacterSet(charactersIn: ",;\n\r\t")
        var out: [String] = []
        var seen = Set<String>()
        for token in rawValue.components(separatedBy: separators) {
            guard let normalized = normalizePattern(token) else { continue }
            guard seen.insert(normalized).inserted else { continue }
            out.append(normalized)
        }
        return out
    }

    private static func normalizePattern(_ rawPattern: String) -> String? {
        let trimmed = rawPattern
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard !trimmed.isEmpty else { return nil }

        if trimmed.hasPrefix("*.") {
            let suffixRaw = String(trimmed.dropFirst(2))
            guard let suffix = normalizeHost(suffixRaw) else { return nil }
            return "*.\(suffix)"
        }

        return normalizeHost(trimmed)
    }

    private static func hostMatchesPattern(_ host: String, pattern: String) -> Bool {
        if pattern.hasPrefix("*.") {
            let suffix = String(pattern.dropFirst(2))
            return host == suffix || host.hasSuffix(".\(suffix)")
        }
        return host == pattern
    }
}

enum ReactGrabSettings {
    static let versionKey = "reactGrabVersion"
    static let defaultVersion = "0.1.29"
}

struct ReactGrabShortcutPanelSnapshot: Equatable {
    let id: UUID
    let panelType: PanelType
    let isFocused: Bool
}

struct ReactGrabShortcutRoute: Equatable {
    let browserPanelId: UUID
    let returnTerminalPanelId: UUID?
}

func resolveReactGrabShortcutRoute(
    panels: [ReactGrabShortcutPanelSnapshot]
) -> ReactGrabShortcutRoute? {
    nil
}

private func browserBareHostCandidate(_ lowercasedInput: String) -> String {
    let end = lowercasedInput.firstIndex { character in
        character == ":" || character == "/" || character == "?" || character == "#"
    } ?? lowercasedInput.endIndex
    return String(lowercasedInput[..<end])
}

private func browserDottedHostWithPortCandidate(_ input: String, schemeCandidate: String) -> Bool {
    guard schemeCandidate.contains(".") else { return false }
    guard input.count > schemeCandidate.count else { return false }
    let afterScheme = input.dropFirst(schemeCandidate.count)
    guard afterScheme.first == ":" else { return false }
    let portAndRest = afterScheme.dropFirst()
    let port = portAndRest.prefix(while: { $0.isNumber })
    guard !port.isEmpty, UInt16(port) != nil else { return false }
    let rest = portAndRest.dropFirst(port.count)
    return rest.isEmpty || rest.first == "/" || rest.first == "?" || rest.first == "#"
}

func resolveBrowserNavigableURL(_ input: String) -> URL? {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    guard !trimmed.contains(" ") else { return nil }

    let lower = trimmed.lowercased()
    let bareHost = browserBareHostCandidate(lower)
    if lower.hasPrefix("localhost") ||
        lower.hasPrefix("127.0.0.1") ||
        lower.hasPrefix("[::1]") ||
        (bareHost != ".localhost" && bareHost.hasSuffix(".localhost")) {
        return URL(string: "http://\(trimmed)")
    }

    if let url = URL(string: trimmed), let scheme = url.scheme?.lowercased() {
        if scheme == "http" || scheme == "https" {
            return url
        }
        if scheme == "file", url.isFileURL, url.path.hasPrefix("/") {
            return url
        }
        if browserDottedHostWithPortCandidate(trimmed, schemeCandidate: scheme) {
            return URL(string: "https://\(trimmed)")
        }
        return nil
    }

    if trimmed.contains(":") || trimmed.contains("/") || trimmed.contains(".") {
        return URL(string: "https://\(trimmed)")
    }

    return nil
}

enum MarkdownFontSizeSettings {
    static let key = "markdown.fontSize"
    static let defaultPointSize: Double = 15
    static let minimumPointSize: Double = 8
    static let maximumPointSize: Double = 96
    static let stepPointSize: Double = 1
    static let baseRenderPointSize: Double = 15

    static func clamp(_ value: Double) -> Double {
        min(max(value, minimumPointSize), maximumPointSize)
    }

    static func resolvedDefault(defaults: UserDefaults = .standard) -> Double {
        guard let raw = defaults.object(forKey: key) as? NSNumber else {
            return defaultPointSize
        }
        return clamp(raw.doubleValue)
    }

    static func setDefault(_ points: Double, defaults: UserDefaults = .standard) {
        defaults.set(Int(clamp(points).rounded()), forKey: key)
    }

    static func pageZoom(forPointSize pointSize: Double) -> CGFloat {
        CGFloat(clamp(pointSize) / baseRenderPointSize)
    }
}

enum MarkdownMaxWidthSettings {
    static let key = "markdown.maxWidth"
    static let defaultCSSPixels: Double = 980
    static let minimumCSSPixels: Double = 320
    static let maximumCSSPixels: Double = 2400
    static let stepCSSPixels: Double = 20

    static func clamp(_ value: Double) -> Double {
        min(max(value, minimumCSSPixels), maximumCSSPixels)
    }

    static func resolvedDefault(defaults: UserDefaults = .standard) -> Double {
        guard let raw = defaults.object(forKey: key) as? NSNumber else {
            return defaultCSSPixels
        }
        return clamp(raw.doubleValue)
    }

    static func setDefault(_ pixels: Double, defaults: UserDefaults = .standard) {
        defaults.set(Int(clamp(pixels).rounded()), forKey: key)
    }

    static func resetDefault(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key)
    }
}

enum MarkdownFontFamily {
    static let key = "markdown.fontFamily"
    static let systemDefault = ""

    static func normalized(_ family: String) -> String {
        family
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func cssValue(for family: String) -> String? {
        let trimmed = normalized(family)
        guard !trimmed.isEmpty else { return nil }
        let escaped = trimmed
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }

    static func resolvedDefault(defaults: UserDefaults = .standard) -> String {
        normalized(defaults.string(forKey: key) ?? systemDefault)
    }

    static func setDefault(_ family: String, defaults: UserDefaults = .standard) {
        let trimmed = normalized(family)
        if trimmed.isEmpty {
            defaults.removeObject(forKey: key)
        } else {
            defaults.set(trimmed, forKey: key)
        }
    }

    static func availableFamilies() async -> [String] { [] }
}

enum FilePreviewWordWrapSettings {
    static let key = "fileEditor.wordWrap"
    static let defaultEnabled = false

    static func isEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: key) == nil ? defaultEnabled : defaults.bool(forKey: key)
    }
}

enum BrowserDevToolsIconOption: String, CaseIterable, Identifiable {
    case wrenchAndScrewdriver = "wrench.and.screwdriver"
    case wrenchAndScrewdriverFill = "wrench.and.screwdriver.fill"
    case curlyBracesSquare = "curlybraces.square"
    case curlyBraces = "curlybraces"
    case terminalFill = "terminal.fill"
    case terminal = "terminal"
    case hammer = "hammer"
    case hammerCircle = "hammer.circle"
    case ladybug = "ladybug"
    case ladybugFill = "ladybug.fill"
    case scope = "scope"
    case codeChevrons = "chevron.left.slash.chevron.right"
    case gearshape = "gearshape"
    case gearshapeFill = "gearshape.fill"
    case globe = "globe"
    case globeAmericas = "globe.americas.fill"

    var id: String { rawValue }
    var title: String { rawValue }
}

enum BrowserDevToolsIconColorOption: String, CaseIterable, Identifiable {
    case bonsplitInactive
    case bonsplitActive
    case accent
    case tertiary

    var id: String { rawValue }
    var title: String { rawValue }

    var color: Color {
        switch self {
        case .bonsplitActive:
            return Color(nsColor: .labelColor)
        case .accent:
            return cmuxAccentColor()
        case .tertiary:
            return Color(nsColor: .tertiaryLabelColor)
        case .bonsplitInactive:
            return Color(nsColor: .secondaryLabelColor)
        }
    }
}

enum BrowserDevToolsButtonDebugSettings {
    static let iconNameKey = "browserDevToolsIconName"
    static let iconColorKey = "browserDevToolsIconColor"
    static let defaultIcon = BrowserDevToolsIconOption.wrenchAndScrewdriver
    static let defaultColor = BrowserDevToolsIconColorOption.bonsplitInactive

    static func iconOption(defaults: UserDefaults = .standard) -> BrowserDevToolsIconOption {
        guard let raw = defaults.string(forKey: iconNameKey),
              let option = BrowserDevToolsIconOption(rawValue: raw) else {
            return defaultIcon
        }
        return option
    }

    static func colorOption(defaults: UserDefaults = .standard) -> BrowserDevToolsIconColorOption {
        guard let raw = defaults.string(forKey: iconColorKey),
              let option = BrowserDevToolsIconColorOption(rawValue: raw) else {
            return defaultColor
        }
        return option
    }

    static func copyPayload(defaults: UserDefaults = .standard) -> String {
        """
        browserDevToolsIconName=\(iconOption(defaults: defaults).rawValue)
        browserDevToolsIconColor=\(colorOption(defaults: defaults).rawValue)
        """
    }
}

enum BrowserProfilePopoverDebugSettings {
    static let horizontalPaddingKey = "browserProfilePopoverHorizontalPadding"
    static let verticalPaddingKey = "browserProfilePopoverVerticalPadding"
    static let defaultHorizontalPadding = 12.0
    static let defaultVerticalPadding = 10.0
    static let horizontalPaddingRange = 8.0...20.0
    static let verticalPaddingRange = 4.0...14.0

    static func resolvedHorizontalPadding(_ rawValue: Double) -> Double {
        horizontalPaddingRange.contains(rawValue) ? rawValue : defaultHorizontalPadding
    }

    static func resolvedVerticalPadding(_ rawValue: Double) -> Double {
        verticalPaddingRange.contains(rawValue) ? rawValue : defaultVerticalPadding
    }

    static func currentHorizontalPadding(defaults: UserDefaults = .standard) -> Double {
        resolvedHorizontalPadding((defaults.object(forKey: horizontalPaddingKey) as? NSNumber)?.doubleValue ?? defaultHorizontalPadding)
    }

    static func currentVerticalPadding(defaults: UserDefaults = .standard) -> Double {
        resolvedVerticalPadding((defaults.object(forKey: verticalPaddingKey) as? NSNumber)?.doubleValue ?? defaultVerticalPadding)
    }
}

final class CmuxWebView: WKWebView {
    var allowsFirstResponderAcquisition = true
    var allowsFirstResponderAcquisitionEffective: Bool { allowsFirstResponderAcquisition }
    var debugPointerFocusAllowanceDepth: Int { 0 }

    func withPointerFocusAllowance<T>(_ body: () -> T) -> T {
        body()
    }
}

let browserOmnibarTextFieldIdentifier = NSUserInterfaceItemIdentifier("cmux.browserOmnibarTextField")

func cmuxBrowserWebKitKeyDownDispatchIsActive() -> Bool {
    false
}

enum BrowserFocusModeKeyDecision: Equatable {
    case inactive
    case forwardToWebView
    case consume
}

final class OmnibarNativeTextField: NSTextField {
    var panelId: UUID?
}

func browserOmnibarField(panelId: UUID?, in window: NSWindow?) -> OmnibarNativeTextField? {
    nil
}

func browserOmnibarPanelId(for responder: NSResponder?) -> UUID? {
    nil
}

extension Notification.Name {
    static let feedRequestFocus = Notification.Name("cmux.feedRequestFocus")
    static let feedRequestSendText = Notification.Name("cmux.feedRequestSendText")
    static let browserSystemProxySettingsDidChange =
        Notification.Name("cmux.browser.systemProxySettingsDidChange")
    static let commandPaletteVisibilityDidChange = Notification.Name("cmux.commandPaletteVisibilityDidChange")
}

func postCommandPaletteVisibilityDidChangeIfNeeded(
    wasVisible: Bool,
    visible: Bool,
    window: NSWindow,
    windowId: UUID
) {}

@MainActor
enum WebViewInspectorTeardown {
    @discardableResult
    static func closeAllInspectors(in window: NSWindow) -> Int { 0 }

    @discardableResult
    static func closeAllInspectors(in windows: [NSWindow]) -> Int { 0 }

    @discardableResult
    static func closeInspector(for webView: WKWebView) -> Bool { false }
}

@MainActor
final class BrowserSystemProxyWatcher {
    static let shared = BrowserSystemProxyWatcher()
    func startObserving() {}
}

enum ReactGrabPastebackNotificationKey {
    static let workspaceId = "workspaceId"
    static let browserPanelId = "browserPanelId"
    static let returnPanelId = "returnPanelId"
    static let content = "content"
}

final class PostHogAnalytics: @unchecked Sendable {
    static let shared = PostHogAnalytics()
    func startIfNeeded() {}
    func trackActive(reason: String) {}
    func trackDailyActive(reason: String) {}
    func trackHourlyActive(reason: String) {}
}

func sentryBreadcrumb(_ message: String, category: String = "ui", data: [String: Any]? = nil) {}

func sentryCaptureWarning(
    _ message: String,
    category: String = "ui",
    data: [String: Any]? = nil,
    contextKey: String? = nil
) {}

func sentryCaptureError(
    _ message: String,
    category: String = "ui",
    data: [String: Any]? = nil,
    contextKey: String? = nil
) {}

@MainActor
func sentryStartMemoryContextRefresh() {}

@MainActor
func sentryStopMemoryContextRefresh() {}

func sentryRefreshMemoryContext(reason: String) async {}

@MainActor
protocol UpdateActionDelegate: AnyObject {
    func updaterRequestsRetryCheckForUpdates()
    func updaterWillRelaunchApplication()
}

@MainActor
protocol UpdateActionsHost: AnyObject {
    func checkForUpdatesInCustomUI()
    func attemptUpdate()
    var updateLogPath: String { get }
}

@MainActor
final class UpdateStateModel {
    var state: UpdateState = .idle
    var overrideState: UpdateState?
    var effectiveState: UpdateState { overrideState ?? state }
    var showsDetectedBackgroundUpdate: Bool { false }
    var hasCachedDetectedUpdateDetails: Bool { false }
    var showsPill: Bool { false }
    var text: String { "" }
    #if DEBUG
    var debugOverrideText: String?
    #endif

    func setState(_ newState: UpdateState) {
        state = newState
    }

    func setOverrideState(_ newState: UpdateState?) {
        overrideState = newState
    }

    func cancelActiveStateForNewCheck() {
        state = .idle
        overrideState = nil
    }

    func dismissDetectedAvailableUpdate() {}

    #if DEBUG
    func debugShowUpdateError(_ scenario: DebugUpdateErrorScenario) {}
    #endif
}

enum UpdateState: Equatable {
    case idle
    case checking(Checking)
    case updateAvailable(UpdateAvailable)
    case notFound(NotFound)
    case installing(Installing)

    var isIdle: Bool {
        if case .idle = self { return true }
        return false
    }

    var isInstallable: Bool { false }

    func cancel() {}
    func confirm() {}

    struct Checking: Equatable {
        let cancel: () -> Void
        init(cancel: @escaping () -> Void) {
            self.cancel = cancel
        }
        static func == (lhs: Checking, rhs: Checking) -> Bool { true }
    }

    struct UpdateAvailable: Equatable {
        static func == (lhs: UpdateAvailable, rhs: UpdateAvailable) -> Bool { true }
    }

    struct NotFound: Equatable {
        let acknowledgement: () -> Void
        init(acknowledgement: @escaping () -> Void) {
            self.acknowledgement = acknowledgement
        }
        static func == (lhs: NotFound, rhs: NotFound) -> Bool { true }
    }

    struct Installing: Equatable {
        var isAutoUpdate: Bool
        let retryTerminatingApplication: () -> Void
        let dismiss: () -> Void

        init(
            isAutoUpdate: Bool = false,
            retryTerminatingApplication: @escaping () -> Void,
            dismiss: @escaping () -> Void
        ) {
            self.isAutoUpdate = isAutoUpdate
            self.retryTerminatingApplication = retryTerminatingApplication
            self.dismiss = dismiss
        }

        static func == (lhs: Installing, rhs: Installing) -> Bool {
            lhs.isAutoUpdate == rhs.isAutoUpdate
        }
    }
}

@MainActor
final class UpdateController {
    let model = UpdateStateModel()
    weak var actionDelegate: (any UpdateActionDelegate)?

    init(log: Any) {}

    func startUpdaterIfNeeded() {}
    func checkForUpdates() {}
    func checkForUpdatesInCustomUI() {}
    func installUpdate() {}
    func attemptUpdate() {}
}

struct UpdatePill: View {
    init(model: UpdateStateModel, accent: Color, actions: any UpdateActionsHost) {}
    var body: some View { EmptyView() }
}

struct InstallUpdateMenuItem: View {
    init(model: UpdateStateModel) {}
    var body: some View { EmptyView() }
}

#if DEBUG
enum DebugUpdateErrorScenario: CaseIterable, Hashable, Sendable {
    static var allCases: [DebugUpdateErrorScenario] { [] }
    var menuTitle: String { "" }
}

struct UpdateTestSupport {
    init(model: UpdateStateModel, log: UpdateLogStore) {}
    func applyIfNeeded() {}
    func performMockFeedCheckIfNeeded() -> Bool { false }
}
#endif

final class FeedKeyboardFocusView: NSView {
    func ownsKeyboardFocus(_ responder: NSResponder) -> Bool { false }
    func focusFirstItemFromCoordinator() {}
    func focusHostFromCoordinator() -> Bool { false }
    func applyFocusSnapshotFromController(_ snapshot: FeedFocusSnapshot) {}
}

final class WindowBrowserHostView: NSView {}

@MainActor
final class CMUXSidebarExtensionBrowserPanel: NSObject, Panel, ObservableObject {
    let id = UUID()
    let panelType: PanelType = .extensionBrowser
    private let title: String

    var displayTitle: String { title }
    var displayIcon: String? { "puzzlepiece.extension" }

    init(title: String) {
        self.title = title
        super.init()
    }

    func close() {}
    func focus() {}
    func unfocus() {}
    func triggerFlash(reason: WorkspaceAttentionFlashReason) {}
}

struct CMUXSidebarExtensionBrowserPanelView: View {
    let panel: CMUXSidebarExtensionBrowserPanel
    let onRequestPanelFocus: () -> Void

    var body: some View { Color.clear }
}

protocol BrowserPanelRestoreSnapshot: Sendable {
    var workspaceId: UUID { get }
    var closedAt: Date { get }
}

struct ClosedBrowserPanelRestoreSnapshot: BrowserPanelRestoreSnapshot {
    let workspaceId: UUID
    let url: URL?
    let profileID: UUID?
    let originalPaneId: UUID
    let originalTabIndex: Int
    let fallbackSplitOrientation: SplitOrientation?
    let fallbackSplitInsertFirst: Bool
    let fallbackAnchorPaneId: UUID?
    let closedAt: Date

    init(
        workspaceId: UUID,
        url: URL?,
        profileID: UUID?,
        originalPaneId: UUID,
        originalTabIndex: Int,
        fallbackSplitOrientation: SplitOrientation?,
        fallbackSplitInsertFirst: Bool,
        fallbackAnchorPaneId: UUID?,
        closedAt: Date = Date()
    ) {
        self.workspaceId = workspaceId
        self.url = url
        self.profileID = profileID
        self.originalPaneId = originalPaneId
        self.originalTabIndex = originalTabIndex
        self.fallbackSplitOrientation = fallbackSplitOrientation
        self.fallbackSplitInsertFirst = fallbackSplitInsertFirst
        self.fallbackAnchorPaneId = fallbackAnchorPaneId
        self.closedAt = closedAt
    }
}

@MainActor
final class BrowserModel<Snapshot: BrowserPanelRestoreSnapshot> {
    private var snapshots: [Snapshot] = []
    private let capacity: Int

    init(recentlyClosedCapacity: Int = 20) {
        capacity = max(1, recentlyClosedCapacity)
    }

    var mostRecentClosedBrowserPanelClosedAt: Date? {
        snapshots.last?.closedAt
    }

    func recordClosedBrowserPanel(_ snapshot: Snapshot) {
        snapshots.append(snapshot)
        if snapshots.count > capacity {
            snapshots.removeFirst(snapshots.count - capacity)
        }
    }

    func popMostRecentlyClosedBrowserPanel() -> Snapshot? {
        snapshots.popLast()
    }

    func removeClosedBrowserPanels(forWorkspaceId workspaceId: UUID) {
        snapshots.removeAll { $0.workspaceId == workspaceId }
    }

    func clearRecentlyClosedBrowserPanels() {
        snapshots.removeAll()
    }
}

struct BrowserEvalEnvelope: Sendable, Equatable {
    let typeKey: String
    let valueKey: String
    let typeUndefined: String
    let typeValue: String

    init(
        typeKey: String = "__cmux_t",
        valueKey: String = "__cmux_v",
        typeUndefined: String = "undefined",
        typeValue: String = "value"
    ) {
        self.typeKey = typeKey
        self.valueKey = valueKey
        self.typeUndefined = typeUndefined
        self.typeValue = typeValue
    }
}

struct BrowserControlService: Sendable {
    let evalEnvelope: BrowserEvalEnvelope

    init(evalEnvelope: BrowserEvalEnvelope = BrowserEvalEnvelope()) {
        self.evalEnvelope = evalEnvelope
    }

    func jsonLiteral(_ value: Any) -> String {
        if let data = try? JSONSerialization.data(withJSONObject: [value]),
           let text = String(data: data, encoding: .utf8),
           text.count >= 2 {
            return String(text.dropFirst().dropLast())
        }
        if let value = value as? String {
            return "\"\(value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\""
        }
        return "null"
    }

    func normalizeJSValue(_ value: Any?, isUndefinedSentinel: (Any) -> Bool) -> Any {
        guard let value else { return NSNull() }
        if isUndefinedSentinel(value) {
            return [
                evalEnvelope.typeKey: evalEnvelope.typeUndefined,
                evalEnvelope.valueKey: NSNull(),
            ]
        }
        if value is NSNull { return NSNull() }
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number }
        if let bool = value as? Bool { return bool }
        if let dict = value as? [String: Any] {
            return dict.mapValues { normalizeJSValue($0, isUndefinedSentinel: isUndefinedSentinel) }
        }
        if let array = value as? [Any] {
            return array.map { normalizeJSValue($0, isUndefinedSentinel: isUndefinedSentinel) }
        }
        return String(describing: value)
    }

    func failureLooksLikeCSPEvalBlock(_ message: String) -> Bool {
        let lower = message.lowercased()
        return lower.contains("unsafe-eval") ||
            lower.contains("content security policy") ||
            lower.contains("blocked by csp") ||
            lower.contains("refused to evaluate")
    }

    func describeJavaScriptError(_ error: any Error) -> String {
        error.localizedDescription
    }

    func elementNotFoundMessage(selector: String, matchCount: Int, visibleCount: Int) -> String {
        if matchCount > 0 && visibleCount == 0 {
            return "Element \"\(selector)\" is present but not visible."
        }
        if matchCount > 1 {
            return "Selector \"\(selector)\" matched multiple elements."
        }
        return "Element \"\(selector)\" not found or not visible. Run 'browser snapshot' to see current page elements."
    }

    func notFoundDiagnosticsScript(selector: String) -> String { "null" }
    func findScript(finderBody: String) -> String { finderBody }
    func findRoleFinderBody(role: String, name: String?, exact: Bool) -> String { "null" }
    func findTextFinderBody(text: String, exact: Bool) -> String { "null" }
    func findLabelFinderBody(label: String, exact: Bool) -> String { "null" }
    func findPlaceholderFinderBody(placeholder: String, exact: Bool) -> String { "null" }
    func findAltFinderBody(alt: String, exact: Bool) -> String { "null" }
    func findTitleFinderBody(title: String, exact: Bool) -> String { "null" }
    func findTestIdFinderBody(testId: String) -> String { "null" }
    func findFirstScript(selector: String) -> String { "null" }
    func findLastScript(selector: String) -> String { "null" }
    func findNthScript(selector: String, index: Int) -> String { "null" }
    func storageType(params: [String: Any]) -> String { (params["type"] as? String) ?? "localStorage" }
    func storageGetScript(storageType: String, key: String?) -> String { "null" }
    func storageSetScript(storageType: String, key: String, valueLiteral: String) -> String { "null" }
    func storageClearScript(storageType: String) -> String { "null" }
}

struct BrowserMediaActivity: Equatable {
    var isPlayingAudio = false
    var isUsingMicrophone = false
    var isUsingCamera = false
    var isActive: Bool { isPlayingAudio || isUsingMicrophone || isUsingCamera }

    static func aggregating<S: Sequence>(_ perPane: S) -> BrowserMediaActivity
    where S.Element == BrowserMediaActivity {
        perPane.reduce(into: BrowserMediaActivity()) { result, pane in
            result.isPlayingAudio = result.isPlayingAudio || pane.isPlayingAudio
            result.isUsingMicrophone = result.isUsingMicrophone || pane.isUsingMicrophone
            result.isUsingCamera = result.isUsingCamera || pane.isUsingCamera
        }
    }
}

struct BrowserRemoteWorkspaceStatus: Equatable {
    let target: String
    let connectionState: WorkspaceRemoteConnectionState
    let heartbeatCount: Int
    let lastHeartbeatAt: Date?
}

enum BrowserAddressBarFocusSelectionIntent: Equatable {
    case preserveFieldEditorSelection
    case selectAll
    var shouldSelectAll: Bool { self == .selectAll }
}

nonisolated enum BrowserWebViewLifecycleState: String {
    case newTab = "new_tab"
    case deferredURL = "deferred_url"
    case liveVisible = "live_visible"
    case liveHidden = "live_hidden"
    case discarded
    case closing
}

final class CmuxDiffViewerURLSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "cmux-diff-viewer"
    static let shared = CmuxDiffViewerURLSchemeHandler()
    static let maxRegisteredFiles = 1024

    struct RegisteredFile {
        let requestPath: String
        let fileURL: URL
        let mimeType: String
    }

    func register(token: String, files: [RegisteredFile], now: Date = Date()) throws {}
    func hasActiveSession(token: String, now: Date = Date()) -> Bool { false }
    func registerFromManifest(token: String, now: Date = Date()) -> Bool { false }
    func diffViewerRestorable(token: String, requestPath: String) -> Bool { false }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        urlSchemeTask.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorUnsupportedURL))
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    static func registeredFile(from object: [String: Any]) -> RegisteredFile? {
        guard let requestPath = object["request_path"] as? String,
              let filePath = object["file_path"] as? String,
              let mimeType = object["mime_type"] as? String else {
            return nil
        }
        return RegisteredFile(
            requestPath: requestPath,
            fileURL: URL(fileURLWithPath: filePath, isDirectory: false),
            mimeType: mimeType
        )
    }

    static func diffViewerComponents(from url: URL?) -> (token: String, requestPath: String)? {
        nil
    }

    static func diffViewerURL(token: String, requestPath: String) -> URL? {
        nil
    }

    static func isValidToken(_ token: String) -> Bool {
        guard (16...80).contains(token.count) else { return false }
        return token.unicodeScalars.allSatisfy { scalar in
            CharacterSet.alphanumerics.contains(scalar) || scalar == "-"
        }
    }

    static func isValidRequestPath(_ path: String) -> Bool {
        path.hasPrefix("/") && !path.contains("\\") && !path.contains("//")
    }

    static func requestPath(for url: URL) -> String? {
        let rawPath = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path
        let requestPath = rawPath.isEmpty ? "/" : rawPath
        return isValidRequestPath(requestPath) ? requestPath : nil
    }
}

@MainActor
final class BrowserSearchState: ObservableObject {
    @Published var needle: String
    @Published var selected: UInt?
    @Published var total: UInt?

    init(needle: String = "") {
        self.needle = needle
    }
}

final class BrowserPortalAnchorView: NSView {
    override var acceptsFirstResponder: Bool { false }
    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class BrowserHistoryStore: ObservableObject {
    struct Entry: Identifiable, Hashable {
        let id = UUID()
        var urlString: String = ""
        var title: String?
        var lastVisited: Date = Date()
    }

    static let shared = BrowserHistoryStore()
    @Published private(set) var entries: [Entry] = []
    var isLoaded: Bool { true }

    init(fileURL: URL? = nil) {}

    func loadIfNeeded() {}
    func clearHistory() {}
    func flushPendingSaves() {}
    func removeHistoryEntry(urlString: String) -> Bool { false }
    func recentSuggestions(limit: Int) -> [Entry] { [] }
    func suggestions(for query: String, limit: Int) -> [Entry] { [] }
    func recordTypedNavigation(url: URL) {}
    func mergeImportedEntries(_ entries: [Entry]) -> Int { 0 }
}

struct BrowserProfileDefinition: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    var displayName: String
    let createdAt: Date
    let isBuiltInDefault: Bool

    init(id: UUID, displayName: String, createdAt: Date, isBuiltInDefault: Bool) {
        self.id = id
        self.displayName = displayName
        self.createdAt = createdAt
        self.isBuiltInDefault = isBuiltInDefault
    }

    var slug: String {
        isBuiltInDefault ? "default" : displayName.lowercased()
    }
}

struct BrowserProfileClearOutcome: Sendable {
    var socketPayload: [String: Any] { [:] }
}

final class BrowserProfileStore: ObservableObject {
    static let shared = BrowserProfileStore()
    let builtInDefaultProfileID = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
    @Published private(set) var profiles: [BrowserProfileDefinition]
    @Published private(set) var lastUsedProfileID: UUID

    private init() {
        lastUsedProfileID = builtInDefaultProfileID
        profiles = [
            BrowserProfileDefinition(
                id: builtInDefaultProfileID,
                displayName: "Default",
                createdAt: Date(timeIntervalSince1970: 0),
                isBuiltInDefault: true
            ),
        ]
    }

    var effectiveLastUsedProfileID: UUID { lastUsedProfileID }
    func profileDefinition(id: UUID) -> BrowserProfileDefinition? { profiles.first { $0.id == id } }
    func displayName(for id: UUID) -> String { profileDefinition(id: id)?.displayName ?? "Default" }
    func createProfile(named rawName: String) -> BrowserProfileDefinition? { nil }
    func renameProfile(id: UUID, to rawName: String) -> Bool { false }
    func canRenameProfile(id: UUID) -> Bool { false }
    func deleteProfile(id: UUID) -> BrowserProfileDefinition? { nil }
    func clearProfileData(id: UUID) async -> BrowserProfileClearOutcome? { nil }
    func noteUsed(_ id: UUID) {}
    func websiteDataStore(for profileID: UUID) -> WKWebsiteDataStore { .nonPersistent() }
    func historyStore(for profileID: UUID) -> BrowserHistoryStore { .shared }
    func historyFileURL(for profileID: UUID) -> URL? { nil }
    func flushPendingSaves() {}
}

enum BrowserAvailabilitySettings {
    static let disabledKey = "browserDisabledOverride"
    static let didChangeNotification = Notification.Name("cmux.browserAvailabilityDidChange")
    static let defaultDisabled = true

    static func isDisabled(defaults: UserDefaults = .standard) -> Bool { true }
    static func isEnabled(defaults: UserDefaults = .standard) -> Bool { false }
    static func setDisabled(_ disabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: disabledKey)
        NotificationCenter.default.post(name: didChangeNotification, object: nil)
    }
}

enum BrowserLinkOpenSettings {
    static let openTerminalLinksInCmuxBrowserKey = "browserOpenTerminalLinksInCmuxBrowser"
    static let defaultOpenTerminalLinksInCmuxBrowser = false
    static let openSidebarPullRequestLinksInCmuxBrowserKey = "browserOpenSidebarPullRequestLinksInCmuxBrowser"
    static let defaultOpenSidebarPullRequestLinksInCmuxBrowser = false
    static let openSidebarPortLinksInCmuxBrowserKey = "browserOpenSidebarPortLinksInCmuxBrowser"
    static let defaultOpenSidebarPortLinksInCmuxBrowser = false
    static let interceptTerminalOpenCommandInCmuxBrowserKey = "browserInterceptTerminalOpenCommandInCmuxBrowser"
    static let defaultInterceptTerminalOpenCommandInCmuxBrowser = false
    static let browserHostWhitelistKey = "browserHostWhitelist"
    static let defaultBrowserHostWhitelist = ""
    static let browserExternalOpenPatternsKey = "browserExternalOpenPatterns"
    static let defaultBrowserExternalOpenPatterns = ""

    static func openTerminalLinksInCmuxBrowser(defaults: UserDefaults = .standard) -> Bool { false }
    static func openSidebarPullRequestLinksInCmuxBrowser(defaults: UserDefaults = .standard) -> Bool { false }
    static func openSidebarPortLinksInCmuxBrowser(defaults: UserDefaults = .standard) -> Bool { false }
    static func interceptTerminalOpenCommandInCmuxBrowser(defaults: UserDefaults = .standard) -> Bool { false }
    static func initialInterceptTerminalOpenCommandInCmuxBrowserValue(defaults: UserDefaults = .standard) -> Bool { false }
    static func hostWhitelist(defaults: UserDefaults = .standard) -> [String] { [] }
    static func externalOpenPatterns(defaults: UserDefaults = .standard) -> [String] { [] }
    static func shouldOpenExternally(_ url: URL, defaults: UserDefaults = .standard) -> Bool { true }
    static func shouldOpenExternally(_ rawURL: String, defaults: UserDefaults = .standard) -> Bool { true }
    static func hostMatchesWhitelist(_ host: String, defaults: UserDefaults = .standard) -> Bool { false }
}

enum BrowserImportHintVariant: String, CaseIterable, Identifiable {
    case inlineStrip
    case floatingCard
    case toolbarChip
    case settingsOnly
    var id: String { rawValue }
}

enum BrowserImportHintBlankTabPlacement: Equatable {
    case hidden
    case inlineStrip
    case floatingCard
    case toolbarChip
}

enum BrowserImportHintSettingsStatus: Equatable {
    case visible
    case hidden
    case settingsOnly
}

struct BrowserImportHintPresentation: Equatable {
    let blankTabPlacement: BrowserImportHintBlankTabPlacement
    let settingsStatus: BrowserImportHintSettingsStatus

    init(variant: BrowserImportHintVariant, showOnBlankTabs: Bool, isDismissed: Bool) {
        blankTabPlacement = .hidden
        settingsStatus = .settingsOnly
    }
}

enum BrowserImportHintSettings {
    static let variantKey = "browserImportHintVariant"
    static let showOnBlankTabsKey = "browserImportHintShowOnBlankTabs"
    static let dismissedKey = "browserImportHintDismissed"
    static let defaultVariant: BrowserImportHintVariant = .settingsOnly
    static let defaultShowOnBlankTabs = false
    static let defaultDismissed = true

    static func variant(for rawValue: String?) -> BrowserImportHintVariant { .settingsOnly }
    static func variant(defaults: UserDefaults = .standard) -> BrowserImportHintVariant { .settingsOnly }
    static func showOnBlankTabs(defaults: UserDefaults = .standard) -> Bool { false }
    static func isDismissed(defaults: UserDefaults = .standard) -> Bool { true }
    static func presentation(defaults: UserDefaults = .standard) -> BrowserImportHintPresentation {
        BrowserImportHintPresentation(variant: .settingsOnly, showOnBlankTabs: false, isDismissed: true)
    }
    static func reset(defaults: UserDefaults = .standard) {}
}

enum BrowserToolbarAccessorySpacingDebugSettings {
    static let key = "browserToolbarAccessorySpacing"
    static let supportedValues = [0]
    static let defaultSpacing = 0
    static func resolved(_ value: Int) -> Int { 0 }
    static func current(defaults: UserDefaults = .standard) -> Int { 0 }
}

enum BrowserImportScope: String, CaseIterable, Identifiable, Sendable {
    case cookiesOnly
    case historyOnly
    case cookiesAndHistory
    case everything
    var id: String { rawValue }
    var displayName: String { rawValue }
    var includesCookies: Bool { self != .historyOnly }
    var includesHistory: Bool { self != .cookiesOnly }
}

struct BrowserImportOutcome: Sendable {
    var socketPayload: [String: Any] { [:] }
}

enum BrowserProfileAutomation {
    static func list(params: [String: Any]) async throws -> [String: Any] { ["profiles": []] }
    static func create(params: [String: Any]) async throws -> [String: Any] { ["created": false] }
    static func rename(params: [String: Any]) async throws -> [String: Any] { ["renamed": false] }
    static func clear(params: [String: Any]) async throws -> [String: Any] { ["cleared": false] }
    static func delete(params: [String: Any]) async throws -> [String: Any] { ["deleted": false] }
}

enum BrowserImportAutomation {
    static func importCookies(params: [String: Any]) async throws -> BrowserImportOutcome {
        BrowserImportOutcome()
    }
}

final class BrowserDataImportCoordinator {
    static let shared = BrowserDataImportCoordinator()
    func presentImportDialog(defaultDestinationProfileID: UUID? = nil, defaultScope: BrowserImportScope? = nil) {}
}

final class BrowserOmnibarSelectionRepeatCoordinator {
    typealias SelectionMove = @MainActor (_ panelID: UUID, _ delta: Int) -> Void
    typealias DebugLog = @MainActor (_ line: String) -> Void

    init(selectionMove: @escaping SelectionMove, debugLog: DebugLog? = nil) {}
    func dispatchSelectionMove(panelID: UUID, delta: Int) {}
    func startRepeatIfNeeded(panelID: UUID, keyCode: UInt16, delta: Int) {}
    func stopRepeat() {}
    func noteKeyUp(keyCode: UInt16) {}
    func noteFlagsChanged(flags: NSEvent.ModifierFlags, keyCode: UInt16?) {}
    func noteFlagsChanged(shouldContinue: Bool, flagsRawValue: UInt) {}
}

final class BrowserFirstResponderBypass: @unchecked Sendable {
    var isActive: Bool { false }

    @discardableResult
    func withBypass<T>(_ body: () -> T) -> T {
        body()
    }
}

@MainActor
final class BrowserPanel: Panel, ObservableObject {
    static let telemetryHookBootstrapScriptSource = ""
    static let dialogTelemetryHookBootstrapScriptSource = ""
    static func isDetachedInspectorWindow(_ window: NSWindow) -> Bool { false }

    let id: UUID
    let panelType: PanelType = .browser
    @Published private(set) var displayTitle: String
    var displayIcon: String? { "globe" }
    var isDirty: Bool { false }
    @Published private(set) var pageTitle: String = ""
    @Published private(set) var currentURL: URL?
    @Published private(set) var isLoading = false
    @Published private(set) var faviconPNGData: Data?
    @Published private(set) var isMuted = false
    @Published private(set) var isBrowserFocusModeActive = false
    @Published private(set) var isBrowserFocusModeExitArmed = false
    @Published private(set) var pendingAddressBarFocusRequestId: UUID?
    @Published private(set) var searchFocusRequestGeneration: UInt64 = 0
    @Published var searchState: BrowserSearchState?
    private(set) var workspaceId: UUID

    let webView = WKWebView()
    let portalAnchorView = BrowserPortalAnchorView()
    let profileID: UUID
    let historyStore: BrowserHistoryStore = .shared
    var mediaActivity = BrowserMediaActivity()
    var onMediaActivityChanged: ((BrowserMediaActivity) -> Void)?
    var webViewDidRequestClose: (() -> Void)?
    var isPlayingAudio = false
    var isOmnibarVisible = false
    var sessionSnapshotTransparentBackground = false
    var preferredFocusIntent: BrowserPanelFocusIntent = .webView
    var isShowingNewTabPage: Bool { true }
    var canToggleBrowserFocusMode: Bool { false }
    var canvasInlineHostingActive = false
    var webViewLifecycleState: BrowserWebViewLifecycleState = .discarded
    var currentURLForTabDuplication: URL? { currentURL }
    var bypassesRemoteWorkspaceProxyForTabDuplication: Bool { false }

    init(
        workspaceId: UUID,
        profileID: UUID? = nil,
        initialURL: URL? = nil,
        initialRequest: URLRequest? = nil,
        renderInitialNavigation: Bool = true,
        preloadInitialNavigationInBackground: Bool = false,
        bypassInsecureHTTPHostOnce: String? = nil,
        omnibarVisible: Bool = true,
        transparentBackground: Bool = false,
        proxyEndpoint: BrowserProxyEndpoint? = nil,
        bypassRemoteProxy: Bool = false,
        isRemoteWorkspace: Bool = false,
        remoteWebsiteDataStoreIdentifier: UUID? = nil
    ) {
        let resolvedURL = initialURL ?? initialRequest?.url
        self.id = UUID()
        self.workspaceId = workspaceId
        self.currentURL = resolvedURL
        self.profileID = profileID ?? BrowserProfileStore.shared.effectiveLastUsedProfileID
        self.displayTitle = resolvedURL?.absoluteString ?? ""
        self.isOmnibarVisible = omnibarVisible
        self.sessionSnapshotTransparentBackground = transparentBackground
    }

    func close() {}
    func focus() {}
    func unfocus() {}
    func triggerFlash(reason: WorkspaceAttentionFlashReason) {}
    func captureFocusIntent(in window: NSWindow?) -> PanelFocusIntent { .browser(preferredFocusIntent) }
    func preferredFocusIntentForActivation() -> PanelFocusIntent { .browser(preferredFocusIntent) }
    func prepareFocusIntentForActivation(_ intent: PanelFocusIntent) {}
    func restoreFocusIntent(_ intent: PanelFocusIntent) -> Bool { false }
    func ownedFocusIntent(for responder: NSResponder, in window: NSWindow) -> PanelFocusIntent? { nil }
    func yieldFocusIntent(_ intent: PanelFocusIntent, in window: NSWindow) -> Bool { false }

    func setRemoteWorkspaceStatus(_ status: BrowserRemoteWorkspaceStatus?) {}
    func setRemoteProxyEndpoint(_ endpoint: BrowserProxyEndpoint?) {}
    func navigate(to url: URL, recordTypedNavigation: Bool = false) { currentURL = url }
    func navigateSmart(_ input: String) { currentURL = URL(string: input) }
    func goBack() {}
    func goForward() {}
    func reload() {}
    func hardReload() {}
    func toggleDeveloperTools() -> Bool { false }
    func showDeveloperTools() -> Bool { false }
    func showDeveloperToolsConsole() -> Bool { false }
    func hideDeveloperTools() -> Bool { false }
    func isDeveloperToolsVisible() -> Bool { false }
    func requestDeveloperToolsRefreshAfterNextAttach(reason: String) {}
    func zoomIn() -> Bool { false }
    func zoomOut() -> Bool { false }
    func resetZoom() -> Bool { false }
    func currentPageZoomFactor() -> CGFloat { 1 }
    func setPageZoomFactor(_ pageZoom: CGFloat) -> Bool { false }
    func captureAutomationVisibleViewportSnapshot() async throws -> NSImage { NSImage(size: .zero) }
    func captureAutomationVisibleViewportSnapshot(_ completion: @escaping (Result<NSImage, Error>) -> Void) {
        completion(.success(NSImage(size: .zero)))
    }
    func evaluateJavaScript(_ script: String) async throws -> Any? { nil }
    func startFind() { searchState = BrowserSearchState() }
    func findNext() {}
    func findPrevious() {}
    func hideFind() { searchState = nil }
    func applySearchNeedle(_ needle: String) { searchState?.needle = needle }
    func toggleOmnibarVisibility() -> Bool { false }
    func toggleBrowserFocusMode(reason: String, focusWebView: Bool = true) -> Bool { false }
    func setBrowserFocusModeActive(_ active: Bool, reason: String, focusWebView: Bool = true) -> Bool { false }
    func handleBrowserFocusModeKeyEvent(_ event: NSEvent, reason: String) -> BrowserFocusModeKeyDecision { .inactive }
    func requestExplicitWebViewFocus() -> Bool { false }
    func armReactGrabRoundTrip(returnTo panelId: UUID) {}
    func clearReactGrabRoundTrip(reason: String = "unspecified") {}
    func ensureReactGrabActive() async {}
    func toggleOrInjectReactGrab() async {}
    func setMuted(_ muted: Bool) -> Bool {
        isMuted = muted
        return false
    }
    func toggleMute() -> Bool {
        isMuted.toggle()
        return false
    }
    func requestAddressBarFocus(
        selectionIntent: BrowserAddressBarFocusSelectionIntent = .preserveFieldEditorSelection
    ) -> UUID {
        let requestId = UUID()
        pendingAddressBarFocusRequestId = requestId
        preferredFocusIntent = .addressBar
        return requestId
    }
    func beginSuppressWebViewFocusForAddressBar() {}
    func endSuppressWebViewFocusForAddressBar() {}
    func clearWebViewFocusSuppression() {}
    func suppressOmnibarAutofocus(for seconds: TimeInterval) {}
    func shouldSuppressOmnibarAutofocus() -> Bool { false }
    func shouldSuppressWebViewFocus() -> Bool { false }
    func restoreDiscardedWebViewIfNeeded(reason: String) -> Bool { false }
    func discardHiddenWebViewForSystemMemoryPressure(now: Date = Date()) -> Bool { false }
    func discardHiddenWebViewForMemory(reason: String, now: Date = Date()) -> Bool { false }
    func resetForWorkspaceContextChange(reason: String) {}
    func preparePortalHostReplacementForNextDistinctClaim(reason: String) {}
    func hideBrowserPortalView(source: String) {}
    func noteWebViewVisibility(_ visible: Bool, reason: String) {}
    func reattachToWorkspace(
        workspaceId: UUID,
        proxyEndpoint: BrowserProxyEndpoint?,
        remoteStatus: BrowserRemoteWorkspaceStatus?
    ) {}
    func reattachToWorkspace(
        _ newWorkspaceId: UUID,
        isRemoteWorkspace: Bool,
        remoteWebsiteDataStoreIdentifier: UUID? = nil,
        proxyEndpoint: BrowserProxyEndpoint?,
        remoteStatus: BrowserRemoteWorkspaceStatus?
    ) {
        workspaceId = newWorkspaceId
    }
    func sessionNavigationHistorySnapshot() -> (backHistoryURLStrings: [String], forwardHistoryURLStrings: [String]) {
        ([], [])
    }
    func restoreSessionNavigationHistory(
        backHistoryURLStrings: [String],
        forwardHistoryURLStrings: [String],
        currentURLString: String?
    ) {}
    func restoreSessionSnapshot(_ snapshot: SessionBrowserPanelSnapshot) {}
    func shouldRenderWebViewForSessionSnapshot() -> Bool { false }
    func shouldPersistSessionSnapshot() -> Bool { false }
    func shouldPreserveWebViewAttachmentDuringTransientHide() -> Bool { false }
    func closeDeveloperToolsFromDetachedInspectorWindowUserAction(
        _ window: NSWindow,
        source: String
    ) -> Bool { false }
    func debugDeveloperToolsStateSummary() -> String { "" }
    func debugDeveloperToolsGeometrySummary() -> String { "" }
    func diffViewerSessionComponents() -> (token: String, requestPath: String)? { nil }
    func preferredURLStringForSessionSnapshot() -> String? { currentURL?.absoluteString }
    func preferredURLStringForOmnibar() -> String? { currentURL?.absoluteString }
    func webViewLifecycleTopPayload(now: Date = Date()) -> [String: Any] {
        ["state": webViewLifecycleState.rawValue]
    }
    func preparePortalHostReplacementForNextDistinctClaim(
        inPane paneId: PaneID,
        reason: String
    ) {}
    static func isBlankBrowserPageURL(_ url: URL?) -> Bool { url == nil }
}

struct BrowserPanelView: View {
    let panel: BrowserPanel
    let paneId: PaneID
    let isFocused: Bool
    let isVisibleInUI: Bool
    let portalPriority: Int
    let onRequestPanelFocus: () -> Void
    var body: some View { Color.clear }
}

func browserIsTemporaryHistoryURL(_ url: URL?) -> Bool {
    false
}

enum MarkdownPanelDisplayMode: String, CaseIterable, Identifiable {
    case preview
    case text
    var id: String { rawValue }
}

enum MarkdownPanelFileLinkResolver {
    static func isMarkdownPathLike(_ path: String) -> Bool {
        let pathExtension = (path as NSString).pathExtension.lowercased()
        return pathExtension == "md" || pathExtension == "markdown" || pathExtension == "mdx"
    }

    static func resolve(rawPath: String, relativeToMarkdownFile filePath: String) -> String? {
        rawPath
    }
}

@MainActor
protocol FilePreviewTextEditingPanel: AnyObject {
    var textContent: String { get }
    func attachTextView(_ textView: NSTextView)
    func retryPendingFocus()
    func updateTextContent(_ nextContent: String)
    @discardableResult func saveTextContent() -> Task<Void, Never>?
}

final class SavingTextView: NSTextView {
    weak var panel: (any FilePreviewTextEditingPanel)?
    static func makeFilePreviewTextView() -> SavingTextView { SavingTextView(frame: .zero) }
    func applyFilePreviewTextEditorInsets() {}
    func applyFilePreviewWordWrap(_ enabled: Bool, scrollView: NSScrollView) {}
}

@MainActor
final class MarkdownPanel: Panel, ObservableObject, FilePreviewTextEditingPanel {
    let id = UUID()
    let panelType: PanelType = .markdown
    let filePath: String
    private(set) var workspaceId: UUID
    @Published private(set) var content = ""
    @Published private(set) var textContent = ""
    @Published private(set) var isDirty = false
    @Published private(set) var isSaving = false
    @Published private(set) var displayMode: MarkdownPanelDisplayMode = .preview
    @Published private(set) var displayTitle: String
    var displayIcon: String? { "doc.richtext" }
    @Published private(set) var isFileUnavailable = false
    @Published private(set) var focusFlashToken = 0
    @Published private(set) var fontSize: Double = 15
    @Published private(set) var fontFamily: String = ""
    @Published private(set) var maxContentWidth: Double = 820

    init(workspaceId: UUID, filePath: String, fontSize: Double? = nil) {
        self.workspaceId = workspaceId
        self.filePath = filePath
        self.displayTitle = URL(fileURLWithPath: filePath).lastPathComponent
    }

    func close() {}
    func focus() {}
    func unfocus() {}
    func triggerFlash(reason: WorkspaceAttentionFlashReason) { focusFlashToken += 1 }
    func zoomIn() -> Bool { false }
    func zoomOut() -> Bool { false }
    func resetZoom() -> Bool { false }
    func setFontSize(_ size: Double) -> Bool { false }
    func setFontFamily(_ family: String) -> Bool { false }
    func setMaxContentWidth(_ width: Double) -> Bool { false }
    func resetTypographyToFactoryDefaults() {}
    func setDisplayMode(_ mode: MarkdownPanelDisplayMode) { displayMode = mode }
    func applySearchNeedle(_ needle: String) {}
    func attachTextView(_ textView: NSTextView) {}
    func retryPendingFocus() {}
    func updateTextContent(_ nextContent: String) { textContent = nextContent }
    func saveTextContent() -> Task<Void, Never>? { nil }
}

struct MarkdownPanelView: View {
    let panel: MarkdownPanel
    let isFocused: Bool
    let isVisibleInUI: Bool
    let portalPriority: Int
    let appearance: PanelAppearance
    let onRequestPanelFocus: () -> Void
    var body: some View { Color.clear }
}

enum FilePreviewMode: Equatable {
    case text
    case pdf
    case image
    case media
    case quickLook
    case unsupported

    var socketName: String {
        switch self {
        case .text:
            return "text"
        case .pdf:
            return "pdf"
        case .image:
            return "image"
        case .media:
            return "media"
        case .quickLook:
            return "quickLook"
        case .unsupported:
            return "unsupported"
        }
    }
}

struct FileExternalOpenApplication: Identifiable, Equatable, Sendable {
    let url: URL
    let displayName: String
    let isDefault: Bool

    var id: String {
        FileExternalOpenApplicationResolver.applicationIdentity(for: url)
    }
}

struct FileExternalOpenApplicationResolver: Sendable {
    var defaultApplicationURL: @Sendable (URL) -> URL?
    var applicationURLs: @Sendable (URL) -> [URL]
    var displayName: @Sendable (URL) -> String
    var shouldIncludeApplication: @Sendable (URL) -> Bool

    static let live = FileExternalOpenApplicationResolver(
        defaultApplicationURL: { NSWorkspace.shared.urlForApplication(toOpen: $0) },
        applicationURLs: { NSWorkspace.shared.urlsForApplications(toOpen: $0) },
        displayName: { liveDisplayName(for: $0) },
        shouldIncludeApplication: { shouldIncludeLiveApplication($0) }
    )

    func applications(for fileURL: URL) -> [FileExternalOpenApplication] {
        let defaultURL = defaultApplicationURL(fileURL).flatMap { url in
            shouldIncludeApplication(url) ? url : nil
        }
        let defaultIdentity = defaultURL.map(Self.applicationIdentity(for:))
        var orderedURLs = defaultURL.map { [$0] } ?? []
        orderedURLs.append(contentsOf: applicationURLs(fileURL).filter(shouldIncludeApplication))

        var seenIdentities: Set<String> = []
        return orderedURLs.compactMap { applicationURL in
            let identity = Self.applicationIdentity(for: applicationURL)
            guard seenIdentities.insert(identity).inserted else { return nil }
            return FileExternalOpenApplication(
                url: applicationURL,
                displayName: displayName(applicationURL),
                isDefault: identity == defaultIdentity
            )
        }
    }

    static func applicationIdentity(for url: URL) -> String {
        url.resolvingSymlinksInPath().standardizedFileURL.path
    }

    private static func liveDisplayName(for applicationURL: URL) -> String {
        let bundle = Bundle(url: applicationURL)
        let bundleName = bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? bundle?.object(forInfoDictionaryKey: "CFBundleName") as? String
        var name = bundleName ?? FileManager.default.displayName(atPath: applicationURL.path)
        if name.lowercased().hasSuffix(".app") {
            name = String(name.dropLast(4))
        }
        return name.isEmpty ? applicationURL.deletingPathExtension().lastPathComponent : name
    }

    private static func shouldIncludeLiveApplication(_ applicationURL: URL) -> Bool {
        guard let bundleIdentifier = Bundle(url: applicationURL)?.bundleIdentifier?.lowercased() else {
            return true
        }
        if Bundle.main.bundleIdentifier?.lowercased() == bundleIdentifier {
            return false
        }
        return !bundleIdentifier.hasPrefix("dev.cmux.")
            && !bundleIdentifier.hasPrefix("com.cmuxterm.")
    }
}

enum FileExternalOpenAction {
    @discardableResult
    static func openDefault(fileURL: URL) -> Bool {
        let resolver = FileExternalOpenApplicationResolver.live
        guard let defaultURL = resolver.defaultApplicationURL(fileURL) else {
            return open(fileURL: fileURL, applicationURL: nil)
        }
        if resolver.shouldIncludeApplication(defaultURL) {
            return open(fileURL: fileURL, applicationURL: defaultURL)
        }
        guard let fallbackURL = resolver.applicationURLs(fileURL).first(where: resolver.shouldIncludeApplication) else {
            return false
        }
        return open(fileURL: fileURL, applicationURL: fallbackURL)
    }

    @discardableResult
    static func open(fileURL: URL, applicationURL: URL?) -> Bool {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = false
        if let applicationURL {
            NSWorkspace.shared.open([fileURL], withApplicationAt: applicationURL, configuration: configuration)
            return true
        }
        return NSWorkspace.shared.open(fileURL)
    }

    static func revealInFinder(fileURL: URL) {
        NSWorkspace.shared.activateFileViewerSelecting([fileURL])
    }
}

enum FileExternalOpenText {
    static var openWithMenu: String {
        String(localized: "filePreview.openWith.menu", defaultValue: "Open With")
    }

    static var openExternally: String {
        String(localized: "filePreview.openExternally", defaultValue: "Open Externally")
    }

    static func openInApplication(_ applicationName: String) -> String {
        let format = String(localized: "filePreview.openInApplication", defaultValue: "Open in %@")
        return String(format: format, applicationName)
    }

    static var revealInFinder: String {
        String(localized: "fileExplorer.contextMenu.revealInFinder", defaultValue: "Reveal in Finder")
    }
}

struct FilePreviewDragEntry {
    let filePath: String
    let displayTitle: String
}

final class FilePreviewDragRegistry {
    static let shared = FilePreviewDragRegistry()

    private init() {}

    func register(_ entry: FilePreviewDragEntry, id: UUID = UUID(), now: Date = Date()) -> UUID { id }
    func consume(id: UUID, now: Date = Date()) -> FilePreviewDragEntry? { nil }
    func contains(id: UUID, now: Date = Date()) -> Bool { false }
    func entry(id: UUID, now: Date = Date()) -> FilePreviewDragEntry? { nil }
    func discard(id: UUID) {}
    func discardExpired(now: Date = Date()) {}
    func discardAll() {}
}

final class FilePreviewDragPasteboardWriter: NSObject, NSPasteboardWriting {
    private let filePath: String

    init(filePath: String, displayTitle: String) {
        self.filePath = filePath
        super.init()
    }

    static func dragID(from transferData: Data) -> UUID? { nil }
    static func dragID(from pasteboard: NSPasteboard) -> UUID? { nil }
    static func discardRegisteredDrag(from pasteboard: NSPasteboard) {}

    func writableTypes(for pasteboard: NSPasteboard) -> [NSPasteboard.PasteboardType] {
        [.fileURL]
    }

    func pasteboardPropertyList(forType type: NSPasteboard.PasteboardType) -> Any? {
        guard type == .fileURL else { return nil }
        return URL(fileURLWithPath: filePath).standardizedFileURL.absoluteString
    }
}

final class FilePreviewNativeViewSessions {
    func closeAll() {}
    func closeInactive(except mode: FilePreviewMode) {}
}

@MainActor
final class FilePreviewPanel: Panel, ObservableObject, FilePreviewTextEditingPanel {
    let id = UUID()
    let panelType: PanelType = .filePreview
    let filePath: String
    private(set) var workspaceId: UUID
    @Published private(set) var displayTitle: String
    @Published private(set) var displayIcon: String? = "doc"
    @Published private(set) var isFileUnavailable = false
    @Published private(set) var textContent = ""
    @Published private(set) var isDirty = false
    @Published private(set) var isSaving = false
    @Published private(set) var focusFlashToken = 0
    @Published private(set) var previewMode: FilePreviewMode = .unsupported
    let nativeViewSessions = FilePreviewNativeViewSessions()
    var fileURL: URL { URL(fileURLWithPath: filePath) }

    init(workspaceId: UUID, filePath: String) {
        self.workspaceId = workspaceId
        self.filePath = filePath
        self.displayTitle = URL(fileURLWithPath: filePath).lastPathComponent
    }

    func close() {}
    func focus() {}
    func unfocus() {}
    func triggerFlash(reason: WorkspaceAttentionFlashReason) { focusFlashToken += 1 }
    func attachTextView(_ textView: NSTextView) {}
    func retryPendingFocus() {}
    func updateTextContent(_ nextContent: String) { textContent = nextContent }
    @discardableResult
    func handleDroppedFileURLsAsText(_ urls: [URL]) -> Bool { false }
    func saveTextContent() -> Task<Void, Never>? { nil }
}

struct FilePreviewPanelView: View {
    let panel: FilePreviewPanel
    let isFocused: Bool
    let isVisibleInUI: Bool
    let portalPriority: Int
    let appearance: PanelAppearance
    let onRequestPanelFocus: () -> Void
    var body: some View { Color.clear }
}

extension Workspace {
    func publishBrowserOpenTabSuggestion(for browserPanel: BrowserPanel) {}

    func removeBrowserOpenTabSuggestion(panelId: UUID) {}

    func removeBrowserOpenTabSuggestionIfNeeded(panel: (any Panel)?, panelId: UUID) {}

    @discardableResult
    func openFileSurfaces(
        inPane paneId: PaneID,
        filePaths: [String],
        focus: Bool? = nil,
        targetIndex: Int? = nil,
        reuseExisting: Bool = false
    ) -> [any Panel] {
        []
    }
}

struct BrowserPortalSearchOverlayConfiguration {}
struct BrowserPortalOmnibarSuggestionsConfiguration {}
struct BrowserPaneDropContext: Equatable {
    let workspaceId: UUID
    let panelId: UUID
    let paneId: PaneID
}
final class BrowserPaneDropTargetView: NSView {}

enum BrowserWindowPortalRegistry {
    struct DebugSnapshot {
        let visibleInUI: Bool
        let containerHidden: Bool
        let frameInWindow: CGRect
    }

    static func bind(webView: WKWebView, to anchorView: NSView, visibleInUI: Bool, zPriority: Int = 0) {}
    static func synchronizeForAnchor(_ anchorView: NSView) {}
    static func scheduleExternalGeometrySynchronize(for window: NSWindow) {}
    static func scheduleExternalGeometrySynchronizeForAllWindows() {}
    static func updateEntryVisibility(for webView: WKWebView, visibleInUI: Bool, zPriority: Int) {}
    static func isWebView(_ webView: WKWebView, boundTo anchorView: NSView) -> Bool { false }
    static func hide(webView: WKWebView, source: String = "externalHide") {}
    static func discard(webView: WKWebView, source: String = "externalDiscard", preserveCurrentSuperview: Bool = false) {}
    static func updateDropZoneOverlay(for webView: WKWebView, zone: DropZone?) {}
    static func updatePaneDropContext(for webView: WKWebView, context: BrowserPaneDropContext?) {}
    static func updateSearchOverlay(for webView: WKWebView, configuration: BrowserPortalSearchOverlayConfiguration?) {}
    static func updateOmnibarSuggestions(for webView: WKWebView, configuration: BrowserPortalOmnibarSuggestionsConfiguration?) {}
    static func searchOverlayPanelId(for responder: NSResponder, in window: NSWindow) -> UUID? { nil }
    static func yieldSearchOverlayFocusIfOwned(by panelId: UUID, in window: NSWindow) -> Bool { false }
    static func updatePaneTopChromeHeight(for webView: WKWebView, height: CGFloat) {}
    static func detach(webView: WKWebView) {}
    static func webViewAtWindowPoint(_ windowPoint: NSPoint, in window: NSWindow) -> WKWebView? { nil }
    static func browserPaneDropTargetAtWindowPoint(_ windowPoint: NSPoint, in window: NSWindow) -> BrowserPaneDropTargetView? { nil }
    static func refresh(webView: WKWebView, reason: String) {}
    static func debugSnapshot(for webView: WKWebView) -> DebugSnapshot? { nil }
    #if DEBUG
    static func debugPortalCount() -> Int { 0 }
    #endif
}

final class FeedCoordinator: @unchecked Sendable {
    enum IngestBlockingResult {
        case acknowledged(itemId: UUID?)
        case resolved(itemId: UUID?, decision: WorkstreamDecision)
        case timedOut(itemId: UUID?)
    }

    static let shared = FeedCoordinator()
    static let storeInstalledNotification = Notification.Name("cmux.feed.storeInstalled")
    @MainActor private(set) var store: WorkstreamStore?

    @MainActor
    func install(store: WorkstreamStore) {
        self.store = store
        NotificationCenter.default.post(name: Self.storeInstalledNotification, object: self)
    }

    func ingestBlocking(event: WorkstreamEvent, waitTimeout: TimeInterval) -> IngestBlockingResult {
        .acknowledged(itemId: nil)
    }

    func deliverReply(requestId: String, decision: WorkstreamDecision) {}
    func snapshot(pendingOnly: Bool) -> [WorkstreamItem] { [] }
    func resolvePossibleSurface(for workstreamID: String) -> Bool { false }
    func focusIfPossible(workstreamId: String) -> Bool { false }
    func sendTextToWorkstream(workstreamId: String, text: String) {}
}

enum FeedSocketEncoding {
    static func payload(for result: FeedCoordinator.IngestBlockingResult) -> [String: Any] {
        switch result {
        case .acknowledged(let itemId):
            var payload: [String: Any] = ["status": "acknowledged"]
            if let itemId { payload["item_id"] = itemId.uuidString }
            return payload
        case .resolved(let itemId, let decision):
            var payload: [String: Any] = ["status": "resolved"]
            if let itemId { payload["item_id"] = itemId.uuidString }
            return payload
        case .timedOut(let itemId):
            var payload: [String: Any] = ["status": "timed_out"]
            if let itemId { payload["item_id"] = itemId.uuidString }
            return payload
        }
    }

    static func itemDict(_ item: WorkstreamItem) -> [String: Any] {
        [
            "id": item.id.uuidString,
            "workstream_id": item.workstreamId,
            "source": item.source.rawValue,
            "kind": item.kind.rawValue,
        ]
    }
}

enum FeedPermissionActionPolicy {
    static func supportsPersistentPermissionModes(source: WorkstreamSource) -> Bool { false }
    static func supportsOncePermissionMode(source: WorkstreamSource, toolInputJSON: String?) -> Bool { false }
    static func supportsAlwaysPermissionMode(source: WorkstreamSource, toolInputJSON: String?) -> Bool { false }
    static func supportsAllPermissionMode(source: WorkstreamSource, toolInputJSON: String?) -> Bool { false }
    static func supportsBypassPermissions(source: WorkstreamSource) -> Bool { false }
    static func codexCapabilityToolInputJSON(source: WorkstreamSource, toolInputJSON: String) -> String? { nil }
}

final class FeedPreviewWindowController: NSWindowController {
    static let shared = FeedPreviewWindowController(window: nil)
    func show() {}
}

final class FeedTextEditorDebugWindowController {
    static let shared = FeedTextEditorDebugWindowController()
    func show() {}
}

final class FeedButtonStyleDebugWindowController {
    static let shared = FeedButtonStyleDebugWindowController()
    func show() {}
}

final class PDFPreviewChromeDebugWindowController {
    static let shared = PDFPreviewChromeDebugWindowController()
    func show() {}
}

struct FeedPanelView: View {
    var body: some View { Color.clear }
}

extension TerminalController: ControlFeedContext {
    func controlFeedResolvePossibleSurface(workstreamID: String) -> Bool { false }
    func controlFeedSnapshotItems(pendingOnly: Bool) -> [JSONValue] { [] }
}

extension TerminalController: ControlBrowserPanelContext {
    func controlBrowserPanelTabManagerAvailable() -> Bool { tabManager != nil }
    func controlBrowserPanelAvailabilityEnabled() -> Bool { false }
    func controlBrowserPanelOpenURLExternally(_ url: URL) -> Bool { NSWorkspace.shared.open(url) }
    func controlBrowserPanelOpen(url: URL?) -> UUID? { nil }
    func controlBrowserPanelNavigate(panelID: UUID, urlString: String) -> Bool { false }
    func controlBrowserPanelGoBack(panelID: UUID) -> Bool { false }
    func controlBrowserPanelGoForward(panelID: UUID) -> Bool { false }
    func controlBrowserPanelReload(panelID: UUID) -> Bool { false }
    func controlBrowserPanelCurrentURLString(panelID: UUID) -> String? { nil }
    func controlBrowserPanelFocusWebView(panelID: UUID) -> ControlBrowserPanelFocusWebViewResolution { .panelNotFound }
    func controlBrowserPanelIsWebViewFocused(panelID: UUID) -> ControlBrowserPanelWebViewFocusState { .panelNotFound }
}
#endif
