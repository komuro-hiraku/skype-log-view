import { join, extname } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = import.meta.dir;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
};

const server = Bun.serve({
  port: PORT,

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === "/" || pathname.endsWith("/")) {
      pathname = "/index.html";
    }

    const filePath = join(ROOT, pathname);

    // Path traversal guard
    if (!filePath.startsWith(ROOT + "/")) {
      return new Response("403 Forbidden", { status: 403 });
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("404 Not Found", { status: 404 });
    }

    const ext = extname(pathname).toLowerCase();
    return new Response(file, {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      },
    });
  },
});

console.log(`Skype Log Viewer → http://localhost:${server.port}`);
