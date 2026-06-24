import { extractBoundingBox } from "../measurement/bounding-box.js";
import { rectsOverlap } from "../measurement/geometry.js";
import { isExtensionRoot, isGiantPageWrapper } from "../measurement/scan-guards.js";
import type { MeasurementRect } from "../measurement/types.js";
import {
  BACK_LAYER,
  computeNextLayer,
  FRONT_LAYER,
  resolveCurrentManagedLayer,
  type LayerCommand,
} from "../transform/layer-order.js";
import type { ElementSnapshotStore } from "./element-snapshot.js";
import type { AppliedDomEffect } from "./types.js";
import { OTF_MANAGED_ATTR } from "./types.js";

const UNSAFE_HOST_TAGS = new Set(["html", "body"]);
const GIANT_ROOT_ID_HINTS = ["application-outlet", "app-root", "root-outlet"];

export interface ElementDescriptor {
  tag: string;
  classes: string[];
  role: string | null;
}

export interface LayerOverlapDiagnostic {
  command: LayerCommand;
  selected: ElementDescriptor;
  initialTarget: ElementDescriptor;
  blocker: ElementDescriptor | null;
  selectedHost: ElementDescriptor;
  blockerHost: ElementDescriptor | null;
  selectedHostDiffersFromSelected: boolean;
  oldPosition: string;
  newPosition: string;
  oldZIndex: string;
  newZIndex: string;
  verification: "pass" | "fail";
  reason?: string;
}

export interface LayerResolverResult {
  host: HTMLElement;
  selected: HTMLElement;
  initialTarget: HTMLElement;
  layer: number;
  previousLayer: number;
  verification: "pass" | "fail";
  reason?: string;
  diagnostic: LayerOverlapDiagnostic;
  changes: AppliedDomEffect["changes"];
}

export type LayerDiagnosticLogger = (message: string, data?: unknown) => void;

interface LayerStyleSnapshot {
  position: string;
  zIndex: string;
}

function describeElement(element: HTMLElement): ElementDescriptor {
  return {
    tag: element.tagName.toLowerCase(),
    classes: Array.from(element.classList),
    role: element.getAttribute("role"),
  };
}

function readComputedPosition(element: HTMLElement): string {
  const inline = element.style.position;
  if (inline && inline !== "static") {
    return inline;
  }
  const view = element.ownerDocument.defaultView;
  return view ? view.getComputedStyle(element).position || "static" : "static";
}

function readComputedZIndex(element: HTMLElement): string {
  const view = element.ownerDocument.defaultView;
  return view ? view.getComputedStyle(element).zIndex : "";
}

function readInlineZIndex(element: HTMLElement): string {
  return element.style.zIndex;
}

function readSiblingMaxZIndex(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent) {
    return 0;
  }

  let maxLayer = 0;
  for (const child of Array.from(parent.children)) {
    if (!(child instanceof HTMLElement) || child === element) {
      continue;
    }
    maxLayer = Math.max(
      maxLayer,
      resolveCurrentManagedLayer(child.style.zIndex, readComputedZIndex(child)),
    );
  }
  return maxLayer;
}

function isPageSampleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const tag = element.tagName.toLowerCase();
  if (UNSAFE_HOST_TAGS.has(tag)) {
    return false;
  }
  if (isExtensionRoot(element)) {
    return false;
  }
  return true;
}

function getFilteredElementsFromPoint(document: Document, x: number, y: number): HTMLElement[] {
  if (typeof document.elementsFromPoint !== "function") {
    return [];
  }

  const filtered: HTMLElement[] = [];
  const seen = new Set<Element>();
  for (const node of document.elementsFromPoint(x, y)) {
    if (!(node instanceof HTMLElement) || seen.has(node)) {
      continue;
    }
    seen.add(node);
    if (isPageSampleElement(node)) {
      filtered.push(node);
    }
  }
  return filtered;
}

function sampleInnerPoints(rect: MeasurementRect): { x: number; y: number }[] {
  const insetX = Math.min(4, Math.max(1, rect.width * 0.1));
  const insetY = Math.min(4, Math.max(1, rect.height * 0.1));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return [
    { x: cx, y: cy },
    { x: rect.x + insetX, y: rect.y + insetY },
    { x: rect.x + rect.width - insetX, y: rect.y + insetY },
    { x: rect.x + insetX, y: rect.y + rect.height - insetY },
    { x: rect.x + rect.width - insetX, y: rect.y + rect.height - insetY },
  ];
}

function collectManagedPaintHosts(selected: HTMLElement, initialTarget: HTMLElement): Set<HTMLElement> {
  const hosts = new Set<HTMLElement>([selected, initialTarget]);
  let current: HTMLElement | null = selected;
  while (current) {
    if (current.hasAttribute(OTF_MANAGED_ATTR)) {
      hosts.add(current);
    }
    if (current === initialTarget) {
      break;
    }
    current = current.parentElement;
  }
  return hosts;
}

function isPaintParticipant(element: HTMLElement, selected: HTMLElement, paintHosts: Set<HTMLElement>): boolean {
  if (element === selected || selected.contains(element)) {
    return true;
  }
  for (const host of paintHosts) {
    if (element === host || host.contains(element) || element.contains(host)) {
      return true;
    }
  }
  return false;
}

function hasAncestorStackingContext(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return false;
  }

  let ancestor = element.parentElement;
  while (ancestor && ancestor.tagName.toLowerCase() !== "body") {
    const inlineTransform = ancestor.style.transform;
    if (inlineTransform && inlineTransform !== "none") {
      return true;
    }

    const style = view.getComputedStyle(ancestor);
    if (
      (style.transform && style.transform !== "none") ||
      (style.filter && style.filter !== "none") ||
      style.isolation === "isolate" ||
      (style.opacity !== "" && Number.parseFloat(style.opacity) < 1)
    ) {
      return true;
    }
    ancestor = ancestor.parentElement;
  }

  return false;
}

function wantsOnTop(command: LayerCommand): boolean {
  return command === "forward" || command === "front";
}

function verifyRelativeLayer(
  selectedHost: HTMLElement,
  blockerHost: HTMLElement,
  command: LayerCommand,
): boolean {
  const selectedLayer = resolveCurrentManagedLayer(
    readInlineZIndex(selectedHost),
    readComputedZIndex(selectedHost),
  );
  const blockerLayer = resolveCurrentManagedLayer(
    readInlineZIndex(blockerHost),
    readComputedZIndex(blockerHost),
  );
  return wantsOnTop(command) ? selectedLayer > blockerLayer : selectedLayer < blockerLayer;
}

function verifyLayerVisual(
  selected: HTMLElement,
  paintHosts: Set<HTMLElement>,
  rect: MeasurementRect,
  command: LayerCommand,
  document: Document,
  options: {
    selectedHost?: HTMLElement;
    blockerHost?: HTMLElement | null;
  } = {},
): boolean {
  const points = sampleInnerPoints(rect);
  const expectOnTop = wantsOnTop(command);
  let sampled = false;

  for (const point of points) {
    const stack = getFilteredElementsFromPoint(document, point.x, point.y);
    const top = stack[0] ?? null;
    if (!top) {
      continue;
    }
    sampled = true;

    const selectedOnTop = isPaintParticipant(top, selected, paintHosts);
    if (expectOnTop && !selectedOnTop) {
      if (options.selectedHost && options.blockerHost) {
        return verifyRelativeLayer(options.selectedHost, options.blockerHost, command);
      }
      return false;
    }
    if (!expectOnTop && selectedOnTop) {
      if (options.selectedHost && options.blockerHost) {
        return verifyRelativeLayer(options.selectedHost, options.blockerHost, command);
      }
      return false;
    }
  }

  if (
    !sampled &&
    options.selectedHost &&
    options.blockerHost
  ) {
    return verifyRelativeLayer(options.selectedHost, options.blockerHost, command);
  }

  return sampled;
}

function findLowestCommonAncestor(a: HTMLElement, b: HTMLElement): HTMLElement | null {
  const seen = new Set<HTMLElement>();
  let current: HTMLElement | null = a;
  while (current) {
    seen.add(current);
    current = current.parentElement;
  }

  current = b;
  while (current) {
    if (seen.has(current)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function directChildUnderAncestor(element: HTMLElement, ancestor: HTMLElement | null): HTMLElement | null {
  if (!ancestor) {
    return null;
  }

  let current: HTMLElement | null = element;
  while (current && current.parentElement !== ancestor) {
    current = current.parentElement;
  }
  return current;
}

function hasGiantRootId(element: HTMLElement): boolean {
  const id = element.id.trim().toLowerCase();
  if (!id) {
    return false;
  }
  return GIANT_ROOT_ID_HINTS.some((hint) => id.includes(hint));
}

function isUnsafePaintHost(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (UNSAFE_HOST_TAGS.has(tag)) {
    return true;
  }
  if (hasGiantRootId(element) && isGiantPageWrapper(element)) {
    return true;
  }
  if (isGiantPageWrapper(element)) {
    return true;
  }

  return false;
}

/** Prefer the selected node, then the nearest non-giant managed move host. */
export function resolveInitialLayerTarget(selected: HTMLElement): HTMLElement {
  if (selected.hasAttribute(OTF_MANAGED_ATTR)) {
    return selected;
  }

  let bestManaged: HTMLElement | null = null;
  let current: HTMLElement | null = selected.parentElement;
  while (current && current !== current.ownerDocument.documentElement) {
    if (current.hasAttribute(OTF_MANAGED_ATTR) && !isUnsafePaintHost(current)) {
      bestManaged = current;
      break;
    }
    current = current.parentElement;
  }

  return bestManaged ?? selected;
}

export function resolveSelectedPaintHost(
  selected: HTMLElement,
  blocker: HTMLElement,
): HTMLElement {
  const lca = findLowestCommonAncestor(selected, blocker);
  const branch = directChildUnderAncestor(selected, lca);
  if (!branch) {
    return resolveInitialLayerTarget(selected);
  }

  if (branch === selected) {
    return resolveInitialLayerTarget(selected);
  }

  if (!isUnsafePaintHost(branch)) {
    return branch;
  }

  return resolveInitialLayerTarget(selected);
}

export function resolveBlockerPaintHost(
  blocker: HTMLElement,
  selected: HTMLElement,
): HTMLElement {
  const lca = findLowestCommonAncestor(selected, blocker);
  const branch = directChildUnderAncestor(blocker, lca);
  if (!branch) {
    return blocker;
  }

  if (!isUnsafePaintHost(branch)) {
    return branch;
  }

  if (!isUnsafePaintHost(blocker)) {
    return blocker;
  }

  return branch;
}

function findBlockerByRectOverlap(
  selected: HTMLElement,
  paintHosts: Set<HTMLElement>,
  rect: MeasurementRect,
  document: Document,
): HTMLElement | null {
  let best: { element: HTMLElement; layer: number } | null = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (!(node instanceof HTMLElement)) {
      node = walker.nextNode();
      continue;
    }
    if (!isPageSampleElement(node) || isPaintParticipant(node, selected, paintHosts)) {
      node = walker.nextNode();
      continue;
    }

    const nodeRect = extractBoundingBox(node);
    if (!rectsOverlap(rect, nodeRect)) {
      node = walker.nextNode();
      continue;
    }

    const layer = resolveCurrentManagedLayer(
      readInlineZIndex(node),
      readComputedZIndex(node),
    );
    if (!best || layer >= best.layer) {
      best = { element: node, layer };
    }
    node = walker.nextNode();
  }

  return best?.element ?? null;
}

function findVisualBlocker(
  selected: HTMLElement,
  paintHosts: Set<HTMLElement>,
  rect: MeasurementRect,
  command: LayerCommand,
  document: Document,
): HTMLElement | null {
  const points = sampleInnerPoints(rect);
  const expectOnTop = wantsOnTop(command);

  for (const point of points) {
    const stack = getFilteredElementsFromPoint(document, point.x, point.y);
    for (const element of stack) {
      if (isPaintParticipant(element, selected, paintHosts)) {
        if (expectOnTop) {
          continue;
        }
        return element;
      }
      return element;
    }
  }

  return findBlockerByRectOverlap(selected, paintHosts, rect, document);
}

function computeTargetLayer(
  host: HTMLElement,
  command: LayerCommand,
  explicitLayer: number | undefined,
  blockerHost: HTMLElement | null,
): number {
  if (explicitLayer !== undefined) {
    return explicitLayer;
  }

  const currentLayer = resolveCurrentManagedLayer(
    readInlineZIndex(host),
    readComputedZIndex(host),
  );
  const siblingMax = readSiblingMaxZIndex(host);

  if (blockerHost && (command === "forward" || command === "backward")) {
    const blockerLayer = resolveCurrentManagedLayer(
      readInlineZIndex(blockerHost),
      readComputedZIndex(blockerHost),
    );
    if (command === "forward") {
      return Math.min(
        FRONT_LAYER,
        Math.max(currentLayer + 1, siblingMax + 1, blockerLayer + 1),
      );
    }
    return Math.max(BACK_LAYER, Math.min(currentLayer - 1, blockerLayer - 1));
  }

  return computeNextLayer(currentLayer, command, siblingMax);
}

function captureLayerStyle(element: HTMLElement): LayerStyleSnapshot {
  return {
    position: element.style.position,
    zIndex: element.style.zIndex,
  };
}

function restoreLayerStyle(element: HTMLElement, snapshot: LayerStyleSnapshot): void {
  if (snapshot.position) {
    element.style.position = snapshot.position;
  } else {
    element.style.removeProperty("position");
  }

  if (snapshot.zIndex) {
    element.style.zIndex = snapshot.zIndex;
  } else {
    element.style.removeProperty("z-index");
  }
}

function applyLayerToHostDry(host: HTMLElement, layer: number): void {
  const computedPosition = readComputedPosition(host);
  if (computedPosition === "static") {
    host.style.position = "relative";
  }
  host.style.zIndex = String(layer);
}

export function applyLayerToHost(
  host: HTMLElement,
  layer: number,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  snapshotStore.captureIfNeeded(host);
  const changes: AppliedDomEffect["changes"] = [];
  const computedPosition = readComputedPosition(host);

  if (computedPosition === "static") {
    const previousPosition = host.style.position;
    host.style.position = "relative";
    changes.push({ kind: "position", previousValue: previousPosition });
  }

  const previousZIndex = host.style.zIndex || readComputedZIndex(host);
  host.style.zIndex = String(layer);
  changes.push({ kind: "zIndex", previousValue: previousZIndex });
  return changes;
}

function buildDiagnostic(
  command: LayerCommand,
  selected: HTMLElement,
  initialTarget: HTMLElement,
  host: HTMLElement,
  blocker: HTMLElement | null,
  blockerHost: HTMLElement | null,
  before: LayerStyleSnapshot,
  layer: number,
  verification: "pass" | "fail",
  reason?: string,
): LayerOverlapDiagnostic {
  const needsPosition = readComputedPosition(host) === "static";
  return {
    command,
    selected: describeElement(selected),
    initialTarget: describeElement(initialTarget),
    blocker: blocker ? describeElement(blocker) : null,
    selectedHost: describeElement(host),
    blockerHost: blockerHost ? describeElement(blockerHost) : null,
    selectedHostDiffersFromSelected: host !== selected,
    oldPosition: before.position,
    newPosition: needsPosition ? "relative" : before.position || readComputedPosition(host),
    oldZIndex: before.zIndex,
    newZIndex: String(layer),
    verification,
    ...(reason ? { reason } : {}),
  };
}

export function logLayerOverlapDiagnostic(
  onDebug: LayerDiagnosticLogger | undefined,
  diagnostic: LayerOverlapDiagnostic,
): void {
  onDebug?.("layer-overlap", diagnostic);
}

export function inferLayerCommandFromOperation(
  sourceCommand: string | null | undefined,
  layer: number,
  previousLayer: number | undefined,
): LayerCommand {
  if (sourceCommand?.startsWith("layer:")) {
    const command = sourceCommand.slice("layer:".length);
    if (
      command === "forward" ||
      command === "backward" ||
      command === "front" ||
      command === "back"
    ) {
      return command;
    }
  }

  if (layer === FRONT_LAYER) {
    return "front";
  }
  if (layer === BACK_LAYER) {
    return "back";
  }
  if (previousLayer !== undefined && layer > previousLayer) {
    return "forward";
  }
  if (previousLayer !== undefined && layer < previousLayer) {
    return "backward";
  }
  return "forward";
}

export interface LayerResolverPlan {
  host: HTMLElement;
  selected: HTMLElement;
  initialTarget: HTMLElement;
  layer: number;
  previousLayer: number;
  verification: "pass" | "fail";
  reason?: string;
  diagnostic: LayerOverlapDiagnostic;
}

export function resolveLayerPlan(
  selected: HTMLElement,
  command: LayerCommand,
  snapshotStore: ElementSnapshotStore,
  options: {
    explicitLayer?: number;
    onDebug?: LayerDiagnosticLogger;
  } = {},
): LayerResolverPlan {
  const initialTarget = resolveInitialLayerTarget(selected);
  const selectedRect = extractBoundingBox(selected);
  const document = selected.ownerDocument;
  const paintHosts = collectManagedPaintHosts(selected, initialTarget);

  const probeHost = (
    host: HTMLElement,
    layer: number,
    blocker: HTMLElement | null,
    blockerHost: HTMLElement | null,
  ): LayerResolverPlan => {
    const before = captureLayerStyle(host);
    const previousLayer = resolveCurrentManagedLayer(before.zIndex, readComputedZIndex(host));
    applyLayerToHostDry(host, layer);
    const verifyHosts = collectManagedPaintHosts(selected, host);
    verifyHosts.add(host);
    const verification = verifyLayerVisual(selected, verifyHosts, selectedRect, command, document, {
      selectedHost: host,
      blockerHost,
    })
      ? "pass"
      : "fail";
    restoreLayerStyle(host, before);

    const diagnostic = buildDiagnostic(
      command,
      selected,
      initialTarget,
      host,
      blocker,
      blockerHost,
      before,
      layer,
      verification,
      verification === "fail" ? "overlap-probe-failed" : undefined,
    );
    logLayerOverlapDiagnostic(options.onDebug, diagnostic);

    return {
      host,
      selected,
      initialTarget,
      layer,
      previousLayer,
      verification,
      ...(verification === "fail" ? { reason: "overlap-probe-failed" } : {}),
      diagnostic,
    };
  };

  const initialLayer = computeTargetLayer(initialTarget, command, options.explicitLayer, null);
  const initialAttempt = probeHost(initialTarget, initialLayer, null, null);
  const overlapBlocker = findBlockerByRectOverlap(
    selected,
    paintHosts,
    selectedRect,
    document,
  );
  if (
    initialAttempt.verification === "pass" &&
    !hasAncestorStackingContext(selected) &&
    (!overlapBlocker || isPaintParticipant(overlapBlocker, selected, paintHosts))
  ) {
    return initialAttempt;
  }

  const blocker =
    findVisualBlocker(selected, paintHosts, selectedRect, command, document) ??
    overlapBlocker;
  if (!blocker) {
    return {
      ...initialAttempt,
      reason: "blocker-not-found",
      diagnostic: {
        ...initialAttempt.diagnostic,
        verification: "fail",
        reason: "blocker-not-found",
      },
    };
  }

  const selectedHost = resolveSelectedPaintHost(selected, blocker);
  const blockerHost = resolveBlockerPaintHost(blocker, selected);
  const resolvedLayer = computeTargetLayer(
    selectedHost,
    command,
    options.explicitLayer,
    blockerHost,
  );

  if (selectedHost === initialTarget && resolvedLayer === initialLayer) {
    return {
      ...initialAttempt,
      host: selectedHost,
      layer: resolvedLayer,
      reason: "unresolved-stacking-context",
      diagnostic: {
        ...initialAttempt.diagnostic,
        blocker: describeElement(blocker),
        blockerHost: describeElement(blockerHost),
        selectedHost: describeElement(selectedHost),
        verification: "fail",
        reason: "unresolved-stacking-context",
      },
    };
  }

  const resolvedAttempt = probeHost(selectedHost, resolvedLayer, blocker, blockerHost);
  if (resolvedAttempt.verification === "fail") {
    options.onDebug?.("layer-overlap-warning", {
      reason: "verification-failed-after-host-resolution",
      command,
      selected: describeElement(selected),
      selectedHost: describeElement(selectedHost),
      blocker: describeElement(blocker),
    });
  }

  return resolvedAttempt;
}

export function resolveLayerApplication(
  selected: HTMLElement,
  command: LayerCommand,
  snapshotStore: ElementSnapshotStore,
  options: {
    explicitLayer?: number;
    onDebug?: LayerDiagnosticLogger;
  } = {},
): LayerResolverResult {
  const plan = resolveLayerPlan(selected, command, snapshotStore, options);
  const changes = applyLayerToHost(plan.host, plan.layer, snapshotStore);
  return {
    ...plan,
    changes,
  };
}

export function applyZIndexOperationWithResolver(
  selected: HTMLElement,
  command: LayerCommand,
  snapshotStore: ElementSnapshotStore,
  options: {
    explicitLayer?: number;
    onDebug?: LayerDiagnosticLogger;
  } = {},
): { plan: LayerResolverPlan; changes: AppliedDomEffect["changes"]; host: HTMLElement } {
  const plan = resolveLayerPlan(selected, command, snapshotStore, options);
  const layer = options.explicitLayer ?? plan.layer;
  const changes = applyLayerToHost(plan.host, layer, snapshotStore);
  return { plan, changes, host: plan.host };
}
