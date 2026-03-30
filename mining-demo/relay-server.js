/**
 * HTTP relay: this process opens plain TCP to a real Stratum pool;
 * the browser only talks to local HTTP (never opens the pool TCP).
 *
 * Required (CLI overrides env):
 *   --host, -H          pool hostname, e.g. stratum.braiins.com
 *   --port, -p          pool port, default 3333
 *   --user, -u          mining.authorize user, e.g. sub.worker1
 *   --pass              pool password, default x
 *
 * Optional:
 *   --http-port         local HTTP port, default 3001 (or RELAY_HTTP_PORT)
 *   --http-bind         local HTTP bind, default 127.0.0.1 (or RELAY_HTTP_HOST)
 *   --help              show help
 *
 * Examples:
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
      if (i + 1 >= argv.length) throw new Error("Missing value for: " + raw);
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
        throw new Error("Unknown argument: " + raw);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node relay-server.js --host <pool-host> --user <subaccount.worker> [options]

Required:
  -H, --host <host>     Stratum pool hostname
  -u, --user <name>     mining.authorize username
Optional:
  -p, --port <port>     pool port (default 3333)
      --pass <pass>     pool password (default x)
      --http-port <n>   local HTTP port (default 3001)
      --http-bind <ip>  local HTTP bind (default 127.0.0.1)

Env fallback: POOL_HOST, POOL_PORT, POOL_USER, POOL_PASS, RELAY_HTTP_PORT, RELAY_HTTP_HOST

Examples:
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
  console.error("Error: pool host and user are required, e.g.:");
  console.error('  node relay-server.js --host stratum.braiins.com --user "subaccount.worker"');
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
    console.log("[relay] TCP connected", POOL_HOST + ":" + POOL_PORT);
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
    console.log("[relay] pool TCP closed, reconnecting in 5s…");
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
          message: "Waiting for subscribe / authorize / mining.notify",
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
      "<p>Relay OK. Open <code>mining-demo/index.html</code> over HTTP; set relay to <code>http://127.0.0.1:" +
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
    "HTTP relay: http://" + HTTP_HOST + ":" + HTTP_PORT + " (browser uses this only; pool creds stay in this process)"
  );
  connectPool();
});
