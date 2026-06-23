import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPreviewController, type AgentPreviewState } from "../../../src/content/agent/agent-preview-controller.js";
import { DomRuntimeAdapter } from "../../../src/editor/dom/dom-runtime-adapter.js";
import {
  appendPreviewOperations,
  createSessionOperationState,
  type SessionOperationState,
} from "../../../src/content/session-operation-state.js";
import { createTestDocument } from "../../editor/dom/test-document.js";
import {
  createInsertHelperObjectOperation,
  createStyleOperation,
  PAGE_KEY,
} from "../../editor/fixtures.js";
import type { AgentEditRequest, AgentEditResponse } from "../../../src/shared/agent-contracts.js";
import type { AgentEditProxyResult } from "../../../src/shared/agent-messages.js";
import type { AgentLatencyStages } from "../../../src/shared/agent-latency.js";
import type { AgentContextInput } from "../../../src/content/agent/context-builder.js";
import { OTF_HELPER_ATTR } from "../../../src/editor/dom/types.js";
import { VisualLayoutGraph } from "../../../src/editor/visual-graph/visual-layout-graph.js";
import { createTestSignature } from "../../editor/fixtures.js";
import { clearAgentSessionCache } from "../../../src/content/agent/agent-session-cache.js";

function createGraph(nodes: Array<{
  id: string;
  kind: "text";
  signature: ReturnType<typeof createTestSignature>;
  rect: { x: number; y: number; width: number; height: number };
  computed: Record<string, never>;
  childIds: string[];
  element: HTMLElement;
}>): VisualLayoutGraph {
  return new VisualLayoutGraph({
    nodes: new Map(nodes.map((node) => [node.id, node])),
    rootNodeIds: nodes.map((node) => node.id),
    viewport: { width: 1280, height: 720 },
    builtAt: 1,
    version: 1,
  });
}

const { sendAgentEditRequestMock } = vi.hoisted(() => ({
  sendAgentEditRequestMock: vi.fn<
    (request: AgentEditRequest) => Promise<AgentEditProxyResult>
  >(),
}));

vi.mock("../../../src/content/agent/agent-client.js", () => ({
  sendAgentEditRequest: sendAgentEditRequestMock,
}));

function createMockResponse(
  operations: AgentEditResponse["draftOperations"],
): AgentEditResponse {
  return {
    draftOperations: operations,
    summary: ["Mock preview"],
    warnings: [],
    confidence: "high",
  };
}

describe("AgentPreviewController", () => {
  let documentRef: Document;
  let adapter: DomRuntimeAdapter;
  let operationState: SessionOperationState;
  let syncSaved: ReturnType<typeof vi.fn>;
  let controller: AgentPreviewController;
  let contextInput: AgentContextInput;

  beforeEach(() => {
    sendAgentEditRequestMock.mockReset();
    clearAgentSessionCache();
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    documentRef = document;
    adapter = new DomRuntimeAdapter(document);
    operationState = createSessionOperationState([
      createStyleOperation({ id: "saved-1", status: "approved" }),
    ]);
    syncSaved = vi.fn(() => Promise.resolve());

    const copy = root.querySelector("#copy") as HTMLElement;
    contextInput = {
      pageKey: PAGE_KEY,
      instruction: "Add background panel",
      selection: { selectedNodeIds: ["node-1"], source: "click" },
      selectedNodes: [
        {
          id: "node-1",
          kind: "text",
          signature: createTestSignature({
            cssPath: "main p#copy",
            tagName: "p",
            idAttr: "copy",
          }),
          rect: { x: 0, y: 0, width: 100, height: 24 },
          computed: {},
          childIds: [],
          element: copy,
        },
      ],
      graph: createGraph([]),
      existingOperations: operationState.savedOperations,
    };

    controller = new AgentPreviewController({
      adapter,
      getContextInput: () => contextInput,
      getOperationState: () => operationState,
      setOperationState: (state) => {
        operationState = state;
      },
      syncSavedOperationsToStorage: syncSaved,
    });
  });

  it("applies preview operations without saving", async () => {
    const previewOp = createInsertHelperObjectOperation({
      id: "preview-helper",
      source: "agent",
      status: "preview",
      payload: {
        ...createInsertHelperObjectOperation().payload,
        rect: { x: 0, y: 0, width: 140, height: 80 },
        zIndex: 1,
      },
    });
    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: createMockResponse([previewOp]),
    });

    const applied = await controller.requestPreview("Add background panel");
    expect(applied).toBe(true);
    expect(operationState.previewOperations.map((operation) => operation.id)).toEqual([
      "preview-helper",
    ]);
    expect(operationState.savedOperations.map((operation) => operation.id)).toEqual(["saved-1"]);
    expect(syncSaved).not.toHaveBeenCalled();
    expect(documentRef.querySelector(`[${OTF_HELPER_ATTR}]`)).not.toBeNull();
  });

  it("reverts preview on reject", async () => {
    const previewOp = createInsertHelperObjectOperation({
      id: "preview-helper",
      source: "agent",
      status: "preview",
      payload: {
        ...createInsertHelperObjectOperation().payload,
        rect: { x: 0, y: 0, width: 140, height: 80 },
        zIndex: 1,
      },
    });
    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: createMockResponse([previewOp]),
    });

    await controller.requestPreview("Add background panel");
    expect(documentRef.querySelector(`[${OTF_HELPER_ATTR}]`)).not.toBeNull();

    controller.rejectPreview();

    expect(operationState.previewOperations).toHaveLength(0);
    expect(documentRef.querySelector(`[${OTF_HELPER_ATTR}]`)).toBeNull();
  });

  it("saves only approved preview operations", async () => {
    const previewOp = createInsertHelperObjectOperation({
      id: "preview-helper",
      source: "agent",
      status: "preview",
      payload: {
        ...createInsertHelperObjectOperation().payload,
        rect: { x: 0, y: 0, width: 140, height: 80 },
        zIndex: 1,
      },
    });
    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: createMockResponse([previewOp]),
    });

    await controller.requestPreview("Add background panel");
    const approved = await controller.approvePreview();

    expect(approved).toBe(true);
    expect(operationState.previewOperations).toHaveLength(0);
    expect(operationState.savedOperations.map((operation) => operation.id)).toEqual([
      "saved-1",
      "preview-helper",
    ]);
    expect(operationState.savedOperations.every((operation) => operation.status === "approved")).toBe(
      true,
    );
    expect(syncSaved).toHaveBeenCalledTimes(1);
  });

  it("clears previous preview before refine", async () => {
    const firstOp = createInsertHelperObjectOperation({
      id: "preview-helper-1",
      payload: {
        ...createInsertHelperObjectOperation().payload,
        helperId: "helper-1",
      },
      target: {
        nodeId: "helper-1",
        signature: createTestSignature({
          cssPath: "#otf-helper-helper-1",
          idAttr: "otf-helper-helper-1",
        }),
      },
      source: "agent",
      status: "preview",
    });
    const secondOp = createInsertHelperObjectOperation({
      id: "preview-helper-2",
      payload: {
        ...createInsertHelperObjectOperation().payload,
        helperId: "helper-2",
      },
      target: {
        nodeId: "helper-2",
        signature: createTestSignature({
          cssPath: "#otf-helper-helper-2",
          idAttr: "otf-helper-helper-2",
        }),
      },
      source: "agent",
      status: "preview",
    });

    sendAgentEditRequestMock
      .mockResolvedValueOnce({ ok: true, response: createMockResponse([firstOp]) })
      .mockResolvedValueOnce({ ok: true, response: createMockResponse([secondOp]) });

    await controller.requestPreview("First preview");
    expect(documentRef.querySelector('[data-otf-helper-id="helper-1"]')).not.toBeNull();

    await controller.refinePreview("Second preview");

    expect(documentRef.querySelector('[data-otf-helper-id="helper-1"]')).toBeNull();
    expect(documentRef.querySelector('[data-otf-helper-id="helper-2"]')).not.toBeNull();
    expect(operationState.previewOperations.map((operation) => operation.id)).toEqual([
      "preview-helper-2",
    ]);
  });

  it("rejects invalid agent output", async () => {
    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: createMockResponse([
        createStyleOperation({
          id: "invalid-agent-op",
          source: "manual",
          status: "approved",
        }),
      ]),
    });

    const applied = await controller.requestPreview("Invalid output");
    expect(applied).toBe(false);
    expect(operationState.previewOperations).toHaveLength(0);
    expect(controller.getState().validationErrors.length).toBeGreaterThan(0);
  });

  it("does not leave stale preview state when validation fails after DOM apply", async () => {
    operationState = appendPreviewOperations(operationState, [
      createInsertHelperObjectOperation({ id: "stale-preview", source: "agent", status: "preview" }),
    ]);

    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: createMockResponse([
        {
          ...createInsertHelperObjectOperation({
            id: "broken-preview",
            source: "agent",
            status: "preview",
          }),
          payload: {
            ...createInsertHelperObjectOperation().payload,
            rect: { x: 0, y: 0, width: -10, height: 10 },
          },
        },
      ]),
    });

    const applied = await controller.requestPreview("Broken geometry");
    expect(applied).toBe(false);
    expect(operationState.previewOperations.map((operation) => operation.id)).toEqual([
      "stale-preview",
    ]);
  });

  it("keeps preview state unchanged when generation fails", async () => {
    operationState = appendPreviewOperations(operationState, [
      createInsertHelperObjectOperation({ id: "existing-preview", source: "agent", status: "preview" }),
    ]);

    sendAgentEditRequestMock.mockResolvedValue({
      ok: false,
      code: "generation_failed",
      error: "provider_down",
    });

    const applied = await controller.requestPreview("Make premium");
    expect(applied).toBe(false);
    expect(operationState.previewOperations.map((operation) => operation.id)).toEqual([
      "existing-preview",
    ]);
    expect(controller.getState().failureCode).toBe("generation_failed");
  });

  it("shows manual tool recommendation without applying preview operations", async () => {
    sendAgentEditRequestMock.mockResolvedValue({
      ok: false,
      code: "manual_tool_recommended",
      error: "Use the style toolbar to change text color.",
      summary: ["Use the style toolbar to change text color."],
      warnings: [],
    });

    const applied = await controller.requestPreview("make text red");
    expect(applied).toBe(false);
    expect(operationState.previewOperations).toHaveLength(0);
    expect(controller.getState().failureCode).toBe("manual_tool_recommended");
    expect(controller.getState().summary[0]).toContain("style toolbar");
  });

  it("blocks preview when critic reports a hard safety failure", async () => {
    const dangerousOp = createInsertHelperObjectOperation({
      id: "dangerous-helper",
      source: "agent",
      status: "preview",
      payload: {
        ...createInsertHelperObjectOperation().payload,
        helperId: "dangerous-helper",
        rect: { x: -8450, y: 0, width: 17000, height: 100 },
        zIndex: 2,
      },
    });

    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: createMockResponse([dangerousOp]),
    });

    const applied = await controller.requestPreview("Add broken panel");
    expect(applied).toBe(false);
    expect(operationState.previewOperations).toHaveLength(0);
    expect(documentRef.querySelector(`[${OTF_HELPER_ATTR}]`)).toBeNull();
    expect(controller.getState().failureCode).toBe("critic_failed");
  });

  it("allows approve when preview has non-blocking critic warnings", async () => {
    const warningOp = createInsertHelperObjectOperation({
      id: "warning-helper",
      source: "agent",
      status: "preview",
      payload: {
        ...createInsertHelperObjectOperation().payload,
        helperId: "warning-helper",
        rect: { x: 0, y: 0, width: 140, height: 80 },
        zIndex: 1500,
        boxShadow: {
          offsetX: 0,
          offsetY: 0,
          blurRadius: 120,
          spreadRadius: 0,
          color: "rgba(0, 0, 0, 0.35)",
        },
      },
    });

    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: createMockResponse([warningOp]),
    });

    const applied = await controller.requestPreview("Add elevated panel");
    expect(applied).toBe(true);
    expect(controller.getState().criticWarnings.length).toBeGreaterThan(0);

    const approved = await controller.approvePreview();
    expect(approved).toBe(true);
    expect(operationState.savedOperations.map((operation) => operation.id)).toContain(
      "warning-helper",
    );
  });

  it("normalizes helper operations missing targets before preview apply", async () => {
    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: {
        draftOperations: [
          {
            type: "insertHelperObject",
            payload: {
              role: "backgroundPanel",
              fill: {
                type: "linearGradient",
                angleDeg: 135,
                stops: [
                  { color: "#ffffff", position: 0 },
                  { color: "#eef2ff", position: 100 },
                ],
              },
              borderRadius: "18px",
              opacity: 0.95,
              zIndex: 1,
            },
          },
        ],
        summary: ["Added gradient panel."],
        warnings: [],
        confidence: "high",
      } as unknown as AgentEditResponse,
    });

    const applied = await controller.requestPreview("add a subtle gradient panel behind this");
    expect(applied).toBe(true);
    expect(operationState.previewOperations).toHaveLength(1);
    expect(documentRef.querySelector(`[${OTF_HELPER_ATTR}]`)).not.toBeNull();
  });

  it("records latency stage diagnostics on successful preview", async () => {
    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: createMockResponse([
        createInsertHelperObjectOperation({ source: "agent", status: "preview" }),
      ]),
      latencyStages: { openAiCallMs: 900, compileMs: 4, validationMs: 2, serverTotalMs: 950 },
    });

    await controller.requestPreview("Add background panel");
    const state = controller.getState();
    expect(state.latencyStages?.contextBuildMs).toBeGreaterThanOrEqual(0);
    expect(state.latencyStages?.serverRequestMs).toBeGreaterThanOrEqual(0);
    expect(state.latencyStages?.openAiCallMs).toBe(900);
    expect(state.latencyStages?.previewApplyMs).toBeGreaterThanOrEqual(0);
    expect(state.latencyStages?.totalMs).toBeGreaterThanOrEqual(0);
    expect(state.latencyStages?.bottleneck).toBeDefined();
  });

  it("shows still generating hint after slow request exceeds 8 seconds", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred<AgentEditProxyResult>();
    sendAgentEditRequestMock.mockReturnValue(deferred.promise);

    const onStateChange = vi.fn();
    controller = new AgentPreviewController({
      adapter,
      getContextInput: () => contextInput,
      getOperationState: () => operationState,
      setOperationState: (state) => {
        operationState = state;
      },
      syncSavedOperationsToStorage: syncSaved,
      onStateChange,
    });

    const pending = controller.requestPreview("slow request");
    expect(controller.getState().loadingSlowHint).toBe(false);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(controller.getState().loadingSlowHint).toBe(true);
    expect(onStateChange.mock.calls.some(
      (call: [AgentPreviewState]) => call[0].loadingSlowHint === true,
    )).toBe(true);

    deferred.resolve({
      ok: true,
      response: createMockResponse([
        createInsertHelperObjectOperation({ source: "agent", status: "preview" }),
      ]),
    });

    await pending;
    vi.useRealTimers();
  });

  it("does not mutate DOM when request times out", async () => {
    sendAgentEditRequestMock.mockResolvedValue({
      ok: false,
      code: "timeout",
      error: "OpenAI request timed out after 25000ms",
    });

    const applied = await controller.requestPreview("slow timeout");
    expect(applied).toBe(false);
    expect(operationState.previewOperations).toHaveLength(0);
    expect(documentRef.querySelector(`[${OTF_HELPER_ATTR}]`)).toBeNull();
    expect(controller.getState().failureCode).toBe("timeout");
  });

  it("logs latency breakdown identifying OpenAI as bottleneck", async () => {
    const onDebug = vi.fn();
    controller = new AgentPreviewController({
      adapter,
      getContextInput: () => contextInput,
      getOperationState: () => operationState,
      setOperationState: (state) => {
        operationState = state;
      },
      syncSavedOperationsToStorage: syncSaved,
      onDebug,
    });

    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: createMockResponse([
        createInsertHelperObjectOperation({ source: "agent", status: "preview" }),
      ]),
      latencyStages: { openAiCallMs: 15_000, compileMs: 3, validationMs: 2, serverTotalMs: 15_010 },
    });

    await controller.requestPreview("Add background panel");

    const breakdownCall = onDebug.mock.calls.find((call) => call[0] === "agent-latency-breakdown");
    expect(breakdownCall).toBeDefined();
    const breakdown = breakdownCall?.[1] as AgentLatencyStages | undefined;
    expect(breakdown?.bottleneck).toBe("openai");
    expect(breakdown?.openAiCallMs).toBe(15_000);
  });

  it("skips duplicate server calls for same scope and instruction in session", async () => {
    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: createMockResponse([
        createInsertHelperObjectOperation({ id: "cached-preview", source: "agent", status: "preview" }),
      ]),
    });

    await controller.requestPreview("Add background panel");
    controller.rejectPreview();
    await controller.requestPreview("Add background panel");

    expect(sendAgentEditRequestMock).toHaveBeenCalledTimes(1);
    expect(operationState.previewOperations[0]?.id).toBe("cached-preview");
  });

  it("ignores stale responses after cancel", async () => {
    let resolveRequest: ((value: AgentEditProxyResult) => void) | undefined;
    sendAgentEditRequestMock.mockImplementation(
      () =>
        new Promise<AgentEditProxyResult>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const pending = controller.requestPreview("slow request");
    controller.cancelPendingRequest();

    resolveRequest?.({
      ok: true,
      response: createMockResponse([
        createInsertHelperObjectOperation({ source: "agent", status: "preview" }),
      ]),
    });

    const applied = await pending;
    expect(applied).toBe(false);
    expect(operationState.previewOperations).toHaveLength(0);
  });

  it("applies preview to captured scope after live selection changes", async () => {
    const deferred = createDeferred<AgentEditProxyResult>();
    sendAgentEditRequestMock.mockReturnValue(deferred.promise);

    const originalNode = contextInput.selectedNodes[0]?.element as HTMLElement;
    const pending = controller.requestPreview("Add background panel");
    void originalNode;

    contextInput = {
      ...contextInput,
      selection: { selectedNodeIds: ["other-node"], source: "click" },
      selectedNodes: [
        {
          ...contextInput.selectedNodes[0] as AgentContextInput["selectedNodes"][number],
          id: "other-node",
          element: documentRef.createElement("span"),
        },
      ],
    };

    deferred.resolve({
      ok: true,
      response: createMockResponse([
        createInsertHelperObjectOperation({
          source: "agent",
          status: "preview",
          target: createInsertHelperObjectOperation().target,
        }),
      ]),
    });

    const applied = await pending;
    expect(applied).toBe(true);
    expect(operationState.previewOperations.some((op) => op.target.nodeId === "helper-panel-1")).toBe(true);
  });

  it("replaces pending same-scope request instead of running two previews", async () => {
    const first = createDeferred<AgentEditProxyResult>();
    const second = createDeferred<AgentEditProxyResult>();
    sendAgentEditRequestMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const firstPending = controller.requestPreview("first");
    const secondPending = controller.requestPreview("second");

    first.resolve({
      ok: true,
      response: createMockResponse([
        createInsertHelperObjectOperation({ id: "stale", source: "agent", status: "preview" }),
      ]),
    });
    second.resolve({
      ok: true,
      response: createMockResponse([
        createInsertHelperObjectOperation({ id: "fresh", source: "agent", status: "preview" }),
      ]),
    });

    const firstApplied = await firstPending;
    const secondApplied = await secondPending;
    expect(firstApplied).toBe(false);
    expect(secondApplied).toBe(true);
    expect(operationState.previewOperations[0]?.id).toBe("fresh");
  });
});

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
