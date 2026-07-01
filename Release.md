# Release Notes

## deppy-lite Web Connect Runtime Split

- deppy-lite release/download links and optional runtime assets use the fork origin, `https://github.com/JRVector9/deppy-mux-lite.git`, not upstream `manaflow-ai/cmux`.
- `main`: Universal lite branch for Intel Macs and Apple Silicon Macs. The universal Release build was verified end-to-end after the Web Connect runtime split.
- `deppy-lite-arm64`: Apple Silicon-only lite branch. The arm64 Release build was verified end-to-end after the Web Connect runtime split.
- `scripts/build-deppy-lite-universal-release.sh` defaults to no bundled Web Connect runtime.
- Set `DEPPY_LITE_INCLUDE_WEB_CONNECT_RUNTIME=1` to opt in to bundling the Web Connect runtime.
- Without that opt-in, the script removes `Contents/Resources/web-connect` from the lite app bundle and fails if the runtime unexpectedly remains.
- The default Install Runtime URL is `https://github.com/JRVector9/deppy-mux-lite/releases/latest/download/deppy-web-connect-runtime-<arch>.zip`.

## deppy-mux-lite Release Script

- deppy-lite keeps release version metadata separate from the upstream cmux app.
- The lite version source of truth is `DEPPY_LITE_VERSION`.
- `scripts/build-deppy-lite-arm64-release.sh` and `scripts/build-deppy-lite-universal-release.sh` read `DEPPY_LITE_VERSION` and pass `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` to Xcode at build time.
- Current lite version: `0.0.1` build `1`.
- Override for one build with `DEPPY_LITE_MARKETING_VERSION=<version>` and/or `DEPPY_LITE_BUILD_VERSION=<build>`.
- Override the version file path with `DEPPY_LITE_VERSION_FILE=<path>`.
- `scripts/build-deppy-lite-universal-release.sh` builds Intel + Apple Silicon `deppy-mux-lite-universal.app` and asserts both `arm64` and `x86_64` slices are present.
- Final downloadable release packages must contain a real Ghostty CLI helper, not the `CMUX_SKIP_ZIG_BUILD=1` stub.
- If no prebuilt helper is provided, the lite release scripts call `scripts/ensure-zig-required.sh` and use a pinned Zig 0.15.2 from `~/Library/Caches/deppy-mux/zig`, without changing the system Homebrew Zig.
- If Zig 0.15.2 cannot link correctly on the app build machine, build the helper separately on a compatible macOS runner and pass it with `DEPPY_LITE_GHOSTTY_HELPER_PATH=<path>`.
- `scripts/build-deppy-lite-universal-release.sh` requires a helper containing both `arm64` and `x86_64`.
- `CMUX_SKIP_ZIG_BUILD=1` without `DEPPY_LITE_GHOSTTY_HELPER_PATH` now fails by default. Use `DEPPY_LITE_ALLOW_STUB_GHOSTTY_HELPER=1` only for local compile validation, never for release assets.
- GitHub Actions workflow `.github/workflows/deppy-lite-release.yml` builds the real universal Ghostty helper on macOS 15, injects it into arm64 and universal lite apps, signs/notarizes both apps, creates notarized DMGs, and uploads `deppy-mux-lite-arm64.dmg` / `deppy-mux-lite-universal.dmg` for tags matching `deppy-lite-v*`.
