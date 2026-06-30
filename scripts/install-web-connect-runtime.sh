#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${ROOT}/web"
OUT_DIR="${HOME}/Library/Application Support/deppy-mux/WebConnectRuntime/current"
ARCHIVE_OUTPUT="${DEPPY_WEB_CONNECT_ARCHIVE_OUTPUT:-}"

usage() {
  echo "usage: $0 [--output /path/to/runtime]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || { usage; exit 64; }
      OUT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

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

CURRENT_ARCH="$(uname -m)"

has_required_arch() {
  local binary="$1"
  local label="$2"
  if ! lipo "$binary" -verify_arch "$CURRENT_ARCH" >/dev/null 2>&1; then
    lipo -info "$binary" >&2 || true
    echo "warning: not using $label; missing the $CURRENT_ARCH slice: $binary" >&2
    return 1
  fi
  return 0
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
        echo "warning: not using $label; dependency is not self-contained: $dependency" >&2
        return 1
        ;;
    esac
  done < <(otool -L "$binary" | awk 'NR > 1 { print $1 }')
}

copy_runtime_if_compatible() {
  local candidate="$1"
  local runtime_name="$2"
  [[ -x "$candidate" ]] || return 1
  has_required_arch "$candidate" "$runtime_name runtime" || return 1
  has_only_relocatable_or_system_dylibs "$candidate" "$runtime_name runtime" || return 1
  mkdir -p "$OUT_DIR/bin"
  cp "$candidate" "$OUT_DIR/bin/$runtime_name"
  chmod +x "$OUT_DIR/bin/$runtime_name"
  return 0
}

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/.next"
rsync -a --delete "${WEB_DIR}/.next/standalone/" "$OUT_DIR/"
rsync -a --delete "${WEB_DIR}/.next/static/" "$OUT_DIR/.next/static/"
if [[ -d "${WEB_DIR}/public" ]]; then
  rsync -a --delete "${WEB_DIR}/public/" "$OUT_DIR/public/"
fi

if [[ -n "${DEPPY_WEB_CONNECT_BUN_PATH:-}" ]]; then
  copy_runtime_if_compatible "$DEPPY_WEB_CONNECT_BUN_PATH" bun || exit 70
else
  copied_bun=0
  for candidate in "${HOME}/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun "$(command -v bun 2>/dev/null || true)"; do
    [[ -n "$candidate" ]] || continue
    if copy_runtime_if_compatible "$candidate" bun; then
      copied_bun=1
      break
    fi
  done
fi

if [[ ! -x "$OUT_DIR/bin/bun" ]]; then
  if [[ -n "${DEPPY_WEB_CONNECT_NODE_PATH:-}" ]]; then
    copy_runtime_if_compatible "$DEPPY_WEB_CONNECT_NODE_PATH" node || exit 70
  else
    copied_node=0
    for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do
      [[ -n "$candidate" ]] || continue
      if copy_runtime_if_compatible "$candidate" node; then
        copied_node=1
        break
      fi
    done
  fi
fi

if [[ ! -x "$OUT_DIR/bin/bun" && ! -x "$OUT_DIR/bin/node" ]]; then
  echo "error: no compatible bun or node runtime found; install bun/node or set DEPPY_WEB_CONNECT_BUN_PATH/DEPPY_WEB_CONNECT_NODE_PATH" >&2
  exit 69
fi

while IFS= read -r -d '' binary; do
  if ! has_required_arch "$binary" "native web dependency"; then
    exit 70
  fi
done < <(find "$OUT_DIR" -type f \( -name '*.node' -o -name '*.dylib' \) -print0)

echo "Web Connect runtime installed:"
echo "  $OUT_DIR"
du -sh "$OUT_DIR"
if [[ -x "$OUT_DIR/bin/bun" ]]; then
  lipo -info "$OUT_DIR/bin/bun"
else
  lipo -info "$OUT_DIR/bin/node"
fi

if [[ -n "$ARCHIVE_OUTPUT" ]]; then
  mkdir -p "$(dirname "$ARCHIVE_OUTPUT")"
  rm -f "$ARCHIVE_OUTPUT"
  (
    cd "$(dirname "$OUT_DIR")"
    ditto -c -k --keepParent "$(basename "$OUT_DIR")" "$ARCHIVE_OUTPUT"
  )
  echo "Web Connect runtime archive:"
  echo "  $ARCHIVE_OUTPUT"
  du -sh "$ARCHIVE_OUTPUT"
fi
