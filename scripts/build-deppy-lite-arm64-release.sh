#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${DERIVED_DATA:-${HOME}/Library/Developer/Xcode/DerivedData/deppy-lite-arm64-release}"
APP_PATH="${DERIVED_DATA}/Build/Products/Release/deppy-mux-lite.app"
APP_BIN="${APP_PATH}/Contents/MacOS/deppy-mux-lite"
CLI_BIN="${APP_PATH}/Contents/Resources/bin/deppy-cli"
CMUX_SHIM="${APP_PATH}/Contents/Resources/bin/cmux"
WEB_CONNECT_RUNTIME_DIR="${APP_PATH}/Contents/Resources/web-connect"

cd "$ROOT_DIR"

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

if [[ "${DEPPY_LITE_SKIP_STRIP:-0}" != "1" ]]; then
  strip -u -r "$APP_BIN"
  strip -u -r "$CLI_BIN"
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
if [[ "${DEPPY_LITE_SKIP_SMOKE:-0}" != "1" ]]; then
  "$CLI_BIN" --help >/dev/null
  "$CMUX_SHIM" --help >/dev/null
fi
