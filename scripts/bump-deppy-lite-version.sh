#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${DEPPY_LITE_VERSION_FILE:-${ROOT_DIR}/DEPPY_LITE_VERSION}"
BUMP="${1:-build}"

read_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$VERSION_FILE" | tail -n 1
}

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "error: version file not found: $VERSION_FILE" >&2
  exit 1
fi

current_marketing="$(read_value MARKETING_VERSION)"
current_build="$(read_value CURRENT_PROJECT_VERSION)"

if [[ ! "$current_marketing" =~ ^[0-9]+[.][0-9]+[.][0-9]+$ ]]; then
  echo "error: MARKETING_VERSION must be semver-like x.y.z, got: $current_marketing" >&2
  exit 1
fi

if [[ ! "$current_build" =~ ^[0-9]+$ ]]; then
  echo "error: CURRENT_PROJECT_VERSION must be an integer, got: $current_build" >&2
  exit 1
fi

IFS=. read -r major minor patch <<<"$current_marketing"
new_marketing="$current_marketing"

case "$BUMP" in
  build)
    ;;
  patch)
    patch=$((patch + 1))
    new_marketing="${major}.${minor}.${patch}"
    ;;
  minor)
    minor=$((minor + 1))
    new_marketing="${major}.${minor}.0"
    ;;
  major)
    major=$((major + 1))
    new_marketing="${major}.0.0"
    ;;
  [0-9]*.[0-9]*.[0-9]*)
    if [[ ! "$BUMP" =~ ^[0-9]+[.][0-9]+[.][0-9]+$ ]]; then
      echo "error: explicit version must be x.y.z, got: $BUMP" >&2
      exit 1
    fi
    new_marketing="$BUMP"
    ;;
  *)
    echo "usage: $0 [build|patch|minor|major|x.y.z]" >&2
    exit 2
    ;;
esac

new_build=$((current_build + 1))
tmp_file="$(mktemp)"
{
  echo "MARKETING_VERSION=${new_marketing}"
  echo "CURRENT_PROJECT_VERSION=${new_build}"
} >"$tmp_file"
mv "$tmp_file" "$VERSION_FILE"

echo "deppy-lite version: ${current_marketing} (${current_build}) -> ${new_marketing} (${new_build})"
