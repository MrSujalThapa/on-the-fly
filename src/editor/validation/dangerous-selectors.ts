const DANGEROUS_CSS_PATH_PATTERN =
  /^(?:html|body|:root|\*|\s*>|\s*\+|\s*~)(?:$|[\s>+~.#[])/i;

const MAX_CSS_PATH_LENGTH = 2048;

export function isDangerousCssPath(cssPath: string): boolean {
  const trimmed = cssPath.trim();
  if (!trimmed) {
    return true;
  }

  if (trimmed.length > MAX_CSS_PATH_LENGTH) {
    return true;
  }

  return DANGEROUS_CSS_PATH_PATTERN.test(trimmed);
}

export function isDangerousTagName(tagName: string): boolean {
  const normalized = tagName.trim().toLowerCase();
  return normalized === "html" || normalized === "body";
}
