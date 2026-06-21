const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "file:"]);

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) {
    return true;
  }

  try {
    return !ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return true;
  }
}
