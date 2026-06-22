export const OTF_ROOT_HOST_ID = "on-the-fly-root-host";
export const OTF_ROOT_HOST_ATTR = "data-on-the-fly";
export const OTF_ROOT_HOST_VALUE = "root-host";

export const MIN_VISIBLE_SIZE_PX = 1;
export const DEFAULT_ALIGNMENT_TOLERANCE_PX = 2;
export const GIANT_NODE_AREA_RATIO = 0.92;
export const MAX_TEXT_FINGERPRINT_LENGTH = 120;
export const MAX_ANCESTOR_TEXT_CONTEXT_LENGTH = 160;
export const MAX_SRC_FINGERPRINT_LENGTH = 120;

export const EXCLUDED_TAG_NAMES = new Set([
  "html",
  "body",
  "head",
  "script",
  "style",
  "meta",
  "link",
  "noscript",
  "template",
  "svg",
  "path",
  "defs",
  "clippath",
  "lineargradient",
  "radialgradient",
  "stop",
  "symbol",
  "use",
]);

export const SUBTREE_SKIP_TAG_NAMES = new Set([
  "head",
  "script",
  "style",
  "meta",
  "link",
  "noscript",
  "template",
  "svg",
  "path",
  "defs",
  "clippath",
  "lineargradient",
  "radialgradient",
  "stop",
  "symbol",
  "use",
]);

export const TEXT_LIKE_TAG_NAMES = new Set([
  "p",
  "span",
  "a",
  "label",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "td",
  "th",
  "figcaption",
  "blockquote",
  "em",
  "strong",
  "small",
]);

export const CONTAINER_TAG_NAMES = new Set([
  "div",
  "section",
  "article",
  "main",
  "nav",
  "header",
  "footer",
  "aside",
  "ul",
  "ol",
  "form",
  "figure",
  "details",
  "fieldset",
]);
