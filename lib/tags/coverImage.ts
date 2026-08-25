export interface CoverImage {
  bytes: Buffer;
  mimeType: string;
}

export const MAX_COVER_BYTES = 10 * 1024 * 1024;

const ALLOWED_COVER_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export class CoverImageError extends Error {
  code: string;
  status: number;

  constructor(message: string, status = 400, code = "invalid_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function coverImageFromUpload(file: File): Promise<CoverImage> {
  if (file.size > MAX_COVER_BYTES) {
    throw new CoverImageError("Cover image must be 10MB or smaller.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImageMime(bytes);
  const declared = file.type === "image/jpg" ? "image/jpeg" : file.type;
  const mimeType = sniffed ?? (ALLOWED_COVER_MIMES.has(declared) ? declared : null);
  if (!mimeType) {
    throw new CoverImageError("Cover must be a JPEG, PNG, WebP, or GIF image.");
  }
  return { bytes, mimeType };
}
