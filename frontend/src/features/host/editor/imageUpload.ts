// Turning a pasted or dropped image into a web-friendly JPEG and a name for it.
// Mirrors what paste.sh did on the command line: cap the longest edge, flatten
// transparency onto white, and squeeze under a size limit.

export const MAX_DIMENSION = 2560;
export const MAX_BYTES = 1024 * 1024;

/** Scale `width` x `height` down (never up) so the longest edge fits `max`. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_DIMENSION
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * A short name no existing image uses. Names are opaque on purpose: the editor
 * shows a thumbnail wherever one appears, so nobody has to read them.
 */
export function newImageName(
  taken: Iterable<string>,
  random: () => number = Math.random
): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  for (let i = 0; i < 200; i++) {
    const name = "img-" + Math.floor(random() * 0x10000).toString(16).padStart(4, "0");
    if (!used.has(name)) return name;
  }
  return "img-" + Date.now().toString(16);
}

/**
 * The image in a paste or drop, if that is what it is. For pastes, text wins
 * when both are present (`preferText`): copying cells or styled text often
 * carries a rendered picture too.
 */
export function imageFromTransfer(
  data: DataTransfer | null,
  { preferText }: { preferText: boolean }
): File | null {
  if (!data) return null;
  if (preferText && data.getData("text/plain")) return null;
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  for (const file of data.files) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The image couldn't be encoded."))),
      "image/jpeg",
      quality
    );
  });
}

function draw(source: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("The image couldn't be processed.");
  // JPEG has no transparency; flatten onto white.
  g.fillStyle = "#fff";
  g.fillRect(0, 0, width, height);
  g.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Decode, downscale and re-encode an image as a JPEG of at most ~1 MB. */
export async function compressImage(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file isn't an image this browser can read.");
  }
  try {
    let size = fitWithin(bitmap.width, bitmap.height);
    // Lower the quality first; only if that isn't enough, shrink the picture.
    for (let attempt = 0; attempt < 4; attempt++) {
      const canvas = draw(bitmap, size.width, size.height);
      for (const quality of [0.88, 0.8, 0.7, 0.6]) {
        const blob = await toJpeg(canvas, quality);
        if (blob.size <= MAX_BYTES) return blob;
      }
      size = fitWithin(size.width, size.height, Math.round(Math.max(size.width, size.height) * 0.75));
    }
    return toJpeg(draw(bitmap, size.width, size.height), 0.6);
  } finally {
    bitmap.close();
  }
}
