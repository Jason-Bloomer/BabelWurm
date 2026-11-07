/**
 * Desktop notifications.
 *
 * Electron's Notification works everywhere when the app is installed. A
 * portable Windows build has no Start-menu shortcut with an AppUserModelID,
 * and Windows silently drops toasts from unregistered apps, so the portable
 * build falls back to sending them through PowerShell.
 */
import { spawn } from "node:child_process";
import { Notification } from "electron";

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function powershellToast(title: string, body: string) {
  const xml =
    '<toast><visual><binding template="ToastGeneric">' +
    `<text>${xmlEscape(title)}</text><text>${xmlEscape(body)}</text>` +
    "</binding></visual></toast>";
  const ps = [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null",
    `$xml = '${xml.replace(/'/g, "''")}'`,
    "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$doc.LoadXml($xml)",
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)",
    "$toast.ExpirationTime = [DateTimeOffset]::Now.AddHours(1)",
    "$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)",
  ].join("\n");
  // the whole command as base64 UTF-16LE: quotes/unicode in the text can't break parsing
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    windowsHide: true,
    stdio: "ignore",
    detached: false,
  });
  child.on("error", () => {});
}

export function showNotification(title: string, body: string, onClick?: () => void, log: (m: string) => void = () => {}) {
  try {
    const portableWin = process.platform === "win32" && !!process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableWin || !Notification.isSupported()) {
      if (process.platform === "win32") powershellToast(title, body);
      return;
    }
    const n = new Notification({ title, body, silent: true });
    if (onClick) n.on("click", onClick);
    n.show();
  } catch (e) {
    log(`notification failed: ${e}`);
  }
}
