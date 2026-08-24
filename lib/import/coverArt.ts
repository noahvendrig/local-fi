const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function extForPictureFormat(format: string): string {
  return MIME_TO_EXT[format.toLowerCase()] ?? "jpg";
}
