import type { EditorRuntime } from "../editor-runtime.js";
import { isExtensionRoot } from "../../editor/measurement/scan-guards.js";
import { isResolvedVisual } from "../visual-model.js";
import { environmentError, throwEnvironment } from "./environment-errors.js";
import type { ElementId, ElementObservation, ElementSummary, OTFEnvironment, OTFOperation, OperationResult } from "./environment-types.js";
import { geometryOf, originOf, stylesOf, textOf, visible } from "./observation.js";

function unsupported(type: string): OperationResult {
  return { ok: false, error: environmentError("UNSUPPORTED_OPERATION", `${type} is not exposed in Environment v1.`) };
}

export function createOTFEnvironment(document: Document, runtime: EditorRuntime): OTFEnvironment {
  const sessionId = `otf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const bind = (id: ElementId): HTMLElement => {
    const resolved = runtime.visualModel.resolveNode(id);
    if (resolved.kind === "ambiguous") throwEnvironment(environmentError("ELEMENT_AMBIGUOUS", "ambiguous_target", { id }));
    if (!isResolvedVisual(resolved)) throwEnvironment(environmentError("ELEMENT_NOT_FOUND", "unresolved_target", { id }));
    return resolved.element;
  };
  const ids = (): ElementId[] => {
    const known = new Set<ElementId>(runtime.visualModel.knownIds());
    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      if (isExtensionRoot(element) || !visible(element)) continue;
      const id = runtime.visualModel.adopt(element);
      if (id) known.add(id);
    }
    return [...known];
  };
  const summary = (id: ElementId, element: HTMLElement): ElementSummary => {
    const box = geometryOf(element, runtime.placement);
    const role = element.getAttribute("role")?.trim();
    const text = textOf(element);
    return { id, origin: originOf(element), tag: element.tagName.toLowerCase(), ...(role ? { role } : {}),
      ...(text ? { text: text.slice(0, 120) } : {}), bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
      selected: runtime.selectedNodeIds().includes(id) };
  };
  const execute = (operation: OTFOperation): OperationResult => {
    if (operation.type === "create") {
      const result = runtime.createElement(operation);
      return result.ok ? { ok: true, operationId: result.operation.id, ...(result.operation.target.nodeId ? { target: result.operation.target.nodeId } : {}), revision: runtime.ledger.cursor }
        : { ok: false, error: environmentError("INVALID_OPERATION", result.error) };
    }
    if (operation.type !== "move" && operation.type !== "layer") return unsupported(operation.type);
    const target = operation.target;
    const element = bind(target);
    const before = geometryOf(element, runtime.placement);
    const result = operation.type === "move" ? runtime.move(target, operation.delta.x, operation.delta.y) : runtime.layer(target, operation.command);
    if (!result.ok) return { ok: false, target, before, error: environmentError("INVALID_OPERATION", result.error) };
    return { ok: true, operationId: result.operation.id, target, before, after: geometryOf(bind(target), runtime.placement), revision: runtime.ledger.cursor };
  };
  return {
    /* The public contract is Promise-based while the local read/runtime adapters are synchronous. */
    /* eslint-disable @typescript-eslint/require-await */
    async observe(options) {
      const selected = runtime.selectedNodeIds();
      const candidates = options?.scope === "selection" ? [...selected] : ids();
      const elements = candidates.flatMap((id) => { try { const element = bind(id); return visible(element) ? [summary(id, element)] : []; } catch { return []; } });
      const view = document.defaultView;
      return { sessionId, url: view?.location.href ?? "", viewport: { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0, scrollX: view?.scrollX ?? 0, scrollY: view?.scrollY ?? 0 }, selection: selected, elements, revision: runtime.ledger.cursor };
    },
    async inspectElement(id) {
      const element = bind(id); const base = summary(id, element);
      const parent = runtime.visualModel.parentOf(id);
      const observation: ElementObservation = { ...base, geometry: geometryOf(element, runtime.placement), computedStyle: stylesOf(element),
        capabilities: { move: true, resize: false, rotate: false, style: false, editText: false, create: true, duplicate: false, delete: false, layer: true },
        relationships: { ...(parent ? { parent } : {}), children: runtime.visualModel.childrenOf(id) } };
      return observation;
    },
    async findElements(query) {
      const text = query.text?.trim().toLowerCase(); const role = query.role?.trim().toLowerCase(); const tag = query.tag?.trim().toLowerCase();
      return ids().filter((id) => { try { const element = bind(id); if (query.visibleOnly !== false && !visible(element)) return false;
        if (query.origin && originOf(element) !== query.origin) return false; if (tag && element.tagName.toLowerCase() !== tag) return false;
        const actualRole = element.getAttribute("role") ?? (element.tagName === "BUTTON" ? "button" : "");
        if (role && actualRole.toLowerCase() !== role) return false; return !text || textOf(element).toLowerCase().includes(text); } catch { return false; } });
    },
    async getGeometry(id) { return geometryOf(bind(id), runtime.placement); },
    async getComputedStyles(id) { return stylesOf(bind(id)); },
    async getSessionState() {
      const counts = { host: 0, clone: 0, created: 0 }; for (const id of ids()) { try { counts[originOf(bind(id))] += 1; } catch { /* stale */ } }
      return { sessionId, url: document.defaultView?.location.href ?? "", selection: runtime.selectedNodeIds(), revision: runtime.ledger.cursor,
        persistedRevision: runtime.ledger.persistedRevision, dirty: runtime.ledger.isDirty(), canUndo: runtime.canUndo(), canRedo: runtime.canRedo(), elementCounts: counts };
    },
    async getChanges() { return runtime.ledger.activeOperations().map((operation) => ({ operationId: operation.id, type: operation.type, ...(operation.target.nodeId ? { target: operation.target.nodeId } : {}) })); },
    async execute(operation) { return execute(operation); },
    async checkpoint() { return unsupported("checkpoint"); },
    async rollback() { return unsupported("rollback"); },
    /* eslint-enable @typescript-eslint/require-await */
  };
}
