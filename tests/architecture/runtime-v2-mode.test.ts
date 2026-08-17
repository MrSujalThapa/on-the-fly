import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("runtime-v2 exclusive mode", () => {
  it("uses one content-entry switch and never instantiates legacy orchestration in V2", () => {
    const build = readFileSync(join(ROOT, "scripts/build.mjs"), "utf8");
    expect(build).toContain("OTF_RUNTIME_V2");
    expect(build).toContain("runtime-v2/content-entry.ts");
    expect(build).toContain("content/content-script.ts");
    expect(build).toMatch(/runtimeV2Enabled\s*\?\s*[\s\S]*content-entry\.ts[\s\S]*:\s*[\s\S]*content-script\.ts/);

    const v2Entry = readFileSync(join(ROOT, "src/runtime-v2/content-entry.ts"), "utf8");
    expect(v2Entry).toContain("OTF_RUNTIME_V2_ACTIVE");
    expect(v2Entry).toContain("createEditorRuntime");
    expect(v2Entry).not.toContain("EditSession");
    expect(v2Entry).not.toContain("TransformController");
    expect(v2Entry).not.toContain("DomRuntimeAdapter");
    expect(v2Entry).not.toContain("PageCustomizationController");
    expect(v2Entry).not.toContain("createEditSession");
    expect(v2Entry).not.toContain("EditorShell");

    const legacyEntry = readFileSync(join(ROOT, "src/content/content-script.ts"), "utf8");
    expect(legacyEntry).toContain("createEditSession");
    expect(legacyEntry).not.toContain("runtime-v2");
    expect(legacyEntry).not.toContain("createEditorRuntime");
  });
});
