# Attack / lab flow (browser mining)

This document follows the structure you specified and matches this repository where applicable.

---

## 1. Attacker attacks the victim’s browser

The goal is to run attacker-controlled JavaScript (and optionally Workers) in the victim’s origin or in a nested browsing context, without the victim meaningfully consenting to mining.

### 1.1 Embedding an iframe

- The attacker serves a **benign-looking page** (e.g. fake news or a lure).
- A **hidden or tiny `<iframe>`** loads the mining page (`miner.html` in this lab) from the same site or another origin (subject to **SAMEORIGIN**, **CSP**, and **sandbox**).
- The iframe runs **silently** (e.g. 1×1 px, `opacity: 0`): the victim sees the outer page, while the inner document executes the miner and talks to the attacker’s relay.
- **In this repo:** see `embed-lab.html` → `<iframe src="miner.html">` with `sandbox="allow-scripts allow-same-origin"` so Workers can load.

### 1.2 Clickjacking

- The attacker overlays **transparent or misleading UI** so the victim clicks what looks like a normal button but actually activates something else (e.g. grants permission, focuses a hidden iframe, or triggers navigation).
- Used together with hidden iframes or opaque layers to **increase interaction** or bypass simple “click to play” gates.
- **Defense:** `X-Frame-Options` / `Content-Security-Policy: frame-ancestors`, UI integrity checks.

---

## 2. Attacker connects to the mining pool (infrastructure)

The **victim’s browser does not open a raw TCP connection to the pool** (browsers cannot). The **attacker-controlled server** holds pool credentials and speaks **Stratum** to the pool.

- **Typical Stratum:** plain **TCP** (newline-delimited JSON-RPC), sometimes **TLS** on another port.
- **WebSocket in diagrams:** often means a **bridge** (e.g. `WebSocket` between browser ↔ attacker server, then **TCP** from server ↔ pool). The pool itself is still Stratum over TCP from the server’s perspective.
- **In this repo:** `relay-server.js` uses **HTTP** (`GET /api/job`, `POST /api/submit`) toward the browser and **one TCP connection** to the pool—no WebSocket in the current code path. Conceptually it is the same “attacker middle” as step 2: **attacker server ↔ mining pool**.

---

## 3. Attacker sends work to the victim’s browser and runs code there

- The victim loads **HTML/JS** (via iframe or main frame). Scripts **fetch jobs** from the attacker relay and **postMessage** to **Web Workers** that perform hashing (`miner-worker.js`).
- **Configuration** (relay URL, `userId`, nonce segment, etc.) is **embedded or fetched** by the attacker—**not** typed by the victim.
- **Shares** are submitted back through the relay (`POST /api/submit`), which issues **`mining.submit`** to the pool under the attacker’s account.

**Summary chain:**

```text
Victim browser (iframe: miner.html + Workers)
    → HTTP → Attacker relay (relay-server.js)
        → TCP Stratum → Mining pool
```

---

## Mapping to files (this lab)

| Step | File / component |
|------|-------------------|
| 1.1 iframe | `embed-lab.html` embeds `miner.html` |
| 1.2 clickjacking | Not implemented; described as optional technique |
| 2 Pool connection | `relay-server.js` (TCP to pool, HTTP to browser) |
| 3 Run code on victim | `miner.html`, `miner-app.js`, `miner-worker.js` |
