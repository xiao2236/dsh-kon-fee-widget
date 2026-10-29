/**
 * dsh-kon-fee-widget — 宿主半侧。
 *
 * 做两件事：
 *   1. 把仓库里的 assets/ 挂到 Web 服务器的 /dsh-kon-fee-widget/* 下；
 *   2. 提供 /dsh-kon-fee-widget/balance：宿主侧读凭据 → 调 DeepSeek 余额接口，
 *      浏览器只拿到数字，API key 不会下发到前端。
 *
 * 路由只读，不执行用户输入。
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const name = "dsh-kon-fee-widget";
const inject = ["webServer"];
const PREFIX = "/dsh-kon-fee-widget";
const ASSETS = fileURLToPath(new URL("../assets", import.meta.url));
const BALANCE_URL = "https://api.deepseek.com/user/balance";
const CACHE_MS = 45_000;
const TIMEOUT_MS = 8000;

const MIME = {
	".png": "image/png",
	".webp": "image/webp",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".json": "application/json; charset=utf-8",
};

let cache = { at: 0, payload: null };
let inflight = null;

function json(res, status, body) {
	const payload = Buffer.from(JSON.stringify(body), "utf8");
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": payload.length,
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	res.end(payload);
}

function text(res, status, body) {
	const payload = Buffer.from(body + "\n", "utf8");
	res.writeHead(status, {
		"content-type": "text/plain; charset=utf-8",
		"content-length": payload.length,
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	res.end(payload);
}

function sendFile(req, res, file, contentType, size) {
	const headers = {
		"content-type": contentType,
		"content-length": size,
		"cache-control": contentType.startsWith("application/json")
			? "no-cache"
			: "public, max-age=86400",
		"x-content-type-options": "nosniff",
	};
	if (req.method === "HEAD") {
		res.writeHead(200, headers);
		res.end();
		return;
	}
	const stream = createReadStream(file);
	stream.once("open", () => {
		if (res.destroyed || res.writableEnded) {
			stream.destroy();
			return;
		}
		res.writeHead(200, headers);
		stream.pipe(res);
	});
	stream.on("error", () => {
		if (!res.headersSent) text(res, 404, "dsh-kon-fee-widget: asset not found");
		else res.destroy();
	});
	res.on("close", () => stream.destroy());
}

/** DSH 凭据里的 DEEPSEEK_API_KEY（没有 credentials 服务时回退环境变量）。 */
async function readApiKey(ctx) {
	try {
		const credentials = ctx.credentials || (typeof ctx.get === "function" ? ctx.get("credentials") : null);
		if (credentials && typeof credentials.get === "function") {
			const value = await credentials.get("DEEPSEEK_API_KEY");
			if (typeof value === "string" && value.trim()) return value.trim();
			if (value && typeof value.value === "string" && value.value.trim()) return value.value.trim();
		}
	} catch {
		/* 老宿主没有 credentials 服务，继续回退 */
	}
	const env = process.env.DEEPSEEK_API_KEY;
	return typeof env === "string" && env.trim() ? env.trim() : "";
}

/**
 * 可选服务：DSH 账号登录态的余额。
 * 形状对齐 DSH 自己的「账号与余额」卡片：getBalance({version, locale, timezoneOffsetSeconds}) →
 * { status: "ready", value: [{balance, currency}], bonusWallets: [{balance, currency}] }，
 * 总额 = 充值钱包 + 赠金（和 API key 的 total_balance 同口径）。
 */
async function readAccountBalance(ctx) {
	try {
		const account = typeof ctx.get === "function" ? ctx.get("deepseekAccount") : null;
		if (!account || typeof account.getBalance !== "function") return null;
		const result = await Promise.race([
			account.getBalance({
				version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || "") || "unknown",
				locale: String(process.env.DSH_LOCALE || "") || "zh_CN",
				timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
			}),
			new Promise((done) => setTimeout(() => done(null), TIMEOUT_MS)),
		]);
		if (!result || result.status !== "ready") return null;
		const num = (value) => {
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : null;
		};
		const normal = (Array.isArray(result.value) ? result.value : []).filter((wallet) => wallet && num(wallet.balance) !== null);
		const bonus = (Array.isArray(result.bonusWallets) ? result.bonusWallets : []).filter((wallet) => wallet && num(wallet.balance) !== null);
		const wallets = normal.concat(bonus);
		if (!wallets.length) return null;
		const currencyOf = (wallet) => String((wallet && wallet.currency) || "CNY").toUpperCase();
		const picked = wallets.find((wallet) => currencyOf(wallet) === "CNY") || wallets[0];
		const currency = currencyOf(picked);
		const total = wallets
			.filter((wallet) => currencyOf(wallet) === currency)
			.reduce((sum, wallet) => sum + Number(wallet.balance), 0);
		return { amount: Number(total.toFixed(6)), currency };
	} catch {
		/* 账号服务不可用或未登录 */
	}
	return null;
}

async function fetchApiBalance(key) {
	const response = await fetch(BALANCE_URL, {
		headers: { authorization: `Bearer ${key}`, accept: "application/json" },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) {
		const error = new Error(`HTTP ${response.status}`);
		error.status = response.status;
		throw error;
	}
	const body = await response.json();
	const list = Array.isArray(body.balance_infos) ? body.balance_infos.filter(Boolean) : [];
	const info = list.find((item) => item.total_balance !== undefined && item.total_balance !== null) || list[0] || {};
	const amount = Number(info.total_balance !== undefined ? info.total_balance : body.total_balance);
	if (!Number.isFinite(amount)) throw new Error("余额字段缺失");
	return { amount, currency: typeof info.currency === "string" ? info.currency : "" };
}

async function loadBalance(ctx, force) {
	const now = Date.now();
	if (!force && cache.payload && now - cache.at < CACHE_MS) return { ...cache.payload, cached: true };
	if (inflight) return { ...inflight, cached: true };

	const task = (async () => {
		const key = await readApiKey(ctx);
		if (key) {
			try {
				const balance = await fetchApiBalance(key);
				return { ok: true, amount: balance.amount, currency: balance.currency, source: "api", at: Date.now() };
			} catch (error) {
				const account = await readAccountBalance(ctx);
				if (account) return { ok: true, amount: account.amount, currency: account.currency, source: "account", at: Date.now() };
				return { ok: false, error: error && error.status === 401 ? "key-invalid" : "request-failed", at: Date.now() };
			}
		}
		const account = await readAccountBalance(ctx);
		if (account) return { ok: true, amount: account.amount, currency: account.currency, source: "account", at: Date.now() };
		return { ok: false, error: "no-key", at: Date.now() };
	})();

	inflight = task;
	try {
		const payload = await task;
		inflight = null;
		if (payload.ok) {
			cache = { at: payload.at, payload };
		}
		// 失败时沿用上次成功的余额，但要标明 stale
		if (!payload.ok && cache.payload) return { ...cache.payload, ok: false, stale: true, error: payload.error, at: payload.at };
		return payload;
	} finally {
		inflight = null;
	}
}

function createHandler(ctx) {
	return async function handler(req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		text(res, 405, "dsh-kon-fee-widget: method not allowed");
		return;
	}
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
	} catch {
		text(res, 400, "dsh-kon-fee-widget: bad request");
		return;
	}
	if (pathname === `${PREFIX}/balance`) {
		const force = new URL(req.url ?? "/", "http://localhost").searchParams.get("force") === "1";
		try {
			const payload = await loadBalance(ctx, force);
			json(res, 200, payload);
		} catch {
			json(res, 500, { ok: false, error: "internal" });
		}
		return;
	}
	if (pathname === `${PREFIX}/last-turn`) {
		json(res, 200, { ok: true, turn: lastTurn });
		return;
	}
	if (!pathname.startsWith(PREFIX + "/")) {
		text(res, 404, "dsh-kon-fee-widget: asset not found");
		return;
	}
	const relative = pathname.slice(PREFIX.length);
	if (relative.includes("\0")) {
		text(res, 400, "dsh-kon-fee-widget: bad request");
		return;
	}
	const file = resolve(ASSETS, "." + relative);
	if (file !== ASSETS && !file.startsWith(ASSETS + sep)) {
		text(res, 404, "dsh-kon-fee-widget: asset not found");
		return;
	}
	let info;
	try {
		info = await stat(file);
	} catch {
		text(res, 404, "dsh-kon-fee-widget: asset not found");
		return;
	}
	if (!info.isFile()) {
		text(res, 404, "dsh-kon-fee-widget: asset not found");
		return;
	}
	const contentType = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
	sendFile(req, res, file, contentType, info.size);
	};
}

// ---- 每轮消耗记账 ----
// 价目表：CNY / 百万 token，[空闲时段价, 高峰时段价]。
// 来源：官方定价页 https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// 2026-09-10 起 Flash 降价（命中 0.02、未命中 1、输出 4；高峰 = 空闲 × 2）；Pro 是 Flash 的 3 倍。
const PRICING = {
	flash: { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
	pro: { hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] },
};

function priceFor(model) {
	return String(model || "").toLowerCase().includes("pro") ? PRICING.pro : PRICING.flash;
}

/** 现在是不是高峰（北京时间，工作日 9–12 / 14–18；周末全天谷价）。 */
function isPeakNow(now = Date.now()) {
	const shifted = new Date(now + 8 * 3600 * 1000);
	const day = shifted.getUTCDay();
	if (day === 0 || day === 6) return false;
	const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
	return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60);
}

const turns = new Map();
let lastTurn = null;

function settleTurn(sessionId) {
	const agg = turns.get(sessionId);
	if (!agg) return;
	turns.delete(sessionId);
	if (!agg.amount && !agg.tokens) return;
	lastTurn = {
		at: Date.now(),
		amount: Number(agg.amount.toFixed(6)),
		tokens: agg.tokens,
		model: agg.model || "",
		peak: agg.peak,
	};
}

function onSessionEvent(session, event) {
	if (!event || typeof event !== "object") return;
	const id = session && session.id ? String(session.id) : "unknown";
	if (event.type === "session/disposed") {
		turns.delete(id);
		return;
	}
	if (event.type === "turn/end") {
		settleTurn(id);
		return;
	}
	if (event.type !== "assistant/message") return;
	const data = event.data;
	if (!data || typeof data !== "object") return;
	const usage = data.usage;
	if (!usage || typeof usage !== "object") return;
	const turn = Number(data.turn);
	const model = data.message && data.message.source ? data.message.source.model : "";
	let agg = turns.get(id);
	if (!agg || (Number.isFinite(turn) && agg.turn !== turn)) {
		if (agg) settleTurn(id);
		agg = { turn: Number.isFinite(turn) ? turn : 0, amount: 0, tokens: 0, model, peak: isPeakNow() };
		turns.set(id, agg);
	}
	const input = Number(usage.inputTokens) || 0;
	const cache = Number(usage.cacheReadTokens) || 0;
	// dsh 保证 reasoningTokens ⊆ outputTokens，所以 output 不再另加 reasoning，避免重复计费
	const output = Number(usage.outputTokens) || 0;
	const price = priceFor(model);
	const peak = agg.peak ? 1 : 0;
	agg.amount += (cache / 1e6) * price.hit[peak] + (input / 1e6) * price.miss[peak] + (output / 1e6) * price.out[peak];
	agg.tokens += input + cache + output;
	if (model) agg.model = model;
}

function apply(ctx) {
	const handler = createHandler(ctx);
	ctx.effect(
		() => ctx.webServer.register({
			kind: "prefix",
			path: PREFIX,
			handler,
		}),
		"dsh-kon-fee-widget: assets + balance",
	);
	// 会话事件流：assistant/message 带每步真实 usage，turn/end 时结算本轮
	if (typeof ctx.on === "function") {
		ctx.effect(
			() => ctx.on("session/event", (session, event) => {
				try { onSessionEvent(session, event); } catch { /* 记账失败不能影响会话 */ }
			}),
			"dsh-kon-fee-widget: turn cost",
		);
	}
}

export { apply, inject, name };
