const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export function isAllowedLocalAgentUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      return false;
    }
    if (url.username || url.password) {
      return false;
    }
    return true;
  } catch {
    return /^https?:\/\/(\[::1\]|127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(urlString);
  }
}

export function resolveAgentEndpointUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
