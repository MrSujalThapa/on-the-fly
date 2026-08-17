import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("../fixtures/e2e", import.meta.url)));
const port = Number(process.env.E2E_PORT ?? 4177);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function safeJoin(requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0] ?? "/");
  const relative = decoded === "/" ? "/simple/index.html" : decoded;
  const withIndex = relative.endsWith("/") ? `${relative}index.html` : relative;
  const resolved = resolve(rootDir, normalize(`.${withIndex}`));
  if (!resolved.startsWith(rootDir)) {
    return null;
  }
  return resolved;
}

const server = createServer((request, response) => {
  const filePath = safeJoin(request.url ?? "/");
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  const type = MIME[extname(filePath)] ?? "application/octet-stream";
  response.writeHead(200, { "content-type": type });
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`e2e fixtures http://127.0.0.1:${String(port)}\n`);
});
