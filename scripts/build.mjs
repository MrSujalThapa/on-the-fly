import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const srcDir = join(rootDir, "src");
const distDir = join(rootDir, "dist");

const publicAgentEnabled = process.env.PUBLIC_AGENT_ENABLED === "true";
const publicBackendEnabled = process.env.PUBLIC_BACKEND_ENABLED === "true";
const localAgentServerUrl = process.env.LOCAL_AGENT_SERVER_URL ?? "";

/** @type {import('esbuild').BuildOptions['define']} */
const define = {
  __PUBLIC_AGENT_ENABLED__: String(publicAgentEnabled),
  __PUBLIC_BACKEND_ENABLED__: String(publicBackendEnabled),
  __LOCAL_AGENT_SERVER_URL__: JSON.stringify(localAgentServerUrl),
};

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function copyStaticAssets() {
  cpSync(join(srcDir, "manifest.json"), join(distDir, "manifest.json"));
  cpSync(join(srcDir, "popup", "popup.html"), join(distDir, "popup", "popup.html"));
  cpSync(join(srcDir, "popup", "popup.css"), join(distDir, "popup", "popup.css"));
  cpSync(join(srcDir, "options", "options.html"), join(distDir, "options", "options.html"));
  cpSync(join(srcDir, "options", "options.css"), join(distDir, "options", "options.css"));
}

function writeIcons() {
  const iconsDir = join(distDir, "icons");
  ensureDir(iconsDir);

  const png16Base64 =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR42mNkYGD4z0ABYBw1igGMAYxRjAEMAAAfAAGpFQAAAABJRU5ErkJggg==";
  const png = Buffer.from(png16Base64, "base64");

  for (const size of [16, 48, 128]) {
    writeFileSync(join(iconsDir, `icon-${size}.png`), png);
  }
}

async function build() {
  ensureDir(distDir);

  await esbuild.build({
    entryPoints: {
      "background/service-worker": join(srcDir, "background/service-worker.ts"),
      "content/content-script": join(srcDir, "content/content-script.ts"),
      "popup/popup": join(srcDir, "popup/popup.ts"),
      "options/options": join(srcDir, "options/options.ts"),
    },
    outdir: distDir,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
    logLevel: "info",
    define,
  });

  copyStaticAssets();
  writeIcons();

  const manifest = JSON.parse(readFileSync(join(distDir, "manifest.json"), "utf8"));
  manifest.version = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")).version;
  writeFileSync(join(distDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `Build complete (agent=${publicAgentEnabled}, backend=${publicBackendEnabled}, dist=${distDir})`,
  );
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
