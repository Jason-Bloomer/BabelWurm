/** Magnifier overlay UI: drag handle + controls, transparent capture box, result panel. */
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { MagApi, MagInit, MagResult } from "../shared/api";

declare global {
  interface Window {
    magApi: MagApi;
  }
}
const api = () => window.magApi;
const AUTO_MS = 1500;

function Magnifier() {
  const [init, setInit] = useState<MagInit | null>(null);
  const [res, setRes] = useState<MagResult>({ state: "idle" });
  const [auto, setAuto] = useState(false);
  const [lang, setLang] = useState("eng");
  const box = useRef<HTMLDivElement>(null);
  const ignoring = useRef(false);

  const rect = () => {
    const r = box.current!.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };
  const read = (isAuto = false) => box.current && void api().capture(rect(), isAuto);

  useEffect(() => {
    void api()
      .init()
      .then((i) => {
        setInit(i);
        setAuto(i.auto);
        setLang(i.ocrLang);
        if (i.last && i.last.state !== "idle") setRes(i.last);
        document.documentElement.dataset.theme = i.dark ? "dark" : "light";
        document.title = i.labels.mag_title;
      });
    api().onResult(setRes);
    api().onTrigger(() => read(false));
  }, []);

  // auto mode: read every 1.5 s (main skips OCR when nothing changed under the box)
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => read(true), AUTO_MS);
    read(true);
    return () => clearInterval(id);
  }, [auto]);

  // click-through over the box interior (Windows/macOS): the game below stays usable
  useEffect(() => {
    if (!init?.clickThrough) return;
    const onMove = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const inside = el === box.current;
      if (inside !== ignoring.current) {
        ignoring.current = inside;
        api().ignoreMouse(inside);
      }
    };
    const onLeave = () => {
      if (ignoring.current) {
        ignoring.current = false;
        api().ignoreMouse(false);
      }
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [init]);

  // resize grip
  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = box.current!.getBoundingClientRect();
    const b = init!.border * 2;
    const sx = e.screenX;
    const sy = e.screenY;
    const move = (ev: PointerEvent) => api().resize(r.width - b + ev.screenX - sx, r.height - b + ev.screenY - sy);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  if (!init) return null;
  const L = init.labels;
  const busy = res.state === "reading" || res.state === "downloading";
  const langName = (code: string) => init.ocrLangs.find((l) => l.code === code)?.name || code;

  let panel;
  if (res.state === "idle") panel = <div class="mag-hint">{L.mag_hint}</div>;
  else if (res.state === "downloading") panel = <div class="mag-hint">{L.mag_downloading.replace("{lang}", langName(res.message || ""))}</div>;
  else if (res.state === "empty") panel = <div class="mag-hint">{L.mag_no_text}</div>;
  else if (res.state === "permission")
    panel = (
      <div class="mag-hint">
        {L.mag_mac_permission} <button onClick={() => api().openPrefs()}>{L.mag_open_prefs}</button>
      </div>
    );
  else if (res.state === "error") panel = <div class="mag-hint mag-err">{res.message}</div>;
  else
    panel = (
      <>
        <div class="mag-ocr" dir="auto">{res.text}</div>
        <div class="mag-tr" dir="auto">
          {res.state === "reading" && !res.translated ? L.mag_reading : res.translated === null ? L.status_translate_fail : res.translated}
        </div>
        <div class="mag-foot">
          {typeof res.confidence === "number" && <span>{L.mag_conf.replace("{n}", String(res.confidence))}</span>}
          {res.srcLang === init.targetLang && <span>· {L.mag_same_lang}</span>}
          <span class="spacer" />
          {res.translated && (
            <button class="icon" title={L.mag_copy} onClick={() => api().copy(res.translated!)}>
              ⧉ {L.mag_copy}
            </button>
          )}
        </div>
      </>
    );

  return (
    <div class="mag">
      <div class="mag-head" style={{ height: init.header }}>
        <span class="grip-dots">⋮⋮</span>
        <button class="primary" onClick={() => read(false)} disabled={busy} title={L.mag_hint}>
          {busy ? "…" : "🔍"} {L.mag_translate}
        </button>
        <label class="auto">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).checked;
              setAuto(v);
              api().set({ auto: v });
            }}
          />
          {L.mag_auto}
        </label>
        <select
          title={L.mag_ocr_lang}
          value={lang}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            setLang(v);
            api().set({ ocr_lang: v });
          }}
        >
          {init.ocrLangs.map((l) => (
            <option value={l.code} key={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <span class="spacer" />
        <button class="icon" title={L.mag_close} onClick={() => api().close()}>
          ✕
        </button>
      </div>
      <div ref={box} class={`mag-box ${busy ? "busy" : ""}`} style={{ height: `calc(100% - ${init.header + init.panel}px)` }}>
      </div>
      <div class="mag-panel" style={{ height: init.panel }}>
        {panel}
        {/* resize grip lives in the panel corner, outside the captured area */}
        <div class="mag-grip" onPointerDown={(e) => startResize(e as unknown as PointerEvent)} />
      </div>
    </div>
  );
}

render(<Magnifier />, document.getElementById("root")!);
