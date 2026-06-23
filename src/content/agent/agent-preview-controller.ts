import type { AgentEditResponse } from "../../shared/agent-contracts.js";
import type { AgentFailureCode } from "../../shared/agent-messages.js";
import type { DomRuntimeAdapter } from "../../editor/dom/dom-runtime-adapter.js";
import { validateAgentOperations } from "../../editor/validation/validate-agent-operation.js";
import { prepareAgentDraftOperations } from "../../editor/agent/normalize-helper-object-operation.js";
import type { OperationBatchSnapshot } from "../../editor/dom/operation-batch-snapshot.js";
import {
  appendPreviewOperations,
  clearPreviewOperations,
  promoteAllDraftToSaved,
  promotePreviewOperationsToDraft,
  type SessionOperationState,
} from "../session-operation-state.js";
import { sendAgentEditRequest } from "./agent-client.js";
import {
  buildAgentEditRequest,
  buildAgentScopeFromContext,
  computeSelectionBoundsFromContext,
  type AgentContextInput,
} from "./context-builder.js";
import type { AgentEditProxyFailure, AgentEditProxyResult } from "../../shared/agent-messages.js";
import { runVisualSanityCritic } from "./visual-sanity-critic.js";

export interface AgentPreviewState {
  status: "idle" | "loading" | "preview" | "error";
  failureCode?: AgentFailureCode;
  summary: string[];
  warnings: string[];
  criticWarnings: string[];
  validationErrors: string[];
  lastInstruction: string;
  requestId?: string;
}

export interface AgentPreviewControllerOptions {
  adapter: DomRuntimeAdapter;
  getContextInput: (instruction: string) => AgentContextInput | null;
  getOperationState: () => SessionOperationState;
  setOperationState: (state: SessionOperationState) => void;
  syncSavedOperationsToStorage: () => Promise<void>;
  onStateChange?: (state: AgentPreviewState) => void;
  onDebug?: (message: string, data?: unknown) => void;
}

export class AgentPreviewController {
  private readonly adapter: DomRuntimeAdapter;
  private readonly getContextInput: (instruction: string) => AgentContextInput | null;
  private readonly getOperationState: () => SessionOperationState;
  private readonly setOperationState: (state: SessionOperationState) => void;
  private readonly syncSavedOperationsToStorage: () => Promise<void>;
  private readonly onStateChange: (state: AgentPreviewState) => void;
  private readonly onDebug: (message: string, data?: unknown) => void;
  private previewSnapshot: OperationBatchSnapshot | null = null;
  private previewState: AgentPreviewState = createIdlePreviewState();

  constructor(options: AgentPreviewControllerOptions) {
    this.adapter = options.adapter;
    this.getContextInput = options.getContextInput;
    this.getOperationState = options.getOperationState;
    this.setOperationState = options.setOperationState;
    this.syncSavedOperationsToStorage = options.syncSavedOperationsToStorage;
    this.onStateChange = options.onStateChange ?? (() => undefined);
    this.onDebug = options.onDebug ?? (() => undefined);
  }

  getState(): AgentPreviewState {
    return this.previewState;
  }

  hasActivePreview(): boolean {
    return this.getOperationState().previewOperations.length > 0;
  }

  async requestPreview(instruction: string): Promise<boolean> {
    const context = this.getContextInput(instruction);
    if (!context) {
      this.setPreviewState({
        status: "error",
        summary: [],
        warnings: [],
        criticWarnings: [],
        validationErrors: ["Select at least one visual element before requesting an agent preview."],
        lastInstruction: instruction,
      });
      return false;
    }

    this.setPreviewState({
      status: "loading",
      summary: [],
      warnings: [],
      criticWarnings: [],
      validationErrors: [],
      lastInstruction: instruction,
    });

    const request = buildAgentEditRequest(context);
    const startedAt = Date.now();
    const proxyResult = await sendAgentEditRequest(request);
    if (!proxyResult.ok) {
      this.logRequestDiagnostics(proxyResult, startedAt, "failed");
      this.setPreviewState({
        status: "error",
        failureCode: proxyResult.code,
        summary: proxyResult.summary ?? [],
        warnings: proxyResult.warnings ?? [],
        criticWarnings: [],
        validationErrors: buildProxyFailureMessages(proxyResult),
        lastInstruction: instruction,
        ...(proxyResult.requestId ? { requestId: proxyResult.requestId } : {}),
      });
      this.onDebug("agent-preview-request-failed", sanitizeDiagnostics(proxyResult));
      return false;
    }

    this.logRequestDiagnostics(proxyResult, startedAt, "ok");
    return this.applyValidatedPreview(proxyResult.response, instruction, context, proxyResult.requestId);
  }

  async refinePreview(instruction: string): Promise<boolean> {
    this.rejectPreview();
    return this.requestPreview(instruction);
  }

  rejectPreview(): void {
    this.revertPreviewEffects();
    this.setOperationState(clearPreviewOperations(this.getOperationState()));
    this.previewSnapshot = null;
    this.setPreviewState(createIdlePreviewState());
    this.onDebug("agent-preview-rejected");
  }

  async approvePreview(): Promise<boolean> {
    const current = this.getOperationState();
    if (current.previewOperations.length === 0) {
      return false;
    }

    let nextState = promotePreviewOperationsToDraft(current);
    nextState = promoteAllDraftToSaved(nextState);
    this.setOperationState(nextState);
    this.previewSnapshot = null;
    await this.syncSavedOperationsToStorage();

    this.setPreviewState({
      status: "idle",
      summary: ["Preview approved and saved locally."],
      warnings: [],
      criticWarnings: [],
      validationErrors: [],
      lastInstruction: this.previewState.lastInstruction,
    });
    this.onDebug("agent-preview-approved", {
      savedCount: nextState.savedOperations.length,
    });
    return true;
  }

  private applyValidatedPreview(
    response: AgentEditResponse,
    instruction: string,
    context: AgentContextInput,
    requestId?: string,
  ): boolean {
    const scope = buildAgentScopeFromContext(context);
    const request = buildAgentEditRequest(context);
    const prepared = prepareAgentDraftOperations(response.draftOperations, request);
    if (!prepared.ok) {
      this.setPreviewState({
        status: "error",
        failureCode: "validation_failed",
        summary: response.summary,
        warnings: response.warnings,
        criticWarnings: [],
        validationErrors: prepared.errors,
        lastInstruction: instruction,
        ...(requestId ? { requestId } : {}),
      });
      this.onDebug("agent-preview-validation-failed", {
        requestId,
        validationStatus: "failed",
        errorCount: prepared.errors.length,
      });
      return false;
    }

    const validation = validateAgentOperations(prepared.operations, scope);
    if (!validation.ok) {
      this.setPreviewState({
        status: "error",
        failureCode: "validation_failed",
        summary: response.summary,
        warnings: response.warnings,
        criticWarnings: [],
        validationErrors: validation.errors,
        lastInstruction: instruction,
        ...(requestId ? { requestId } : {}),
      });
      this.onDebug("agent-preview-validation-failed", {
        requestId,
        validationStatus: "failed",
        errorCount: validation.errors.length,
      });
      return false;
    }

    const operations = validation.operations.map((operation) => ({
      ...operation,
      status: "preview" as const,
      source: "agent" as const,
    }));

    if (operations.length === 0) {
      this.setPreviewState({
        status: "error",
        summary: response.summary,
        warnings: response.warnings,
        criticWarnings: [],
        validationErrors: ["Agent returned no preview operations."],
        lastInstruction: instruction,
      });
      return false;
    }

    this.revertPreviewEffects();
    this.setOperationState(clearPreviewOperations(this.getOperationState()));

    const results = this.adapter.replayOperations(operations);
    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      for (const operation of operations) {
        this.adapter.revertOperation(operation);
      }
      this.setPreviewState({
        status: "error",
        summary: response.summary,
        warnings: response.warnings,
        criticWarnings: [],
        validationErrors: failed.map((result) => result.error),
        lastInstruction: instruction,
      });
      return false;
    }

    const document = resolveDocumentFromContext(context);
    const critic = runVisualSanityCritic({
      document,
      operations,
      selectionBounds: computeSelectionBoundsFromContext(context),
      selectedElements: context.selectedNodes
        .map((node) => node.element)
        .filter((element): element is HTMLElement => element instanceof HTMLElement),
      viewport: readViewport(document),
    });

    if (critic.hardFailures.length > 0) {
      for (const operation of operations) {
        this.adapter.revertOperation(operation);
      }
      this.setPreviewState({
        status: "error",
        failureCode: "critic_failed",
        summary: response.summary,
        warnings: response.warnings,
        criticWarnings: critic.warnings,
        validationErrors: critic.hardFailures,
        lastInstruction: instruction,
        ...(requestId ? { requestId } : {}),
      });
      this.onDebug("agent-preview-critic-failed", {
        requestId,
        validationStatus: "critic_failed",
        hardFailureCount: critic.hardFailures.length,
        warningCount: critic.warnings.length,
      });
      return false;
    }

    this.previewSnapshot = this.adapter.buildBatchSnapshot(operations);

    this.setOperationState(appendPreviewOperations(this.getOperationState(), operations));
    this.setPreviewState({
      status: "preview",
      summary: response.summary,
      warnings: response.warnings,
      criticWarnings: critic.warnings,
      validationErrors: [],
      lastInstruction: instruction,
      ...(requestId ? { requestId } : {}),
    });
    this.onDebug("agent-preview-applied", {
      requestId,
      validationStatus: "ok",
      count: operations.length,
      criticWarningCount: critic.warnings.length,
    });
    return true;
  }

  private revertPreviewEffects(): void {
    const previewOperations = this.getOperationState().previewOperations;
    if (this.previewSnapshot) {
      this.adapter.restoreBatchSnapshot(this.previewSnapshot, "before");
      this.previewSnapshot = null;
      return;
    }

    for (const operation of [...previewOperations].reverse()) {
      this.adapter.revertOperation(operation);
    }
  }

  private setPreviewState(state: AgentPreviewState): void {
    this.previewState = state;
    this.onStateChange(state);
  }

  private logRequestDiagnostics(
    result: AgentEditProxyResult,
    startedAt: number,
    validationStatus: "ok" | "failed",
  ): void {
    const latencyMs = Date.now() - startedAt;
    this.onDebug("agent-request-diagnostics", sanitizeDiagnostics(result, {
      latencyMs,
      validationStatus,
    }));
  }
}

function createIdlePreviewState(): AgentPreviewState {
  return {
    status: "idle",
    summary: [],
    warnings: [],
    criticWarnings: [],
    validationErrors: [],
    lastInstruction: "",
  };
}

function buildProxyFailureMessages(result: AgentEditProxyFailure): string[] {
  const messages = [result.error];
  if (result.details && result.details.length > 0) {
    messages.push(...result.details);
  }
  return messages;
}

function readViewport(document: Document): { width: number; height: number } {
  const view = document.defaultView;
  return {
    width: document.documentElement.clientWidth || view?.innerWidth || 1280,
    height: document.documentElement.clientHeight || view?.innerHeight || 720,
  };
}

function resolveDocumentFromContext(context: AgentContextInput): Document {
  for (const node of context.selectedNodes) {
    if (node.element?.ownerDocument) {
      return node.element.ownerDocument;
    }
  }
  if (typeof document !== "undefined") {
    return document;
  }
  throw new Error("document_unavailable");
}

function sanitizeDiagnostics(
  result: AgentEditProxyResult,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  if (!result.ok) {
    return {
      requestId: result.requestId,
      code: result.code,
      ...extra,
    };
  }

  return {
    requestId: result.requestId,
    mode: result.mode,
    repairAttempted: result.repairAttempted ?? false,
    contextBudget: result.contextBudget,
    ...extra,
  };
}
