import type { Page } from "@playwright/test";
import { clearPageOperations, enableEdit, expect, productFailure, test } from "./harness.js";
import { linkedInFilters, requireLinkedInAuth } from "./linkedin.js";

interface EnvCall {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; message?: string };
}

interface EnvMessage {
  channel?: unknown;
  id?: unknown;
  ok?: unknown;
  value?: unknown;
  error?: EnvCall["error"];
}

async function env(page: Page, method: string, ...args: unknown[]): Promise<EnvCall> {
  return page.evaluate(async ([methodName, methodArgs]) => {
    const id = `otf-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    return await new Promise<EnvCall>((resolve) => {
      const onMessage = (event: MessageEvent<EnvMessage>): void => {
        if (event.source !== window || event.data.channel !== "otf-env-result" || event.data.id !== id) return;
        window.removeEventListener("message", onMessage);
        resolve({
          ok: Boolean(event.data.ok),
          ...(event.data.value !== undefined ? { value: event.data.value } : {}),
          ...(event.data.error ? { error: event.data.error } : {}),
        });
      };
      window.addEventListener("message", onMessage);
      window.postMessage({ channel: "otf-env", id, method: methodName, args: methodArgs }, "*");
    });
  }, [method, args] as const);
}

test.describe("OTFEnvironment LinkedIn contract", () => {
  test.beforeEach(async ({ page, context }) => {
    await requireLinkedInAuth(page);
    await clearPageOperations(context, page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await linkedInFilters(page);
    await enableEdit(context, page);
  });

  test("observe, find, execute, and rollback share the live runtime", async ({ page }) => {
    const observed = await env(page, "observe", { scope: "viewport" });
    expect(observed.ok, productFailure(`observe failed: ${observed.error?.message ?? "unknown"}`)).toBe(true);
    const pageObservation = observed.value as { url: string; viewport: { width: number }; selection: string[]; elements: Array<{ id: string }>; revision: number };
    expect(pageObservation.url).toContain("linkedin.com");
    expect(pageObservation.viewport.width).toBeGreaterThan(0);
    expect(pageObservation.elements.some((element) => element.id.startsWith("otf"))).toBe(true);

    let found = await env(page, "findElements", { text: "Mentions", role: "radio", visibleOnly: true });
    if (!found.ok || !(found.value as string[]).length) {
      found = await env(page, "findElements", { text: "Mentions", visibleOnly: true });
    }
    expect(found.ok).toBe(true);
    const mentionIds = found.value as string[];
    expect(mentionIds.length, productFailure("find Mentions returned no ElementId")).toBeGreaterThan(0);
    const mentionId = mentionIds[0];
    expect(mentionId).toBeTruthy();
    if (!mentionId) return;
    const inspected = await env(page, "inspectElement", mentionId);
    expect(inspected.ok).toBe(true);
    const before = (inspected.value as { geometry: { x: number; y: number; width: number; height: number }; origin: string }).geometry;
    expect((inspected.value as { origin: string }).origin).toBe("host");

    const styled = await env(page, "execute", { type: "style", target: mentionId, property: "backgroundColor", value: "rgb(255, 0, 0)" });
    expect(styled.ok, productFailure(`env STYLE failed: ${styled.error?.message ?? "unknown"}`)).toBe(true);

    const checkpoint = await env(page, "checkpoint", "before-env");
    expect(checkpoint.ok).toBe(true);
    const moved = await env(page, "execute", { type: "move", target: mentionId, delta: { x: 36, y: 12 } });
    expect(moved.ok, productFailure(`env MOVE failed: ${moved.error?.message ?? "unknown"}`)).toBe(true);
    const afterMove = await env(page, "getGeometry", mentionId);
    const after = afterMove.value as { x: number; y: number };
    expect(after.x - before.x).toBeGreaterThan(20);
    expect(after.y - before.y).toBeGreaterThan(4);

    const resized = await env(page, "execute", { type: "resize", target: mentionId, size: { width: Math.max(40, before.width + 24), height: Math.max(20, before.height + 10) } });
    expect(resized.ok, productFailure(`env RESIZE failed: ${resized.error?.message ?? "unknown"}`)).toBe(true);
    const layered = await env(page, "execute", { type: "layer", target: mentionId, command: "forward" });
    expect(layered.ok, productFailure(`env LAYER failed: ${layered.error?.message ?? "unknown"}`)).toBe(true);

    const created = await env(page, "execute", { type: "create", kind: "button", rect: { x: 80, y: 80, width: 120, height: 40 } });
    expect(created.ok, productFailure(`env CREATE failed: ${created.error?.message ?? "unknown"}`)).toBe(true);
    const createdId = (created.value as { target?: string }).target;
    expect(createdId).toBeTruthy();
    if (!createdId) return;
    const createdInspect = await env(page, "inspectElement", createdId);
    expect((createdInspect.value as { origin: string }).origin).toBe("created");
    const edited = await env(page, "execute", { type: "text", target: createdId, value: "Env Button" });
    expect(edited.ok, productFailure(`env TEXT failed: ${edited.error?.message ?? "unknown"}`)).toBe(true);

    const deleted = await env(page, "execute", { type: "delete", target: createdId });
    expect(deleted.ok, productFailure(`env DELETE failed: ${deleted.error?.message ?? "unknown"}`)).toBe(true);

    const rolled = await env(page, "rollback", checkpoint.value);
    expect(rolled.ok, productFailure(`rollback failed: ${rolled.error?.message ?? "unknown"}`)).toBe(true);
    const restored = await env(page, "getGeometry", mentionId);
    const restoredBox = restored.value as { x: number; y: number };
    expect(Math.abs(restoredBox.x - before.x)).toBeLessThan(8);

    const continueMove = await env(page, "execute", { type: "move", target: mentionId, delta: { x: 16, y: 0 } });
    expect(continueMove.ok, productFailure("continue editing after rollback failed")).toBe(true);
    const undo = await env(page, "rollback", checkpoint.value);
    expect(undo.ok).toBe(true);
  });
});
