#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${DERIVED_DATA:-${HOME}/Library/Developer/Xcode/DerivedData/deppy-lite-arm64-release}"
APP_PATH="${DERIVED_DATA}/Build/Products/Release/deppy-mux-lite.app"
APP_BIN="${APP_PATH}/Contents/MacOS/deppy-mux-lite"
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
  -destination 'platform=macOS,arch=arm64'
  -derivedDataPath "$DERIVED_DATA"
  build
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
  ARCHS=arm64
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

require_exact_archs() {
  local binary="$1"
  local label="$2"
  shift 2
  local expected
  local actual
  expected="$*"
  actual="$(lipo -archs "$binary")"
  if [[ "$actual" != "$expected" ]]; then
    echo "error: $label architectures are '$actual', expected '$expected'" >&2
    exit 1
  fi
}

require_executable "$CLI_BIN" "deppy-cli"
require_executable "$CMUX_SHIM" "cmux compatibility shim"

if [[ -n "$PREBUILT_GHOSTTY_HELPER" ]]; then
  mkdir -p "$(dirname "$GHOSTTY_HELPER_BIN")"
  helper_archs="$(lipo -archs "$PREBUILT_GHOSTTY_HELPER")"
  case " $helper_archs " in
    *" arm64 "*) ;;
    *) echo "error: prebuilt Ghostty helper is missing arm64 slice: $helper_archs" >&2; exit 68 ;;
  esac
  if [[ "$helper_archs" == *" "* ]]; then
    lipo "$PREBUILT_GHOSTTY_HELPER" -thin arm64 -output "$GHOSTTY_HELPER_BIN"
    chmod 0755 "$GHOSTTY_HELPER_BIN"
  else
    install -m 755 "$PREBUILT_GHOSTTY_HELPER" "$GHOSTTY_HELPER_BIN"
  fi
fi

require_executable "$GHOSTTY_HELPER_BIN" "Ghostty CLI helper"
require_exact_archs "$GHOSTTY_HELPER_BIN" "Ghostty CLI helper" arm64
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
require_exact_archs "$APP_BIN" "app binary" arm64
lipo -info "$CLI_BIN"
require_exact_archs "$CLI_BIN" "deppy-cli" arm64
lipo -info "$GHOSTTY_HELPER_BIN"
require_exact_archs "$GHOSTTY_HELPER_BIN" "Ghostty CLI helper" arm64
if [[ "${DEPPY_LITE_SKIP_SMOKE:-0}" != "1" ]]; then
  "$CLI_BIN" --help >/dev/null
  "$CMUX_SHIM" --help >/dev/null
fi
