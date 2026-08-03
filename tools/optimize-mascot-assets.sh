#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
asset_dir="$repo_root/public/mascot-motion"

command -v avconvert >/dev/null 2>&1 || {
  echo "avconvert is required (available on macOS)." >&2
  exit 1
}
command -v qlmanage >/dev/null 2>&1 || {
  echo "qlmanage is required to create poster frames." >&2
  exit 1
}

for name in idle idle-magnifier idle-belt working working-hammer working-drawing complete; do
  source_file="$asset_dir/$name.mp4"
  output_file="$asset_dir/$name.web.mp4"
  poster_file="$asset_dir/$name.poster.png"
  poster_tmp=$(mktemp -d /tmp/dreamhome-poster.XXXXXX)
  trap 'rm -rf "$poster_tmp"' EXIT HUP INT TERM

  avconvert \
    --source "$source_file" \
    --preset Preset640x480 \
    --output "$output_file" \
    --replace
  qlmanage -t -s 240 -o "$poster_tmp" "$output_file" >/dev/null 2>&1
  mv "$poster_tmp/$name.web.mp4.png" "$poster_file"
  rmdir "$poster_tmp"
  trap - EXIT HUP INT TERM
done
