#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${DERIVED_DATA:-${HOME}/Library/Developer/Xcode/DerivedData/deppy-lite-arm64-release}"
APP_PATH="${DERIVED_DATA}/Build/Products/Release/deppy-mux-lite.app"
APP_BIN="${APP_PATH}/Contents/MacOS/deppy-mux-lite"
CLI_BIN="${APP_PATH}/Contents/Resources/bin/deppy-cli"

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

if [[ "${DEPPY_LITE_SKIP_STRIP:-0}" != "1" ]]; then
  strip -u -r "$APP_BIN"
  if [[ -x "$CLI_BIN" ]]; then
    strip -u -r "$CLI_BIN"
  fi
fi

echo "Release app:"
echo "  $APP_PATH"
echo "Sizes:"
du -sh "$APP_PATH" "$APP_BIN"
if [[ -x "$CLI_BIN" ]]; then
  du -sh "$CLI_BIN"
fi
echo "Architectures:"
lipo -info "$APP_BIN"
if [[ -x "$CLI_BIN" ]]; then
  lipo -info "$CLI_BIN"
fi
