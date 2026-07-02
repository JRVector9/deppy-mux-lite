#!/usr/bin/env bash
# Fails when DEPPY_LITE_VERSION's CURRENT_PROJECT_VERSION is not strictly
# greater than every previously tagged deppy-lite release. Sparkle only offers
# an update when the build number increases, so tagging a release without
# bumping silently strands existing users on the old build.
#
# Run before creating a deppy-lite tag:
#   ./scripts/deppy-lite-pretag-guard.sh
#
# Tags pointing at HEAD are excluded so the guard can also run in CI on the
# tagged commit itself.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${DEPPY_LITE_VERSION_FILE:-${ROOT_DIR}/DEPPY_LITE_VERSION}"

if [ ! -f "$VERSION_FILE" ]; then
  echo "error: missing $VERSION_FILE" >&2
  exit 1
fi

current_build="$(sed -n 's/^CURRENT_PROJECT_VERSION=//p' "$VERSION_FILE" | tail -n 1)"
if ! [[ "$current_build" =~ ^[0-9]+$ ]]; then
  echo "error: CURRENT_PROJECT_VERSION must be an integer, got: $current_build" >&2
  exit 1
fi

head_tags="$(git -C "$ROOT_DIR" tag --points-at HEAD 2>/dev/null || true)"

max_build=0
max_tag=""
while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  # The tag being created/released points at HEAD; it must not guard itself.
  if printf '%s\n' "$head_tags" | grep -qx "$tag"; then
    continue
  fi
  tagged_version="$(git -C "$ROOT_DIR" show "$tag:DEPPY_LITE_VERSION" 2>/dev/null || true)"
  [ -n "$tagged_version" ] || continue
  tagged_build="$(printf '%s\n' "$tagged_version" | sed -n 's/^CURRENT_PROJECT_VERSION=//p' | tail -n 1)"
  [[ "$tagged_build" =~ ^[0-9]+$ ]] || continue
  if [ "$tagged_build" -gt "$max_build" ]; then
    max_build="$tagged_build"
    max_tag="$tag"
  fi
done < <(git -C "$ROOT_DIR" tag -l 'deppy-lite-*')

if [ "$current_build" -le "$max_build" ]; then
  cat >&2 <<EOF
error: DEPPY_LITE_VERSION build $current_build is not greater than build $max_build
       already released by tag '$max_tag'. Sparkle clients will never see this
       release as an update. Run ./scripts/bump-deppy-lite-version.sh, commit,
       and re-tag.
EOF
  exit 1
fi

echo "deppy-lite pretag guard OK: build $current_build > previous max $max_build${max_tag:+ ($max_tag)}"
