const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "switch",
  "checkbox",
  "radio",
  "combobox",
  "searchbox",
  "textbox",
]);

const INTERACTIVE_GROUP_ROLES = new Set([
  "radiogroup",
  "tablist",
  "menu",
  "menubar",
  "listbox",
  "toolbar",
  "group",
]);

const INTERACTIVE_CONTROL_ROLES = new Set([
  "button",
  "link",
  "tab",
  "radio",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "switch",
  "checkbox",
]);

const INTERACTIVE_TAG_NAMES = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "summary",
  "details",
]);

const CONTROL_HINT_PATTERN =
  /(?:^|[-_])(?:btn|button|tab|tabs|nav|menu|link|toggle|switch|control|action|settings|experience|pill|pills|filter|chip|chips|radiogroup|tablist)(?:$|[-_])/i;

const FILTER_BAR_TAG_NAMES = new Set(["nav", "ul", "ol"]);

function hasDetectableClickHandler(element: HTMLElement): boolean {
  if (element.onclick !== null) {
    return true;
  }

  for (const attr of element.getAttributeNames()) {
    if (attr.startsWith("on") && attr.length > 2) {
      return true;
    }
  }

  return false;
}

function hasPositiveTabIndex(element: HTMLElement): boolean {
  const raw = element.getAttribute("tabindex");
  if (!raw) {
    return false;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0;
}

function hasInteractiveAriaState(element: HTMLElement): boolean {
  return (
    element.hasAttribute("aria-checked") ||
    element.hasAttribute("aria-selected") ||
    element.hasAttribute("aria-pressed")
  );
}

function hasControlHint(element: HTMLElement): boolean {
  if (element.id && CONTROL_HINT_PATTERN.test(element.id)) {
    return true;
  }

  for (const className of Array.from(element.classList)) {
    if (CONTROL_HINT_PATTERN.test(className)) {
      return true;
    }
  }

  return false;
}

function readRole(element: HTMLElement): string | null {
  const role = element.getAttribute("role")?.trim().toLowerCase();
  return role || null;
}

function isDirectInteractiveElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (INTERACTIVE_TAG_NAMES.has(tag)) {
    if (tag === "a") {
      return element.hasAttribute("href");
    }
    return true;
  }

  const role = readRole(element);
  if (role && INTERACTIVE_ROLES.has(role)) {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  if (hasDetectableClickHandler(element)) {
    return true;
  }

  if (hasPositiveTabIndex(element)) {
    return true;
  }

  if (hasInteractiveAriaState(element)) {
    return true;
  }

  return hasControlHint(element);
}

/** True when the element is likely to rely on delegated or framework-bound events. */
export function isInteractiveElement(element: HTMLElement): boolean {
  return isDirectInteractiveElement(element);
}

export function isInteractiveOrContainsInteractive(element: HTMLElement): boolean {
  if (isDirectInteractiveElement(element)) {
    return true;
  }

  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node instanceof HTMLElement && isDirectInteractiveElement(node)) {
      return true;
    }
    node = walker.nextNode();
  }

  return false;
}

function countDirectInteractiveChildren(element: HTMLElement): number {
  let count = 0;
  for (const child of Array.from(element.children)) {
    if (child instanceof HTMLElement && isDirectInteractiveElement(child)) {
      count += 1;
    }
  }
  return count;
}

function sharesInteractiveChildRole(element: HTMLElement): boolean {
  const roles = new Set<string>();
  for (const child of Array.from(element.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    const role = readRole(child);
    if (role && INTERACTIVE_CONTROL_ROLES.has(role)) {
      roles.add(role);
    }
  }
  return roles.size === 1 && countDirectInteractiveChildren(element) >= 2;
}

/** True when the element behaves like a radiogroup/tablist/filter chip bar container. */
export function isInteractiveGroupContainer(element: HTMLElement): boolean {
  const role = readRole(element);
  if (role && INTERACTIVE_GROUP_ROLES.has(role)) {
    return true;
  }

  if (countDirectInteractiveChildren(element) >= 2 && sharesInteractiveChildRole(element)) {
    return true;
  }

  const tag = element.tagName.toLowerCase();
  if (FILTER_BAR_TAG_NAMES.has(tag) && countDirectInteractiveChildren(element) >= 2) {
    return true;
  }

  return countDirectInteractiveChildren(element) >= 2 && hasControlHint(element);
}

/** Nearest ancestor that should move as a unit to preserve SPA control behavior. */
export function findInteractiveGroupContainer(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  let candidate: HTMLElement | null = null;

  while (current && current !== current.ownerDocument.documentElement) {
    if (isInteractiveGroupContainer(current)) {
      candidate = current;
    }
    current = current.parentElement;
  }

  return candidate;
}

export function isInsideInteractiveGroup(element: HTMLElement): boolean {
  const group = findInteractiveGroupContainer(element);
  return group !== null && group !== element;
}

/** Move the group container instead of an individual chip/tab/radio control. */
export function resolveInteractionMoveTarget(element: HTMLElement): HTMLElement {
  const group = findInteractiveGroupContainer(element);
  if (group && group.contains(element) && group !== element) {
    return group;
  }
  return element;
}

/**
 * Standalone interactive controls (links/buttons) may use viewport-fixed placement.
 * Grouped SPA controls must stay in-flow with transform on their shared container.
 */
export function requiresInteractionSafeFixedMove(element: HTMLElement): boolean {
  if (!isDirectInteractiveElement(element)) {
    return false;
  }

  if (isInteractiveGroupContainer(element)) {
    return false;
  }

  if (isInsideInteractiveGroup(element)) {
    return false;
  }

  return true;
}

/**
 * Interactive targets must stay in their original DOM/event tree. Never detach/reparent.
 * Group containers and grouped controls use transform-only; standalone controls may use fixed.
 */
export function requiresTransformOnlyMove(element: HTMLElement): boolean {
  if (requiresInteractionSafeFixedMove(element)) {
    return true;
  }

  if (isInteractiveGroupContainer(element)) {
    return true;
  }

  if (isInsideInteractiveGroup(element)) {
    return true;
  }

  return isInteractiveOrContainsInteractive(element);
}

export function isInteractiveControlRole(element: HTMLElement): boolean {
  const role = readRole(element);
  return role !== null && INTERACTIVE_CONTROL_ROLES.has(role);
}
