import Foundation
import Testing

@testable import CmuxSettingsUI

/// Behavior tests for ``MobileWebAccessSessionModel``.
@MainActor
@Suite struct MobileWebAccessSessionModelTests {
    @Test func startStoresCreatedSession() async {
        let expiresAt = Date(timeIntervalSince1970: 1_800)
        let snapshot = MobileWebAccessSessionSnapshot(
            slug: "abc123",
            publicURL: "https://cmux.test/w/abc123",
            expiresAt: expiresAt,
            hostSeenAt: nil
        )
        let model = MobileWebAccessSessionModel(
            currentSession: { nil },
            startSession: { .started(snapshot) },
            copyURL: { _ in }
        )

        await model.start()

        #expect(model.current == snapshot)
        #expect(model.lastError == nil)
        #expect(model.isStarting == false)
    }

    @Test func notSignedInLeavesCurrentSessionUntouched() async {
        let existing = MobileWebAccessSessionSnapshot(
            slug: "old",
            publicURL: "https://cmux.test/w/old",
            expiresAt: Date(timeIntervalSince1970: 1_200),
            hostSeenAt: nil
        )
        let model = MobileWebAccessSessionModel(
            currentSession: { existing },
            startSession: { .notSignedIn },
            copyURL: { _ in }
        )
        model.refreshCurrentSession()

        await model.start()

        #expect(model.current == existing)
        #expect(model.lastError == .notSignedIn)
        #expect(model.isStarting == false)
    }

    @Test func tailscaleUnavailableLeavesCurrentSessionUntouched() async {
        let existing = MobileWebAccessSessionSnapshot(
            slug: "old",
            publicURL: "https://cmux.test/w/old",
            expiresAt: Date(timeIntervalSince1970: 1_200),
            hostSeenAt: nil
        )
        let model = MobileWebAccessSessionModel(
            currentSession: { existing },
            startSession: { .tailscaleUnavailable },
            copyURL: { _ in }
        )
        model.refreshCurrentSession()

        await model.start()

        #expect(model.current == existing)
        #expect(model.lastError == .tailscaleUnavailable)
        #expect(model.isStarting == false)
    }

    @Test func webEndpointUnavailableLeavesCurrentSessionUntouched() async {
        let existing = MobileWebAccessSessionSnapshot(
            slug: "old",
            publicURL: "https://cmux.test/w/old",
            expiresAt: Date(timeIntervalSince1970: 1_200),
            hostSeenAt: nil
        )
        let model = MobileWebAccessSessionModel(
            currentSession: { existing },
            startSession: { .webEndpointUnavailable },
            copyURL: { _ in }
        )
        model.refreshCurrentSession()

        await model.start()

        #expect(model.current == existing)
        #expect(model.lastError == .webEndpointUnavailable)
        #expect(model.isStarting == false)
    }

    @Test func copyUsesCurrentURL() {
        var copied: String?
        let snapshot = MobileWebAccessSessionSnapshot(
            slug: "copy",
            publicURL: "https://cmux.test/w/copy",
            expiresAt: Date(timeIntervalSince1970: 1_200),
            hostSeenAt: nil
        )
        let model = MobileWebAccessSessionModel(
            currentSession: { snapshot },
            startSession: { .failed },
            copyURL: { copied = $0 }
        )
        model.refreshCurrentSession()

        model.copyCurrentURL()

        #expect(copied == snapshot.publicURL)
        #expect(model.didCopyCurrentURL)
    }
}
