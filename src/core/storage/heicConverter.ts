const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

/**
 * Checks whether a File is HEIC/HEIF by filename extension or MIME type.
 */
export function isHeicFileNameOrMime(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (HEIC_MIME_TYPES.has(mime)) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".heic") || lowerName.endsWith(".heif");
}

function replaceHeicExtensionWithJpg(filename: string): string {
  const replaced = filename.replace(/\.(heic|heif)$/i, ".jpg");
  return replaced === filename ? `${filename}.jpg` : replaced;
}

/**
 * Converts HEIC/HEIF images to standard JPEG client-side so Chrome, Konva, and FFmpeg.wasm can decode them.
 */
export async function normalizeMediaFileForBrowser(file: File): Promise<File> {
  let shouldConvert = isHeicFileNameOrMime(file);

  if (
    !shouldConvert &&
    (file.type === "" || file.type === "application/octet-stream")
  ) {
    try {
      const { isHeic } = await import("heic-to");
      shouldConvert = await isHeic(file);
    } catch {
      shouldConvert = false;
    }
  }

  if (!shouldConvert) {
    return file;
  }

  const { heicTo } = await import("heic-to");
  const jpegBlob = await heicTo({
    blob: file,
    type: "image/jpeg",
    quality: 0.92,
  });

  return new File([jpegBlob], replaceHeicExtensionWithJpg(file.name), {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}
