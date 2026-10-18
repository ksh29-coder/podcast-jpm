#!/usr/bin/env bash
# Generates placeholder media for every episode and clip in data/episodes.json:
# a tone for audio, a test pattern for video, vertical 9:16 video for clips.
# Requires ffmpeg and node. Output goes to public/media/.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p public/media

node -e '
  const eps = require("./data/episodes.json");
  for (const ep of eps) {
    console.log(["episode", ep.id, ep.durationSec].join(" "));
    for (const c of ep.clips) console.log(["clip", c.id, c.endSec - c.startSec].join(" "));
  }
' | while read -r kind id dur; do
  if [ "$kind" = episode ]; then
    echo "Generating $id ($dur s)"
    ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=440:duration=$dur" -b:a 48k "public/media/$id.mp3" </dev/null
    ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=640x360:rate=24:duration=$dur" \
      -f lavfi -i "sine=frequency=440:duration=$dur" \
      -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 40 -c:a aac -b:a 48k -shortest "public/media/$id.mp4" </dev/null
    ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=600x600:duration=1" -frames:v 1 "public/media/$id.jpg" </dev/null
  else
    echo "Generating clip $id ($dur s)"
    ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=540x960:rate=24:duration=$dur" \
      -f lavfi -i "sine=frequency=660:duration=$dur" \
      -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 40 -c:a aac -b:a 48k -shortest "public/media/$id.mp4" </dev/null
  fi
done

echo "Done: $(ls public/media | wc -l) files in public/media/"
