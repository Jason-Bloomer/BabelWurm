/** The "last alert" popup window (bottom-right corner, always on top). */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { AlertWindowApi } from "../shared/api";

declare global {
  interface Window {
    alertApi: AlertWindowApi;
  }
}

type Data = Parameters<Parameters<AlertWindowApi["onData"]>[0]>[0];

function AlertPopup() {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    window.alertApi.onData((x) => {
      setD(x);
      document.documentElement.dataset.theme = x.dark ? "dark" : "light";
      document.title = x.title;
    });
  }, []);
  if (!d) return null;
  return (
    <div class="alert-pop">
      <div class="alert-head">
        <span class="alert-bell">🔔</span>
        <span class="alert-head-text">{d.head}</span>
      </div>
      <div class="alert-text">{d.text}</div>
      <div class="alert-btns">
        <button class="primary" onClick={() => window.alertApi.jump()}>
          {d.jumpLabel}
        </button>
        <button onClick={() => window.alertApi.close()}>{d.closeLabel}</button>
      </div>
    </div>
  );
}

render(<AlertPopup />, document.getElementById("root")!);
