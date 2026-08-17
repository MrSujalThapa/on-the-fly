import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "src");
const RUNTIME_V2 = join(SRC, "runtime-v2");

const IMPORT_RE =
  /(?:from|import)\s+["']([^"']+)["']|export\s+\*\s+from\s+["']([^"']+)["']/g;

const ALLOWED_PREFIXES = [
  "src/runtime-v2/",
  "src/editor/operations.ts",
  "src/editor/ids.ts",
  "src/editor/element-signature.ts",
  "src/editor/editor-target.ts",
  "src/editor/group-state.ts",
  "src/editor/visual-node.ts",
  "src/editor/editor-selection.ts",
  "src/editor/editor-command.ts",
  "src/editor/operation-batch.ts",
  "src/editor/validation/",
  "src/editor/measurement/",
  "src/editor/transform/",
  "src/editor/persistence/",
  "src/editor/dom/handlers/",
  "src/editor/dom/types.ts",
  "src/editor/dom/signature-matcher.ts",
  "src/editor/dom/resolve-target.ts",
  "src/editor/dom/element-snapshot.ts",
  "src/editor/dom/managed-detach.ts",
  "src/editor/dom/interactive-fixed-placement.ts",
  "src/editor/dom/interactive-safety.ts",
  "src/editor/dom/fixed-position-anchor.ts",
  "src/editor/dom/layer-overlap-resolver.ts",
  "src/editor/dom/enrich-operation-metadata.ts",
  "src/editor/dom/operation-batch-snapshot.ts",
  "src/editor/dom/dom-placement-snapshot.ts",
  "src/editor/dom/replay-readiness.ts",
  "src/editor/dom/match-viewport.ts",
  "src/content/storage-client.ts",
  "src/shared/",
];

const FORBIDDEN_SUBSTRINGS = [
  "/edit-session",
  "/transform-controller",
  "/session-operation-state",
  "/session-history",
  "/page-customization-controller",
  "/editor-shell",
  "/floating-toolbar",
  "/session-command-host",
  "/content-script",
  "/dom-runtime-adapter",
  "/default-commands",
  "/style-text-controller",
  "/save-window-controller",
  "/agent/",
  "/editor/index",
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function posix(path: string): string {
  return path.split(sep).join("/");
}

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const fromDir = dirname(fromFile);
  const raw = specifier.replace(/\.js$/u, ".ts");
  return resolve(fromDir, raw);
}

function srcRelative(abs: string): string {
  return posix(relative(ROOT, abs));
}

function isAllowedRuntimeV2Import(resolvedSrcPath: string): boolean {
  const path = posix(resolvedSrcPath);
  if (FORBIDDEN_SUBSTRINGS.some((fragment) => path.includes(fragment))) {
    return false;
  }
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

function collectImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

describe("runtime-v2 import boundaries", () => {
  it("runtime-v2 only imports approved lower-level modules", () => {
    const files = listTsFiles(RUNTIME_V2);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of collectImports(file)) {
        if (!specifier.startsWith(".")) {
          violations.push(`${srcRelative(file)} imports non-relative "${specifier}"`);
          continue;
        }
        const resolved = resolveImport(file, specifier);
        if (!resolved) {
          continue;
        }
        const rel = srcRelative(resolved);
        if (!rel.startsWith("src/")) {
          violations.push(`${srcRelative(file)} escaped src via "${specifier}"`);
          continue;
        }
        if (!isAllowedRuntimeV2Import(rel)) {
          violations.push(`${srcRelative(file)} → ${rel}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("legacy src does not import runtime-v2", () => {
    const files = listTsFiles(SRC).filter((file) => !file.startsWith(RUNTIME_V2 + sep));
    const violations: string[] = [];

    for (const file of files) {
      for (const specifier of collectImports(file)) {
        if (!specifier.startsWith(".")) {
          continue;
        }
        const resolved = resolveImport(file, specifier);
        if (!resolved) {
          continue;
        }
        const rel = srcRelative(resolved);
        if (rel.startsWith("src/runtime-v2/")) {
          violations.push(`${srcRelative(file)} → ${rel}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
