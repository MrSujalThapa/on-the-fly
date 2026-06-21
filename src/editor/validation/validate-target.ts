import { hasEditorTargetReference, type EditorTarget } from "../editor-target.js";
import { validateElementSignature, createValidationFailure, createValidationSuccess, type ValidationResult } from "./validate-signature.js";

export function validateEditorTarget(target: EditorTarget): ValidationResult {
  if (!hasEditorTargetReference(target)) {
    return createValidationFailure(["target must include nodeId, groupId, or signature"]);
  }

  if (target.signature) {
    const signatureResult = validateElementSignature(target.signature);
    if (!signatureResult.ok) {
      return createValidationFailure(signatureResult.errors.map((error) => `target.${error}`));
    }
  }

  return createValidationSuccess();
}
