import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("../fixtures/local", import.meta.url)));
const port = Number(process.env.LOCAL_FIXTURE_PORT ?? 4188);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function safeJoin(requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0] ?? "/");
  const relative = decoded === "/" ? "/runtime/index.html" : decoded;
  const withIndex = relative.endsWith("/") ? `${relative}index.html` : relative;
  const resolved = resolve(rootDir, normalize(`.${withIndex}`));
  return resolved.startsWith(rootDir) ? resolved : null;
}

createServer((request, response) => {
  const filePath = safeJoin(request.url ?? "/");
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }
  response.writeHead(200, {
    "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`local fixtures http://127.0.0.1:${String(port)}\n`);
});
