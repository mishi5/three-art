export type AssetKind = "image" | "video" | "audio";

/** MIME タイプの先頭から扱える種別を判定する。対象外は null。 */
export function kindFromMime(mime: string): AssetKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}
