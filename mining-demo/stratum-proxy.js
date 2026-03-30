/**
 * 本地 Stratum 桥：浏览器 WebSocket <-> 矿池 TCP（换行分隔的 JSON-RPC）。
 * 仅监听 127.0.0.1，避免被局域网误用为开放代理。
 *
 * 用法：node stratum-proxy.js
 * 环境变量：STRATUM_PROXY_PORT（默认 8787）
 */
import { WebSocketServer } from "ws";
import net from "node:net";

const BIND = "127.0.0.1";
const PORT = Number(process.env.STRATUM_PROXY_PORT || 8787);

const wss = new WebSocketServer({ host: BIND, port: PORT });

wss.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用（多半是上一次的 stratum-proxy 仍在运行）。`);
    console.error("处理：关掉那个终端里的 node，或在 PowerShell 执行：");
    console.error(`  $env:STRATUM_PROXY_PORT=8788; node stratum-proxy.js`);
    console.error("然后把页面里代理地址改成 ws://127.0.0.1:8788");
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
        ws.send(JSON.stringify({ type: "status", ok: false, message: "host/port 无效" }));
        return;
      }
      cleanupSock();
      sock = net.createConnection({ host, port }, () => {
        ws.send(JSON.stringify({ type: "status", ok: true, message: `TCP 已连接 ${host}:${port}` }));
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
        ws.send(JSON.stringify({ type: "status", ok: false, message: "TCP 已关闭" }));
        cleanupSock();
      });
      return;
    }

    if (msg.type === "stratum_send") {
      const line = msg.line;
      if (typeof line !== "string" || !sock || sock.destroyed || !sock.writable) {
        ws.send(JSON.stringify({ type: "status", ok: false, message: "矿池 TCP 未连接" }));
        return;
      }
      sock.write(line.replace(/\r?\n/g, "") + "\n");
      return;
    }

    if (msg.type === "tcp_disconnect") {
      cleanupSock();
      ws.send(JSON.stringify({ type: "status", ok: true, message: "已主动断开 TCP" }));
    }
  });

  ws.on("close", cleanupSock);
});

wss.on("listening", () => {
  console.log(`Stratum 代理已就绪：ws://${BIND}:${PORT}`);
  console.log("在浏览器中填写此地址，再通过页面「连接矿池」指定 host:port。");
});
