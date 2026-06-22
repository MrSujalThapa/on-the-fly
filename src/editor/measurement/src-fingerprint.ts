import { MAX_SRC_FINGERPRINT_LENGTH } from "./constants.js";

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength).trim();
}

/** Normalizes an element src/currentSrc into a stable replay fingerprint. */
export function fingerprintSrcValue(rawSrc: string): string | undefined {
  const trimmed = rawSrc.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed.startsWith("data:image") ? "data:image" : "blob:asset";
  }

  try {
    const url = new URL(trimmed, "https://placeholder.local");
    const segments = url.pathname.split("/").filter(Boolean);
    const tail = segments.slice(-2).join("/") || url.pathname;
    const fingerprint = truncateText(tail, MAX_SRC_FINGERPRINT_LENGTH);
    return fingerprint || undefined;
  } catch {
    const withoutQuery = trimmed.split("?")[0]?.split("#")[0] ?? trimmed;
    return truncateText(withoutQuery, MAX_SRC_FINGERPRINT_LENGTH) || undefined;
  }
}
