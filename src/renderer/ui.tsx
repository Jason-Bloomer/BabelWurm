/** Reusable UI pieces: modal dialog, context menu, searchable language picker. */
import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { englishName, nativeName, type Language } from "../core/languages";

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function Modal(props: {
  title: string;
  onClose: () => void;
  width?: number;
  children: ComponentChildren;
  footer?: ComponentChildren;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".ctx-menu, .picker-pop")) props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);
  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`modal ${props.className || ""}`} style={{ width: props.width ? `min(${props.width}px, 96vw)` : undefined }} role="dialog" aria-label={props.title}>
        <div class="modal-head">
          <h2>{props.title}</h2>
          <button class="icon-btn" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div class="modal-body">{props.children}</div>
        {props.footer && <div class="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------
export interface MenuItem {
  label?: string;
  onClick?: () => void;
  checked?: boolean;
  radio?: boolean;
  disabled?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
  /** Keep the menu open after clicking (multi-select lists). */
  keepOpen?: boolean;
}

type MenuState = { x: number; y: number; items: MenuItem[] } | null;
let setMenuGlobal: ((m: MenuState) => void) | null = null;

export function openMenu(e: MouseEvent | JSX.TargetedMouseEvent<Element>, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  setMenuGlobal?.({ x: e.clientX, y: e.clientY, items });
}

export function openMenuAt(x: number, y: number, items: MenuItem[]) {
  setMenuGlobal?.({ x, y, items });
}

export function closeMenu() {
  setMenuGlobal?.(null);
}

function MenuList(props: { items: MenuItem[]; x: number; y: number; onDone: () => void; sub?: boolean; altX?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: props.x, y: props.y });
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [subPos, setSubPos] = useState({ x: 0, y: 0, alt: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = props.x;
    let y = props.y;
    if (x + r.width > window.innerWidth - 4) x = props.sub && props.altX !== undefined ? props.altX - r.width + 2 : window.innerWidth - r.width - 4;
    if (y + r.height > window.innerHeight - 4) y = Math.max(4, window.innerHeight - r.height - 4);
    setPos({ x: Math.max(4, x), y });
  }, [props.x, props.y]);
  return (
    <div class="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      {props.items.map((it, i) =>
        it.separator ? (
          <div class="ctx-sep" key={i} />
        ) : (
          <div
            key={i}
            class={`ctx-item ${it.disabled ? "disabled" : ""} ${openSub === i ? "open" : ""}`}
            onMouseEnter={(e) => {
              if (it.submenu) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setSubPos({ x: r.right - 2, y: r.top - 4, alt: r.left });
                setOpenSub(i);
              } else setOpenSub(null);
            }}
            onClick={() => {
              if (it.disabled || it.submenu) return;
              it.onClick?.();
              if (!it.keepOpen) props.onDone();
            }}
          >
            <span class="ctx-check">{it.checked === undefined ? "" : it.radio ? (it.checked ? "●" : "○") : it.checked ? "✓" : ""}</span>
            <span class="ctx-label">{it.label}</span>
            {it.submenu && <span class="ctx-arrow">›</span>}
          </div>
        ),
      )}
      {openSub !== null && props.items[openSub]?.submenu && (
        <MenuList items={props.items[openSub].submenu!} x={subPos.x} y={subPos.y} altX={subPos.alt} onDone={props.onDone} sub />
      )}
    </div>
  );
}

export function ContextMenuHost() {
  const [menu, setMenu] = useState<MenuState>(null);
  setMenuGlobal = setMenu;
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  if (!menu) return null;
  return createPortal(<MenuList items={menu.items} x={menu.x} y={menu.y} onDone={() => setMenu(null)} />, document.body);
}

// ---------------------------------------------------------------------------
// Searchable language picker (all Google Translate languages)
// ---------------------------------------------------------------------------
export function LanguagePicker(props: {
  value: string;
  onChange: (code: string) => void;
  languages: Language[];
  /** "full": native name on the button; "compact": just the code. */
  mode?: "full" | "compact";
  autoLabel?: string;
  searchPlaceholder: string;
  title?: string;
  /** Extra codes pinned at the top (e.g. recently used). */
  pinned?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const rows = useMemo(() => {
    const all: Array<{ code: string; native: string; english: string }> = [];
    if (props.autoLabel) all.push({ code: "auto", native: props.autoLabel, english: "" });
    const pinned = (props.pinned || []).filter((c) => props.languages.some((l) => l.code === c));
    const seen = new Set<string>();
    for (const c of pinned) {
      seen.add(c);
      all.push({ code: c, native: nativeName(c), english: englishName(c) });
    }
    const rest = props.languages
      .filter((l) => !seen.has(l.code))
      .map((l) => ({ code: l.code, native: nativeName(l.code), english: l.name }))
      .sort((a, b) => a.english.localeCompare(b.english, "en"));
    all.push(...rest);
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((r) => r.code.toLowerCase().startsWith(s) || r.native.toLowerCase().includes(s) || r.english.toLowerCase().includes(s));
  }, [props.languages, props.autoLabel, props.pinned, q, open]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const pop = document.querySelector(".picker-pop");
      if (pop && !pop.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("blur", () => setOpen(false), { once: true });
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector(".picker-row.active") as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (code: string) => {
    setOpen(false);
    setQ("");
    if (code !== props.value) props.onChange(code);
  };

  const label =
    props.value === "auto" ? props.autoLabel || "Auto" : props.mode === "compact" ? props.value : `${nativeName(props.value)}`;

  const popStyle = (): JSX.CSSProperties => {
    if (!rect) return {};
    const w = 300;
    const h = 340;
    const left = Math.min(Math.max(4, rect.left), window.innerWidth - w - 4);
    const below = window.innerHeight - rect.bottom;
    return below > h + 8 || below > rect.top
      ? { left, top: rect.bottom + 4, width: w, maxHeight: Math.min(h, below - 8) }
      : { left, bottom: window.innerHeight - rect.top + 4, width: w, maxHeight: Math.min(h, rect.top - 8) };
  };

  return (
    <>
      <button
        ref={btn}
        class={`picker-btn ${props.mode === "compact" ? "compact" : ""}`}
        title={props.title || (props.value !== "auto" ? `${englishName(props.value)} (${props.value})` : undefined)}
        onClick={() => {
          setRect(btn.current!.getBoundingClientRect());
          setOpen(!open);
        }}
      >
        <span>{label}</span>
        <span class="caret">▾</span>
      </button>
      {open &&
        createPortal(
          <div class="picker-pop" style={popStyle()}>
            <input
              class="picker-search"
              autoFocus
              placeholder={props.searchPlaceholder}
              value={q}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(rows.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter" && rows[active]) choose(rows[active].code);
                else if (e.key === "Escape") setOpen(false);
              }}
            />
            <div class="picker-list" ref={listRef}>
              {rows.map((r, i) => (
                <div
                  key={r.code}
                  class={`picker-row ${i === active ? "active" : ""} ${r.code === props.value ? "selected" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(r.code)}
                >
                  <span class="picker-native">{r.native}</span>
                  {r.english && r.english !== r.native && <span class="picker-english">{r.english}</span>}
                  {r.code !== "auto" && <span class="picker-code">{r.code}</span>}
                </div>
              ))}
              {!rows.length && <div class="picker-empty">—</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function Check(props: { checked: boolean; onChange: (v: boolean) => void; children: ComponentChildren; title?: string }) {
  return (
    <label class="check" title={props.title}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
      <span>{props.children}</span>
    </label>
  );
}
