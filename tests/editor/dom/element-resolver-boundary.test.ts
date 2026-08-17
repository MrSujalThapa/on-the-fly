import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(process.cwd(), "src");

const ALLOWED_SIGNATURE_MATCHER_IMPORTERS = new Set([
  path.normalize("editor/dom/element-resolver.ts"),
  path.normalize("editor/dom/signature-matcher.ts"),
  path.normalize("editor/index.ts"),
  // getMatchViewport / summarizeElementSignature re-exports — not identity resolution
  path.normalize("editor/visual-graph/geometry-cache.ts"),
  path.normalize("editor/save-window/operation-metadata.ts"),
  path.normalize("editor/duplicate/duplicate-element.ts"),
  path.normalize("editor/selection/rectangle-sampling.ts"),
  path.normalize("editor/measurement/scan-guards.ts"),
  path.normalize("editor/measurement/dom-scanner.ts"),
  path.normalize("editor/measurement/visual-node-builder.ts"),
  path.normalize("editor/dom/dom-runtime-adapter.ts"),
]);

function walkTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkTsFiles(full));
      continue;
    }
    if (full.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("element resolution architecture guard", () => {
  it("limits direct signature-matcher imports outside ElementResolver internals", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC_ROOT)) {
      const relative = path.normalize(path.relative(SRC_ROOT, file));
      const source = readFileSync(file, "utf8");
      if (!source.includes("signature-matcher")) {
        continue;
      }
      if (ALLOWED_SIGNATURE_MATCHER_IMPORTERS.has(relative)) {
        continue;
      }
      if (/from\s+["'][^"']*signature-matcher/.test(source)) {
        offenders.push(relative.replace(/\\/g, "/"));
      }
    }

    expect(offenders).toEqual([]);
  });
});
