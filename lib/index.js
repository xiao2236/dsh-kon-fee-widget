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
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const name = "dsh-kon-fee-widget";
const inject = ["webServer"];
const PREFIX = "/dsh-kon-fee-widget";
const ASSETS = fileURLToPath(new URL("../assets", import.meta.url));
const BALANCE_URL = "https://api.deepseek.com/user/balance";
const CACHE_MS = 45_000;
const TIMEOUT_MS = 8000;
const configDir = () => process.env.DSH_HOME || join(homedir(), ".dsh");
const configFile = () => process.env.KON_FEE_CONFIG || join(configDir(), "kon-fee-widget.json");

// ---------------- 配置文件（带注释的 JSON） ----------------
// 设置页负责「谁坐上桌」；其余旋钮都在这个文件里，默认值见 DEFAULT_CONFIG。
const CHARACTER_IDS = ["mio", "ritsu", "yui", "tsumugi", "azusa"];
const DEFAULT_CONFIG = {
	visible: true,
	characters: { mio: true, ritsu: true, yui: true, tsumugi: true, azusa: true },
	scale: 1,
	snap: true,
	refreshSeconds: 60,
	warnBelow: 5,
	turnBubble: true,
	panelDurationMs: 8000,
	bubbleStyle: "cassette",
	easterEgg: true,
	easterEggLines: [],
	eggLines: {},
	eggComboChance: 0.5,
	lang: "zh",
	voice: true,
	bubbleAreaRatio: 1.3,
};

function renderConfig(config) {
	const characters = CHARACTER_IDS.map((id) => `"${id}": ${config.characters[id] !== false}`).join(", ");
	// 写成带注释的 JSONC：方便手改；读的时候会把注释剥掉
	return `{
  // 整个挂件是否显示（false = 茶桌完全消失）
  "visible": ${config.visible},
  // 五个人谁坐上桌（false = 这个人连同自己那一段桌子一起收起）
  // 可选值：mio（澪）ritsu（律）yui（唯）tsumugi（䌷）azusa（梓）
  "characters": { ${characters} },
  // 整张茶桌缩放，0.5 ~ 1.6
  "scale": ${config.scale},
  // 拖到屏幕边缘松手后是否自动贴边
  "snap": ${config.snap},
  // 余额自动刷新间隔（秒，15 ~ 600；点茶桌也会刷新）
  "refreshSeconds": ${config.refreshSeconds},
  // 余额低于这个数（元）时，账本数字变红、台词换成省钱的
  "warnBelow": ${config.warnBelow},
  // 每轮对话结束是否弹「本轮消耗」小气泡
  "turnBubble": ${config.turnBubble},
  // 账本气泡停留时长（毫秒）
  "panelDurationMs": ${config.panelDurationMs},
  // 账本气泡背景：cassette（卡带，裁到卡带本体）| cassette-full（整张卡带原图）| mascot（动物玩偶）
  "bubbleStyle": "${config.bubbleStyle}",
  // 双击茶桌是否弹一句彩蛋台词
  "easterEgg": ${config.easterEgg},
  // 按在场角色的彩蛋台词：{ "角色id": ["台词"] }，组合写 "id+id"（顺序无关）
  // 每条可以写成字符串（中文），或 { "zh": "中文", "ja": "日文", "voice": "文件名.mp3" }
  // 角色 id：mio（澪）ritsu（律）yui（唯）tsumugi（䌷）azusa（梓）
  "eggLines": ${JSON.stringify(config.eggLines, null, 2).replace(/\n/g, "\n  ")},
  // 组合台词触发的概率（0~1），没命中就退回在场某人的单人台词
  "eggComboChance": ${config.eggComboChance},
  // 台词语言：zh（中文）或 ja（日文）
  "lang": "${config.lang}",
  // 有配音文件时是否播放（语音文件放插件 assets/voices/ 下）
  "voice": ${config.voice},
  // 气泡面积 = 桌子+人物面积 × 这个比例（默认 1.3）；人多/人少时气泡跟着变
  "bubbleAreaRatio": ${config.bubbleAreaRatio},
  // 兜底台词（上面都没有时用；留空数组 = 用内置的十句）
  "easterEggLines": ${JSON.stringify(config.easterEggLines)}
}
`;
}

/** 剥掉 JSONC 里的 // 与 /* *​/ 注释（字符串里的不算）。 */
function stripComments(source) {
	let out = "";
	let index = 0;
	let inString = false;
	let inLine = false;
	let inBlock = false;
	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		if (inLine) {
			if (char === "\n") {
				inLine = false;
				out += char;
			}
			index += 1;
			continue;
		}
		if (inBlock) {
			if (char === "*" && next === "/") {
				inBlock = false;
				index += 2;
				continue;
			}
			if (char === "\n") out += char;
			index += 1;
			continue;
		}
		if (inString) {
			out += char;
			if (char === "\\") {
				out += next ?? "";
				index += 2;
				continue;
			}
			if (char === '"') inString = false;
			index += 1;
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
			index += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			inLine = true;
			index += 2;
			continue;
		}
		if (char === "/" && next === "*") {
			inBlock = true;
			index += 2;
			continue;
		}
		out += char;
		index += 1;
	}
	return out;
}

function sanitizeConfig(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const scale = Number(source.scale);
	const refresh = Number(source.refreshSeconds);
	const warn = Number(source.warnBelow);
	const panel = Number(source.panelDurationMs);
	const rawCharacters = source.characters && typeof source.characters === "object" && !Array.isArray(source.characters) ? source.characters : {};
	const characters = {};
	for (const id of CHARACTER_IDS) characters[id] = rawCharacters[id] !== false && source.showCharacters !== false;
	return {
		visible: source.visible !== false,
		characters,
		scale: Number.isFinite(scale) ? Math.max(0.5, Math.min(1.6, Math.round(scale * 100) / 100)) : DEFAULT_CONFIG.scale,
		snap: source.snap !== false,
		refreshSeconds: Number.isFinite(refresh) ? Math.max(15, Math.min(600, Math.round(refresh))) : DEFAULT_CONFIG.refreshSeconds,
		warnBelow: Number.isFinite(warn) ? Math.max(0, Math.min(10000, warn)) : DEFAULT_CONFIG.warnBelow,
		turnBubble: source.turnBubble !== false,
		panelDurationMs: Number.isFinite(panel) ? Math.max(2000, Math.min(60000, Math.round(panel))) : DEFAULT_CONFIG.panelDurationMs,
		bubbleStyle: ["mascot", "cassette-full", "plain"].includes(source.bubbleStyle) ? source.bubbleStyle : "cassette",
		easterEgg: source.easterEgg !== false,
		easterEggLines: (Array.isArray(source.easterEggLines) ? source.easterEggLines : [])
			.filter((line) => typeof line === "string" && line.trim())
			.slice(0, 20)
			.map((line) => line.trim().slice(0, 60)),
		eggLines: sanitizeEggLines(source.eggLines),
		eggComboChance: Number.isFinite(Number(source.eggComboChance)) ? Math.max(0, Math.min(1, Number(source.eggComboChance))) : DEFAULT_CONFIG.eggComboChance,
		lang: source.lang === "ja" ? "ja" : "zh",
		voice: source.voice !== false,
		bubbleAreaRatio: Number.isFinite(Number(source.bubbleAreaRatio)) ? Math.max(0.5, Math.min(3, Number(source.bubbleAreaRatio))) : DEFAULT_CONFIG.bubbleAreaRatio,
	};
}

/** 组合彩蛋：键只能是 "id" 或 "id+id"（每个 id 都在角色表里），值是非空字符串数组。 */
function sanitizeEggLines(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const out = {};
	for (const [key, value] of Object.entries(source)) {
		const parts = String(key).split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
		if (!parts.length || parts.some((part) => !CHARACTER_IDS.includes(part))) continue;
		const lines = (Array.isArray(value) ? value : [])
			.map(normalizeEggEntry)
			.filter(Boolean)
			.slice(0, 20);
		if (lines.length) out[[...new Set(parts)].sort().join("+")] = lines;
	}
	return out;
}

/** 台词的两种写法：纯字符串（中文）或 { zh, ja, voice }。 */
function normalizeEggEntry(value) {
	const clip = (text) => (typeof text === "string" ? text.trim().slice(0, 60) : "");
	if (typeof value === "string") {
		const zh = clip(value);
		return zh ? { zh, ja: "", voice: "" } : null;
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const zh = clip(value.zh);
		const ja = clip(value.ja);
		const voice = typeof value.voice === "string" ? value.voice.trim().slice(0, 120) : "";
		if (!zh && !ja) return null;
		return { zh: zh || ja, ja: ja || zh, voice };
	}
	return null;
}

async function loadConfig() {
	try {
		const raw = await readFile(configFile(), "utf8");
		return sanitizeConfig(JSON.parse(stripComments(raw)));
	} catch {
		// 文件不存在 / 解析失败：写一份带注释的默认配置，避免用户无从下手
		const fallback = { ...DEFAULT_CONFIG };
		try {
			await mkdir(dirname(configFile()), { recursive: true });
			await writeFile(configFile(), renderConfig(fallback), "utf8");
		} catch {
			/* 写不了就只用内存默认值 */
		}
		return fallback;
	}
}

async function saveConfig(patch) {
	const current = await loadConfig();
	const next = sanitizeConfig({ ...current, ...(patch && typeof patch === "object" ? patch : {}) });
	try {
		await mkdir(dirname(configFile()), { recursive: true });
		await writeFile(configFile(), renderConfig(next), "utf8");
	} catch {
		/* 写失败时内存里已经生效，下次重启回退到文件值 */
	}
	return next;
}


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
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
	} catch {
		text(res, 400, "dsh-kon-fee-widget: bad request");
		return;
	}
	const isConfig = pathname === `${PREFIX}/config`;
	if (req.method !== "GET" && req.method !== "HEAD" && !(isConfig && req.method === "POST")) {
		text(res, 405, "dsh-kon-fee-widget: method not allowed");
		return;
	}
	if (isConfig) {
		if (req.method === "POST") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			let patch = null;
			try {
				patch = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				patch = null;
			}
			if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
				json(res, 400, { ok: false, error: "bad-json" });
				return;
			}
			const config = await saveConfig(patch);
			json(res, 200, { ok: true, config, path: configFile() });
			return;
		}
		const config = await loadConfig();
		json(res, 200, { ok: true, config, path: configFile() });
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
		const today = await loadDaily();
		json(res, 200, { ok: true, turn: lastTurn, today });
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

// ---- 今天花了多少（按北京时间日期汇总，写盘以便重启后还在） ----
const dailyFile = () => join(dirname(configFile()), "kon-fee-today.json");

function beijingDate(now = Date.now()) {
	return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

let dailyCache = null;

async function loadDaily() {
	if (dailyCache && dailyCache.date === beijingDate()) return dailyCache;
	try {
		const raw = await readFile(dailyFile(), "utf8");
		const parsed = JSON.parse(raw);
		if (parsed && parsed.date === beijingDate()) {
			dailyCache = { date: parsed.date, amount: Number(parsed.amount) || 0, tokens: Number(parsed.tokens) || 0, turns: Number(parsed.turns) || 0 };
			return dailyCache;
		}
	} catch {
		/* 没有文件或坏文件：直接从今天重新累计 */
	}
	dailyCache = { date: beijingDate(), amount: 0, tokens: 0, turns: 0 };
	return dailyCache;
}

async function addDaily(amount, tokens) {
	const daily = await loadDaily();
	if (daily.date !== beijingDate()) {
		daily.date = beijingDate();
		daily.amount = 0;
		daily.tokens = 0;
		daily.turns = 0;
	}
	daily.amount = Number((daily.amount + (Number(amount) || 0)).toFixed(6));
	daily.tokens += Number(tokens) || 0;
	daily.turns += 1;
	try {
		await mkdir(dirname(dailyFile()), { recursive: true });
		await writeFile(dailyFile(), JSON.stringify(daily), "utf8");
	} catch {
		/* 写不了就只记在内存里 */
	}
	return daily;
}

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
	addDaily(lastTurn.amount, lastTurn.tokens).catch(() => {});
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
