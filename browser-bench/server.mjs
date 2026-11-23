// Static server for the browser benchmark. Sends COOP/COEP so the page is cross-origin isolated
// (SharedArrayBuffer -> multi-threaded WASM), the same headers the extension's offscreen page will declare.
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = normalize(join(import.meta.dirname, ".."));   // read-aloud-tts/
const PORT = Number(process.env.PORT || 8787);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".bin": "application/octet-stream", ".tsv": "text/plain",
  ".gguf": "application/octet-stream", ".safetensors": "application/octet-stream", ".data": "application/octet-stream" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let st; try { st = statSync(p); } catch { res.writeHead(404).end("not found"); return; }
  if (st.isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, {
    "Content-Type": TYPES[extname(p)] || "application/octet-stream", "Content-Length": st.size,
    "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless",
    "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store",
  });
  createReadStream(p).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`));
