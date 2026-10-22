// Substitui o IPC do Tauri: comandos do app vão para a ponte HTTP com o núcleo real.
(() => {
  window.__calls = [];
  window.__dialog = { ask: true, save: "/tmp/nova-flows/doc.nova", open: "/tmp/nova-flows/doc.nova" };
  let cb = 0;
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
      if (cmd.startsWith("plugin:window|")) {
        if (cmd.endsWith("set_title")) window.__title = args.value ?? args.title;
        return null;
      }
      if (cmd.startsWith("plugin:")) return null;
      const r = await fetch("http://127.0.0.1:1430/" + cmd, { method: "POST", body: JSON.stringify(args) });
      const j = await r.json();
      if ("err" in j) throw j.err;
      return j.ok;
    },
  };
})();
