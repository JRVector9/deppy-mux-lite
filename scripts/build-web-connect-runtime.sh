#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${ROOT}/web"

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /path/to/App.app" >&2
  exit 64
fi

APP_PATH="$1"
RESOURCES_DIR="${APP_PATH}/Contents/Resources"
OUT_DIR="${RESOURCES_DIR}/web-connect"

if [[ ! -d "$APP_PATH" ]]; then
  echo "error: app bundle not found: $APP_PATH" >&2
  exit 66
fi

if [[ ! -x "${WEB_DIR}/node_modules/.bin/next" ]]; then
  echo "error: web dependencies are missing; run bun install in web/" >&2
  exit 69
fi

next_build_args=(${DEPPY_WEB_CONNECT_NEXT_BUILD_ARGS:---webpack})
(
  cd "$WEB_DIR"
  SKIP_ENV_VALIDATION=1 \
    NEXT_PUBLIC_STACK_PROJECT_ID="${NEXT_PUBLIC_STACK_PROJECT_ID:-00000000-0000-4000-8000-000000000000}" \
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY="${NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY:-preview-publishable-client-key}" \
    STACK_SECRET_SERVER_KEY="${STACK_SECRET_SERVER_KEY:-preview-secret-server-key}" \
    ./node_modules/.bin/next build "${next_build_args[@]}"
)

if [[ ! -f "${WEB_DIR}/.next/standalone/server.js" ]]; then
  echo "error: Next standalone server was not produced" >&2
  exit 70
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/.next"
rsync -a --delete "${WEB_DIR}/.next/standalone/" "$OUT_DIR/"
rsync -a --delete "${WEB_DIR}/.next/static/" "$OUT_DIR/.next/static/"
if [[ -d "${WEB_DIR}/public" ]]; then
  rsync -a --delete "${WEB_DIR}/public/" "$OUT_DIR/public/"
fi

app_archs() {
  local app_binary
  app_binary="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Contents/Info.plist")"
  lipo -archs "$APP_PATH/Contents/MacOS/$app_binary"
}

has_required_archs() {
  local binary="$1"
  local label="$2"
  local binary_archs
  binary_archs="$(lipo -archs "$binary" 2>/dev/null || true)"
  [[ -n "$binary_archs" ]] || return 1

  for arch in $(app_archs); do
    if [[ " $binary_archs " != *" $arch "* ]]; then
      echo "warning: not bundling $label runtime; $binary lacks $arch slice" >&2
      return 1
    fi
  done
}

require_native_dependencies_for_app_archs() {
  local binary
  local binary_archs
  local arch
  while IFS= read -r -d '' binary; do
    binary_archs="$(lipo -archs "$binary" 2>/dev/null || true)"
    if [[ -z "$binary_archs" ]]; then
      echo "error: native web dependency is not a Mach-O binary: $binary" >&2
      exit 70
    fi
    for arch in $(app_archs); do
      if [[ " $binary_archs " != *" $arch "* ]]; then
        lipo -info "$binary" >&2 || true
        echo "error: native web dependency is missing the $arch slice: $binary" >&2
        exit 70
      fi
    done
  done < <(find "$OUT_DIR" -type f \( -name '*.node' -o -name '*.dylib' \) -print0)
}

has_only_relocatable_or_system_dylibs() {
  local binary="$1"
  local label="$2"
  local dependency
  while IFS= read -r dependency; do
    case "$dependency" in
      "" | "$binary:" | /usr/lib/* | /System/Library/* | @executable_path/* | @loader_path/*)
        ;;
      *)
        echo "warning: not bundling $label runtime; dependency is not self-contained: $dependency" >&2
        return 1
        ;;
    esac
  done < <(otool -L "$binary" | awk 'NR > 1 { print $1 }')
}

copy_runtime_if_compatible() {
  local runtime_path="$1"
  local runtime_name="$2"
  local require_self_contained="${3:-1}"
  [[ -x "$runtime_path" ]] || return 1

  has_required_archs "$runtime_path" "$runtime_name" || return 1
  if [[ "$require_self_contained" == "1" ]]; then
    has_only_relocatable_or_system_dylibs "$runtime_path" "$runtime_name" || return 1
  fi

  mkdir -p "$OUT_DIR/bin"
  cp "$runtime_path" "$OUT_DIR/bin/$runtime_name"
  chmod +x "$OUT_DIR/bin/$runtime_name"
  return 0
}

if [[ -n "${DEPPY_WEB_CONNECT_BUN_PATH:-}" ]]; then
  copy_runtime_if_compatible "$DEPPY_WEB_CONNECT_BUN_PATH" bun || exit 70
else
  for candidate in "${HOME}/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun "$(command -v bun 2>/dev/null || true)"; do
    [[ -n "$candidate" ]] || continue
    if copy_runtime_if_compatible "$candidate" bun; then
      break
    fi
  done
fi

if [[ ! -x "$OUT_DIR/bin/bun" && -n "${DEPPY_WEB_CONNECT_NODE_PATH:-}" ]]; then
  copy_runtime_if_compatible "$DEPPY_WEB_CONNECT_NODE_PATH" node || exit 70
else
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do
    [[ -n "$candidate" ]] || continue
    if [[ -x "$OUT_DIR/bin/bun" ]]; then
      break
    fi
    copy_runtime_if_compatible "$candidate" node || true
  done
fi

if [[ ! -x "$OUT_DIR/bin/bun" && ! -x "$OUT_DIR/bin/node" ]]; then
  echo "error: no compatible bun or node runtime found for bundled Web Connect runtime" >&2
  echo "       install bun/node with the app architecture or set DEPPY_WEB_CONNECT_BUN_PATH/DEPPY_WEB_CONNECT_NODE_PATH" >&2
  exit 69
fi

require_native_dependencies_for_app_archs

echo "Web Connect runtime:"
echo "  $OUT_DIR"
du -sh "$OUT_DIR"
if [[ -x "$OUT_DIR/bin/bun" ]]; then
  echo "Bundled runtime:"
  lipo -info "$OUT_DIR/bin/bun"
elif [[ -x "$OUT_DIR/bin/node" ]]; then
  echo "Bundled runtime:"
  lipo -info "$OUT_DIR/bin/node"
fi
