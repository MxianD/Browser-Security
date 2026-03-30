/**
 * HTTP 中继：本进程用明文 TCP 连真实矿池 Stratum；
 * 浏览器只访问本机 HTTP API（不直连矿池）。
 *
 * 必填（命令行优先，未写的项可回退到同名环境变量）：
 *   --host, -H          矿池主机，如 stratum.braiins.com
 *   --port, -p          矿池端口，默认 3333
 *   --user, -u          mining.authorize 用户名，如 sub.worker1
 *   --pass              矿池密码，默认 x
 *
 * 可选：
 *   --http-port         本机 HTTP 端口，默认 3001（或 RELAY_HTTP_PORT）
 *   --http-bind         本机 HTTP 绑定地址，默认 127.0.0.1（或 RELAY_HTTP_HOST）
 *   --help              显示帮助
 *
 * 示例：
 *   node relay-server.js --host stratum.braiins.com --port 3333 --user my.worker --pass x
 *   npm run relay -- --host stratum.braiins.com -u my.worker
 */
import http from "node:http";
import net from "node:net";

function splitEq(s) {
  const i = s.indexOf("=");
  if (i <= 0) return [s, null];
  return [s.slice(0, i), s.slice(i + 1)];
}

/**
 * @returns {{
 *   poolHost?: string,
 *   poolPort?: number,
 *   poolUser?: string,
 *   poolPass?: string,
 *   httpPort?: number,
 *   httpBind?: string,
 *   help?: boolean
 * }}
 */
function parseRelayArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    let key;
    let val;
    const raw = argv[i];
    if (raw.startsWith("--")) {
      const [k, v] = splitEq(raw.slice(2));
      key = k;
      if (v !== null) val = v;
    } else if (raw.startsWith("-") && raw.length === 2) {
      key = raw.slice(1);
      val = undefined;
    } else {
      continue;
    }

    const need = () => {
      if (val !== undefined) return val;
      if (i + 1 >= argv.length) throw new Error("缺少参数值: " + raw);
      return argv[++i];
    };

    switch (key) {
      case "help":
      case "h":
        out.help = true;
        break;
      case "host":
      case "H":
        out.poolHost = need();
        break;
      case "port":
      case "p":
        out.poolPort = parseInt(need(), 10);
        break;
      case "user":
      case "u":
        out.poolUser = need();
        break;
      case "pass":
        out.poolPass = need();
        break;
      case "http-port":
        out.httpPort = parseInt(need(), 10);
        break;
      case "http-bind":
        out.httpBind = need();
        break;
      default:
        throw new Error("未知参数: " + raw);
    }
  }
  return out;
}

function printHelp() {
  console.log(`用法:
  node relay-server.js --host <矿池主机> --user <子账户.矿工> [选项]

必填:
  -H, --host <host>     矿池 Stratum 主机
  -u, --user <name>     mining.authorize 用户名
可选:
  -p, --port <port>     矿池端口 (默认 3333)
      --pass <pass>     矿池密码 (默认 x)
      --http-port <n>   本机 HTTP 端口 (默认 3001)
      --http-bind <ip>  本机 HTTP 绑定 (默认 127.0.0.1)

未在命令行给出的项可使用环境变量: POOL_HOST, POOL_PORT, POOL_USER, POOL_PASS,
RELAY_HTTP_PORT, RELAY_HTTP_HOST

示例:
  node relay-server.js -H stratum.braiins.com -p 3333 -u account.worker1 --pass x
  npm run relay -- --host stratum.braiins.com -u account.worker1
`);
}

let cli;
try {
  cli = parseRelayArgv(process.argv.slice(2));
} catch (e) {
  console.error(String((e && e.message) || e));
  printHelp();
  process.exit(1);
}

if (cli.help) {
  printHelp();
  process.exit(0);
}

const POOL_HOST = cli.poolHost || process.env.POOL_HOST || "";
const POOL_PORT = Number(
  cli.poolPort !== undefined ? cli.poolPort : process.env.POOL_PORT || 3333
);
const POOL_USER = cli.poolUser || process.env.POOL_USER || "";
const POOL_PASS =
  cli.poolPass !== undefined ? cli.poolPass : process.env.POOL_PASS || "x";
const HTTP_HOST = cli.httpBind || process.env.RELAY_HTTP_HOST || "127.0.0.1";
const HTTP_PORT = Number(
  cli.httpPort !== undefined ? cli.httpPort : process.env.RELAY_HTTP_PORT || 3001
);

if (!POOL_HOST || !POOL_USER) {
  console.error("错误: 必须指定矿池主机与用户名，例如:");
  console.error('  node relay-server.js --host stratum.braiins.com --user "子账户.矿工"');
  printHelp();
  process.exit(1);
}

/** @type {import('node:net').Socket | null} */
let sock = null;
let buf = "";
let nextRpcId = 1;
let subscribeId = 0;
let authorizeId = 0;
let subscribeOk = false;
let extranonce1 = "";
let extranonce2Size = 4;
let difficulty = 1;
/** @type {null | { jobId: string, prevhash: string, coinb1: string, coinb2: string, merkleBranches: string[], version: string, nbits: string, ntime: string }} */
let lastJob = null;

function sendStratum(obj) {
  if (!sock || sock.destroyed) return;
  sock.write(JSON.stringify(obj) + "\n");
}

function handlePoolLine(line) {
  if (!line.trim()) return;
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return;
  }
  if (j.method === "mining.notify" && Array.isArray(j.params) && j.params.length >= 8) {
    const p = j.params;
    lastJob = {
      jobId: p[0],
      prevhash: p[1],
      coinb1: p[2],
      coinb2: p[3],
      merkleBranches: p[4],
      version: p[5],
      nbits: p[6],
      ntime: p[7],
    };
    console.log("[relay] mining.notify job_id=", lastJob.jobId);
    return;
  }
  if (j.method === "mining.set_difficulty" && j.params && j.params.length) {
    difficulty = Number(j.params[0]) || 1;
    console.log("[relay] difficulty=", difficulty);
    return;
  }
  if (j.result !== undefined && j.error == null) {
    if (j.id === subscribeId && Array.isArray(j.result) && j.result.length >= 3) {
      const en1 = j.result[1];
      const en2n = Number(j.result[2]);
      if (typeof en1 === "string" && Number.isFinite(en2n) && en2n >= 0 && en2n <= 32) {
        extranonce1 = en1;
        extranonce2Size = en2n;
        subscribeOk = true;
        authorizeId = nextRpcId++;
        sendStratum({
          id: authorizeId,
          method: "mining.authorize",
          params: [POOL_USER, POOL_PASS],
        });
        console.log("[relay] subscribed, extranonce2_size=", extranonce2Size);
      }
      return;
    }
    if (j.id === authorizeId && j.result === true) {
      console.log("[relay] authorized");
      return;
    }
  }
}

function connectPool() {
  buf = "";
  lastJob = null;
  subscribeOk = false;
  sock = net.createConnection({ host: POOL_HOST, port: POOL_PORT }, () => {
    console.log("[relay] TCP 已连接", POOL_HOST + ":" + POOL_PORT);
    subscribeId = nextRpcId++;
    sendStratum({
      id: subscribeId,
      method: "mining.subscribe",
      params: ["CMU-RelayLab/1.0"],
    });
  });
  sock.setEncoding("utf8");
  sock.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line.length) handlePoolLine(line);
    }
  });
  sock.on("error", (e) => {
    console.error("[relay] pool socket error:", e.message);
  });
  sock.on("close", () => {
    console.log("[relay] pool TCP 关闭，5s 后重连…");
    sock = null;
    setTimeout(connectPool, 5000);
  });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/api/job" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (!subscribeOk || !lastJob) {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          ready: false,
          message: "等待 subscribe / authorize / mining.notify",
        })
      );
      return;
    }
    res.writeHead(200);
    res.end(
      JSON.stringify({
        ready: true,
        difficulty,
        extranonce1,
        extranonce2Size,
        job: lastJob,
      })
    );
    return;
  }

  if (req.url === "/api/submit" && req.method === "POST") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: "invalid JSON" }));
      return;
    }
    const { jobId, extranonce2, ntime, nonce } = body;
    if (!jobId || !extranonce2 || !ntime || !nonce) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: "need jobId, extranonce2, ntime, nonce" }));
      return;
    }
    const sid = nextRpcId++;
    sendStratum({
      id: sid,
      method: "mining.submit",
      params: [POOL_USER, jobId, extranonce2, ntime, nonce],
    });
    console.log("[relay] mining.submit jobId=", jobId, "nonce=", nonce);
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, sent: true }));
    return;
  }

  if (req.url === "/" && req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.writeHead(200);
    res.end(
      "<p>Relay OK. 在 HTTP 服务下打开 <code>mining-demo/index.html</code>，中继地址设为 <code>http://127.0.0.1:" +
        HTTP_PORT +
        "</code></p>"
    );
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(HTTP_PORT, HTTP_HOST, () => {
  console.log(
    "HTTP 中继: http://" + HTTP_HOST + ":" + HTTP_PORT + " （浏览器只连这里；矿池凭证仅在本进程）"
  );
  connectPool();
});
