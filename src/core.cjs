/**
 * dsh-kon-fee-widget — 纯逻辑核心。
 *
 * 不依赖 DOM / React / localStorage：会被 build-client 内联进 lib/client.js，
 * 也能被 Node 测试直接 require。
 */
(function (root, factory) {
	const api = factory();
	if (typeof module === "object" && module.exports) module.exports = api;
	if (root) root.KonFeeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : null, function () {
	"use strict";

	const STORE_KEY = "dsh-kon-fee:v1";
	const REFRESH_OPTIONS = [30, 60, 120];
	const WARN_DEFAULT = 5;
	const SCALE_MIN = 0.5;
	const SCALE_MAX = 1.6;

	// 原版茶桌场景：288×160，五个座位坐标来自 MascotTable_d/main.sd 的对象表。
	const TABLE = {
		width: 288,
		height: 160,
		charWidth: 64,
		charHeight: 128,
		charTop: 16,
		widths: { yui: 64, mio: 64, ritsu: 80, tsumugi: 64, azusa: 64 },
		frames: 4,
		fps: 4,
		seats: [
			{ id: "mio", x: 0 },
			{ id: "ritsu", x: 64 },
			{ id: "yui", x: 112 },
			{ id: "tsumugi", x: 176 },
			{ id: "azusa", x: 224 },
		],
	};

	// 坐姿动画：中间三人的帧表是 4 列 × 2 行，两侧两人用静态图。
	const ANIM = {
		yui: [0, 4, 5, 6, 7],
		ritsu: [0, 4, 5],
		tsumugi: [0, 4, 5, 6, 7],
	};
	const FRAME = { columns: 4, rows: 2, height: 128 };

	const ROSTER = [
		{ id: "mio", name: "秋山澪" },
		{ id: "ritsu", name: "田井中律" },
		{ id: "yui", name: "平泽唯" },
		{ id: "tsumugi", name: "琴吹䌷" },
		{ id: "azusa", name: "中野梓" },
	];

	const DEFAULT_SETTINGS = {
		visible: true,
		scale: 1,
		snap: true,
		refreshSeconds: 60,
		warnBelow: WARN_DEFAULT,
		showAll: true,
		characters: { mio: true, ritsu: true, yui: true, tsumugi: true, azusa: true },
		pos: null,
		edge: null,
	};

	const LINES = {
		ok: [
			"部费还有 {money}，够开一次茶会啦。",
			"今天还剩 {money}，省着点用哦。",
			"{money}…买蛋糕还是买茶叶？",
		],
		low: [
			"只剩 {money} 了…要不要省着点？",
			"{money}，连蛋糕都买不起了…",
			"部费见底了（{money}），我还有饼干。",
		],
		error: [
			"查不到余额啦，是不是没配 API key？",
			"余额读不到…先记在账本上吧。",
		],
		loading: ["翻账本中…", "让我想想今天花了多少…"],
	};

	// DeepSeek 计价窗口（北京时间，工作日）：9:00–12:00、14:00–18:00 为高峰。
	const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];

	const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
	const pad2 = (value) => String(value).padStart(2, "0");
	const clock = (minutes) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

	/** 金额显示：CNY 用 ¥，其它币种写后缀。 */
	function formatMoney(amount, currency = "") {
		const value = Number(amount);
		if (!Number.isFinite(value)) return "—";
		const code = String(currency || "").toUpperCase();
		if (!code || code === "CNY" || code === "RMB") return `¥${value.toFixed(2)}`;
		return `${value.toFixed(2)} ${code}`;
	}

	/** 从 DeepSeek /user/balance 的返回里取余额。 */
	function parseBalance(raw) {
		const json = raw && typeof raw === "object" ? raw : {};
		const list = Array.isArray(json.balance_infos) ? json.balance_infos.filter(Boolean) : [];
		const info = list.find((item) => item.total_balance !== undefined && item.total_balance !== null) || list[0] || {};
		const amount = Number(info.total_balance !== undefined ? info.total_balance : json.total_balance);
		if (!Number.isFinite(amount)) return { ok: false, amount: 0, currency: "" };
		return { ok: true, amount, currency: typeof info.currency === "string" ? info.currency : "" };
	}

	/**
	 * 现在是不是高峰计价（北京时间）。
	 * 工作日 9:00–12:00、14:00–18:00 为高峰；其余时间为谷时；周末全天谷价。
	 */
	function priceWindow(date = new Date()) {
		const stamp = date instanceof Date ? date : new Date(date);
		if (Number.isNaN(stamp.getTime())) {
			return { peak: false, weekend: false, minutes: 0, label: "谷时", detail: "现在计价更低", window: "" };
		}
		// 用 UTC 位移换算北京时间，不依赖运行环境的时区设置
		const shifted = new Date(stamp.getTime() + 8 * 3600 * 1000);
		const day = shifted.getUTCDay(); // 0 = 周日
		const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
		const weekend = day === 0 || day === 6;
		const window = PEAK_WINDOWS.find(([start, end]) => minutes >= start && minutes < end) || null;
		const peak = !weekend && Boolean(window);
		const detail = peak
			? `${clock(window[0])}–${clock(window[1])}`
			: weekend ? "周末全天谷价" : "现在计价更低";
		return {
			peak,
			weekend,
			minutes,
			label: peak ? "高峰" : "谷时",
			detail,
			window: window ? `${clock(window[0])}–${clock(window[1])}` : "",
		};
	}

	/** 拖拽松手后的吸附：四边 + 四角。 */
	function snapToEdge(pos, size, viewport, options = {}) {
		const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : 24;
		const enabled = options.enabled !== false;
		const vw = Math.max(1, Number(viewport && viewport.width) || 1);
		const vh = Math.max(1, Number(viewport && viewport.height) || 1);
		const width = Math.max(1, Number(size && size.width) || 1);
		const height = Math.max(1, Number(size && size.height) || 1);
		let x = clamp(Number(pos && pos.x) || 0, 0, Math.max(0, vw - width));
		let y = clamp(Number(pos && pos.y) || 0, 0, Math.max(0, vh - height));
		let edge = null;
		if (enabled) {
			if (x <= threshold) {
				x = 0;
				edge = "left";
			} else if (x >= vw - width - threshold) {
				x = vw - width;
				edge = "right";
			}
			if (y <= threshold) y = 0;
			else if (y >= vh - height - threshold) y = vh - height;
		}
		return { x: Math.round(x), y: Math.round(y), edge: edge || null };
	}

	/** 默认位置：左下角贴边（避开桌宠习惯待的右下角）。 */
	function defaultPosition(size, viewport) {
		const vh = Math.max(1, Number(viewport && viewport.height) || 1);
		const height = Math.max(1, Number(size && size.height) || 1);
		return { x: 0, y: Math.max(0, vh - height) };
	}

	/** 数字滚动：easeOutCubic 插值。 */
	function rollAmount(from, to, t) {
		const start = Number(from) || 0;
		const end = Number(to) || 0;
		const progress = clamp(Number(t) || 0, 0, 1);
		const eased = 1 - (1 - progress) ** 3;
		return start + (end - start) * eased;
	}

	/** 按余额挑一句台词；{money} 会替换成格式化后的金额。 */
	function pickLine(kind, amount, currency, warnBelow) {
		const table = LINES[kind] || LINES.ok;
		const pool = kind === "ok" && Number(amount) <= Number(warnBelow) ? LINES.low : table;
		const line = pool[Math.floor(Math.random() * pool.length)] || "";
		return line.replace("{money}", formatMoney(amount, currency));
	}

	/** 状态行文案：ok / warn / error / 未配置。 */
	function statusInfo(state) {
		const next = state || {};
		if (next.configMissing) return { text: "未配置 API key", tone: "warn" };
		if (next.loading) return { text: "读取中…", tone: "muted" };
		if (next.error) return { text: next.stale ? "读取失败（显示上次）" : "读取失败", tone: "error" };
		const stamp = Number(next.updatedAt) || 0;
		if (!stamp) return { text: "等待刷新", tone: "muted" };
		const date = new Date(stamp);
		return { text: `更新于 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`, tone: "ok" };
	}

	/** 设置清洗：只认已知字段，坏值一律回默认。 */
	function sanitizeSettings(raw) {
		const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
		const scale = Number(source.scale);
		const refresh = Number(source.refreshSeconds);
		const warn = Number(source.warnBelow);
		const pos = source.pos && typeof source.pos === "object" && Number.isFinite(Number(source.pos.x)) && Number.isFinite(Number(source.pos.y))
			? { x: Math.round(Number(source.pos.x)), y: Math.round(Number(source.pos.y)) }
			: null;
		const edge = source.edge === "left" || source.edge === "right" ? source.edge : null;
		const rawCharacters = source.characters && typeof source.characters === "object" && !Array.isArray(source.characters) ? source.characters : {};
		const characters = {};
		for (const member of ROSTER) characters[member.id] = rawCharacters[member.id] !== false;
		return {
			visible: source.visible !== false,
			scale: Number.isFinite(scale) ? clamp(Math.round(scale * 100) / 100, SCALE_MIN, SCALE_MAX) : DEFAULT_SETTINGS.scale,
			snap: source.snap !== false,
			refreshSeconds: REFRESH_OPTIONS.includes(refresh) ? refresh : DEFAULT_SETTINGS.refreshSeconds,
			warnBelow: Number.isFinite(warn) ? clamp(Math.round(warn * 100) / 100, 0, 10000) : DEFAULT_SETTINGS.warnBelow,
			showAll: source.showAll !== false,
			characters,
			pos,
			edge,
		};
	}

	return {
		STORE_KEY,
		REFRESH_OPTIONS,
		WARN_DEFAULT,
		SCALE_MIN,
		SCALE_MAX,
		DEFAULT_SETTINGS,
		TABLE,
		ANIM,
		FRAME,
		ROSTER,
		LINES,
		PEAK_WINDOWS,
		clamp,
		formatMoney,
		parseBalance,
		priceWindow,
		snapToEdge,
		defaultPosition,
		rollAmount,
		pickLine,
		statusInfo,
		sanitizeSettings,
	};
});
