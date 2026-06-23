import type { AgentOperationValidationResult } from "../../shared/agent-contracts.js";
import type { ElementSignature } from "../element-signature.js";
import type { EditorOperation, EditorOperationType } from "../operations.js";
import { isDangerousCssPath, isDangerousTagName } from "./dangerous-selectors.js";
import {
  type AgentScopeContext,
  validateAgentOperationsScope,
} from "./validate-agent-scope.js";
import { validateUnknownOperation } from "./validate-unknown-operation.js";
import type { ValidationErrorCode } from "./validation-codes.js";

const AGENT_OPERATION_TYPES: ReadonlySet<EditorOperationType> = new Set([
  "style",
  "text",
  "move",
  "resize",
  "rotate",
  "crop",
  "hide",
  "zIndex",
  "group",
  "ungroup",
  "insertImage",
  "insertHelperObject",
]);

function validateAgentSafeOperation(operation: EditorOperation): {
  errors: string[];
  codes: ValidationErrorCode[];
} {
  const errors: string[] = [];
  const codes: ValidationErrorCode[] = [];

  if (!AGENT_OPERATION_TYPES.has(operation.type)) {
    errors.push(`agent operation type is not allowed: ${operation.type}`);
    codes.push(operation.type === "duplicate" ? "unsupported_dom_operation" : "unknown_type");
  }

  if (operation.source !== "agent") {
    errors.push("agent operation source must be agent");
    codes.push("invalid_source");
  }

  if (operation.status !== "draft" && operation.status !== "preview") {
    errors.push("agent operation status must be draft or preview");
    codes.push("invalid_status");
  }

  const dangerous = findDangerousSignatures(operation);
  if (dangerous.length > 0) {
    errors.push(...dangerous);
    codes.push("dangerous_selector");
  }

  return { errors, codes };
}

function findDangerousSignatures(operation: EditorOperation): string[] {
  const signatures: ElementSignature[] = [];
  if (operation.target.signature) {
    signatures.push(operation.target.signature);
  }

  if (operation.type === "group") {
    signatures.push(...operation.payload.memberSignatures);
  }

  return signatures
    .filter((signature) =>
      isDangerousCssPath(signature.cssPath) || isDangerousTagName(signature.tagName),
    )
    .map((signature) => `agent operation targets unsafe selector: ${signature.cssPath}`);
}

export function validateAgentOperation(value: unknown): AgentOperationValidationResult {
  const base = validateUnknownOperation(value);
  if (!base.ok) {
    return base;
  }

  const agentSafe = validateAgentSafeOperation(base.operation);
  if (agentSafe.errors.length > 0) {
    return {
      ok: false,
      errors: agentSafe.errors,
      codes: [...new Set(agentSafe.codes)],
    };
  }

  return { ok: true, operations: [base.operation] };
}

export function validateAgentOperations(
  values: unknown[],
  scope?: AgentScopeContext,
): AgentOperationValidationResult {
  const operations: EditorOperation[] = [];
  const errors: string[] = [];
  const codes: ValidationErrorCode[] = [];

  values.forEach((value, index) => {
    const result = validateAgentOperation(value);
    if (result.ok) {
      operations.push(...result.operations);
      return;
    }

    errors.push(...result.errors.map((error) => `operations[${String(index)}].${error}`));
    codes.push(...result.codes);
  });

  if (errors.length > 0) {
    return { ok: false, errors, codes: [...new Set(codes)] };
  }

  if (scope) {
    const scopeErrors = validateAgentOperationsScope(operations, scope);
    if (scopeErrors.length > 0) {
      const scopeCodes: ValidationErrorCode[] = [...codes, "out_of_scope"];
      return {
        ok: false,
        errors: scopeErrors,
        codes: [...new Set(scopeCodes)],
      };
    }
  }

  return { ok: true, operations };
}

export { AGENT_OPERATION_TYPES };
