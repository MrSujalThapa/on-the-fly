import { extractBoundingBox } from "../measurement/bounding-box.js";
import { isExtensionRoot, isGiantPageWrapper } from "../measurement/scan-guards.js";
import type { MeasurementRect } from "../measurement/types.js";
import {
  BACK_LAYER,
  computeNextLayer,
  FRONT_LAYER,
  MANAGED_Z_INDEX_BASELINE,
  resolveCurrentManagedLayer,
  type LayerCommand,
} from "../transform/layer-order.js";
import type { ElementSnapshotStore } from "./element-snapshot.js";
import type { AppliedDomEffect } from "./types.js";
import { OTF_DETACH_ATTR } from "./managed-detach.js";
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
    { x: rect.x + insetX, y: cy },
    { x: rect.x + rect.width - insetX, y: cy },
    { x: cx, y: rect.y + insetY },
    { x: cx, y: rect.y + rect.height - insetY },
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
  if (element === selected || selected.contains(element) || element.contains(selected)) {
    return true;
  }
  for (const host of paintHosts) {
    if (element === host || host.contains(element) || element.contains(host)) {
      return true;
    }
  }
  return false;
}

function wantsOnTop(command: LayerCommand): boolean {
  return command === "forward" || command === "front";
}

function verifyLayerVisual(
  selected: HTMLElement,
  paintHosts: Set<HTMLElement>,
  blocker: HTMLElement,
  blockerHost: HTMLElement,
  rect: MeasurementRect,
  command: LayerCommand,
  document: Document,
): boolean {
  const points = sampleInnerPoints(rect);
  const expectOnTop = wantsOnTop(command);

  for (const point of points) {
    const stack = getFilteredElementsFromPoint(document, point.x, point.y);
    const selectedIndex = stack.findIndex((element) =>
      isPaintParticipant(element, selected, paintHosts));
    const blockerIndex = stack.findIndex((element) =>
      element === blocker || blocker.contains(element) || element.contains(blocker) ||
      element === blockerHost || blockerHost.contains(element) || element.contains(blockerHost));
    if (selectedIndex < 0 || blockerIndex < 0 || selectedIndex === blockerIndex) {
      continue;
    }
    if (expectOnTop && selectedIndex > blockerIndex) {
      return false;
    }
    if (!expectOnTop && selectedIndex < blockerIndex) {
      return false;
    }
  }

  return true;
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
  return selected;
}

export function resolveSelectedPaintHost(
  selected: HTMLElement,
  blocker: HTMLElement,
): HTMLElement {
  void blocker;
  return selected;
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

function sameVisualPeer(left: HTMLElement, right: HTMLElement): boolean {
  if (left.tagName !== right.tagName) return false;
  const leftText = left.textContent.replace(/\s+/gu, " ").trim();
  const rightText = right.textContent.replace(/\s+/gu, " ").trim();
  if (!leftText || leftText !== rightText) return false;
  const a = extractBoundingBox(left);
  const b = extractBoundingBox(right);
  return Math.abs(a.width - b.width) <= 4 && Math.abs(a.height - b.height) <= 4;
}

function managedLayerPeer(element: HTMLElement, selected: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>("[data-otf-element-id]")
    ?? element.closest<HTMLElement>(`[${OTF_DETACH_ATTR}="true"]`)
    ?? element.closest<HTMLElement>(`[${OTF_MANAGED_ATTR}="true"]`)
    ?? (selected.hasAttribute("data-otf-clone-id") && sameVisualPeer(element, selected) ? element : null);
}

/**
 * A layer command re-stacks the target against the On the Fly objects that
 * overlap it. Only managed peers qualify: verifying against arbitrary host
 * nodes picked out of the hit stack (LinkedIn embeds zero-area tracking
 * iframes and full-bleed overlays) failed the command for stacking contests
 * the user never asked about, and pushed in-flow elements into an
 * layout-destroying independent promotion to try to win them.
 */
function findVisualBlocker(
  selected: HTMLElement,
  paintHosts: Set<HTMLElement>,
  rect: MeasurementRect,
  command: LayerCommand,
  document: Document,
): HTMLElement | null {
  void command;
  for (const point of sampleInnerPoints(rect)) {
    const stack = getFilteredElementsFromPoint(document, point.x, point.y);
    for (const element of stack) {
      if (isPaintParticipant(element, selected, paintHosts)) {
        continue;
      }
      const peer = managedLayerPeer(element, selected);
      if (peer && peer !== selected && !selected.contains(peer) && !peer.contains(selected)) {
        return peer;
      }
    }
  }

  return null;
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
  const floor = host.getAttribute(OTF_DETACH_ATTR) === "true" ? MANAGED_Z_INDEX_BASELINE : BACK_LAYER;

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
    return Math.max(floor, Math.min(currentLayer - 1, blockerLayer - 1));
  }

  return computeNextLayer(currentLayer, command, siblingMax, floor);
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
    const verification = !blocker || !blockerHost
      ? "pass"
      : verifyLayerVisual(selected, verifyHosts, blocker, blockerHost, selectedRect, command, document)
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

  const overlapBlocker = findVisualBlocker(selected, paintHosts, selectedRect, command, document);
  const blocker = overlapBlocker;
  if (!blocker) {
    const initialLayer = computeTargetLayer(initialTarget, command, options.explicitLayer, null);
    return probeHost(initialTarget, initialLayer, null, null);
  }

  const selectedHost = resolveSelectedPaintHost(selected, blocker);
  const blockerHost = resolveBlockerPaintHost(blocker, selected);
  const resolvedLayer = computeTargetLayer(
    selectedHost,
    command,
    options.explicitLayer,
    blockerHost,
  );

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
