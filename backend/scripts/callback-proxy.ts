/**
 * Only needed if Swiggy rejects http://localhost:4000/auth/callback as a redirect URI.
 * Swiggy always allows http://localhost/callback (port 80). This tiny server listens there
 * and forwards the browser, with the same query string, to the Express callback.
 *
 * Use with SWIGGY_REDIRECT_URL="http://localhost/callback" in backend/.env:
 *   npm run callback-proxy
 */
import http from "node:http";

const target = process.env.CALLBACK_TARGET ?? "http://localhost:4000/auth/callback";
const port = Number(process.env.CALLBACK_PROXY_PORT ?? 80);

const server = http.createServer((req, res) => {
  const incoming = new URL(req.url ?? "/", "http://localhost");
  if (incoming.pathname !== "/callback") {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  const dest = new URL(target);
  incoming.searchParams.forEach((value, key) => dest.searchParams.set(key, value));
  res.writeHead(302, { Location: dest.toString() }).end();
});

server.listen(port, () => {
  console.log(`Callback proxy: http://localhost:${port}/callback -> ${target}`);
});
