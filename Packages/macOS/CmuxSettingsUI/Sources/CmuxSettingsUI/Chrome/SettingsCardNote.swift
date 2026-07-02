import CmuxFoundation
import SwiftUI

/// Small caption-style note rendered inside a ``SettingsCard`` —
/// typically used after a row to explain a setting's effect in
/// secondary-colored text. Mirrors the legacy in-app chrome.
///
/// The ``Role-swift.enum/warning`` role renders the note as an orange
/// warning label with a leading triangle icon and a tighter gap to the
/// row above, so error notes are hard to miss.
@MainActor
public struct SettingsCardNote: View {
    /// How the note is presented.
    public enum Role {
        /// Secondary-colored explanatory text (the default).
        case note
        /// Orange warning text with a leading `exclamationmark.triangle.fill`.
        case warning
    }

    let text: String
    let role: Role

    public init(_ text: String, role: Role = .note) {
        self.text = text
        self.role = role
    }

    public var body: some View {
        switch role {
        case .note:
            Text(text)
                .cmuxFont(.caption)
                .foregroundColor(.secondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .warning:
            Label(text, systemImage: "exclamationmark.triangle.fill")
                .cmuxFont(.caption)
                .foregroundStyle(.orange)
                .padding(.horizontal, 14)
                .padding(.top, 2)
                .padding(.bottom, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
