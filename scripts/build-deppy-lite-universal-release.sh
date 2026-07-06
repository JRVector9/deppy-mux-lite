#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${DERIVED_DATA:-${HOME}/Library/Developer/Xcode/DerivedData/deppy-lite-universal-release}"
APP_PRODUCT_NAME="${APP_PRODUCT_NAME:-deppy-mux-lite-universal}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.deppy-mux.lite.universal}"
APP_AUTH_CALLBACK_SCHEME="${APP_AUTH_CALLBACK_SCHEME:-deppy-mux-lite-universal}"
SPARKLE_FEED_URL="${DEPPY_LITE_SPARKLE_FEED_URL:-https://github.com/JRVector9/deppy-mux-lite/releases/latest/download/appcast-universal.xml}"
SPARKLE_PUBLIC_KEY="${DEPPY_LITE_SPARKLE_PUBLIC_KEY:-ojk35wvax9SXb3G+4lpL83PRAS2FQzqs+4FsbE0otOA=}"
APP_PATH="${DERIVED_DATA}/Build/Products/Release/${APP_PRODUCT_NAME}.app"
APP_BIN="${APP_PATH}/Contents/MacOS/${APP_PRODUCT_NAME}"
CLI_BIN="${APP_PATH}/Contents/Resources/bin/deppy-cli"
CMUX_SHIM="${APP_PATH}/Contents/Resources/bin/cmux"
WEB_CONNECT_RUNTIME_DIR="${APP_PATH}/Contents/Resources/web-connect"
GHOSTTY_HELPER_BIN="${APP_PATH}/Contents/Resources/bin/ghostty"

cd "$ROOT_DIR"

VERSION_FILE="${DEPPY_LITE_VERSION_FILE:-${ROOT_DIR}/DEPPY_LITE_VERSION}"

read_lite_version_value() {
  local key="$1"
  if [[ -f "$VERSION_FILE" ]]; then
    sed -n "s/^${key}=//p" "$VERSION_FILE" | tail -n 1
  fi
}

LITE_MARKETING_VERSION="${DEPPY_LITE_MARKETING_VERSION:-$(read_lite_version_value MARKETING_VERSION)}"
LITE_BUILD_VERSION="${DEPPY_LITE_BUILD_VERSION:-$(read_lite_version_value CURRENT_PROJECT_VERSION)}"
PREBUILT_GHOSTTY_HELPER="${DEPPY_LITE_GHOSTTY_HELPER_PATH:-}"

if [[ -n "$PREBUILT_GHOSTTY_HELPER" ]]; then
  if [[ ! -f "$PREBUILT_GHOSTTY_HELPER" ]]; then
    echo "error: DEPPY_LITE_GHOSTTY_HELPER_PATH does not exist: $PREBUILT_GHOSTTY_HELPER" >&2
    exit 66
  fi
  # The app build can use a temporary stub, but the script replaces it below
  # with the provided real helper before any release artifact is accepted.
  export CMUX_SKIP_ZIG_BUILD=1
fi

# --- Local fallback when the pinned Zig can't build the Ghostty helper --------
# Zig builds its build-runner for the native host. On a macOS newer than the
# pinned Zig knows about (e.g. macOS 26 + Zig 0.15.2, which lacks libSystem
# stubs for that OS), that native link fails, so `zig build` of the helper can't
# run at all. The functions below detect that case and reuse a valid prebuilt
# helper instead of failing the whole release build.

# Probe: can this Zig link a native macOS binary? Mirrors how the build-runner
# is linked, so a failure here predicts the helper build failing the same way.
zig_can_link_natively() {
  local zig_bin="$1"
  local probe_dir
  probe_dir="$(mktemp -d "${TMPDIR:-/tmp}/cmux-zig-probe.XXXXXX")"
  printf 'const std = @import("std");\npub fn main() void {\n    std.debug.print("", .{});\n}\n' \
    >"$probe_dir/probe.zig"
  local rc=0
  ( cd "$probe_dir" && env -u SDKROOT "$zig_bin" build-exe probe.zig -femit-bin=probe ) \
    >/dev/null 2>&1 || rc=1
  rm -rf "$probe_dir"
  return "$rc"
}

# Print a valid, non-stub prebuilt Ghostty helper that contains every requested
# architecture, searching installed app bundles. Returns non-zero if none match.
find_prebuilt_ghostty_helper() {
  local candidate want ok
  for candidate in \
    "/Applications/deppy-mux-lite-universal.app/Contents/Resources/bin/ghostty" \
    "/Applications/cmux.app/Contents/Resources/bin/ghostty" \
    "/Applications/deppy-mux-lite.app/Contents/Resources/bin/ghostty"; do
    [[ -x "$candidate" ]] || continue
    ok=1
    for want in "$@"; do
      lipo -archs "$candidate" 2>/dev/null | tr ' ' '\n' | grep -qx "$want" || { ok=0; break; }
    done
    [[ "$ok" == "1" ]] || continue
    /usr/bin/strings "$candidate" 2>/dev/null | grep -q "ghostty CLI helper stub" && continue
    echo "$candidate"
    return 0
  done
  return 1
}

# When no explicit helper was provided and the pinned Zig can't build here, fall
# back to a prebuilt universal (arm64+x86_64) helper so local release builds still
# succeed. On CI (older macOS) the probe passes and the source build runs as
# usual. Disable with DEPPY_LITE_AUTO_GHOSTTY_HELPER=0.
if [[ -z "$PREBUILT_GHOSTTY_HELPER" \
      && "${CMUX_SKIP_ZIG_BUILD:-}" != "1" \
      && "${DEPPY_LITE_AUTO_GHOSTTY_HELPER:-1}" == "1" ]]; then
  probe_zig="${CMUX_ZIG:-$("$ROOT_DIR/scripts/ensure-zig-required.sh" 2>/dev/null || true)}"
  if [[ -n "$probe_zig" && -x "$probe_zig" ]] && ! zig_can_link_natively "$probe_zig"; then
    auto_helper="$(find_prebuilt_ghostty_helper arm64 x86_64 || true)"
    if [[ -n "$auto_helper" ]]; then
      echo "note: pinned Zig cannot build the Ghostty helper on this host; reusing prebuilt helper:" >&2
      echo "      $auto_helper" >&2
      echo "      (set DEPPY_LITE_AUTO_GHOSTTY_HELPER=0 to force a source build)" >&2
      PREBUILT_GHOSTTY_HELPER="$auto_helper"
      export CMUX_SKIP_ZIG_BUILD=1
    else
      echo "warning: pinned Zig cannot build the Ghostty helper here and no prebuilt universal (arm64+x86_64) helper was found." >&2
      echo "         Provide one with DEPPY_LITE_GHOSTTY_HELPER_PATH=<path>." >&2
    fi
  fi
fi

if [[ "${CMUX_SKIP_ZIG_BUILD:-}" == "1" && -z "$PREBUILT_GHOSTTY_HELPER" && "${DEPPY_LITE_ALLOW_STUB_GHOSTTY_HELPER:-0}" != "1" ]]; then
  cat >&2 <<'EOF'
error: CMUX_SKIP_ZIG_BUILD=1 would leave a Ghostty CLI helper stub in the app.
Provide a real helper with DEPPY_LITE_GHOSTTY_HELPER_PATH=<path>, install Zig 0.15.2,
or set DEPPY_LITE_ALLOW_STUB_GHOSTTY_HELPER=1 only for local compile validation.
EOF
  exit 67
fi

if [[ -z "$PREBUILT_GHOSTTY_HELPER" && "${CMUX_SKIP_ZIG_BUILD:-}" != "1" ]]; then
  CMUX_ZIG="$("$ROOT_DIR/scripts/ensure-zig-required.sh")"
  export CMUX_ZIG
  echo "Using zig $("$CMUX_ZIG" version) at $CMUX_ZIG"
fi

XCODEBUILD_ARGS=(
  -project cmux.xcodeproj
  -scheme deppy-mux-lite
  -configuration Release
  -destination 'platform=macOS'
  -derivedDataPath "$DERIVED_DATA"
  build
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
  'ARCHS=arm64 x86_64'
  ONLY_ACTIVE_ARCH=NO
  DEPPY_LITE_PRODUCT_NAME="$APP_PRODUCT_NAME"
  DEPPY_LITE_BUNDLE_IDENTIFIER="$APP_BUNDLE_ID"
  DEPPY_LITE_AUTH_CALLBACK_SCHEME="$APP_AUTH_CALLBACK_SCHEME"
  DEPPY_LITE_SIDEBAR_EXTENSION_POINT_ID="$APP_BUNDLE_ID.cmux.sidebar"
  SPARKLE_FEED_URL="$SPARKLE_FEED_URL"
  SPARKLE_PUBLIC_KEY="$SPARKLE_PUBLIC_KEY"
  DEAD_CODE_STRIPPING=YES
  COMPILER_INDEX_STORE_ENABLE=NO
)

if [[ -n "$LITE_MARKETING_VERSION" ]]; then
  XCODEBUILD_ARGS+=(MARKETING_VERSION="$LITE_MARKETING_VERSION")
fi

if [[ -n "$LITE_BUILD_VERSION" ]]; then
  XCODEBUILD_ARGS+=(CURRENT_PROJECT_VERSION="$LITE_BUILD_VERSION")
fi

if [[ "${DEPPY_LITE_SWIFT_WORKAROUND:-1}" != "0" ]]; then
  XCODEBUILD_ARGS+=(SWIFT_ENABLE_BATCH_MODE=NO)
  XCODEBUILD_ARGS+=(SWIFT_COMPILATION_MODE=singlefile)
  XCODEBUILD_ARGS+=(DEBUG_INFORMATION_FORMAT=)
  XCODEBUILD_ARGS+=(GCC_GENERATE_DEBUGGING_SYMBOLS=NO)
  XCODEBUILD_ARGS+=('OTHER_SWIFT_FLAGS=$(inherited) -Xllvm -aarch64-enable-global-isel-at-O=-1')
fi

if [[ "${DEPPY_LITE_LINK_MAP:-0}" == "1" ]]; then
  XCODEBUILD_ARGS+=(LD_GENERATE_MAP_FILE=YES)
fi

if [[ "${CMUX_SKIP_ZIG_BUILD:-}" == "1" ]]; then
  XCODEBUILD_ARGS+=(CMUX_SKIP_ZIG_BUILD=1)
fi

xcodebuild "${XCODEBUILD_ARGS[@]}"

# Stamp the commit into the built Info.plist here, outside Xcode. The in-build
# script phase does the same, but under a linked git worktree the sandboxed
# phase cannot read the repo .git (it lives outside SRCROOT) and skips
# silently, leaving the About panel commit empty.
CMUX_COMMIT_STAMP="$(git -C "$ROOT_DIR" rev-parse --short=9 HEAD 2>/dev/null || true)"
if [[ -n "$CMUX_COMMIT_STAMP" && -f "$APP_PATH/Contents/Info.plist" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CMUXCommit $CMUX_COMMIT_STAMP" "$APP_PATH/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :CMUXCommit string $CMUX_COMMIT_STAMP" "$APP_PATH/Contents/Info.plist"
  echo "Stamped CMUXCommit=$CMUX_COMMIT_STAMP"
fi

if [[ ! -x "$APP_BIN" ]]; then
  echo "error: app binary not found at $APP_BIN" >&2
  exit 1
fi

require_executable() {
  local binary="$1"
  local label="$2"
  if [[ ! -x "$binary" ]]; then
    echo "error: $label not found at $binary" >&2
    exit 1
  fi
}

require_archs() {
  local binary="$1"
  local label="$2"
  shift 2
  if ! lipo "$binary" -verify_arch "$@"; then
    lipo -info "$binary" >&2 || true
    echo "error: $label is missing one or more required slices: $*" >&2
    exit 1
  fi
}

require_executable "$CLI_BIN" "deppy-cli"
require_executable "$CMUX_SHIM" "cmux compatibility shim"

if [[ -n "$PREBUILT_GHOSTTY_HELPER" ]]; then
  mkdir -p "$(dirname "$GHOSTTY_HELPER_BIN")"
  install -m 755 "$PREBUILT_GHOSTTY_HELPER" "$GHOSTTY_HELPER_BIN"
fi

require_executable "$GHOSTTY_HELPER_BIN" "Ghostty CLI helper"
require_archs "$GHOSTTY_HELPER_BIN" "Ghostty CLI helper" arm64 x86_64
if /usr/bin/strings "$GHOSTTY_HELPER_BIN" | grep -q "ghostty CLI helper stub" && [[ "${DEPPY_LITE_ALLOW_STUB_GHOSTTY_HELPER:-0}" != "1" ]]; then
  echo "error: Ghostty CLI helper is a stub; refusing to produce a release app" >&2
  exit 69
fi

if [[ "${DEPPY_LITE_SKIP_STRIP:-0}" != "1" ]]; then
  strip -u -r "$APP_BIN"
  strip -u -r "$CLI_BIN"
  strip -u -r "$GHOSTTY_HELPER_BIN"
fi

if [[ "${DEPPY_LITE_INCLUDE_WEB_CONNECT_RUNTIME:-0}" == "1" && "${DEPPY_LITE_SKIP_WEB_CONNECT_RUNTIME:-0}" != "1" ]]; then
  "$ROOT_DIR/scripts/build-web-connect-runtime.sh" "$APP_PATH"
else
  rm -rf "$WEB_CONNECT_RUNTIME_DIR"
  echo "Web Connect runtime: not bundled (set DEPPY_LITE_INCLUDE_WEB_CONNECT_RUNTIME=1 to include)"
fi

if [[ "${DEPPY_LITE_INCLUDE_WEB_CONNECT_RUNTIME:-0}" != "1" && -e "$WEB_CONNECT_RUNTIME_DIR" ]]; then
  echo "error: Web Connect runtime unexpectedly remains in lite app bundle: $WEB_CONNECT_RUNTIME_DIR" >&2
  exit 70
fi

echo "Release app:"
echo "  $APP_PATH"
echo "Sizes:"
du -sh "$APP_PATH" "$APP_BIN"
du -sh "$CLI_BIN"
echo "Architectures:"
lipo -info "$APP_BIN"
require_archs "$APP_BIN" "app binary" arm64 x86_64
lipo -info "$CLI_BIN"
require_archs "$CLI_BIN" "deppy-cli" arm64 x86_64
lipo -info "$GHOSTTY_HELPER_BIN"
require_archs "$GHOSTTY_HELPER_BIN" "Ghostty CLI helper" arm64 x86_64
if [[ "${DEPPY_LITE_SKIP_SMOKE:-0}" != "1" ]]; then
  "$CLI_BIN" --help >/dev/null
  "$CMUX_SHIM" --help >/dev/null
fi
