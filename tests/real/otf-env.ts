import type { Page } from "@playwright/test";

export interface EnvCall {
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

export async function env(page: Page, method: string, ...args: unknown[]): Promise<EnvCall> {
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

export function envValue(call: EnvCall, label: string): unknown {
  if (!call.ok) throw new Error(`${label}: ${call.error?.message ?? "bridge failed"}`);
  return call.value;
}

export function requireExecute(call: EnvCall, label: string): { ok: boolean; target?: string } {
  const value = envValue(call, label) as { ok?: boolean; target?: string; error?: { message?: string } };
  if (value.ok === false) throw new Error(`${label}: ${value.error?.message ?? "execute failed"}`);
  return { ok: true, ...(value.target ? { target: value.target } : {}) };
}
