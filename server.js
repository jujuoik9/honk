const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, "public", "index.html");

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") { res.writeHead(200); return res.end("ok"); }
  if (req.url.split("?")[0] === "/honk.m4a") {
    return fs.readFile(path.join(__dirname, "public", "honk.m4a"), (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": "audio/mp4", "Cache-Control": "public, max-age=86400" });
      res.end(data);
    });
  }
  fs.readFile(INDEX, (err, data) => {
    if (err) { res.writeHead(500); return res.end("error"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

let first = null; // name of the first person to honk since last reset

const joined = () => [...wss.clients].filter((c) => c.name);
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of joined()) if (c.readyState === 1) c.send(data);
}
const sendCount = () => broadcast({ type: "count", n: joined().length });
const clean = (n) => String(n || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);

wss.on("connection", (ws) => {
  ws.alive = true;
  ws.lastHonk = 0;
  ws.name = null;
  ws.on("pong", () => (ws.alive = true));
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === "join") {
      const name = clean(m.name);
      if (!name) return ws.send(JSON.stringify({ type: "error", msg: "Name required" }));
      ws.name = name;
      ws.send(JSON.stringify({ type: "joined", name, first }));
      return sendCount();
    }
    if (!ws.name) return; // must join first
    if (m.type === "honk") {
      const now = Date.now();
      if (now - ws.lastHonk < 150) return;
      ws.lastHonk = now;
      if (!first) first = ws.name;
      broadcast({ type: "honk", by: ws.name, first });
    } else if (m.type === "reset") {
      first = null;
      broadcast({ type: "reset", by: ws.name });
    }
  });
  ws.on("close", sendCount);
});

// keep connections alive through proxies and drop dead ones
setInterval(() => {
  for (const c of wss.clients) {
    if (!c.alive) { c.terminate(); continue; }
    c.alive = false; c.ping();
  }
}, 25000);

server.listen(PORT, () => console.log("Listening on " + PORT));
