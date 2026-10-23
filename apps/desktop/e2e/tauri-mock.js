// Substitui o IPC do Tauri: comandos do app vão para a ponte HTTP com o núcleo real.
(() => {
  window.__calls = [];
  window.__listeners = {};
  window.__destroyed = false;
  window.__printed = 0;
  window.print = () => { window.__printed++; };
  /** Simula o clique no X da janela. */
  window.__requestClose = () => {
    const id = window.__listeners["tauri://close-requested"];
    if (id) window["_" + id]({ event: "tauri://close-requested", id: 1, payload: null });
  };
  window.__dialog = { ask: true, save: "/tmp/nova-flows/doc.docx", open: "/tmp/nova-flows/doc.docx" };
  let cb = 0;
  // Atualizações: a resposta de releases/latest do GitHub fica no sessionStorage
  // ("mock.release") para valer já na abertura do app, depois de recarregar.
  // "mock.windows" = "0" simula macOS/Linux; "mock.download" = "fail", um checksum errado.
  window.__version = "0.1.6";
  window.__installed = 0;
  const session = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
  const emit = (event, payload) => {
    const id = window.__listeners[event];
    if (id && window["_" + id]) window["_" + id]({ event, id: 1, payload });
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: (fn) => { const id = ++cb; window["_" + id] = fn; return id; },
    unregisterCallback: () => {},
    convertFileSrc: (p) => p,
    invoke: async (cmd, args = {}) => {
      window.__calls.push({ cmd, args });
      if (cmd.startsWith("plugin:dialog|")) {
        const k = cmd.split("|")[1];
        if (k === "ask" || k === "confirm" || k === "message") return window.__dialog.ask;
        return window.__dialog[k] ?? null;
      }
      if (cmd === "plugin:event|listen") {
        window.__listeners[args.event] = args.handler;
        return args.handler;
      }
      if (cmd.startsWith("plugin:window|")) {
        if (cmd.endsWith("set_title")) window.__title = args.value ?? args.title;
        if (cmd.endsWith("destroy")) window.__destroyed = true;
        return null;
      }
      if (cmd === "plugin:opener|open_url") {
        window.__opened = args.url;
        return null;
      }
      if (cmd === "plugin:app|version") return window.__version;
      if (cmd.startsWith("plugin:")) return null;
      if (cmd === "check_update") {
        const release = session("mock.release");
        if (release === null) return null;
        if (release === "offline") throw "consultando atualizações: sem conexão";
        args = { release, current: window.__version, windows: session("mock.windows") !== "0" };
      }
      if (cmd === "download_update") {
        const total = 4200000;
        for (let received = 0; received <= total; received += total / 4) {
          emit("update-progress", { received, total });
          await new Promise((r) => setTimeout(r, 150));
        }
        if (session("mock.download") === "fail") throw "o instalador baixado não confere (SHA-256 abc, esperado def)";
        return null;
      }
      if (cmd === "install_update") {
        window.__installed++;
        return null;
      }
      const r = await fetch("http://127.0.0.1:1430/" + cmd, { method: "POST", body: JSON.stringify(args) });
      const j = await r.json();
      if ("err" in j) throw j.err;
      return j.ok;
    },
  };
})();
