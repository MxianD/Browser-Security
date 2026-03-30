/**
 * Local Stratum bridge: browser WebSocket <-> pool TCP (newline-delimited JSON-RPC).
 * Listens on 127.0.0.1 only so it is not mistaken for an open LAN proxy.
 *
 * Usage: node stratum-proxy.js
 * Env: STRATUM_PROXY_PORT (default 8787)
 */
import { WebSocketServer } from "ws";
import net from "node:net";

const BIND = "127.0.0.1";
const PORT = Number(process.env.STRATUM_PROXY_PORT || 8787);

const wss = new WebSocketServer({ host: BIND, port: PORT });

wss.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is in use (often a previous stratum-proxy still running).`);
    console.error("Fix: stop that terminal's node, or in PowerShell run:");
    console.error(`  $env:STRATUM_PROXY_PORT=8788; node stratum-proxy.js`);
    console.error("Then set the page proxy URL to ws://127.0.0.1:8788");
  } else {
    console.error(err);
  }
  process.exit(1);
});

wss.on("connection", (ws) => {
  let sock = null;
  let buf = "";

  function cleanupSock() {
    if (!sock) return;
    sock.removeAllListeners();
    try {
      sock.destroy();
    } catch (_) {}
    sock = null;
    buf = "";
  }

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === "tcp_connect") {
      const host = String(msg.host || "").trim();
      const port = Number(msg.port);
      if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
        ws.send(JSON.stringify({ type: "status", ok: false, message: "Invalid host or port" }));
        return;
      }
      cleanupSock();
      sock = net.createConnection({ host, port }, () => {
        ws.send(JSON.stringify({ type: "status", ok: true, message: `TCP connected ${host}:${port}` }));
      });
      sock.setEncoding("utf8");
      buf = "";
      sock.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          if (line.length) ws.send(JSON.stringify({ type: "stratum", line }));
        }
      });
      sock.on("error", (e) => {
        ws.send(JSON.stringify({ type: "status", ok: false, message: e.message || String(e) }));
      });
      sock.on("close", () => {
        ws.send(JSON.stringify({ type: "status", ok: false, message: "TCP closed" }));
        cleanupSock();
      });
      return;
    }

    if (msg.type === "stratum_send") {
      const line = msg.line;
      if (typeof line !== "string" || !sock || sock.destroyed || !sock.writable) {
        ws.send(JSON.stringify({ type: "status", ok: false, message: "Pool TCP not connected" }));
        return;
      }
      sock.write(line.replace(/\r?\n/g, "") + "\n");
      return;
    }

    if (msg.type === "tcp_disconnect") {
      cleanupSock();
      ws.send(JSON.stringify({ type: "status", ok: true, message: "TCP disconnected" }));
    }
  });

  ws.on("close", cleanupSock);
});

wss.on("listening", () => {
  console.log(`Stratum proxy ready: ws://${BIND}:${PORT}`);
  console.log("Enter this URL in the browser, then use Connect pool on the page for host:port.");
});
