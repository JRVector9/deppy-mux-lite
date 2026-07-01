#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIG_REQUIRED="${ZIG_REQUIRED:-0.15.2}"
ZIG_CACHE_ROOT="${ZIG_INSTALL_ROOT:-${HOME}/Library/Caches/deppy-mux/zig}"

case "$(uname -m)" in
  arm64 | aarch64) ZIG_ARCH="aarch64" ;;
  x86_64) ZIG_ARCH="x86_64" ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

ZIG_NAME="zig-${ZIG_ARCH}-macos-${ZIG_REQUIRED}"

read_zig_lib_dir() {
  local zig_path="$1"
  "$zig_path" env 2>/dev/null | python3 -c 'import json, re, sys
text = sys.stdin.read()
try:
    print(json.loads(text).get("lib_dir", ""))
except Exception:
    match = re.search(r"(?m)^\s*\.lib_dir\s*=\s*\"([^\"]*)\"", text)
    print(match.group(1) if match else "")
'
}

zig_has_required_version() {
  local zig_path="$1"
  local zig_lib_dir
  [[ -x "$zig_path" ]] || return 1
  [[ "$("$zig_path" version 2>/dev/null || true)" == "$ZIG_REQUIRED" ]] || return 1
  zig_lib_dir="$(read_zig_lib_dir "$zig_path" || true)"
  [[ -n "$zig_lib_dir" ]] || return 1
  [[ -f "$zig_lib_dir/compiler/build_runner.zig" ]] || return 1
}

canonical_zig_path() {
  local zig_path="$1"
  [[ -n "$zig_path" && -x "$zig_path" ]] || return 1
  printf '%s/%s\n' "$(cd "$(dirname "$zig_path")" && pwd)" "$(basename "$zig_path")"
}

find_required_zig() {
  local candidate
  local path_zig
  local seen=" "
  path_zig="$(command -v zig 2>/dev/null || true)"
  for candidate in \
    "${CMUX_ZIG:-}" \
    "${ZIG_CACHE_ROOT%/}/${ZIG_NAME}/zig" \
    "$path_zig" \
    /opt/homebrew/bin/zig \
    /usr/local/bin/zig
  do
    [[ -n "$candidate" ]] || continue
    [[ -x "$candidate" ]] || continue
    candidate="$(canonical_zig_path "$candidate")"
    case "$seen" in
      *" $candidate "*) continue ;;
    esac
    seen="${seen}${candidate} "
    if zig_has_required_version "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

if required_zig="$(find_required_zig)"; then
  echo "$required_zig"
  exit 0
fi

echo "Installing pinned zig ${ZIG_REQUIRED} under ${ZIG_CACHE_ROOT}" >&2
ZIG_FORCE_LOCAL_INSTALL=1 \
  ZIG_INSTALL_ROOT="$ZIG_CACHE_ROOT" \
  "$SCRIPT_DIR/install-zig-ci.sh" >&2

if required_zig="$(find_required_zig)"; then
  echo "$required_zig"
  exit 0
fi

echo "error: failed to install zig ${ZIG_REQUIRED} under ${ZIG_CACHE_ROOT}" >&2
exit 1
