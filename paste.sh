#!/bin/bash
#
# Paste images from the clipboard straight into the trivia-wizard-2 assets
# bucket. Mirrors slider/paste.sh's naming REPL, but compresses each paste to a
# web-friendly JPG and uploads it — plus the regenerated manifest.json — to S3.
#
# The clipboard can hold either image data (screenshot, "Copy Image") or a file
# copied in Finder (Cmd+C on a file); the latter uploads the file from disk.
#
#   Mode 1  shared images  ->  cdn/images/<qid>-<n>.jpg          (bare-name refs)
#   Mode 2  event images   ->  events/<uuid>/images/<name>.jpg   (./name refs)
#
# Editor/presentation match image refs by stem (filename minus extension), so
# the .jpg conversion is transparent to existing `kfr` / `./kfr` references.
#
# Requires: pngpaste, ImageMagick (magick), awscli v2, jq (+ macOS sips/osascript).

set -e

BUCKET="${ASSETS_BUCKET:-triviaapphostingstack-assetsbucket5cb76180-ezkgozrxjix4}"
REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$REGION"

# Compression targets — tweak here. jpeg:extent makes ImageMagick binary-search
# quality to land under MAX_SIZE; MAX_DIM caps the longest edge so quality stays
# reasonable instead of being crushed to hit the size on a huge Retina capture.
MAX_SIZE="1MB"
MAX_BYTES=1048576
MAX_DIM=2560

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Current filenames under the active prefix (manifest.json excluded). Refreshed
# from S3 at mode start and after every upload, so suffix defaults, the overwrite
# check, and the manifest all reflect the bucket.
LISTING=()

# ── Preflight ────────────────────────────────────────────────
require_tools() {
  local missing=0 t
  for t in pngpaste magick aws jq sips osascript; do
    command -v "$t" >/dev/null 2>&1 || { echo "Missing required tool: $t"; missing=1; }
  done
  [ "$missing" -eq 0 ] || exit 1
}

check_creds() {
  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "AWS credentials are missing or expired."
    echo "Run 'aws login' (or refresh your session) and try again."
    exit 1
  fi
}

# ── S3 listing + manifest ────────────────────────────────────
refresh_listing() {
  local prefix="$1"
  LISTING=()
  while IFS= read -r f; do
    [ -n "$f" ] && LISTING+=("$f")
  done < <(
    aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$prefix/" --output json \
      | jq -r --arg p "$prefix/" \
          '(.Contents // [])[].Key | ltrimstr($p)
           | select(. != "" and . != "manifest.json" and (contains("/") | not))'
  )
}

# Rebuild manifest.json from LISTING (sorted, compact) and upload it. Mirrors the
# format the editor writes via putImagesManifest: a JSON array of filenames.
upload_manifest() {
  local prefix="$1"
  local manifest="$TMP/manifest.json"
  printf '%s\n' "${LISTING[@]}" \
    | sort \
    | jq -R -s -c 'split("\n") | map(select(length > 0))' > "$manifest"
  aws s3 cp "$manifest" "s3://$BUCKET/$prefix/manifest.json" \
    --content-type application/json >/dev/null
  echo "Updated $prefix/manifest.json (${#LISTING[@]} images)"
}

# ── Paste → compress → upload ────────────────────────────────
# Paths of files copied in Finder, one per line (empty if the clipboard holds
# none). pngpaste would only see the generic file-type icon for these.
clipboard_files() {
  osascript -l JavaScript -e '
    ObjC.import("AppKit");
    const urls = $.NSPasteboard.generalPasteboard.readObjectsForClassesOptions(
      $([$.NSURL]), $({ NSPasteboardURLReadingFileURLsOnlyKey: true }));
    const out = [];
    if (urls) for (let i = 0; i < urls.count; i++) out.push(urls.objectAtIndex(i).path.js);
    out.join("\n");' 2>/dev/null
}

# Write the clipboard's image to $1 as PNG — from a Finder-copied file if there
# is one, else from raw image data. sips decodes formats Homebrew's magick may
# lack (HEIC/HEIF) and reads only the first frame/page.
grab_clipboard() {
  local out="$1" files n
  files="$(clipboard_files)"
  if [ -n "$files" ]; then
    n=$(printf '%s\n' "$files" | wc -l | tr -d ' ')
    if [ "$n" -gt 1 ]; then
      echo "Clipboard holds $n files — copy one at a time."
      return 1
    fi
    echo "Using file: $files"
    sips -s format png "$files" --out "$out" >/dev/null 2>&1 || {
      echo "Couldn't read $files as an image."
      return 1
    }
    return 0
  fi
  pngpaste "$out" 2>/dev/null || { echo "No image in clipboard — try copying again."; return 1; }
}

compress_image() {
  local src="$1" dst="$2"
  # -flatten over white removes the alpha JPG can't carry (transparent -> white).
  magick "$src" -auto-orient -resize "${MAX_DIM}x${MAX_DIM}>" \
    -background white -flatten -strip -quality 88 \
    -define jpeg:extent="$MAX_SIZE" "$dst"
}

paste_one() {
  local name="$1" prefix="$2"
  local key="$prefix/${name}.jpg"
  local png="$TMP/clip.png"
  local jpg="$TMP/out.jpg"

  if printf '%s\n' "${LISTING[@]}" | grep -qx -- "${name}.jpg"; then
    read -p "${name}.jpg exists in $prefix/. Overwrite? [y/N]: " ow
    [ "$ow" = "y" ] || { echo "Skipped."; return 1; }
  fi

  rm -f "$png"
  grab_clipboard "$png" || return 1

  compress_image "$png" "$jpg"
  local bytes kb
  bytes=$(stat -f%z "$jpg")
  kb=$(( (bytes + 1023) / 1024 ))
  echo "Compressed -> ${name}.jpg (${kb} KB)"
  [ "$bytes" -le "$MAX_BYTES" ] || echo "  (warning: still over 1 MB)"

  aws s3 cp "$jpg" "s3://$BUCKET/$key" --content-type image/jpeg >/dev/null
  echo "Uploaded s3://$BUCKET/$key"

  refresh_listing "$prefix"
  upload_manifest "$prefix"
}

# ── Mode 1: shared images (cdn/images/) ──────────────────────
mode_shared() {
  local prefix="cdn/images"
  echo "Target: s3://$BUCKET/$prefix/"
  refresh_listing "$prefix"
  echo "Shared-image REPL — Ctrl+C to quit"

  while true; do
    echo
    read -p "Question ID (3 letters): " qid
    if ! [[ "$qid" =~ ^[A-Za-z]{3}$ ]]; then
      echo "Question ID must be exactly 3 letters."
      continue
    fi
    qid="$(echo "$qid" | tr '[:upper:]' '[:lower:]')"

    local highest default_n
    highest=$(printf '%s\n' "${LISTING[@]}" \
      | grep -oE "^${qid}-[0-9]+\." \
      | grep -oE '[0-9]+' \
      | sort -n | tail -1)
    default_n=$(( ${highest:-0} + 1 ))

    read -p "Suffix [$default_n]: " input_n
    paste_one "${qid}-${input_n:-$default_n}" "$prefix" || continue
  done
}

# ── Mode 2: event images (events/<uuid>/images/) ─────────────
mode_event() {
  read -p "Event UUID: " uuid
  if ! [[ "$uuid" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Invalid event UUID."
    exit 1
  fi
  local prefix="events/${uuid}/images"
  echo "Target: s3://$BUCKET/$prefix/"
  refresh_listing "$prefix"
  echo "Event-image REPL — Ctrl+C to quit"

  local counter=1
  while true; do
    echo
    read -p "Image name [$counter]: " name
    name="${name:-$counter}"
    paste_one "$name" "$prefix" || continue
    [ "$name" = "$counter" ] && counter=$(( counter + 1 ))
  done
}

# ── Main ─────────────────────────────────────────────────────
require_tools
check_creds

echo "Bucket: $BUCKET"
echo "1) Shared images  (cdn/images/, prompts for 3-letter question ID + suffix)"
echo "2) Event images   (events/<uuid>/images/, monotonic counter default)"
read -p "Mode [1]: " mode
case "${mode:-1}" in
  1) mode_shared ;;
  2) mode_event ;;
  *) echo "Unknown mode: ${mode}"; exit 1 ;;
esac
