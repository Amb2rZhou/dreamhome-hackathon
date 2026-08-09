#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
poster_dir="$repo_root/public/video-posters"
poster_tmp=$(mktemp -d /tmp/dreamhome-feed-posters.XXXXXX)
trap 'rm -rf "$poster_tmp"' EXIT HUP INT TERM
mkdir -p "$poster_dir"

make_poster() {
  source_file=$1
  poster_name=$2
  source_name=${source_file##*/}
  qlmanage -t -s 720 -o "$poster_tmp" "$source_file" >/dev/null 2>&1
  sips -s format jpeg -s formatOptions 78 \
    "$poster_tmp/$source_name.png" \
    --out "$poster_dir/$poster_name.jpg" >/dev/null
}

make_poster "$repo_root/public/videos/home-1.mp4" home-1
for source_file in "$repo_root"/web/prototype/assets/videos/*.mp4; do
  source_name=${source_file##*/}
  make_poster "$source_file" "${source_name%.mp4}"
done
