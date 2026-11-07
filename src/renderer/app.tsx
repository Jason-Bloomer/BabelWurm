/** Main window: toolbar, client/channel tabs, chat view, reply bar, status bar. */
import { render } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { BUILTIN_SOUNDS, channelFlag, setChannelFlag } from "../core/alerts";
import { isKnownLanguage, languageName } from "../core/languages";
import { AboutDialog, AlertLogDialog, AlertsDialog, ClientsDialog, GlossaryDialog, SearchDialog, SettingsDialog } from "./dialogs";
import { api, key, store, useStore, type Entry, type Snapshot } from "./store";
import { OverlayApp } from "./overlay";
import { Check, ContextMenuHost, LanguagePicker, openMenu, type MenuItem } from "./ui";

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------
function Toolbar() {
  const s = useStore();
  const t = s.t;
  const clients = s.cfg.clients;
  const summary = clients.length ? clients.map((c, i) => c.name || s.clientLabel(i)).join(", ") : t("clients_none");
  return (
    <header class="toolbar">
      <div class="toolbar-row">
        <span class="muted">{t("clients_label")}</span>
        <span class="clients-summary" title={clients.map((c) => c.path).join("\n")}>
          {summary}
        </span>
        <button onClick={() => ((s.dialog = "clients"), s.emit())}>{t("clients_btn")}</button>
        <button onClick={() => ((s.dialog = "settings"), s.emit())}>{t("btn_settings")}</button>
        <button onClick={() => ((s.dialog = "alerts"), s.emit())}>{t("alerts_btn")}</button>
        <button class="ov-btn" onClick={() => void api().toggleOverlay(true)} title={t("overlay_tt", { key: s.cfg.overlay?.hotkey || "" })}>
          {t("overlay_btn")}
        </button>
        <button class="mag-btn" onClick={() => void api().toggleMagnifier()} title={t("mag_hint", { key: s.cfg.magnifier?.hotkey_translate || "" })}>
          {t("mag_btn")}
        </button>
        <button onClick={() => ((s.dialog = "alertlog"), s.emit())}>
          {t("alerts_log_btn")}
          {s.alertLog.length > 0 && <span class="badge">{s.alertLog.length}</span>}
        </button>
        <span class="spacer" />
        <span class="muted">{t("lang_label")}</span>
        <LanguagePicker
          value={s.cfg.target_lang || "auto"}
          onChange={(code) => void s.set({ target_lang: code, reply_src: "" })}
          languages={s.languages}
          autoLabel={`${t("lang_auto")} (${languageName(s.targetLang, s.uiLang)})`}
          searchPlaceholder={t("lang_search")}
          pinned={["en", "ru", "pt", "de", "es", "fr", "zh"]}
        />
      </div>
      <div class="toolbar-row flags">
        <Check checked={s.cfg.translate} onChange={(v) => void s.set({ translate: v })}>
          {t("chk_translate", { lang: languageName(s.targetLang, s.uiLang) })}
        </Check>
        <Check checked={s.cfg.show_original} onChange={(v) => void s.set({ show_original: v })}>
          {t("chk_original")}
        </Check>
        <Check checked={s.cfg.on_top} onChange={(v) => void s.set({ on_top: v })}>
          {t("chk_on_top")}
        </Check>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function channelMenu(client: number, channel: string): MenuItem[] {
  const s = store;
  const t = s.t;
  const cur = s.cfg.channel_sounds?.[channel] || "";
  const pick = (sid: string) => {
    const sounds = { ...(s.cfg.channel_sounds || {}) };
    if (sid) sounds[channel] = sid;
    else delete sounds[channel]; // "same as global" — no entry needed
    void s.set({ channel_sounds: sounds });
    if (sid) s.play(sid);
  };
  return [
    {
      label: t("tab_menu_sound"),
      checked: channelFlag(s.cfg.sound_channels, channel),
      onClick: () => void s.set({ sound_channels: setChannelFlag(s.cfg.sound_channels, channel, !channelFlag(s.cfg.sound_channels, channel)) }),
    },
    {
      label: t("tab_menu_notify"),
      checked: channelFlag(s.cfg.notify_channels, channel),
      onClick: () => void s.set({ notify_channels: setChannelFlag(s.cfg.notify_channels, channel, !channelFlag(s.cfg.notify_channels, channel)) }),
    },
    {
      label: t("tab_menu_translate"),
      checked: s.isTranslated(channel),
      onClick: () => s.setTranslated(channel, !s.isTranslated(channel)),
    },
    { separator: true },
    {
      label: t("tab_menu_sound_pick"),
      submenu: [
        { label: t("sound_default"), radio: true, checked: !cur, onClick: () => pick("") },
        ...BUILTIN_SOUNDS.map((sid) => ({ label: t(`snd_${sid}`), radio: true, checked: cur === sid, onClick: () => pick(sid) })),
      ],
    },
    { separator: true },
    {
      label: t("tab_menu_hide"),
      disabled: s.tabs(client).length <= 1,
      onClick: () => s.hideChannel(channel),
    },
  ];
}

export function ChannelTabs(props: { client: number; compact?: boolean }) {
  const s = useStore();
  const t = s.t;
  const active = s.tabOf(props.client);
  return (
    <nav class="tabs" role="tablist">
      {s.tabs(props.client).map((name) => {
        const k = key(props.client, name);
        const cls = s.alerted.has(k) ? "alert" : s.unread.has(k) ? "unread" : "";
        const sOn = channelFlag(s.cfg.sound_channels, name);
        const nOn = channelFlag(s.cfg.notify_channels, name);
        return (
          <div
            key={name}
            role="tab"
            aria-selected={active === name}
            class={`tab ${active === name ? "active" : ""} ${cls}`}
            onClick={() => s.switchTab(props.client, name)}
            onContextMenu={(e) => openMenu(e, channelMenu(props.client, name))}
          >
            <span class="tab-name">{name}</span>
            {!props.compact && !s.isTranslated(name) && (
              <span class="tab-notr" title={t("tab_menu_translate") + ": ✗"}>
                Aa
              </span>
            )}
            {!props.compact && (
              <>
            <span
              class={`tab-icon ${sOn ? "on" : ""}`}
              title={sOn ? t("tab_tt_sound_on") : t("tab_tt_sound_off")}
              onClick={(e) => {
                e.stopPropagation();
                void s.set({ sound_channels: setChannelFlag(s.cfg.sound_channels, name, !sOn) });
              }}
            >
              ♪
            </span>
            <span
              class={`tab-icon ${nOn ? "on" : ""}`}
              title={nOn ? t("tab_tt_notify_on") : t("tab_tt_notify_off")}
              onClick={(e) => {
                e.stopPropagation();
                void s.set({ notify_channels: setChannelFlag(s.cfg.notify_channels, name, !nOn) });
              }}
            >
              ✉
            </span>
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function ClientTabs() {
  const s = useStore();
  if (s.cfg.clients.length < 2) return null;
  return (
    <nav class="client-tabs" role="tablist">
      {s.cfg.clients.map((c, i) => {
        const cls = s.alertedClients.has(i) ? "alert" : s.unreadClients.has(i) ? "unread" : "";
        return (
          <div key={i} role="tab" class={`client-tab ${s.currentClient === i ? "active" : ""} ${cls}`} onClick={() => s.switchClient(i)} title={c.path}>
            {s.clientLabel(i)}
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Chat view
// ---------------------------------------------------------------------------
function EntryView(props: { e: Entry; showOriginal: boolean; translating: boolean; failText: string; onMenu: (ev: MouseEvent, e: Entry) => void }) {
  const { e } = props;
  const head = (
    <>
      {e.time && <span class="m-time">[{e.time}] </span>}
      {e.sub && <span class="m-sub">{e.sub}</span>}
      {e.name && <span class="m-name">{e.name}: </span>}
    </>
  );
  let body;
  let spaced = true;
  if (e.translated === null) {
    // no translation — the original is always shown
    body = (
      <>
        <div>
          {head}
          <span class="m-orig">{e.original}</span>
        </div>
        {props.translating && e.original && <div class="m-err">{props.failText}</div>}
      </>
    );
  } else if (e.translated === e.original) {
    // not translated (already in the target language, language channel "as is") — compact
    body = (
      <div>
        {head}
        {e.original}
      </div>
    );
    spaced = false;
  } else if (props.showOriginal) {
    body = (
      <>
        <div>
          {head}
          <span class="m-orig">{e.original}</span>
        </div>
        <div class="m-tr">{e.translated}</div>
      </>
    );
  } else {
    body = (
      <div>
        {head}
        {e.translated}
      </div>
    );
  }
  return (
    <div dir="auto" class={`msg ${spaced ? "spaced" : ""} ${e.mention ? "mention" : ""}`} onContextMenu={(ev) => props.onMenu(ev as unknown as MouseEvent, e)}>
      {body}
    </div>
  );
}

export function ChatView(props: { client: number }) {
  const s = useStore();
  const channel = s.tabOf(props.client);
  const entries = s.entries(props.client, channel);
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastTab = useRef("");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tabKey = `${props.client}|${channel}`;
    // a reader scrolled up in the history is not thrown to the bottom by new messages
    if (lastTab.current !== tabKey || atBottom.current) el.scrollTop = el.scrollHeight;
    lastTab.current = tabKey;
  });

  const onMenu = (ev: MouseEvent, e: Entry) => {
    const t = s.t;
    const sel = window.getSelection()?.toString() || "";
    const items: MenuItem[] = [];
    // "Reply" only for messages really translated from another language
    if (e.translated && e.translated !== e.original && e.src && isKnownLanguage(e.src) && e.src !== s.targetLang) {
      items.push({ label: `${t("ctx_reply")} (${e.src})`, onClick: () => s.replyTo?.(e.src!) });
      items.push({ separator: true });
    }
    if (sel) items.push({ label: t("ctx_copy"), onClick: () => void api().copy(sel) });
    items.push({ label: t("ctx_copy_original"), onClick: () => void api().copy(e.original) });
    if (e.translated && e.translated !== e.original) items.push({ label: t("ctx_copy_translation"), onClick: () => void api().copy(e.translated!) });
    openMenu(ev, items);
  };

  if (!s.cfg.clients.length) return <div class="chat empty-hint">{s.t("no_clients_hint")}</div>;
  return (
    <div
      class="chat"
      ref={ref}
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {entries.map((e) => (
        <EntryView key={e.id} e={e} showOriginal={s.cfg.show_original} translating={s.cfg.translate} failText={s.t("msg_untranslated")} onMenu={onMenu} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reply bar: type in your language, get the translation (copied to the clipboard)
// ---------------------------------------------------------------------------
function ReplyBar() {
  const s = useStore();
  const t = s.t;
  const [text, setText] = useState("");
  const [out, setOut] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  const src = s.cfg.reply_src || s.targetLang;
  const dst = s.cfg.reply_dst || "en";

  const run = (value: string, from: string, to: string) => {
    seq.current++;
    if (timer.current) clearTimeout(timer.current);
    const v = value.trim();
    if (!v) {
      setOut("");
      return;
    }
    const my = seq.current;
    // translate 0.7 s after the last keystroke
    timer.current = window.setTimeout(async () => {
      const r = await api().translateReply(v, from, to);
      if (my !== seq.current) return; // outdated: the text has changed
      if (r === null) {
        setOut(t("status_translate_fail"));
        return;
      }
      setOut(r);
      if (s.cfg.auto_copy_reply) {
        await api().copy(r);
        s.status = t("status_copied", { text: r.slice(0, 60) });
        s.emit();
      }
    }, 700);
  };

  useEffect(() => {
    s.replyTo = (lang: string) => {
      void s.set({ reply_dst: lang }).then(() => run(input.current?.value || "", s.cfg.reply_src || s.targetLang, lang));
      input.current?.focus();
    };
    return () => {
      s.replyTo = null;
    };
  }, []);

  const setLangs = (from: string, to: string) => {
    void s.set({ reply_src: from, reply_dst: to });
    run(text, from, to);
  };

  return (
    <div class="reply">
      <span class="muted">{t("reply_label")}</span>
      <LanguagePicker mode="compact" value={src} onChange={(c) => setLangs(c, dst)} languages={s.languages} searchPlaceholder={t("lang_search")} pinned={[s.targetLang, "en"]} />
      <button
        class="icon-btn swap"
        title="⇄"
        onClick={() => setLangs(dst, src)}
      >
        →
      </button>
      <LanguagePicker mode="compact" value={dst} onChange={(c) => setLangs(src, c)} languages={s.languages} searchPlaceholder={t("lang_search")} pinned={["en", s.targetLang]} />
      <input
        ref={input}
        class="reply-input"
        dir="auto"
        placeholder={t("reply_placeholder")}
        value={text}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setText(v);
          run(v, src, dst);
        }}
      />
      <input class="reply-out" dir="auto" readOnly value={out} onFocus={(e) => (e.target as HTMLInputElement).select()} />
      <button class="icon-btn" title={t("btn_copy")} disabled={!out} onClick={() => void api().copy(out)}>
        ⧉
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------
export async function startEngine() {
  const s = store;
  const r = await api().start();
  if (r.ok) {
    s.running = true;
    s.count = 0;
    const names = s.cfg.clients.map((_c, i) => s.clientLabel(i)).join(", ");
    s.status = s.t("status_watching", { n: s.cfg.clients.length, names, mode: s.t("status_mode_tail") });
  } else {
    s.running = false;
    s.status = r.error === "no_clients" ? s.t("status_add_client") : s.t("status_bad_path", { path: r.path });
  }
  s.emit();
}

export async function stopEngine() {
  await api().stop();
  store.running = false;
  store.status = store.t("status_stopped");
  store.emit();
}

export async function restartEngineIfRunning() {
  if (store.running) {
    await stopEngine();
    await startEngine();
  }
}

function StatusBar() {
  const s = useStore();
  const t = s.t;
  const [q, setQ] = useState("");
  const search = () => {
    if (!q.trim()) return;
    s.searchQuery = q.trim();
    s.dialog = "search";
    s.emit();
  };
  return (
    <footer class="statusbar">
      <span class={`status-dot ${s.running ? "on" : ""}`} />
      <span class="status-text" title={s.status}>
        {s.status}
      </span>
      {s.uiBusy && <span class="ui-busy">⟳ {t("ui_translating")}</span>}
      <span class="spacer" />
      <input class="search" placeholder={t("search_placeholder")} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && search()} />
      <button onClick={search}>{t("btn_search")}</button>
      <button onClick={() => s.clearAll()}>{t("btn_clear")}</button>
      <button class={s.running ? "danger" : "primary"} onClick={() => void (s.running ? stopEngine() : startEngine())}>
        {s.running ? t("btn_stop") : t("btn_start")}
      </button>
      <a
        class="link"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          s.dialog = "glossary";
          s.emit();
        }}
      >
        {t("glossary_link")}
      </a>
      <button class="about-btn" title={t("about_title")} onClick={() => ((s.dialog = "about"), s.emit())}>
        ⓘ v{s.init.version}
      </button>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
function App() {
  const s = useStore();
  const close = () => {
    s.dialog = null;
    s.emit();
  };
  if (s.overlay)
    return (
      <>
        <OverlayApp />
        {s.dialog === "about" && <AboutDialog onClose={close} />}
        <ContextMenuHost />
      </>
    );
  return (
    <div class="app">
      <Toolbar />
      <ClientTabs />
      <ChannelTabs client={s.currentClient} />
      <ChatView client={s.currentClient} />
      <ReplyBar />
      <StatusBar />
      {s.dialog === "clients" && <ClientsDialog onClose={close} onApplied={() => void restartEngineIfRunning()} />}
      {s.dialog === "settings" && <SettingsDialog onClose={close} />}
      {s.dialog === "alerts" && <AlertsDialog onClose={close} />}
      {s.dialog === "alertlog" && <AlertLogDialog onClose={close} />}
      {s.dialog === "glossary" && <GlossaryDialog onClose={close} />}
      {s.dialog === "search" && <SearchDialog onClose={close} query={s.searchQuery} />}
      {s.dialog === "about" && <AboutDialog onClose={close} />}
      <ContextMenuHost />
    </div>
  );
}

async function boot() {
  await store.load();
  const a = api();
  // a mode switch hands over the previous window's state (history, unread marks, alert log)
  if (store.init.snapshot) store.restore(store.init.snapshot as Snapshot);
  store.running = store.init.engineRunning;
  (window as unknown as { __babelwurmSnapshot: () => Snapshot }).__babelwurmSnapshot = () => store.snapshot();
  a.onMessage((m) => store.onMessage(m));
  a.onEngineEvent((e) => {
    if (e.type === "channels") {
      store.addChannels(e.clientIdx, e.channels);
      return;
    }
    if (e.type === "watcher_restarted") store.status = store.t("watcher_restarted");
    else if (e.type === "worker_restarted") store.status = store.t("worker_restarted");
    else store.status = store.t("status_error", { msg: e.message });
    store.emit();
  });
  a.onJump((j) => {
    store.dialog = null;
    store.jump(j.clientIdx, j.channel);
  });
  a.onAppMenu((cmd) => {
    if (cmd === "settings" || cmd === "about") {
      store.dialog = cmd;
      store.emit();
    }
  });
  // Ctrl+Q / Cmd+Q quits completely (the window's close button may only hide to the tray)
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "q") {
      e.preventDefault();
      void a.quit();
    }
  });
  document.addEventListener("visibilitychange", () => {
    // coming back from the tray: the open tab is now read
    if (document.visibilityState === "visible") store.switchTab(store.currentClient, store.tabOf(store.currentClient));
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => store.applyAppearance());
  // periodic status refresh, even without messages
  setInterval(async () => {
    if (!store.running) return;
    const st = await a.status();
    store.backend = st.backend;
    store.count = st.count;
    store.status = store.t("status_running", { n: st.count, backend: store.backendText() });
    store.emit();
  }, 5000);
  render(<App />, document.getElementById("root")!);
  await a.ready(); // messages queued during a mode switch arrive now
  // watching starts right away (unless it already runs: mode switch)
  if (!store.running) setTimeout(() => void startEngine(), 300);
}

void boot();
