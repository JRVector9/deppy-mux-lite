#!/usr/bin/env bash
# Fails when DEPPY_LITE_VERSION's CURRENT_PROJECT_VERSION is not strictly
# greater than every previously tagged deppy-lite release (Sparkle only offers
# an update when the build number increases), or when the release tag name does
# not match MARKETING_VERSION (a `deppy-lite-vX.Y.Z` tag must ship an app whose
# displayed version is X.Y.Z).
#
# Run before creating a deppy-lite tag:
#   ./scripts/deppy-lite-pretag-guard.sh --tag deppy-lite-vX.Y.Z
#
# In CI the tag is taken from GITHUB_REF_NAME; locally a release tag pointing
# at HEAD is also checked. Tags pointing at HEAD are excluded from the
# build-monotonicity comparison so the guard can run on the tagged commit.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${DEPPY_LITE_VERSION_FILE:-${ROOT_DIR}/DEPPY_LITE_VERSION}"

intended_tag=""
if [ "${1:-}" = "--tag" ]; then
  intended_tag="${2:-}"
fi

if [ ! -f "$VERSION_FILE" ]; then
  echo "error: missing $VERSION_FILE" >&2
  exit 1
fi

current_build="$(sed -n 's/^CURRENT_PROJECT_VERSION=//p' "$VERSION_FILE" | tail -n 1)"
if ! [[ "$current_build" =~ ^[0-9]+$ ]]; then
  echo "error: CURRENT_PROJECT_VERSION must be an integer, got: $current_build" >&2
  exit 1
fi

current_marketing="$(sed -n 's/^MARKETING_VERSION=//p' "$VERSION_FILE" | tail -n 1)"

# Tag <-> marketing-version alignment. The tag under validation is, in order:
# an explicit --tag argument, CI's GITHUB_REF_NAME, or a release tag already
# pointing at HEAD. The grandfathered deppy-lite-v0.1.0 shipped 0.0.1 before
# this check existed and is exempted.
check_tag=""
if [ -n "$intended_tag" ]; then
  check_tag="$intended_tag"
elif [[ "${GITHUB_REF_NAME:-}" == deppy-lite-v* ]]; then
  check_tag="$GITHUB_REF_NAME"
else
  check_tag="$(git -C "$ROOT_DIR" tag --points-at HEAD 2>/dev/null | grep '^deppy-lite-v' | head -n 1 || true)"
fi
if [ -n "$check_tag" ] && [ "$check_tag" != "deppy-lite-v0.1.0" ]; then
  tag_version="${check_tag#deppy-lite-v}"
  if [ "$tag_version" != "$current_marketing" ]; then
    cat >&2 <<EOF
error: tag '$check_tag' does not match MARKETING_VERSION '$current_marketing'.
       Align them before tagging:
         ./scripts/bump-deppy-lite-version.sh $tag_version
EOF
    exit 1
  fi
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
