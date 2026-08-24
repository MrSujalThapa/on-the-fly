import {
  OTF_ROOT_HOST_ATTR,
  OTF_ROOT_HOST_ID,
  OTF_ROOT_HOST_VALUE,
} from "../editor/measurement/constants.js";
import type { VisualNodeId } from "../editor/ids.js";
import { rectsNear } from "./geometry.js";
import type { InputMode } from "./input-router.js";
import type { OverlayCoordinator } from "./overlay-coordinator.js";
import type { IntendedRect } from "./placement-engine.js";
import { unionRects } from "./runtime-selection.js";
import type { VisualModel } from "./visual-model.js";
import { FloatingToolbar, type FloatingToolbarCallbacks, type FloatingToolbarCommandState } from "../editor/floating-toolbar.js";
import { readStoredCropInsets } from "../editor/dom/handlers/crop-handler.js";

export interface OverlayCoordinatorDeps {
  document: Document;
  visualModel: VisualModel;
}

const SAVE_BUTTON_CLASS = "otf-save-button";
const OUTLINE_CLASS = "otf-selection-outline";
const MEMBER_OUTLINE_CLASS = "otf-selection-member-outline";
const LASSO_CLASS = "otf-lasso";
const FREEFORM_LASSO_CLASS = "otf-freeform-lasso";
const HANDLE_CLASS = "otf-transform-handle";
const CROP_HANDLE_CLASS = "otf-crop-handle";

function serializeRect(rect: IntendedRect): string {
  return `${String(rect.x)},${String(rect.y)},${String(rect.width)},${String(rect.height)}`;
}

function overlayStyles(doc: Document): HTMLStyleElement {
  const style = doc.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .otf-indicator {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.92);
      color: #f9fafb;
      font: 600 12px/1 system-ui, sans-serif;
      pointer-events: none;
    }
    .otf-indicator-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #34d399;
    }
    .otf-indicator[data-mode="interact"] .otf-indicator-dot {
      background: #fbbf24;
    }
    .${SAVE_BUTTON_CLASS} {
      position: fixed;
      left: 16px;
      bottom: 16px;
      display: inline-flex;
      padding: 8px 14px;
      border: none;
      border-radius: 999px;
      background: #059669;
      color: #ecfdf5;
      font: 600 12px/1 system-ui, sans-serif;
      pointer-events: auto;
      cursor: pointer;
    }
    .${SAVE_BUTTON_CLASS}[hidden] { display: none !important; }
    .otf-overlay-layer { position: fixed; inset: 0; z-index: 5; pointer-events: none; }
    .${OUTLINE_CLASS} {
      position: fixed;
      box-sizing: border-box;
      border: 2px solid #2563eb;
      border-radius: 4px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85), 0 0 0 4px rgba(37, 99, 235, 0.18);
      pointer-events: none;
    }
    .${MEMBER_OUTLINE_CLASS} {
      position: fixed;
      box-sizing: border-box;
      border: 1px solid rgba(37, 99, 235, 0.72);
      border-radius: 3px;
      pointer-events: none;
    }
    .${OUTLINE_CLASS}[data-selection-kind="group"] {
      border-color: #7c3aed;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85), 0 0 0 4px rgba(124, 58, 237, 0.2);
    }
    .otf-overlay-layer[data-selection-kind="group"] .${MEMBER_OUTLINE_CLASS} {
      border-color: rgba(167, 139, 250, 0.82);
    }
    .${LASSO_CLASS} {
      position: fixed;
      box-sizing: border-box;
      border: 1px solid #2563eb;
      background: rgba(37, 99, 235, 0.08);
      pointer-events: none;
    }
    .${FREEFORM_LASSO_CLASS} {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    .${FREEFORM_LASSO_CLASS} path {
      fill: rgba(37, 99, 235, 0.08);
      fill-rule: evenodd;
      stroke: #2563eb;
      stroke-width: 1;
      pointer-events: none;
    }
    .${HANDLE_CLASS} { position: absolute; width: 10px; height: 10px; box-sizing: border-box; border: 2px solid currentColor; background: white; color: #2563eb; border-radius: 50%; pointer-events: auto; }
    .otf-overlay-layer[data-selection-kind="group"] .${HANDLE_CLASS} { color: #7c3aed; }
    .${HANDLE_CLASS}[data-handle="resize-nw"] { left: -6px; top: -6px; cursor: nwse-resize; }
    .${HANDLE_CLASS}[data-handle="resize-ne"] { right: -6px; top: -6px; cursor: nesw-resize; }
    .${HANDLE_CLASS}[data-handle="resize-sw"] { left: -6px; bottom: -6px; cursor: nesw-resize; }
    .${HANDLE_CLASS}[data-handle="resize-se"] { right: -6px; bottom: -6px; cursor: nwse-resize; }
    .${HANDLE_CLASS}[data-handle="rotate"] { left: 50%; top: -28px; transform: translateX(-50%); cursor: grab; }
    .${CROP_HANDLE_CLASS} { display: none; position: absolute; width: 12px; height: 12px; box-sizing: border-box; border: 2px solid #f59e0b; background: white; pointer-events: auto; }
    .otf-overlay-layer[data-crop-mode="true"] .${HANDLE_CLASS} { display: none; }
    .otf-overlay-layer[data-crop-mode="true"] .${CROP_HANDLE_CLASS} { display: block; }
    .${CROP_HANDLE_CLASS}[data-handle="crop-nw"] { left: -6px; top: -6px; cursor: nwse-resize; }
    .${CROP_HANDLE_CLASS}[data-handle="crop-ne"] { right: -6px; top: -6px; cursor: nesw-resize; }
    .${CROP_HANDLE_CLASS}[data-handle="crop-sw"] { left: -6px; bottom: -6px; cursor: nesw-resize; }
    .${CROP_HANDLE_CLASS}[data-handle="crop-se"] { right: -6px; bottom: -6px; cursor: nwse-resize; }
  `;
  return style;
}

export function createOverlayCoordinator(deps: OverlayCoordinatorDeps): OverlayCoordinator & {
  mount(): void;
  unmount(): void;
  setSave(state: {
    visible: boolean;
    status?: "idle" | "saving" | "saved" | "failed";
    error?: string;
    onSave?: () => void;
  }): void;
} {
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let layer: HTMLElement | null = null;
  let saveButton: HTMLButtonElement | null = null;
  let indicatorLabel: HTMLElement | null = null;
  let selected: readonly VisualNodeId[] = [];
  let painted: IntendedRect | null = null;
  let saveHandler: (() => void) | null = null;
  let outline: HTMLElement | null = null;
  let memberOutlines: HTMLElement[] = [];
  let lasso: HTMLElement | null = null;
  let freeformLasso: SVGSVGElement | null = null;
  let handlePointerDown: ((kind: "resize-nw" | "resize-ne" | "resize-sw" | "resize-se" | "rotate" | "crop-nw" | "crop-ne" | "crop-sw" | "crop-se", event: PointerEvent) => void) | null = null;
  let rafId = 0;
  let mode: InputMode = "edit";
  let toolbar: FloatingToolbar | null = null;
  let toolbarCallbacks: FloatingToolbarCallbacks = {
    onCommand: () => undefined,
    onStyleChange: () => undefined,
    onTextCommit: () => undefined,
    onTextCancel: () => undefined,
  };
  let toolbarCommands: readonly FloatingToolbarCommandState[] = [];
  let toolbarActiveStates: Record<string, boolean> = {};
  let toolbarVisible = false;
  let cropSubjectId: VisualNodeId | undefined;
  const scrollCleanups: Array<() => void> = [];
  const nestedScrollCleanups: Array<() => void> = [];

  const cancelLoop = (): void => {
    if (rafId !== 0) {
      deps.document.defaultView?.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const position = (element: HTMLElement, rect: IntendedRect): void => {
    element.style.left = `${String(rect.x)}px`;
    element.style.top = `${String(rect.y)}px`;
    element.style.width = `${String(rect.width)}px`;
    element.style.height = `${String(rect.height)}px`;
  };

  const paint = (rect: IntendedRect | null, members: readonly IntendedRect[] = []): void => {
    if (!layer) {
      return;
    }
    if (!rect) {
      outline?.remove();
      outline = null;
      for (const member of memberOutlines) member.remove();
      memberOutlines = [];
      painted = null;
      return;
    }
    if (!outline) {
      outline = deps.document.createElement("div");
      outline.className = OUTLINE_CLASS;
      layer.append(outline);
      for (const kind of ["resize-nw", "resize-ne", "resize-sw", "resize-se", "rotate"] as const) {
        const handle = deps.document.createElement("div");
        handle.className = HANDLE_CLASS;
        handle.dataset.handle = kind;
        handle.addEventListener("pointerdown", (event) => {
          event.preventDefault(); event.stopPropagation();
          handle.setPointerCapture(event.pointerId);
          handlePointerDown?.(kind, event);
        });
        outline.append(handle);
      }
      for (const kind of ["crop-nw", "crop-ne", "crop-sw", "crop-se"] as const) {
        const handle = deps.document.createElement("div");
        handle.className = CROP_HANDLE_CLASS;
        handle.dataset.handle = kind;
        handle.addEventListener("pointerdown", (event) => {
          event.preventDefault(); event.stopPropagation();
          if (typeof __OTF_DIAGNOSTICS_ENABLED__ !== "undefined" && __OTF_DIAGNOSTICS_ENABLED__) console.info("[otf-v2] crop-handle-pointerdown", { kind, x: event.clientX, y: event.clientY });
          handle.setPointerCapture(event.pointerId);
          handlePointerDown?.(kind, event);
        });
        outline.append(handle);
      }
    }
    outline.setAttribute("data-selection-kind", layer.getAttribute("data-selection-kind") ?? "selection");
    position(outline, rect);
    const cropNodeId = cropSubjectId ?? (selected.length === 1 ? selected[0] : undefined);
    const cropTarget = cropNodeId ? deps.visualModel.bind(cropNodeId) : null;
    const crop = cropTarget ? readStoredCropInsets(cropTarget) : { top: 0, right: 0, bottom: 0, left: 0 };
    const subjectRect = (cropNodeId ? deps.visualModel.measure([cropNodeId]).get(cropNodeId) : null) ?? rect;
    const insetLeft = (subjectRect.x - rect.x) + crop.left - 6;
    const insetTop = (subjectRect.y - rect.y) + crop.top - 6;
    const insetRight = (rect.x + rect.width) - (subjectRect.x + subjectRect.width) + crop.right - 6;
    const insetBottom = (rect.y + rect.height) - (subjectRect.y + subjectRect.height) + crop.bottom - 6;
    const cropHandles: Record<string, HTMLElement> = Object.fromEntries(
      Array.from(outline.querySelectorAll<HTMLElement>(`.${CROP_HANDLE_CLASS}`)).map((handle) => [handle.dataset.handle ?? "", handle]),
    );
    cropHandles["crop-nw"]?.style.setProperty("left", `${String(insetLeft)}px`); cropHandles["crop-nw"]?.style.setProperty("top", `${String(insetTop)}px`);
    cropHandles["crop-ne"]?.style.setProperty("right", `${String(insetRight)}px`); cropHandles["crop-ne"]?.style.setProperty("top", `${String(insetTop)}px`);
    cropHandles["crop-sw"]?.style.setProperty("left", `${String(insetLeft)}px`); cropHandles["crop-sw"]?.style.setProperty("bottom", `${String(insetBottom)}px`);
    cropHandles["crop-se"]?.style.setProperty("right", `${String(insetRight)}px`); cropHandles["crop-se"]?.style.setProperty("bottom", `${String(insetBottom)}px`);
    while (memberOutlines.length < members.length) {
      const member = deps.document.createElement("div");
      member.className = MEMBER_OUTLINE_CLASS;
      layer.append(member);
      memberOutlines.push(member);
    }
    while (memberOutlines.length > members.length) memberOutlines.pop()?.remove();
    members.forEach((member, index) => {
      const target = memberOutlines[index];
      if (target) position(target, member);
    });
    const model = measureSelected().union;
    outline.dataset.otfModel = serializeRect(model ?? rect);
    outline.dataset.otfRenderer = serializeRect(rect);
    outline.dataset.otfSpace = "viewport";
    painted = rect;
  };

  const measureSelected = (): { union: IntendedRect | null; members: IntendedRect[] } => {
    const measured = deps.visualModel.measure(selected);
    const members = selected
      .map((id) => measured.get(id))
      .filter((rect): rect is IntendedRect => Boolean(rect));
    return { union: unionRects(members), members };
  };

  const render = (force = false): void => {
    const measured = measureSelected();
    const rect = measured.union;
    if (!rect) {
      paint(null);
      toolbar?.hide();
      return;
    }
    if (!force && painted && rectsNear(rect, painted, 0.5)) {
      return;
    }
    paint(rect, selected.length > 1 ? measured.members : []);
    if (mode === "edit" && toolbarVisible) toolbar?.refreshAnchor(rect);
  };

  const loop = (): void => {
    rafId = 0;
    if (selected.length === 0) {
      return;
    }
    render(true);
    const view = deps.document.defaultView;
    if (view) {
      rafId = view.requestAnimationFrame(loop);
    }
  };

  const attachNestedScroll = (): void => {
    while (nestedScrollCleanups.length > 0) {
      nestedScrollCleanups.pop()?.();
    }
    const onNestedScroll = (): void => {
      render(true);
    };
    const observed = new Set<HTMLElement>();
    for (const id of selected) {
      let current = deps.visualModel.bind(id);
      while (current) {
        if (!observed.has(current)) {
          observed.add(current);
          current.addEventListener("scroll", onNestedScroll, { passive: true });
          const node = current;
          nestedScrollCleanups.push(() => {
            node.removeEventListener("scroll", onNestedScroll);
          });
        }
        current = current.parentElement;
      }
    }
  };

  const startLoop = (): void => {
    if (rafId !== 0 || selected.length === 0) {
      return;
    }
    const view = deps.document.defaultView;
    if (!view) {
      render(true);
      return;
    }
    rafId = view.requestAnimationFrame(loop);
  };

  const applyMode = (): void => {
    if (!host || !indicatorLabel) {
      return;
    }
    const indicator = indicatorLabel.parentElement;
    if (mode === "interact") {
      indicatorLabel.textContent = "Interact mode — site clicks enabled";
      indicator?.setAttribute("data-mode", "interact");
      selected = [];
      cancelLoop();
      paint(null);
      toolbar?.hide();
      return;
    }
    indicatorLabel.textContent = "Edit mode — press I to interact";
    indicator?.setAttribute("data-mode", "edit");
  };

  return {
    mount() {
      if (host?.isConnected) {
        return;
      }
      const existing = deps.document.getElementById(OTF_ROOT_HOST_ID);
      existing?.remove();

      host = deps.document.createElement("div");
      host.id = OTF_ROOT_HOST_ID;
      host.setAttribute(OTF_ROOT_HOST_ATTR, OTF_ROOT_HOST_VALUE);
      host.style.cssText =
        "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
      shadow = host.attachShadow({ mode: "closed" });
      const syncKeyboardCapture = (): void => {
        const active = shadow?.activeElement;
        const captures = active instanceof HTMLElement &&
          (active.matches("input, textarea, select") || active.isContentEditable);
        host?.setAttribute("data-otf-keyboard-capture", String(captures));
      };
      shadow.addEventListener("focusin", syncKeyboardCapture);
      shadow.addEventListener("focusout", () => {
        queueMicrotask(syncKeyboardCapture);
      });
      const indicator = deps.document.createElement("div");
      indicator.className = "otf-indicator";
      indicator.dataset.mode = mode;
      const dot = deps.document.createElement("span");
      dot.className = "otf-indicator-dot";
      indicatorLabel = deps.document.createElement("span");
      indicatorLabel.textContent = "Edit mode — press I to interact";
      indicator.append(dot, indicatorLabel);
      saveButton = deps.document.createElement("button");
      saveButton.type = "button";
      saveButton.className = SAVE_BUTTON_CLASS;
      saveButton.hidden = true;
      saveButton.textContent = "Save";
      saveButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        saveHandler?.();
      });
      layer = deps.document.createElement("div");
      layer.className = "otf-overlay-layer";
      shadow.append(overlayStyles(deps.document), indicator, saveButton, layer);
      toolbar = new FloatingToolbar({ shadowRoot: shadow, callbacks: toolbarCallbacks });
      toolbar.mount();
      deps.document.documentElement.append(host);
      const view = deps.document.defaultView;
      const onScrollOrResize = (): void => {
        render(true);
      };
      if (view) {
        view.addEventListener("scroll", onScrollOrResize, true);
        view.addEventListener("resize", onScrollOrResize);
        scrollCleanups.push(() => {
          view.removeEventListener("scroll", onScrollOrResize, true);
          view.removeEventListener("resize", onScrollOrResize);
        });
      }
      deps.document.addEventListener("scroll", onScrollOrResize, true);
      scrollCleanups.push(() => {
        deps.document.removeEventListener("scroll", onScrollOrResize, true);
      });
      applyMode();
      startLoop();
    },
    unmount() {
      cancelLoop();
      toolbar?.unmount();
      toolbar = null;
      while (scrollCleanups.length > 0) {
        scrollCleanups.pop()?.();
      }
      while (nestedScrollCleanups.length > 0) {
        nestedScrollCleanups.pop()?.();
      }
      host?.remove();
      host = null;
      shadow = null;
      layer = null;
      outline = null;
      memberOutlines = [];
      lasso = null;
      freeformLasso = null;
      saveButton = null;
      indicatorLabel = null;
      selected = [];
      painted = null;
      saveHandler = null;
      handlePointerDown = null;
    },
    showSelection(nodeIds: readonly VisualNodeId[], kind = "selection") {
      selected = nodeIds;
      layer?.setAttribute("data-selection-kind", kind);
      outline?.setAttribute("data-selection-kind", kind);
      attachNestedScroll();
      render(true);
      if (nodeIds.length > 0) {
        startLoop();
        return;
      }
      cancelLoop();
    },
    showLasso(rect) {
      if (!layer) return;
      freeformLasso?.remove();
      freeformLasso = null;
      if (!lasso) {
        lasso = deps.document.createElement("div");
        lasso.className = LASSO_CLASS;
        layer.append(lasso);
      }
      position(lasso, rect);
    },
    showFreeformLasso(points) {
      if (!layer || points.length === 0) return;
      lasso?.remove();
      lasso = null;
      if (!freeformLasso) {
        freeformLasso = deps.document.createElementNS("http://www.w3.org/2000/svg", "svg");
        freeformLasso.setAttribute("class", FREEFORM_LASSO_CLASS);
        const path = deps.document.createElementNS("http://www.w3.org/2000/svg", "path");
        freeformLasso.append(path);
        layer.append(freeformLasso);
      }
      const path = freeformLasso.querySelector("path");
      if (!path) return;
      const first = points[0];
      if (!first) return;
      const body = points.slice(1).map((point) => `L ${String(point.x)} ${String(point.y)}`).join(" ");
      path.setAttribute("d", `M ${String(first.x)} ${String(first.y)} ${body} Z`);
    },
    clearLasso() {
      lasso?.remove();
      lasso = null;
      freeformLasso?.remove();
      freeformLasso = null;
    },
    toggleLassoChooser() {
      toolbar?.toggleLassoChooser();
    },
    closeLassoChooser() {
      return toolbar?.closeLassoChooser() ?? false;
    },
    isLassoChooserOpen() {
      return toolbar?.isLassoChooserOpen() ?? false;
    },
    toggleMoreMenu() {
      toolbar?.toggleMoreMenu();
    },
    closeMoreMenu() {
      return toolbar?.closeMoreMenu() ?? false;
    },
    setMoreWrapEnabled(enabled) {
      toolbar?.setMoreWrapEnabled(enabled);
    },
    openComponentPalette(options) {
      toolbar?.openComponentPalette(options);
    },
    closeComponentPalette() {
      return toolbar?.closeComponentPalette() ?? false;
    },
    isComponentPaletteOpen() {
      return toolbar?.isComponentPaletteOpen() ?? false;
    },
    setPaletteSampling(sampling) {
      toolbar?.setPaletteSampling(sampling);
    },
    setLassoDiagnostics(stats) {
      if (!host) return;
      if (stats) host.setAttribute("data-otf-freeform-stats", JSON.stringify(stats));
      else host.removeAttribute("data-otf-freeform-stats");
    },
    refreshFromLiveGeometry() {
      render(true);
    },
    clear() {
      selected = [];
      attachNestedScroll();
      cancelLoop();
      paint(null);
      toolbar?.hide();
      lasso?.remove();
      lasso = null;
      freeformLasso?.remove();
      freeformLasso = null;
    },
    selectionOutlineRect() {
      return measureSelected().union;
    },
    setHandlePointerDown(handler) {
      handlePointerDown = handler;
    },
    setCropMode(active, subjectNodeId) {
      layer?.setAttribute("data-crop-mode", String(active));
      cropSubjectId = active ? subjectNodeId : undefined;
      render(true);
    },
    setMode(next: InputMode) {
      mode = next;
      applyMode();
      if (mode === "edit") render(true);
    },
    configureToolbar(callbacks) {
      toolbarCallbacks = callbacks;
    },
    setToolbarCommands(commands, activeStates = {}) {
      toolbarCommands = commands;
      toolbarActiveStates = activeStates;
      const rect = measureSelected().union;
      if (rect && mode === "edit" && toolbarVisible) toolbar?.renderCommandStates(toolbarCommands, rect, toolbarActiveStates);
    },
    setToolbarVisible(visible) {
      toolbarVisible = visible;
      const rect = measureSelected().union;
      if (visible && rect && mode === "edit") toolbar?.renderCommandStates(toolbarCommands, rect, toolbarActiveStates);
      else toolbar?.hide();
    },
    openStylePanel(values) {
      toolbar?.toggleStylePanel(true, values);
    },
    closeStylePanel() {
      toolbar?.closeStylePanel();
    },
    openTextEditor(initialText) {
      const rect = measureSelected().union;
      if (rect) toolbar?.openTextEditor(rect, initialText);
    },
    closeTextEditor(cancel) {
      toolbar?.closeTextEditor(cancel);
    },
    setSave(state) {
      saveHandler = state.onSave ?? null;
      host?.setAttribute("data-otf-save-status", state.status ?? "idle");
      if (state.error) host?.setAttribute("data-otf-save-error", state.error);
      else host?.removeAttribute("data-otf-save-error");
      if (saveButton) {
        saveButton.hidden = !state.visible;
        saveButton.textContent = state.status === "saving"
          ? "Saving…"
          : state.status === "saved"
            ? "Saved"
            : state.status === "failed"
              ? "Save failed"
              : "Save";
      }
    },
  };
}
