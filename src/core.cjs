/**
 * dsh-kon-fee-widget — 纯逻辑核心。
 *
 * 和 dsh-k-on-pet 一样：这个文件不依赖 DOM / React / localStorage，
 * 既会被 scripts/build-client.mjs 内联进 lib/client.js，也能被 Node 测试直接 require。
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
	const SCALE_MIN = 0.8;
	const SCALE_MAX = 1.6;

	const DEFAULT_SETTINGS = {
		visible: true,
		scale: 1,
		snap: true,
		refreshSeconds: 60,
		warnBelow: WARN_DEFAULT,
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

	const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

	/** 拖拽松手后的吸附：四边 + 四角，贴左时整体镜像。 */
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
		return {
			x: Math.round(x),
			y: Math.round(y),
			edge: edge || null,
			mirrored: edge === "left",
		};
	}

	/** 默认位置：左下角贴边（避开桌宠习惯待的右下角）。 */
	function defaultPosition(size, viewport) {
		const vh = Math.max(1, Number(viewport && viewport.height) || 1);
		const height = Math.max(1, Number(size && size.height) || 1);
		return {
			x: 0,
			y: Math.max(0, vh - height),
			edge: "left",
			mirrored: true,
		};
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
		const hh = String(date.getHours()).padStart(2, "0");
		const mm = String(date.getMinutes()).padStart(2, "0");
		return { text: `更新于 ${hh}:${mm}`, tone: "ok" };
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
		return {
			visible: source.visible !== false,
			scale: Number.isFinite(scale) ? clamp(Math.round(scale * 100) / 100, SCALE_MIN, SCALE_MAX) : DEFAULT_SETTINGS.scale,
			snap: source.snap !== false,
			refreshSeconds: REFRESH_OPTIONS.includes(refresh) ? refresh : DEFAULT_SETTINGS.refreshSeconds,
			warnBelow: Number.isFinite(warn) ? clamp(Math.round(warn * 100) / 100, 0, 10000) : DEFAULT_SETTINGS.warnBelow,
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
		LINES,
		clamp,
		formatMoney,
		parseBalance,
		snapToEdge,
		defaultPosition,
		rollAmount,
		pickLine,
		statusInfo,
		sanitizeSettings,
	};
});
