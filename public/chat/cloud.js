// The visitor's own Cloudflare account, and reading the files they attach.
//
// Reading a PDF or photo runs on the visitor's own free Workers AI allowance,
// connected with Cloudflare's sign-in (OAuth with PKCE — no secret anywhere).
// Sign-in opens in a small window; Cloudflare sends it back to
// /chat/cloudflare.html, which hands the one-time code to this tab over a
// BroadcastChannel (the site's Cross-Origin-Opener-Policy cuts window.opener).
// Where popups are blocked, the whole tab goes to Cloudflare and back instead.
//
// The token is kept in this tab only (sessionStorage) and never stored by
// huddlecode.com. Files are read here in the browser — PDF text with pdf.js,
// photos shrunk to a sensible size — and go, with the message, to the
// visitor's own account.
(function () {
  "use strict";

  const STORE = "mike-cf";            // the connection, this tab only
  const FLOW = "mike-cf-flow";        // a sign-in under way (localStorage: the popup must see it)
  const RETURN = "mike-cf-return";    // what Cloudflare sent back
  const CHANNEL = "mike-cloudflare";
  const PDFJS = "/assets/vendor/pdfjs-4.10.38/";

  const LIMITS = {
    files: 5,               // per message
    fileBytes: 25 * 1024 * 1024,
    textChars: 120000,      // all the text from one file
    pdfPages: 80,
    scannedPages: 4,        // a scanned PDF: this many pages sent as pictures
    imageSide: 1600,        // longest side of a photo, in pixels
    imageBytes: 1500000,    // a data URL, after shrinking
  };

  const TEXT_TYPES = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|mjs|ts|tsx|jsx|py|java|c|h|cpp|hpp|cs|go|rs|rb|php|sql|sh|yaml|yml|toml|ini|log|tex)$/i;

  // ── the connection ──────────────────────────────────────
  let config = null;
  async function getConfig() {
    if (config) return config;
    const r = await fetch("/api/cf/config");
    if (!r.ok) throw new Error("config");
    config = await r.json();
    return config;
  }

  function load() {
    try { return JSON.parse(sessionStorage.getItem(STORE) || "null"); } catch (_) { return null; }
  }
  function save(c) {
    try {
      if (c) sessionStorage.setItem(STORE, JSON.stringify(c));
      else sessionStorage.removeItem(STORE);
    } catch (_) { /* private mode: lasts until this page closes */ }
  }
  let conn = load();

  function connected() { return Boolean(conn && conn.access && conn.account && conn.account.id); }
  function account() { return conn ? conn.account : null; }

  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  function random(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }

  async function tokens(body) {
    const r = await fetch("/api/cf/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || "failed"); e.kind = data.error || "failed"; throw e; }
    return data;
  }

  function keep(data, previous) {
    conn = {
      access: data.access_token,
      refresh: data.refresh_token || (previous && previous.refresh) || null,
      exp: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      account: data.account || (previous && previous.account) || null,
    };
    save(conn);
    return conn;
  }

  /** A current access token, renewed first when it's about to run out. */
  async function token(force) {
    if (!connected()) return null;
    if (!force && conn.exp - Date.now() > 60000) return conn.access;
    if (!conn.refresh) { forget(); return null; }
    try {
      keep(await tokens({ refresh: conn.refresh }), conn);
      return conn.access;
    } catch (_) {
      forget();
      return null;
    }
  }

  function forget() { conn = null; save(null); }

  async function disconnect() {
    const refresh = conn && conn.refresh;
    forget();
    if (refresh) {
      try { await fetch("/api/cf/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh }) }); }
      catch (_) { /* forgotten here either way */ }
    }
  }

  /** Start Cloudflare's sign-in. Resolves once connected (popup), or
   *  navigates the whole tab when popups are blocked (returns never). */
  async function connect() {
    const cfg = await getConfig();
    const verifier = b64url(random(32));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const state = b64url(random(16));
    const url = cfg.authUrl + "?" + new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: location.origin + cfg.callback,
      scope: cfg.scopes,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const flow = { state, verifier, at: Date.now(), mode: "popup" };
    const w = 520, h = 720;
    const left = Math.max(0, (window.screenX || 0) + ((window.outerWidth || w) - w) / 2);
    const top = Math.max(0, (window.screenY || 0) + ((window.outerHeight || h) - h) / 2);
    localStorage.setItem(FLOW, JSON.stringify(flow));
    localStorage.removeItem(RETURN);
    const popup = window.open(url, "mike-cloudflare", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) {
      flow.mode = "redirect";
      localStorage.setItem(FLOW, JSON.stringify(flow));
      location.assign(url);
      return new Promise(() => {});
    }
    return new Promise((resolve, reject) => {
      let done = false;
      let channel = null;
      let poll = 0;
      const cleanup = () => {
        clearInterval(poll);
        window.removeEventListener("storage", onStorage);
        if (channel) channel.close();
      };
      const finish = (msg) => {
        if (done || !msg || msg.state !== state) return;
        done = true;
        cleanup();
        complete(msg, flow).then(resolve, reject);
      };
      const onStorage = (e) => { if (e.key === RETURN && e.newValue) { try { finish(JSON.parse(e.newValue)); } catch (_) { /* ignore */ } } };
      try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = (e) => finish(e.data); } catch (_) { /* old browser: storage event */ }
      window.addEventListener("storage", onStorage);
      // The window closed without an answer: the visitor gave up.
      poll = setInterval(() => {
        const back = readReturn();
        if (back && back.state === state) { finish(back); return; }
        let closed = false;
        try { closed = popup.closed; } catch (_) { closed = false; }
        if (closed && !done) {
          clearInterval(poll);
          setTimeout(() => {
            const late = readReturn();
            if (late && late.state === state) { finish(late); return; }
            if (!done) { done = true; cleanup(); const e = new Error("closed"); e.kind = "closed"; reject(e); }
          }, 900);
        }
      }, 700);
    });
  }

  function readReturn() {
    try { return JSON.parse(localStorage.getItem(RETURN) || "null"); } catch (_) { return null; }
  }

  async function complete(msg, flow) {
    localStorage.removeItem(RETURN);
    localStorage.removeItem(FLOW);
    if (!msg.code) {
      const e = new Error(msg.error_description || msg.error || "declined");
      e.kind = msg.error === "access_denied" ? "declined" : "failed";
      throw e;
    }
    return keep(await tokens({ code: msg.code, verifier: flow.verifier }));
  }

  /** After a full-tab sign-in: finish it, if this tab started one. */
  async function resume() {
    let flow = null;
    try { flow = JSON.parse(localStorage.getItem(FLOW) || "null"); } catch (_) { flow = null; }
    const back = readReturn();
    if (!flow || flow.mode !== "redirect" || !back || back.state !== flow.state) return null;
    if (Date.now() - flow.at > 15 * 60 * 1000) { localStorage.removeItem(FLOW); localStorage.removeItem(RETURN); return null; }
    return complete(back, flow);
  }

  // ── reading files ───────────────────────────────────────
  function kindOf(file) {
    const name = file.name || "";
    if (file.type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
    if (/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type) || /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(name)) return "image";
    if (/^text\//.test(file.type) || TEXT_TYPES.test(name)) return "text";
    return "";
  }

  async function shrink(source, side) {
    const w0 = source.width, h0 = source.height;
    const scale = Math.min(1, side / Math.max(w0, h0));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const q of [0.86, 0.75, 0.62, 0.5]) {
      const url = canvas.toDataURL("image/jpeg", q);
      if (url.length <= LIMITS.imageBytes) return url;
    }
    return side > 900 ? shrink(canvas, Math.round(side * 0.7)) : canvas.toDataURL("image/jpeg", 0.45);
  }

  async function readImage(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (_) {
      throw new Error(/\.heic$/i.test(file.name) ? "HEIC photos can't be opened in the browser — save it as JPEG first." : "This picture couldn't be opened.");
    }
    return { images: [await shrink(bitmap, LIMITS.imageSide)], note: "photo" };
  }

  let pdfjs = null;
  async function loadPdfjs() {
    if (!pdfjs) {
      pdfjs = await import(PDFJS + "pdf.min.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
    }
    return pdfjs;
  }

  async function readPdf(file) {
    const lib = await loadPdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = Math.min(doc.numPages, LIMITS.pdfPages);
    let text = "";
    for (let i = 1; i <= pages && text.length < LIMITS.textChars; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items) {
        line += item.str || "";
        if (item.hasEOL) { text += line.trimEnd() + "\n"; line = ""; } else if (item.str && !/\s$/.test(item.str)) line += " ";
      }
      if (line.trim()) text += line.trimEnd() + "\n";
      text += `\n[page ${i}]\n\n`;
    }
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const letters = text.replace(/\[page \d+\]/g, "").trim().length;
    const more = doc.numPages > pages ? ` (first ${pages} of ${doc.numPages})` : "";
    if (letters > 200) return { text: text.slice(0, LIMITS.textChars), note: `${doc.numPages} page${doc.numPages === 1 ? "" : "s"}${more}` };
    // Scanned: no text layer. Send the first pages as pictures instead.
    const images = [];
    for (let i = 1; i <= Math.min(doc.numPages, LIMITS.scannedPages); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 1500 / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      images.push(await shrink(canvas, LIMITS.imageSide));
    }
    return { images, note: `scanned — ${images.length} of ${doc.numPages} page${doc.numPages === 1 ? "" : "s"} as pictures` };
  }

  async function readText(file) {
    const text = (await file.text()).slice(0, LIMITS.textChars);
    return { text, note: `${Math.max(1, Math.round(file.size / 1000))} KB` };
  }

  /** {kind, text?, images?, note} for one file, or throws a readable Error. */
  async function read(file) {
    const kind = kindOf(file);
    if (!kind) throw new Error("Mike can read PDFs, photos and text files here. The desktop Mike reads Word and PowerPoint too.");
    if (file.size > LIMITS.fileBytes) throw new Error("That file is over 25 MB.");
    const out = kind === "pdf" ? await readPdf(file) : kind === "image" ? await readImage(file) : await readText(file);
    return { kind, ...out };
  }

  window.MikeCloud = { connected, account, connect, resume, token, disconnect, forget, read, LIMITS };
})();
