#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
asset_dir="$repo_root/public/mascot-motion"

command -v avconvert >/dev/null 2>&1 || {
  echo "avconvert is required (available on macOS)." >&2
  exit 1
}
source_dir="$repo_root/source-assets/mascot-motion"
mkdir -p "$source_dir"

for name in cold-start idle idle-magnifier idle-belt working working-hammer working-drawing complete; do
  source_file="$source_dir/$name.mp4"
  if [ ! -f "$source_file" ]; then
    source_file="$asset_dir/$name.mp4"
  fi
  output_file="$asset_dir/$name.web.mp4"

  avconvert \
    --source "$source_file" \
    --preset Preset640x480 \
    --output "$output_file" \
    --replace
done
