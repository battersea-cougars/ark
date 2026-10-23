/**
 * A member's profile photo (ADR 0123), shrunk in the browser to a 512px square from the middle of the picture, so
 * it's small enough to keep in the database: WebP where the browser can write it, else JPEG. Throws when the file
 * isn't an image it can read (an iPhone's HEIC is turned into a JPEG by the phone when it's picked).
 */
export async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(512, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close();
  const webp = canvas.toDataURL("image/webp", 0.82);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
}

/** Where a member's photo is, or null for none: its address changes with it, so the browser keeps each one. */
export const photoUrl = (p: { id: number; photoAt?: string | null }) =>
  p.photoAt ? `/api/members/${p.id}/photo?v=${encodeURIComponent(p.photoAt)}` : null;
