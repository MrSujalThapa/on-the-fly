import type { EditorOperation } from "../../editor/operations.js";
import type { ElementId, OTFChange } from "./environment-types.js";

export function changeFromOperation(operation: EditorOperation): OTFChange | null {
  const target = operation.target.nodeId;
  if (operation.type === "createElement") {
    return { type: "create", target: operation.payload.elementId, kind: operation.payload.kind };
  }
  if (operation.type === "duplicate") {
    return { type: "duplicate", target: operation.payload.cloneId };
  }
  if (!target) return null;
  const id: ElementId = target;
  switch (operation.type) {
    case "move":
      return { type: "move", target: id, delta: { x: operation.payload.dx, y: operation.payload.dy } };
    case "resize":
      return { type: "resize", target: id, size: { width: operation.payload.width, height: operation.payload.height } };
    case "rotate":
      return { type: "rotate", target: id, degrees: operation.payload.degrees };
    case "zIndex":
      return { type: "layer", target: id, layer: operation.payload.layer };
    case "style":
      return { type: "style", target: id, property: operation.payload.property, value: operation.payload.value };
    case "text":
      return { type: "text", target: id, value: operation.payload.value };
    case "crop":
      return { type: "crop", target: id };
    case "hide":
      return operation.payload.hidden ? { type: "delete", target: id } : null;
    default:
      return { type: "other", target: id, operationType: operation.type };
  }
}
