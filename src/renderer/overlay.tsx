/**
 * Overlay mode: the main window as a compact, see-through chat panel that
 * stays on top of the game — only the chat tabs and the open chat, plus a
 * strip of small side buttons (start/stop, magnifier, click-through,
 * background opacity, back to the normal window).
 */
import { useEffect, useRef } from "preact/hooks";
import { ChannelTabs, ChatView, ClientTabs, startEngine, stopEngine } from "./app";
import { api, store, useStore } from "./store";

const OPACITY_STEPS = [1, 0.85, 0.7, 0.55, 0.4, 0.25];

/** Small line icons (identical on every OS, unlike emoji/symbol fonts). */
const ICONS: Record<string, string> = {
  play: "M5 3.5v9l7.5-4.5z",
  stop: "M4.5 4.5h7v7h-7z",
  search: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3l3.2 3.2",
  through: "M4 2.5l8 4.2-3.5 1 2.3 4.2-1.5.8-2.3-4.2L4.5 11z",
  opacity: "M8 2.5a5.5 5.5 0 1 0 0 11zM8 2.5a5.5 5.5 0 1 1 0 11",
  exit: "M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9",
};
const FILLED = new Set(["play", "stop", "through"]);

function Icon(props: { name: string }) {
  const filled = FILLED.has(props.name);
  if (props.name === "opacity")
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d={ICONS[props.name]}
        fill={filled ? "currentColor" : "none"}
        fill-rule="evenodd"
        stroke="currentColor"
        stroke-width={filled ? 0.5 : 1.6}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function OverlayApp() {
  const s = useStore();
  const t = s.t;
  const ov = s.cfg.overlay;
  const ignoring = useRef(false);
  const clickThrough = !!ov?.click_through && s.init.clickThroughSupported;

  // Click-through: over the chat text, mouse clicks/wheel go to the game below
  useEffect(() => {
    const set = (v: boolean) => {
      if (v !== ignoring.current) {
        ignoring.current = v;
        api().overlayIgnoreMouse(v);
      }
    };
    if (!clickThrough) {
      set(false);
      return;
    }
    const onMove = (e: MouseEvent) => set(!!(e.target as HTMLElement).closest?.(".ov .chat"));
    const onLeave = () => set(false);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      set(false);
    };
  }, [clickThrough]);

  const setOv = async (patch: { opacity?: number; click_through?: boolean }) => {
    s.cfg.overlay = await api().overlaySet(patch);
    s.applyAppearance();
    s.emit();
  };
  const nextOpacity = () => {
    const cur = ov?.opacity ?? 0.7;
    const i = OPACITY_STEPS.findIndex((v) => Math.abs(v - cur) < 0.03);
    void setOv({ opacity: OPACITY_STEPS[(i + 1) % OPACITY_STEPS.length] });
  };

  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const w0 = window.innerWidth;
    const h0 = window.innerHeight;
    const sx = e.screenX;
    const sy = e.screenY;
    const move = (ev: PointerEvent) => api().overlayResize(w0 + ev.screenX - sx, h0 + ev.screenY - sy);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div class={`ov ${clickThrough ? "click-through" : ""}`}>
      <div class="ov-main">
        <div class="ov-top">
          <span class="ov-handle" title={t("overlay_drag")}>
            ⋮⋮
          </span>
          {s.cfg.clients.length > 1 && <ClientTabs />}
          <ChannelTabs client={s.currentClient} compact />
        </div>
        <ChatView client={s.currentClient} />
      </div>
      <div class="ov-side">
        <button
          class={`ov-side-btn ${s.running ? "running" : "stopped"}`}
          title={s.running ? t("btn_stop") : t("btn_start")}
          onClick={() => void (s.running ? stopEngine() : startEngine())}
        >
          <Icon name={s.running ? "stop" : "play"} />
        </button>
        <button class="ov-side-btn" title={t("mag_title")} onClick={() => void api().toggleMagnifier()}>
          <Icon name="search" />
        </button>
        {s.init.clickThroughSupported && (
          <button
            class={`ov-side-btn ${clickThrough ? "on" : ""}`}
            title={clickThrough ? t("overlay_ct_on") : t("overlay_ct_off")}
            onClick={() => void setOv({ click_through: !clickThrough })}
          >
            <Icon name="through" />
          </button>
        )}
        <button class="ov-side-btn" title={`${t("overlay_opacity")}: ${Math.round((ov?.opacity ?? 0.7) * 100)}%`} onClick={nextOpacity}>
          <Icon name="opacity" />
        </button>
        <span class="ov-side-fill" title={t("overlay_drag")} />
        <button class="ov-side-btn" title={t("overlay_exit")} onClick={() => void api().toggleOverlay(false)}>
          <Icon name="exit" />
        </button>
        <div class="ov-grip" title={t("overlay_resize")} onPointerDown={(e) => startResize(e as unknown as PointerEvent)} />
      </div>
    </div>
  );
}

