import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const distDir = join(rootDir, "dist");

const ALLOWED_PERMISSIONS = new Set(["storage", "activeTab"]);

/** @param {string} message */
function fail(message) {
  console.error(`verify-public-build: ${message}`);
  process.exitCode = 1;
}

function readDistFiles() {
  /** @type {string[]} */
  const files = [];

  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (/\.(js|json)$/i.test(entry)) {
        files.push(fullPath);
      }
    }
  }

  walk(distDir);
  return files;
}

function verifyManifest() {
  const manifestPath = join(distDir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail("dist/manifest.json is missing or invalid JSON. Run npm run build:public first.");
    return;
  }

  const permissions = manifest.permissions ?? [];
  for (const permission of permissions) {
    if (!ALLOWED_PERMISSIONS.has(permission)) {
      fail(`unexpected manifest permission: ${permission}`);
    }
  }

  for (const required of ALLOWED_PERMISSIONS) {
    if (!permissions.includes(required)) {
      fail(`manifest is missing required permission: ${required}`);
    }
  }

  const hostPermissions = manifest.host_permissions ?? [];
  if (hostPermissions.length > 0) {
    fail(`public manifest must not include host_permissions: ${hostPermissions.join(", ")}`);
  }
}

function verifyBuildFlags(files) {
  const entrypoints = [
    "background/service-worker.js",
    "content/content-script.js",
    "popup/popup.js",
    "options/options.js",
  ];

  for (const relativePath of entrypoints) {
    const fullPath = join(distDir, relativePath);
    let source;
    try {
      source = readFileSync(fullPath, "utf8");
    } catch {
      fail(`missing bundled entrypoint: ${relativePath}`);
      continue;
    }

    if (/localDevAgentEnabled:\s*true/.test(source)) {
      fail(`${relativePath} has localDevAgentEnabled:true`);
    }
    if (/publicAgentEnabled:\s*true/.test(source)) {
      fail(`${relativePath} has publicAgentEnabled:true`);
    }
    if (/publicBackendEnabled:\s*true/.test(source)) {
      fail(`${relativePath} has publicBackendEnabled:true`);
    }
    if (/diagnosticsEnabled:\s*true/.test(source)) {
      fail(`${relativePath} has diagnosticsEnabled:true`);
    }
    if (relativePath === "content/content-script.js") {
      if (!source.includes("OTF_RUNTIME_V2_ACTIVE")) {
        fail("public content script must ship Runtime V2 as the only editor");
      }
      if (source.includes("createEditSession") || source.includes("DomRuntimeAdapter")) {
        fail("public content script must not instantiate legacy orchestration");
      }
    }
  }

  void files;
}

function main() {
  try {
    statSync(distDir);
  } catch {
    fail("dist/ is missing. Run npm run build:public first.");
    return;
  }

  const files = readDistFiles();
  verifyManifest();
  verifyBuildFlags(files);

  if (process.exitCode) {
    console.error("Public build verification failed.");
    process.exit(process.exitCode);
  }

  console.log("Public build verification passed.");
}

main();
