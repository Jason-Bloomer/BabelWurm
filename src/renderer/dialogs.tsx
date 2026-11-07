/** Dialogs: Clients, Settings, Alerts, Alert log, Glossary, Search results. */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { BUILTIN_SOUNDS, newRuleId, ruleChannels, type AlertRule } from "../core/alerts";
import { isHandTranslated, UI_LANGS } from "../core/i18n";
import { englishName, nativeName } from "../core/languages";
import type { ClientCfg, GlossaryItem } from "../shared/api";
import { ABOUT } from "../shared/about";
import { api, store, useStore } from "./store";
import { Check, LanguagePicker, Modal, openMenuAt, type MenuItem } from "./ui";

// ---------------------------------------------------------------------------
// Inline-editable cell: text, double-click (or Enter) to edit
// ---------------------------------------------------------------------------
function EditCell(props: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  autoEdit?: boolean;
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(!!props.autoEdit);
  const [v, setV] = useState(props.value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setV(props.value), [props.value]);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);
  if (!editing)
    return (
      <div class={`cell-text ${props.mono ? "mono" : ""} ${props.value ? "" : "placeholder"}`} onDblClick={() => setEditing(true)} title={props.value}>
        {props.value || props.placeholder || "—"}
      </div>
    );
  const commit = () => {
    setEditing(false);
    if (v.trim() !== props.value) props.onCommit(v.trim());
  };
  return (
    <input
      ref={ref}
      class="cell-input"
      value={v}
      onInput={(e) => setV((e.target as HTMLInputElement).value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          e.stopPropagation();
          setV(props.value);
          setEditing(false);
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Clients — log folders
// ---------------------------------------------------------------------------
export function ClientsDialog(props: { onClose: () => void; onApplied: () => void }) {
  const s = useStore();
  const t = s.t;
  const [rows, setRows] = useState<ClientCfg[]>(() => s.cfg.clients.map((c) => ({ ...c })));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState("");

  const findAll = async () => {
    const found = await api().findAllClients();
    if (!found.length) {
      setMsg(t("find_none"));
      return;
    }
    const existing = new Set(rows.map((r) => r.path.toLowerCase()));
    const add = found.filter((f) => !existing.has(f.path.toLowerCase()));
    if (!add.length) setMsg(t("find_all_present"));
    else {
      setRows([...rows, ...add]);
      setMsg("");
    }
  };
  const addManual = async () => {
    const d = await api().pickFolder(t("add_dir_title"));
    if (!d) return;
    const parts = d.replace(/[\\/]+$/, "").split(/[\\/]/);
    const name = (parts[parts.length - 1].toLowerCase() === "logs" ? parts[parts.length - 2] : parts[parts.length - 1]) || t("client_default", { n: rows.length + 1 });
    setRows([...rows, { name, path: d }]);
  };
  const remove = () => {
    setRows(rows.filter((_r, i) => !sel.has(i)));
    setSel(new Set());
  };
  const apply = () => {
    const clients = rows.map((r, k) => ({ name: r.name || t("client_default", { n: k + 1 }), path: r.path }));
    const changed = JSON.stringify(clients) !== JSON.stringify(s.cfg.clients);
    if (changed) {
      void s.set({ clients }).then(() => {
        s.clientsChanged();
        props.onApplied();
      });
    }
    props.onClose();
  };
  const click = (i: number, e: MouseEvent) => {
    const n = new Set(e.ctrlKey || e.metaKey ? sel : []);
    if (n.has(i) && (e.ctrlKey || e.metaKey)) n.delete(i);
    else n.add(i);
    setSel(n);
  };

  return (
    <Modal
      title={t("dlg_clients_title")}
      onClose={apply}
      width={760}
      footer={
        <>
          <button onClick={findAll}>{t("btn_find_all")}</button>
          <button onClick={addManual}>{t("btn_add")}</button>
          <button onClick={remove} disabled={!sel.size}>
            {t("btn_remove")}
          </button>
          <span class="spacer" />
          <button class="primary" onClick={apply}>
            {t("btn_close")}
          </button>
        </>
      }
    >
      <table class="grid">
        <thead>
          <tr>
            <th style={{ width: "28%" }}>{t("col_name")}</th>
            <th>{t("col_path")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} class={sel.has(i) ? "selected" : ""} onClick={(e) => click(i, e as unknown as MouseEvent)}>
              <td>
                <EditCell value={r.name} onCommit={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, name: v } : x)))} />
              </td>
              <td>
                <EditCell mono value={r.path} onCommit={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, path: v } : x)))} />
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={2} class="muted center">
                {t("clients_none")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p class="hint">{msg || t("clients_hint")}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export function SettingsDialog(props: { onClose: () => void }) {
  const s = useStore();
  const t = s.t;
  const c = s.cfg;
  const fileName = c.sound_file ? c.sound_file.split(/[\\/]/).pop() : "";
  return (
    <Modal
      title={t("settings_title")}
      onClose={props.onClose}
      width={560}
      footer={
        <>
          <button onClick={() => void api().openDataDir()}>{t("btn_open_data")}</button>
          <button class="danger" onClick={() => void api().quit()} title="Ctrl+Q">
            {t("btn_quit")}
          </button>
          <span class="spacer" />
          <button class="primary" onClick={props.onClose}>
            {t("settings_close")}
          </button>
        </>
      }
    >
      <section class="settings-section">
        <h3>{t("section_translation")}</h3>
        <div class="row">
          <span class="label">{t("lang_label")}</span>
          <LanguagePicker
            value={c.target_lang || "auto"}
            onChange={(code) => void s.set({ target_lang: code, reply_src: "" })}
            languages={s.languages}
            autoLabel={t("lang_auto")}
            searchPlaceholder={t("lang_search")}
            pinned={["en", "ru", "pt", "de", "es", "fr", "zh"]}
          />
        </div>
        <Check checked={c.translate_lang_channels} onChange={(v) => void s.set({ translate_lang_channels: v })}>
          {t("opt_lang_channels")}
        </Check>
        <Check checked={c.translate_currency} onChange={(v) => void s.set({ translate_currency: v })}>
          {t("opt_currency")}
        </Check>
        <Check checked={c.auto_copy_reply} onChange={(v) => void s.set({ auto_copy_reply: v })}>
          {t("opt_auto_copy")}
        </Check>
      </section>

      <section class="settings-section">
        <h3>{t("section_sound")}</h3>
        <div class="row">
          <span class="label">{t("opt_sound")}</span>
          <select value={BUILTIN_SOUNDS.includes(c.sound as never) ? c.sound : "beep"} onChange={(e) => void s.set({ sound: (e.target as HTMLSelectElement).value })}>
            {BUILTIN_SOUNDS.map((sid) => (
              <option value={sid} key={sid}>
                {t(`snd_${sid}`)}
              </option>
            ))}
          </select>
          <button onClick={() => s.play(c.sound || "beep")}>▶ {t("btn_play")}</button>
        </div>
        <p class="hint small">{t("sound_global_hint")}</p>
        <div class="row">
          <span class="label">{t("opt_custom_sound")}</span>
          <span class="file-name" title={c.sound_file}>
            {fileName || "—"}
          </span>
          <button
            onClick={async () => {
              const f = await api().pickSoundFile(t("sound_file_filter"));
              if (f) await s.set({ sound_file: f });
            }}
          >
            {t("btn_browse")}
          </button>
          {c.sound_file && <button onClick={() => void s.set({ sound_file: "" })}>{t("btn_clear_file")}</button>}
        </div>
      </section>

      <section class="settings-section">
        <h3>{t("section_appearance")}</h3>
        <div class="row">
          <span class="label">{t("opt_ui_lang")}</span>
          <LanguagePicker
            value={c.ui_lang || "auto"}
            onChange={(code) => void s.set({ ui_lang: code })}
            languages={s.languages}
            autoLabel={t("ui_lang_auto")}
            searchPlaceholder={t("lang_search")}
            pinned={[...UI_LANGS]}
          />
          {s.uiBusy && <span class="muted small">{t("ui_translating")}</span>}
        </div>
        {!isHandTranslated(s.uiLang) && (
          <div class="row">
            <span class="label" />
            <span class="hint small" style={{ margin: 0, flex: 1 }}>
              {t("ui_machine_note")}
            </span>
            <button disabled={s.uiBusy} onClick={() => void api().retranslateUi()}>
              {t("btn_retranslate_ui")}
            </button>
          </div>
        )}
        <div class="row">
          <span class="label">{t("opt_theme")}</span>
          <select value={c.theme || "system"} onChange={(e) => void s.set({ theme: (e.target as HTMLSelectElement).value })}>
            <option value="system">{t("theme_system")}</option>
            <option value="light">{t("theme_light")}</option>
            <option value="dark">{t("theme_dark")}</option>
          </select>
        </div>
        <div class="row">
          <span class="label">{t("opt_font_size")}</span>
          <input
            type="range"
            min={10}
            max={22}
            value={c.font_size || 13}
            onInput={(e) => void s.set({ font_size: Number((e.target as HTMLInputElement).value) })}
          />
          <span class="muted">{c.font_size || 13}px</span>
        </div>
        <Check checked={c.highlight_mentions} onChange={(v) => void s.set({ highlight_mentions: v })}>
          {t("opt_mentions")}
        </Check>
      </section>

      <section class="settings-section">
        <h3>{t("section_tabs")}</h3>
        <div class="row">
          <span class="label">{t("hidden_tabs")}</span>
          {(c.hidden_channels || []).length === 0 && <span class="muted">{t("hidden_none")}</span>}
          {(c.hidden_channels || []).map((ch) => (
            <button key={ch} class="chip" title={t("unhide")} onClick={() => s.unhideChannel(ch)}>
              {ch} ✕
            </button>
          ))}
        </div>
        <p class="hint small">{t("tabs_hint")}</p>
      </section>

      <MagnifierSettings />

      <section class="settings-section">
        <h3>{t("section_app")}</h3>
        {s.init.hasTray && (
          <div class="row">
            <span class="label">{t("opt_close_action")}</span>
            <select value={c.close_action || "ask"} onChange={(e) => void s.set({ close_action: (e.target as HTMLSelectElement).value as "ask" | "tray" | "quit" })}>
              <option value="ask">{t("close_ask")}</option>
              <option value="tray">{t("close_tray")}</option>
              <option value="quit">{t("close_quit")}</option>
            </select>
          </div>
        )}
        <Check checked={c.check_updates} onChange={(v) => void s.set({ check_updates: v })}>
          {t("opt_check_updates")}
        </Check>
      </section>
      <p class="hint">{t("settings_hint")}</p>
    </Modal>
  );
}

/** Magnifier + overlay settings, with the global shortcuts. */
function MagnifierSettings() {
  const s = useStore();
  const t = s.t;
  const m = s.cfg.magnifier;
  const [keys, setKeys] = useState({
    mag_toggle: m?.hotkey_toggle || "",
    mag_translate: m?.hotkey_translate || "",
    overlay: s.cfg.overlay?.hotkey || "",
  });
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const apply = async () => {
    const k = { mag_toggle: keys.mag_toggle.trim(), mag_translate: keys.mag_translate.trim(), overlay: keys.overlay.trim() };
    setErrors(await api().setHotkeys(k));
    s.cfg.magnifier = { ...s.cfg.magnifier, hotkey_toggle: k.mag_toggle, hotkey_translate: k.mag_translate };
    s.cfg.overlay = { ...s.cfg.overlay, hotkey: k.overlay };
  };
  const field = (name: keyof typeof keys) => (
    <>
      <input
        class="mono hotkey"
        value={keys[name]}
        onInput={(e) => setKeys({ ...keys, [name]: (e.target as HTMLInputElement).value })}
        onBlur={() => void apply()}
        onKeyDown={(e) => e.key === "Enter" && void apply()}
      />
      {errors[keys[name].trim()] && <span class="m-err small">{t("hotkey_invalid")}</span>}
    </>
  );
  const ov = s.cfg.overlay;
  const setOv = async (patch: { opacity?: number; no_focus?: boolean }) => {
    s.cfg.overlay = await api().overlaySet(patch);
    s.applyAppearance();
    s.emit();
  };
  return (
    <>
      <section class="settings-section">
        <h3>{t("section_magnifier")}</h3>
        <div class="row">
          <span class="label">{t("opt_mag_hotkey")}</span>
          {field("mag_toggle")}
        </div>
        <div class="row">
          <span class="label">{t("opt_mag_hotkey_tr")}</span>
          {field("mag_translate")}
        </div>
      </section>
      <section class="settings-section">
        <h3>{t("section_overlay")}</h3>
        <div class="row">
          <span class="label">{t("opt_overlay_hotkey")}</span>
          {field("overlay")}
        </div>
        <div class="row">
          <span class="label">{t("overlay_opacity")}</span>
          <input
            type="range"
            min={15}
            max={100}
            value={Math.round((ov?.opacity ?? 0.7) * 100)}
            onInput={(e) => void setOv({ opacity: Number((e.target as HTMLInputElement).value) / 100 })}
          />
          <span class="muted">{Math.round((ov?.opacity ?? 0.7) * 100)}%</span>
        </div>
        {s.init.clickThroughSupported && (
          <Check checked={ov?.no_focus ?? true} onChange={(v) => void setOv({ no_focus: v })}>
            {t("opt_overlay_no_focus")}
          </Check>
        )}
        <p class="hint small">{t("overlay_settings_hint")}</p>
        <p class="hint small">{t("mag_settings_hint")}</p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export function AlertsDialog(props: { onClose: () => void }) {
  const s = useStore();
  const t = s.t;
  const [rules, setRules] = useState<AlertRule[]>(() => s.cfg.alerts.map((r) => ({ ...r })));
  const [sel, setSel] = useState<number | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const save = (next: AlertRule[]) => {
    setRules(next);
    void s.set({ alerts: next });
  };
  const patch = (i: number, p: Partial<AlertRule>) => save(rules.map((r, k) => (k === i ? { ...r, ...p } : r)));

  const channelText = (r: AlertRule) => {
    const ch = ruleChannels(r);
    return ch.length ? s.allChannels().filter((n) => ch.includes(n)).join(", ") || ch.join(", ") : t("alert_any");
  };
  const soundText = (r: AlertRule) => (!r.sound ? "—" : r.sound_id ? t(`snd_${r.sound_id}`) : "✓");

  const channelMenu = (i: number, x: number, y: number) => {
    const build = (): MenuItem[] => {
      const r = rulesRef.current[i];
      const chans = new Set(ruleChannels(r));
      const toggle = (name: string | null) => {
        const cur = new Set(ruleChannels(rulesRef.current[i]));
        if (name === null) cur.clear();
        else if (cur.has(name)) cur.delete(name);
        else cur.add(name);
        const { channel: _old, ...rest } = rulesRef.current[i];
        const next = rulesRef.current.map((x, k) => (k === i ? { ...rest, channels: s.allChannels().filter((n) => cur.has(n)) } : x));
        rulesRef.current = next;
        save(next);
        // multi-select: the list stays open and shows the new state
        openMenuAt(x, y, build());
      };
      return [
        { label: t("alert_any"), checked: chans.size === 0, keepOpen: true, onClick: () => toggle(null) },
        { separator: true },
        ...s.allChannels().map((n) => ({ label: n, checked: chans.has(n), keepOpen: true, onClick: () => toggle(n) })),
      ];
    };
    openMenuAt(x, y, build());
  };
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const soundMenu = (i: number, x: number, y: number) => {
    const r = rules[i];
    const cur = !r.sound ? "off" : r.sound_id || "";
    const pick = (sid: string) => {
      if (sid === "off") patch(i, { sound: false });
      else {
        const { sound_id: _x, ...rest } = rules[i];
        const next = sid ? { ...rest, sound: true, sound_id: sid } : { ...rest, sound: true };
        save(rules.map((q, k) => (k === i ? next : q)));
        s.play(sid || s.channelSoundId(ruleChannels(r)[0] || ""));
      }
    };
    openMenuAt(x, y, [
      { label: t("sound_off"), radio: true, checked: cur === "off", onClick: () => pick("off") },
      { label: t("sound_channel_default"), radio: true, checked: cur === "", onClick: () => pick("") },
      { separator: true },
      ...BUILTIN_SOUNDS.map((sid) => ({ label: t(`snd_${sid}`), radio: true, checked: cur === sid, onClick: () => pick(sid) })),
    ]);
  };

  const add = () => {
    const id = newRuleId();
    const next = [...rules, { id, channels: [], pattern: "", enabled: true, sound: true, notify: false, note: "" }];
    setRules(next); // saved once a substring is entered
    setSel(next.length - 1);
    setFresh(id);
  };
  const remove = () => {
    if (sel === null) return;
    save(rules.filter((_r, k) => k !== sel));
    setSel(null);
  };
  const close = () => {
    save(rules.filter((r) => String(r.pattern || "").trim()));
    props.onClose();
  };
  const cellBtn = (e: MouseEvent, fn: (x: number, y: number) => void) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    e.stopPropagation();
    fn(r.left, r.bottom + 2);
  };

  return (
    <Modal
      title={t("alerts_title")}
      onClose={close}
      width={900}
      footer={
        <>
          <button onClick={add}>＋ {t("alerts_add")}</button>
          <button onClick={remove} disabled={sel === null}>
            {t("alerts_remove")}
          </button>
          <span class="spacer" />
          <button class="primary" onClick={close}>
            {t("btn_close")}
          </button>
        </>
      }
    >
      <table class="grid alerts">
        <thead>
          <tr>
            <th style={{ width: 48 }}>{t("alerts_col_on")}</th>
            <th style={{ width: "19%" }}>{t("alerts_col_channel")}</th>
            <th>{t("alerts_col_pattern")}</th>
            <th style={{ width: 110 }}>{t("alerts_col_sound")}</th>
            <th style={{ width: 70 }}>{t("alerts_col_notify")}</th>
            <th style={{ width: "26%" }}>{t("alerts_col_note")}</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={r.id || i} class={sel === i ? "selected" : ""} onClick={() => setSel(i)}>
              <td class="center">
                <button class={`tick ${r.enabled !== false ? "on" : ""}`} onClick={(e) => (e.stopPropagation(), patch(i, { enabled: r.enabled === false }))}>
                  {r.enabled !== false ? "✓" : "—"}
                </button>
              </td>
              <td>
                <button class="cell-drop" onClick={(e) => cellBtn(e as unknown as MouseEvent, (x, y) => channelMenu(i, x, y))}>
                  {channelText(r)} <span class="caret">▾</span>
                </button>
              </td>
              <td>
                <EditCell
                  value={r.pattern || ""}
                  autoEdit={fresh === r.id}
                  onCommit={(v) => {
                    setFresh(null);
                    // an empty substring keeps the old value: a typo must not delete the rule
                    if (v) patch(i, { pattern: v });
                  }}
                />
              </td>
              <td>
                <button class="cell-drop" onClick={(e) => cellBtn(e as unknown as MouseEvent, (x, y) => soundMenu(i, x, y))}>
                  {soundText(r)} <span class="caret">▾</span>
                </button>
              </td>
              <td class="center">
                <button class={`tick ${r.notify ? "on" : ""}`} onClick={(e) => (e.stopPropagation(), patch(i, { notify: !r.notify }))}>
                  {r.notify ? "✓" : "—"}
                </button>
              </td>
              <td>
                <EditCell value={r.note || ""} onCommit={(v) => patch(i, { note: v })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="hint">{t("alerts_hint")}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Alert log
// ---------------------------------------------------------------------------
export function AlertLogDialog(props: { onClose: () => void }) {
  const s = useStore();
  const t = s.t;
  const list = s.alertLog;
  return (
    <Modal
      title={t("alerts_log_title")}
      onClose={props.onClose}
      width={640}
      footer={
        <>
          <span class="spacer" />
          <button class="primary" onClick={props.onClose}>
            {t("btn_close")}
          </button>
        </>
      }
    >
      {!list.length ? (
        <p class="muted">{t("alerts_log_empty")}</p>
      ) : (
        <table class="grid">
          <thead>
            <tr>
              <th style={{ width: 80 }}>{t("alerts_log_col_time")}</th>
              <th style={{ width: "24%" }}>{t("alerts_log_col_channel")}</th>
              <th>{t("alerts_log_col_text")}</th>
            </tr>
          </thead>
          <tbody>
            {list
              .map((rec, i) => (
                <tr
                  key={i}
                  class="clickable"
                  onDblClick={() => {
                    props.onClose();
                    s.jump(rec.client, rec.channel);
                  }}
                >
                  <td class="mono">{rec.at}</td>
                  <td>{s.placeLabel(rec.client, rec.channel)}</td>
                  <td>{rec.text.slice(0, 160)}</td>
                </tr>
              ))
              .reverse()}
          </tbody>
        </table>
      )}
      <p class="hint">{t("search_hint")}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Glossary editor
// ---------------------------------------------------------------------------
export function GlossaryDialog(props: { onClose: () => void }) {
  const s = useStore();
  const t = s.t;
  const [items, setItems] = useState<GlossaryItem[] | null>(null);
  const [lang, setLang] = useState(s.targetLang === "en" ? "ru" : s.targetLang);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState("");
  const [test, setTest] = useState("");
  const [testOut, setTestOut] = useState("—");
  const [fresh, setFresh] = useState<number | null>(null);
  const testSeq = useRef(0);

  useEffect(() => {
    void api()
      .glossaryGet()
      .then((r) => {
        setItems(r.items);
        setStatus(t("glossary_status", { n: r.items.length }));
      });
  }, []);

  const save = async (next: GlossaryItem[]) => {
    setItems(next);
    const r = await api().glossarySave(next);
    setStatus(r.ok ? t("glossary_status", { n: next.length }) : t("glossary_save_err", { exc: r.error || "" }));
  };
  const setCell = (i: number, col: string, v: string) => {
    if (!items) return;
    const next = items.map((it, k) => (k === i ? { ...it, [col]: v } : it));
    const it = next[i];
    // an entry without a term and without any translation is removed
    const empty = !String(it.en || "").trim() && !Object.entries(it).some(([k, x]) => k !== "en" && String(x || "").trim());
    void save(empty ? next.filter((_x, k) => k !== i) : next);
  };
  const add = () => {
    if (!items) return;
    setItems([...items, { en: "", [lang]: "" }]);
    setFresh(items.length);
    setTimeout(() => document.querySelector(".glossary-table tbody tr:last-child")?.scrollIntoView({ block: "nearest" }), 0);
  };
  const remove = () => {
    if (!items || !sel.size) return;
    void save(items.filter((_x, k) => !sel.has(k)));
    setSel(new Set());
  };
  const onTest = (v: string) => {
    setTest(v);
    const my = ++testSeq.current;
    if (!v.trim()) {
      setTestOut("—");
      return;
    }
    setTestOut("…");
    // debounce: translate shortly after the last keystroke
    setTimeout(async () => {
      if (my !== testSeq.current) return;
      const r = await api().preview(v.trim(), lang);
      if (my === testSeq.current) setTestOut(r || t("status_translate_fail"));
    }, 600);
  };
  const shown = useMemo(() => (items || []).map((it, i) => ({ it, i })), [items]);
  const langLabel = `${nativeName(lang)} (${lang})`;

  return (
    <Modal
      title={`${t("glossary_title")} — ${t("app_title")}`}
      onClose={props.onClose}
      width={820}
      className="glossary"
      footer={
        <>
          <button onClick={add}>{t("btn_add_row")}</button>
          <button onClick={remove} disabled={!sel.size}>
            {t("btn_delete_sel")}
          </button>
          <button onClick={() => void api().openGlossaryFile()}>{t("btn_open_file")}</button>
          <span class="spacer" />
          <button class="primary" onClick={props.onClose}>
            {t("btn_close")}
          </button>
        </>
      }
    >
      <div class="row">
        <span class="label">{t("glossary_lang")}</span>
        <LanguagePicker
          value={lang}
          onChange={(c) => {
            setLang(c);
            onTest(test);
          }}
          languages={s.languages.filter((l) => l.code !== "en")}
          searchPlaceholder={t("lang_search")}
          pinned={[s.targetLang, "ru"]}
        />
        <span class="muted small">{englishName(lang)}</span>
      </div>
      <div class="table-scroll">
        <table class="grid glossary-table">
          <thead>
            <tr>
              <th style={{ width: "45%" }}>{t("col_en")}</th>
              <th>
                {t("col_ru")} — {langLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ it, i }) => (
              <tr
                key={i}
                class={sel.has(i) ? "selected" : ""}
                onClick={(e) => {
                  const n = new Set((e as unknown as MouseEvent).ctrlKey || (e as unknown as MouseEvent).metaKey ? sel : []);
                  n.add(i);
                  setSel(n);
                }}
              >
                <td>
                  <EditCell value={String(it.en || "")} autoEdit={fresh === i} onCommit={(v) => (setFresh(null), setCell(i, "en", v))} />
                </td>
                <td>
                  <EditCell value={String(it[lang] || "")} onCommit={(v) => setCell(i, lang, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset class="test-box">
        <legend>{t("test_frame")}</legend>
        <input value={test} onInput={(e) => onTest((e.target as HTMLInputElement).value)} placeholder="WTS 90ql nails, 2g 50s" />
        <div class="test-out">{testOut}</div>
      </fieldset>
      <p class="hint">{status}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------
export function SearchDialog(props: { onClose: () => void; query: string }) {
  const s = useStore();
  const t = s.t;
  const q = props.query.toLowerCase();
  const results = useMemo(() => {
    const out: Array<{ ci: number; ch: string; tab: string; time: string; name: string | null; original: string; translated: string | null }> = [];
    for (const [k, entries] of store.history) {
      const [ciS, ch] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
      for (const e of entries) {
        const hay = [e.name, e.sub, e.original, e.translated].filter(Boolean).join(" ").toLowerCase();
        if (hay.includes(q)) out.push({ ci: Number(ciS), ch: e.sub ? `${ch}: ${e.sub}` : ch, tab: ch, time: e.time, name: e.name, original: e.original, translated: e.translated });
      }
    }
    return out;
  }, [q, s.version]);
  return (
    <Modal
      title={t("search_title", { query: props.query, n: results.length })}
      onClose={props.onClose}
      width={720}
      footer={
        <>
          <span class="muted small">{t("search_hint")}</span>
          <span class="spacer" />
          <button class="primary" onClick={props.onClose}>
            {t("btn_close")}
          </button>
        </>
      }
    >
      {!results.length && <p class="muted">{t("search_empty")}</p>}
      <div class="search-results">
        {results.map((r, i) => (
          <div
            key={i}
            class="search-hit"
            dir="auto"
            onDblClick={() => {
              props.onClose();
              s.jump(r.ci, r.tab);
            }}
          >
            <span class="m-ch">[{s.placeLabel(r.ci, r.ch)}] </span>
            {r.time && <span class="m-time">[{r.time}] </span>}
            {r.name && <span class="m-name">{r.name}: </span>}
            <span>{r.translated || r.original}</span>
            {r.translated && r.translated !== r.original && s.cfg.show_original && <div class="m-orig">{r.original}</div>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------
export function AboutDialog(props: { onClose: () => void }) {
  const s = useStore();
  const t = s.t;
  const [copied, setCopied] = useState(false);
  const rt = s.init.runtime;
  const info = [
    `${ABOUT.name} v${s.init.version}`,
    `${rt.os} (${rt.arch})`,
    `Electron ${rt.electron} · Chromium ${rt.chrome} · Node ${rt.node}`,
    `UI: ${s.uiLang} · Translate to: ${s.targetLang}`,
  ].join("\n");
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  );
  return (
    <Modal
      title={t("about_title")}
      onClose={props.onClose}
      width={460}
      className="about"
      footer={
        <>
          <button
            onClick={async () => {
              await api().copy(info);
              setCopied(true);
            }}
          >
            {copied ? `✓ ${t("about_copied")}` : t("about_copy")}
          </button>
          <span class="spacer" />
          <button class="primary" onClick={props.onClose}>
            {t("btn_close")}
          </button>
        </>
      }
    >
      <div class="about-head">
        {s.init.logoUrl && <img class="about-logo" src={s.init.logoUrl} alt={ABOUT.name} width={128} height={128} />}
        <div class="about-name">{ABOUT.name}</div>
        <div class="about-tagline">{t("about_tagline")}</div>
        <div class="about-version">{t("about_version", { v: s.init.version })}</div>
      </div>
      <dl class="about-list">
        <dt>{t("about_developer")}</dt>
        <dd>{link(ABOUT.developerUrl, ABOUT.developer)}</dd>
        <dt>{t("about_project")}</dt>
        <dd>{link(ABOUT.projectUrl, ABOUT.projectUrl.replace(/^https:\/\//, ""))}</dd>
        <dt>{t("about_source")}</dt>
        <dd>{link(ABOUT.repoUrl, ABOUT.repoUrl.replace(/^https:\/\//, ""))}</dd>
        <dt>{t("about_support")}</dt>
        <dd>
          {link(`mailto:${ABOUT.supportEmail}?subject=${encodeURIComponent(`${ABOUT.name} v${s.init.version}`)}`, ABOUT.supportEmail)}
          <div class="about-hint">{t("about_support_hint")}</div>
        </dd>
        <dt>{t("about_license")}</dt>
        <dd>
          {ABOUT.license} · © {ABOUT.year} {ABOUT.developer}
        </dd>
        <dt>{t("about_system")}</dt>
        <dd class="about-sys">
          {rt.os} ({rt.arch})
          <br />
          Electron {rt.electron} · Chromium {rt.chrome} · Node {rt.node}
        </dd>
      </dl>
    </Modal>
  );
}
