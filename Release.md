# Release Notes

## deppy-lite Web Connect Runtime Split

- deppy-lite release/download links and optional runtime assets use the fork origin, `https://github.com/JRVector9/deppy-mux-lite.git`, not upstream `manaflow-ai/cmux`.
- `main`: Universal lite branch for Intel Macs and Apple Silicon Macs. The release workflow publishes `deppy-mux-lite-universal.dmg`.
- `deppy-lite-arm64`: Apple Silicon-only optimized branch. Branch-specific release assets should not replace the universal `main` DMG name.
- `scripts/build-deppy-lite-universal-release.sh` defaults to no bundled Web Connect runtime.
- Set `DEPPY_LITE_INCLUDE_WEB_CONNECT_RUNTIME=1` to opt in to bundling the Web Connect runtime.
- Without that opt-in, the script removes `Contents/Resources/web-connect` from the lite app bundle and fails if the runtime unexpectedly remains.
- The default Install Runtime URL is `https://github.com/JRVector9/deppy-mux-lite/releases/latest/download/deppy-web-connect-runtime-<arch>.zip`.
- The release workflow publishes both runtime archive assets expected by the app: `deppy-web-connect-runtime-arm64.zip` and `deppy-web-connect-runtime-x86_64.zip`.

## deppy-mux-lite Release Script

- deppy-lite keeps release version metadata separate from the upstream cmux app.
- The lite version source of truth is `DEPPY_LITE_VERSION`.
- `scripts/build-deppy-lite-universal-release.sh` reads `DEPPY_LITE_VERSION` and passes `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` to Xcode at build time.
- Current lite version: `0.0.1` build `1`.
- Override for one build with `DEPPY_LITE_MARKETING_VERSION=<version>` and/or `DEPPY_LITE_BUILD_VERSION=<build>`.
- Override the version file path with `DEPPY_LITE_VERSION_FILE=<path>`.
- `scripts/build-deppy-lite-universal-release.sh` builds Intel + Apple Silicon `deppy-mux-lite-universal.app` and asserts both `arm64` and `x86_64` slices are present.
- Final downloadable release packages must contain a real Ghostty CLI helper, not the `CMUX_SKIP_ZIG_BUILD=1` stub.
- If no prebuilt helper is provided, the lite release scripts call `scripts/ensure-zig-required.sh` and use a pinned Zig 0.15.2 from `~/Library/Caches/deppy-mux/zig`, without changing the system Homebrew Zig.
- If Zig 0.15.2 cannot link correctly on the app build machine, build the helper separately on a compatible macOS runner and pass it with `DEPPY_LITE_GHOSTTY_HELPER_PATH=<path>`.
- `scripts/build-deppy-lite-universal-release.sh` requires a helper containing both `arm64` and `x86_64`.
- `CMUX_SKIP_ZIG_BUILD=1` without `DEPPY_LITE_GHOSTTY_HELPER_PATH` now fails by default. Use `DEPPY_LITE_ALLOW_STUB_GHOSTTY_HELPER=1` only for local compile validation, never for release assets.
- GitHub Actions workflow `.github/workflows/deppy-lite-release.yml` builds the real universal Ghostty helper on macOS 15, builds the universal lite app on `main`, signs/notarizes it, creates the notarized `deppy-mux-lite-universal.dmg`, and uploads the DMG plus `deppy-web-connect-runtime-arm64.zip` and `deppy-web-connect-runtime-x86_64.zip` for tags matching `deppy-lite-v*`.
- The x86_64 runtime archive job requires an Intel macOS runner. It defaults to GitHub's `macos-15-intel` runner; set the repository variable `DEPPY_LITE_MACOS_X86_64_RUNNER` to override it.

## deppy-mux-lite Distribution Checklist

### Version and Branch Policy

- `main` is the default public lite channel for the universal app, usable on Intel Macs and Apple Silicon Macs.
- `deppy-lite-arm64` is the Apple Silicon-only optimized release branch.
- Full cmux release metadata and upstream `manaflow-ai/cmux` appcast data must not be reused for deppy-mux-lite.
- Keep deppy-lite version metadata in `DEPPY_LITE_VERSION`.
- For a new build of the same marketing version, run:

```bash
./scripts/bump-deppy-lite-version.sh
```

- Example result: `0.0.1 (1)` becomes `0.0.1 (2)`.
- For a patch/minor/major version bump, run one of:

```bash
./scripts/bump-deppy-lite-version.sh patch
./scripts/bump-deppy-lite-version.sh minor
./scripts/bump-deppy-lite-version.sh major
./scripts/bump-deppy-lite-version.sh 0.1.0
```

- Commit `DEPPY_LITE_VERSION` before tagging. Sparkle requires `CURRENT_PROJECT_VERSION` to increase monotonically.

### Sparkle Update Channel

- deppy-mux-lite uses a separate Sparkle signing key from cmux.
- Generate the key locally with:

```bash
SPARKLE_KEYCHAIN_ACCOUNT=deppy-mux-lite \
SPARKLE_ENV_FILE=.env.deppy-lite \
./scripts/sparkle_generate_keys.sh
```

- `SPARKLE_PUBLIC_KEY` is committed through Xcode build settings and injected into `SUPublicEDKey`.
- `SPARKLE_PRIVATE_KEY` must never be committed. Store it in GitHub Secrets as `DEPPY_LITE_SPARKLE_PRIVATE_KEY`.
- Current deppy-lite public key:

```text
ojk35wvax9SXb3G+4lpL83PRAS2FQzqs+4FsbE0otOA=
```

- `Resources/Info.plist` uses `$(SPARKLE_FEED_URL)` and `$(SPARKLE_PUBLIC_KEY)`.
- Release scripts pass branch/variant-specific appcast URLs:
  - arm64: `https://github.com/JRVector9/deppy-mux-lite/releases/latest/download/appcast-arm64.xml`
  - universal: `https://github.com/JRVector9/deppy-mux-lite/releases/latest/download/appcast-universal.xml`
- The release workflow must upload the appcast next to the DMG. Without the appcast asset, Sparkle update checks cannot work.

### GitHub Secrets

Add these secrets to `https://github.com/JRVector9/deppy-mux-lite/settings/secrets/actions`.

```text
DEPPY_LITE_SPARKLE_PRIVATE_KEY
APPLE_CERTIFICATE_BASE64
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
DEPPY_LITE_RELEASE_PROVISIONING_PROFILE_BASE64
```

- `DEPPY_LITE_SPARKLE_PRIVATE_KEY`: value from `.env.deppy-lite`, key `SPARKLE_PRIVATE_KEY`.
- `APPLE_ID`: Apple Developer Apple ID email.
- `APPLE_TEAM_ID`: Apple Developer Team ID from `developer.apple.com/account` -> Membership details.
- `APPLE_APP_SPECIFIC_PASSWORD`: generated at `appleid.apple.com` -> Sign-In and Security -> App-Specific Passwords.
- `APPLE_CERTIFICATE_BASE64`: base64-encoded Developer ID Application `.p12`.
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`.
- `APPLE_SIGNING_IDENTITY`: full codesigning identity name from `security find-identity -v -p codesigning`, usually `Developer ID Application: Name (TEAMID)`.
- `DEPPY_LITE_RELEASE_PROVISIONING_PROFILE_BASE64`: base64-encoded Developer ID provisioning profile for the app bundle ID being released.

Export local files without printing their contents:

```bash
base64 -i /path/to/developer-id-application.p12 | pbcopy
base64 -i /path/to/deppy-lite.provisionprofile | pbcopy
```

Never commit `.p12`, `.pem`, `.p8`, `.mobileprovision`, `.provisionprofile`, `.env`, `.env.*`, or Sparkle private key files. `.gitignore` and the pre-commit hook are configured to block the common secret file names, but GitHub Secrets or Keychain are the only intended storage locations.

### Apple Developer Assets

- Create or reuse a Developer ID Application certificate in Apple Developer.
- Export it from Keychain Access as `.p12`.
- The provisioning profile must match the bundle ID:
  - universal main app: `com.deppy-mux.lite.universal`
  - arm64 app: `com.deppy-mux.lite`
- If publishing both variants from one workflow, both bundle IDs must be covered by the signing/provisioning setup used by that workflow.
- The workflow signs the app, notarizes the app, creates the DMG, signs the DMG, notarizes the DMG, staples tickets, then uploads release assets.

### Release Assets

The GitHub Release should contain:

```text
deppy-mux-lite-universal.dmg
appcast-universal.xml
deppy-web-connect-runtime-arm64.zip
deppy-web-connect-runtime-x86_64.zip
```

For the arm64 optimized branch/release, include:

```text
deppy-mux-lite-arm64.dmg
appcast-arm64.xml
```

The Web Connect runtime archives are optional runtime downloads. They are not bundled into the default lite app.

### Tag and Release Flow

Typical universal release flow on `main`:

```bash
git switch main
git pull --ff-only origin main
./scripts/bump-deppy-lite-version.sh
git add DEPPY_LITE_VERSION
git commit -m "Bump deppy lite build version"
git tag deppy-lite-v0.0.1-build.2
git push origin main --tags
```

Use a tag that matches:

```text
deppy-lite-v*
```

The GitHub Actions workflow `.github/workflows/deppy-lite-release.yml` runs from that tag and publishes the release assets.

### Pre-Publish Verification

Before announcing a release, verify:

- The GitHub Actions run completed successfully.
- The release has the expected DMG, runtime ZIPs, and appcast XML files.
- The downloaded DMG opens and installs.
- Gatekeeper allows launching the installed app without manual override.
- `spctl -a -vv --type execute /Applications/deppy-mux-lite.app` accepts the app.
- `xcrun stapler validate <downloaded-dmg>` succeeds.
- The app shows the expected version, for example `0.0.1 (2)`.
- Sparkle update checks read `JRVector9/deppy-mux-lite`, not `manaflow-ai/cmux`.
- `deppy-cli` is present in `Contents/Resources/bin/deppy-cli`.
- The Ghostty helper is real and executable, not a local stub.
- `Contents/Resources/web-connect` is absent unless `DEPPY_LITE_INCLUDE_WEB_CONNECT_RUNTIME=1` was intentionally used.
- Web Connect Install Runtime downloads from `https://github.com/JRVector9/deppy-mux-lite/releases/latest/download/deppy-web-connect-runtime-<arch>.zip`.

### Common Failure Points

- Missing `DEPPY_LITE_SPARKLE_PRIVATE_KEY`: appcast generation fails or appcast lacks `sparkle:edSignature`.
- Wrong Sparkle public/private key pair: appcast is generated but Sparkle rejects the update.
- `SUFeedURL` points at `manaflow-ai/cmux`: lite users receive the wrong update feed.
- Build number not increased: Sparkle may ignore the release.
- Missing Apple secrets: signing/notarization jobs fail.
- Wrong provisioning profile bundle ID: codesign or entitlement validation fails.
- Missing Intel runner for x86_64 runtime: universal release cannot publish both runtime archives.
- Stub Ghostty helper: release script should fail unless explicitly allowed for local compile validation only.
