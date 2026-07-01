import AppKit
import CMUXMobileCore
import SwiftUI

/// Renders a Web Connect URL as a scanner-friendly QR code.
struct WebConnectQRCodeView: View {
    /// The URL encoded into the QR code.
    let url: String

    var body: some View {
        Group {
            if let image = qrImage {
                Image(nsImage: image)
                    .interpolation(.none)
                    .resizable()
                    .aspectRatio(1, contentMode: .fit)
                    .accessibilityLabel(
                        String(
                            localized: "settings.mobile.webAccess.qrAccessibilityLabel",
                            defaultValue: "Web Connect QR code"
                        )
                    )
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.secondary.opacity(0.12))
                    .aspectRatio(1, contentMode: .fit)
                    .overlay(
                        Image(systemName: "qrcode")
                            .cmuxFont(size: 32)
                            .foregroundStyle(.secondary)
                    )
                    .accessibilityLabel(
                        String(
                            localized: "settings.mobile.webAccess.qrUnavailable",
                            defaultValue: "Web Connect QR code unavailable."
                        )
                    )
            }
        }
    }

    private var qrImage: NSImage? {
        guard let cgImage = CmxPairingQRBitmap().makeImage(payload: url) else {
            return nil
        }
        return NSImage(
            cgImage: cgImage,
            size: NSSize(width: CGFloat(cgImage.width), height: CGFloat(cgImage.height))
        )
    }
}
