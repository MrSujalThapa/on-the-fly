import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const distDir = join(rootDir, "dist");
const releaseDir = join(rootDir, "release");

function readVersion() {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  return pkg.version ?? "0.0.0";
}

function ensureDist() {
  if (!existsSync(distDir)) {
    console.error("dist/ is missing. Run npm run build:public first.");
    process.exit(1);
  }
}

function createZip(zipPath) {
  rmSync(zipPath, { force: true });

  if (platform() === "win32") {
    const distGlob = join(distDir, "*").replace(/\\/g, "/");
    const destination = zipPath.replace(/\\/g, "/");
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${distGlob}' -DestinationPath '${destination}' -Force"`,
      { stdio: "inherit", cwd: rootDir },
    );
    return;
  }

  execSync(`zip -r "${zipPath}" .`, { cwd: distDir, stdio: "inherit" });
}

function main() {
  ensureDist();
  mkdirSync(releaseDir, { recursive: true });

  const version = readVersion();
  const zipPath = join(releaseDir, `on-the-fly-v${version}.zip`);
  createZip(zipPath);

  const sizeKb = Math.round(statSync(zipPath).size / 1024);
  console.log(`Release package created: ${zipPath} (${String(sizeKb)} KB)`);
}

main();
