/**
 * Single instance with a choice: when a second copy is
 * launched it asks "Activate / Replace / Cancel". Uses a local socket (a named
 * pipe on Windows) so the running instance can be asked to show its window or
 * to quit.
 */
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

function socketPath(): string {
  const user = (os.userInfo().username || "user").replace(/[^A-Za-z0-9_-]/g, "_");
  if (process.platform === "win32") return `\\\\.\\pipe\\babelwurm-${user}`;
  return path.join(os.tmpdir(), `babelwurm-${user}.sock`);
}

/** Try to talk to a running instance. Resolves true when one answered. */
export function sendToRunning(cmd: "ping" | "activate" | "quit", timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection(socketPath());
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.once("connect", () => {
      sock.write(cmd + "\n");
    });
    sock.once("data", () => {
      clearTimeout(timer);
      sock.end();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** Wait until the running instance has gone (after "quit"). */
export async function waitUntilGone(maxMs = 6000): Promise<void> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    if (!(await sendToRunning("ping", 500))) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Become the instance others talk to. */
export function listen(handlers: { activate: () => void; quit: () => void }, log: (m: string) => void): net.Server {
  const p = socketPath();
  if (process.platform !== "win32") {
    try {
      fs.unlinkSync(p); // stale socket after a crash
    } catch {
      /* none */
    }
  }
  const server = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString();
      if (!buf.includes("\n")) return;
      const cmd = buf.trim();
      sock.write("ok\n");
      sock.end();
      if (cmd === "activate") {
        log("activation request from a second instance");
        handlers.activate();
      } else if (cmd === "quit") {
        log("second instance asked us to quit (replace)");
        handlers.quit();
      }
    });
    sock.on("error", () => {});
  });
  server.on("error", (e) => log(`instance server error: ${e}`));
  server.listen(p);
  return server;
}
