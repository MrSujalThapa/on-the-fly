import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorShell } from "../../src/content/editor-shell.js";

describe("EditorShell", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.documentElement
      .querySelectorAll("#on-the-fly-root-host")
      .forEach((element) => {
        element.remove();
      });
    vi.restoreAllMocks();
  });

  it("does not create duplicate overlay roots when mounted twice", () => {
    const shell = new EditorShell();

    shell.mount({ onDeactivate: () => undefined });
    shell.mount({ onDeactivate: () => undefined });

    expect(globalThis.document.querySelectorAll("#on-the-fly-root-host")).toHaveLength(1);

    shell.unmount();
  });

  it("removes stale duplicate overlay roots before mounting", () => {
    const first = globalThis.document.createElement("div");
    first.id = "on-the-fly-root-host";
    const second = globalThis.document.createElement("div");
    second.id = "on-the-fly-root-host";
    globalThis.document.documentElement.append(first, second);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });

    expect(globalThis.document.querySelectorAll("#on-the-fly-root-host")).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      "[On the Fly] Removed duplicate overlay root before mounting.",
      { count: 2 },
    );

    shell.unmount();
  });
});
