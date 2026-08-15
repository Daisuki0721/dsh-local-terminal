import { createRequire } from "node:module";
import { WebSocket, WebSocketServer } from "ws";
import { chmodSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import * as pty from "node-pty";
//#region src/pty-session.ts
const require = createRequire(import.meta.url);
function clampTerminalSize(cols, rows) {
	return {
		cols: Number.isFinite(cols) ? Math.min(500, Math.max(2, Math.trunc(cols))) : 80,
		rows: Number.isFinite(rows) ? Math.min(200, Math.max(1, Math.trunc(rows))) : 24
	};
}
function resolveTerminalCwd(candidate) {
	if (candidate !== void 0 && candidate !== "") {
		const path = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
		try {
			if (existsSync(path) && statSync(path).isDirectory()) return path;
		} catch {}
	}
	return process.cwd();
}
/**
* node-pty 1.1.0's macOS prebuild can arrive without the executable bit on
* spawn-helper when restored through a content-addressed package store.
* Repair only that package-owned helper before the native fork call.
*/
function ensureSpawnHelperExecutable() {
	if (process.platform === "win32") return;
	const packageRoot = dirname(require.resolve("node-pty/package.json"));
	const candidates = [
		join(packageRoot, "build", "Release", "spawn-helper"),
		join(packageRoot, "build", "Debug", "spawn-helper"),
		join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper")
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		const mode = statSync(candidate).mode & 511;
		if ((mode & 73) === 0) chmodSync(candidate, mode | 493);
		return;
	}
}
function openLocalPty(options) {
	ensureSpawnHelperExecutable();
	const shell = "/bin/zsh";
	const cwd = resolveTerminalCwd(options.cwd);
	const size = clampTerminalSize(options.cols, options.rows);
	const child = pty.spawn(shell, ["-l"], {
		name: "xterm-256color",
		cols: size.cols,
		rows: size.rows,
		cwd,
		env: {
			...process.env,
			HOME: process.env.HOME ?? homedir(),
			SHELL: shell,
			TERM: "xterm-256color",
			COLORTERM: "truecolor"
		}
	});
	let closed = false;
	let exitState = null;
	const dataListeners = /* @__PURE__ */ new Set();
	const exitListeners = /* @__PURE__ */ new Set();
	const pendingData = [];
	let pendingLength = 0;
	const dataSubscription = child.onData((data) => {
		if (dataListeners.size !== 0) {
			for (const listener of dataListeners) listener(data);
			return;
		}
		if (pendingLength < 1024 * 1024) {
			pendingData.push(data);
			pendingLength += data.length;
		}
	});
	child.onExit((event) => {
		exitState = {
			exitCode: event.exitCode,
			...event.signal !== void 0 ? { signal: event.signal } : {}
		};
		for (const listener of exitListeners) listener(event);
	});
	return {
		cwd,
		shell,
		get exitState() {
			return exitState;
		},
		write: (data) => {
			if (!closed) child.write(data);
		},
		resize: (cols, rows) => {
			if (closed) return;
			const next = clampTerminalSize(cols, rows);
			child.resize(next.cols, next.rows);
		},
		close: () => {
			if (closed) return;
			closed = true;
			dataSubscription.dispose();
			dataListeners.clear();
			exitListeners.clear();
			pendingData.length = 0;
			try {
				child.kill();
			} catch {}
		},
		onData: (listener) => {
			dataListeners.add(listener);
			if (pendingData.length !== 0) {
				const buffered = pendingData.splice(0).join("");
				pendingLength = 0;
				listener(buffered);
			}
			return { dispose: () => {
				dataListeners.delete(listener);
			} };
		},
		onExit: (listener) => {
			exitListeners.add(listener);
			if (exitState !== null) listener(exitState);
			return { dispose: () => {
				exitListeners.delete(listener);
			} };
		}
	};
}
//#endregion
//#region src/protocol.ts
const LOCAL_TERMINAL_PATH = "/api/dsh-local-terminal/pty";
//#endregion
//#region src/routes.ts
const wss = new WebSocketServer({ noServer: true });
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/** Keep a detached PTY alive this long so the client can reconnect to it. */
const DETACH_GRACE_MS = 6e4;
const MAX_SESSION_ID_LENGTH = 64;
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
function makeTerminalUpgrade() {
	const sessions = /* @__PURE__ */ new Map();
	const dispose = () => {
		for (const attached of sessions.values()) {
			if (attached.timer !== void 0) clearTimeout(attached.timer);
			attached.session.close();
		}
		sessions.clear();
	};
	const scheduleDetachCleanup = (sessionId, entry) => {
		if (entry.timer !== void 0) clearTimeout(entry.timer);
		entry.timer = setTimeout(() => {
			entry.session.close();
			sessions.delete(sessionId);
		}, DETACH_GRACE_MS);
	};
	return {
		upgrade: {
			path: LOCAL_TERMINAL_PATH,
			handler: (request, socket, head) => {
				if (!isLoopbackRequest(request)) {
					socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
					socket.destroy();
					return;
				}
				const url = new URL(request.url ?? "/", "http://localhost");
				const sessionId = url.searchParams.get("session");
				if (sessionId === null || sessionId === "" || sessionId.length > MAX_SESSION_ID_LENGTH) {
					socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
					socket.destroy();
					return;
				}
				const cols = Number.parseInt(url.searchParams.get("cols") ?? "80", 10);
				const rows = Number.parseInt(url.searchParams.get("rows") ?? "24", 10);
				const cwd = url.searchParams.get("cwd") ?? void 0;
				wss.handleUpgrade(request, socket, head, (ws) => {
					let session;
					let settled = false;
					const send = (frame) => {
						if (settled || ws.readyState !== WebSocket.OPEN) return;
						if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
							settled = true;
							try {
								ws.close(1013, "terminal output backpressure");
							} catch {}
							sessions.delete(sessionId);
							session?.close();
							return;
						}
						ws.send(JSON.stringify(frame));
					};
					const finish = () => {
						if (settled) return;
						settled = true;
						session = void 0;
					};
					const attachTo = (entry, replayed) => {
						session = entry.session;
						entry.ws = ws;
						entry.notify = send;
						if (entry.timer !== void 0) {
							clearTimeout(entry.timer);
							entry.timer = void 0;
						}
						send({
							type: "ready",
							cwd: session.cwd,
							shell: session.shell,
							...replayed ? { replayed: true } : {}
						});
						session.onData((data) => send({
							type: "output",
							data
						}));
						if (session.exitState !== null) {
							send({
								type: "exit",
								code: session.exitState.exitCode,
								signal: session.exitState.signal
							});
							try {
								ws.close(1e3);
							} catch {}
							finish();
							sessions.delete(sessionId);
							return;
						}
						ws.on("message", (data) => {
							let frame;
							try {
								frame = JSON.parse(String(data));
							} catch {
								return;
							}
							if (frame.type === "input" && typeof frame.data === "string") session?.write(frame.data);
							if (frame.type === "resize") session?.resize(frame.cols, frame.rows);
							if (frame.type === "kill") {
								entry.ws = void 0;
								entry.notify = void 0;
								sessions.delete(sessionId);
								session?.close();
								finish();
								try {
									ws.close(1e3);
								} catch {}
							}
						});
					};
					const detach = () => {
						if (settled) return;
						settled = true;
						const entry = sessions.get(sessionId);
						if (entry !== void 0 && entry.ws === ws) {
							entry.ws = void 0;
							entry.notify = void 0;
							scheduleDetachCleanup(sessionId, entry);
						}
						session = void 0;
					};
					const existing = sessions.get(sessionId);
					if (existing !== void 0) attachTo(existing, true);
					else try {
						const created = openLocalPty({
							cwd,
							cols,
							rows
						});
						const entry = { session: created };
						sessions.set(sessionId, entry);
						created.onExit((event) => {
							const ws = entry.ws;
							entry.notify?.({
								type: "exit",
								code: event.exitCode,
								signal: event.signal
							});
							entry.notify = void 0;
							entry.ws = void 0;
							try {
								ws?.close(1e3);
							} catch {}
							if (entry.timer === void 0) scheduleDetachCleanup(sessionId, entry);
						});
						attachTo(entry, false);
					} catch (error) {
						send({
							type: "exit",
							code: null,
							error: error instanceof Error ? error.message : String(error)
						});
						try {
							ws.close(1011);
						} catch {}
						finish();
						return;
					}
					ws.on("close", detach);
					ws.on("error", detach);
				});
			}
		},
		dispose
	};
}
//#endregion
//#region src/index.ts
const name = "local-terminal";
const inject = ["webServer"];
function apply(ctx) {
	const { upgrade, dispose } = makeTerminalUpgrade();
	ctx.effect(() => ctx.webServer.registerUpgrade(upgrade), "dsh-local-terminal: websocket route");
	ctx.effect(() => dispose, "dsh-local-terminal: pty sessions");
}
//#endregion
export { apply, inject, name };
