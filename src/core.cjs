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
		turnBubble: true,
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

	// 双击彩蛋：轻音部味的小句子（配置里 easterEggLines 可以覆盖）
	// 双击彩蛋：轻音部味的小句子（{ ja, zh } 成对；配置里 easterEggLines 可以覆盖）
	const EGG_LINES = [
		{ ja: "放課後ティータイム、開始！", zh: "放学后茶会，开始！" },
		{ ja: "ふわふわ時間～", zh: "软绵绵的时间～" },
		{ ja: "ケーキ、もう一枚どう？", zh: "再来一块蛋糕怎么样？" },
		{ ja: "あずにゃん、今日も頑張ってね。", zh: "梓喵～今天也要加油哦。" },
		{ ja: "唯：わーい！", zh: "唯：哇——！" },
		{ ja: "律：部費は計画的にね。", zh: "律：部费要省着点花啦。" },
		{ ja: "䌷：うちでお茶しない？", zh: "䌷：我家有茶点，随便吃。" },
		{ ja: "澪：見、見ないでよ！", zh: "澪：别、别盯着我看啦！" },
		{ ja: "軽音部、活動開始！", zh: "轻音部，活动开始！" },
		{ ja: "一緒に一曲どう？", zh: "要不要一起听首歌？" },
	];

	// 按在场角色分的默认彩蛋台词；键是角色 id，组合用 "id+id"（顺序无关，会排序）
	const DEFAULT_EGG_LINES = {
		mio: [
			{ ja: "澪：今、今日はこのへんで…", zh: "澪：今、今天先到这里吧…" },
			{ ja: "澪：見、見ないでよ！", zh: "澪：别、别盯着我看啦！" },
			{ ja: "澪：部費はちゃんとつけるから。", zh: "澪：部费我会记好的。" },
		],
		ritsu: [
			{ ja: "律：部費は計画的に使おうね。", zh: "律：部费要省着点花啦。" },
			{ ja: "律：今日はゆるっと行こう！", zh: "律：今天就轻松一下吧！" },
			{ ja: "律：えへへ、また使いすぎた？", zh: "律：哎嘿，又超支了？" },
		],
		yui: [
			{ ja: "唯：わーい！", zh: "唯：哇——！" },
			{ ja: "唯：ケーキ！ケーキ！", zh: "唯：蛋糕！蛋糕！" },
			{ ja: "唯：今日も頑張るよ～", zh: "唯：今天也要加油哦～" },
		],
		tsumugi: [
			{ ja: "䌷：うちでお茶しない？", zh: "䌷：要不要来我家喝茶？" },
			{ ja: "䌷：お金のことは気にしないで。", zh: "䌷：钱的事不用担心啦。" },
			{ ja: "䌷：お菓子、たくさんあるよ。", zh: "䌷：我家有茶点，随便吃。" },
		],
		azusa: [
			{ ja: "梓：あずにゃんだよ。", zh: "梓：人家是梓喵啦。" },
			{ ja: "梓：先輩たち、ちゃんとしてください…", zh: "梓：前辈们别闹啦。" },
			{ ja: "梓：また部費使いすぎです…", zh: "梓：部费又花在哪了…" },
		],
		"mio+ritsu": [
			{ ja: "律：澪、今日も照れてる～", zh: "律：澪，今天也别害羞啦。" },
			{ ja: "澪：律、やめて…", zh: "澪：律，别闹…" },
		],
		"azusa+yui": [
			{ ja: "唯：あずにゃん、一緒に練習しよう！", zh: "唯：梓喵，一起练琴吧！" },
			{ ja: "梓：唯先輩、音程…", zh: "梓：唯前辈，音准…" },
		],
		"mio+yui": [
			{ ja: "唯：澪、ベース教えて！", zh: "唯：澪，教我弹贝斯嘛。" },
			{ ja: "澪：唯、まず譜面を読んで…", zh: "澪：唯，先把谱子看完…" },
		],
		"ritsu+tsumugi": [
			{ ja: "䌷：律、お茶点を用意したよ。", zh: "䌷：律，茶点准备好了。" },
			{ ja: "律：䌷のケーキ最高！", zh: "律：䌷家的蛋糕最棒了！" },
		],
	};

	/** 一条彩蛋台词统一成 { ja, zh, voice }；纯字符串当作中文。 */
	function normalizeEggEntry(value) {
		if (typeof value === "string") return { ja: "", zh: value, voice: "" };
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const zh = typeof value.zh === "string" ? value.zh : "";
			const ja = typeof value.ja === "string" ? value.ja : "";
			const voice = typeof value.voice === "string" ? value.voice : "";
			if (zh || ja) return { ja: ja || zh, zh: zh || ja, voice };
		}
		return null;
	}

	/** 按语言取彩蛋台词；没有对应语言就用另一个。 */
	function eggText(entry, lang = "zh") {
		const value = entry || {};
		if (lang === "ja") return value.ja || value.zh || "";
		return value.zh || value.ja || "";
	}

	/**
	 * 把一条台词拆成「一人一句」的节拍：组合对白用 ｜ 分隔，
	 * 单人台词自然只有一拍。返回按顺序播放的句子数组。
	 */
	function eggBeats(entry, lang = "zh") {
		return eggText(entry, lang)
			.split("｜")
			.map((part) => part.trim())
			.filter(Boolean);
	}
	/** 从若干 id 里取组合（size >= 2）。 */
	function combinations(ids, size) {
		const result = [];
		const walk = (start, picked) => {
			if (picked.length === size) {
				result.push(picked.slice());
				return;
			}
			for (let index = start; index < ids.length; index += 1) {
				picked.push(ids[index]);
				walk(index + 1, picked);
				picked.pop();
			}
		};
		walk(0, []);
		return result;
	}

	// DeepSeek 计价窗口（北京时间，工作日）：9:00–12:00、14:00–18:00 为高峰。
	const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];

	/**
	 * 座位段的切分边界：相邻两个座位中心的中间，最后补上场景宽度。
	 * 五个人全坐时正好还原成 288 宽的整张桌子；少人时把对应那一段抽掉、后面整体左移。
	 */
	function segmentBounds() {
		const centers = TABLE.seats.map((seat) => seat.x + (TABLE.widths[seat.id] || TABLE.charWidth) / 2);
		const bounds = [0];
		for (let index = 1; index < centers.length; index += 1) {
			bounds.push(Math.round((centers[index - 1] + centers[index]) / 2));
		}
		bounds.push(TABLE.width);
		return bounds;
	}

	/**
	 * 按可见座位把桌子切成若干段，并给出每段的源区间 [from,to)、目标偏移 offset。
	 * 只画可见段时，容器宽度 = TABLE.width - 被抽掉的总宽。
	 */
	function layoutSegments(seatIds) {
		const bounds = segmentBounds();
		const wanted = Array.isArray(seatIds) ? new Set(seatIds) : null;
		const segments = [];
		let removed = 0;
		TABLE.seats.forEach((seat, index) => {
			const from = bounds[index];
			const to = bounds[index + 1];
			const width = to - from;
			const visible = !wanted || wanted.has(seat.id);
			if (!visible) {
				removed += width;
				return;
			}
			segments.push({
				id: seat.id,
				from,
				to,
				width,
				offset: removed,
				x: seat.x - removed,
				y: TABLE.charTop,
			});
		});
		return { segments, width: Math.max(1, TABLE.width - removed), bounds };
	}

	const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
	const pad2 = (value) => String(value).padStart(2, "0");
	const clock = (minutes) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
	// 给界面用的时段文案：09:00–12:00 · 14:00–18:00
	const PEAK_TEXT = PEAK_WINDOWS.map(([start, end]) => `${clock(start)}–${clock(end)}`).join(" · ");
	const MINUTE = 60 * 1000;
	const DAY = 24 * 60 * MINUTE;
	const BEIJING_OFFSET = 8 * 3600 * 1000;

	/** 北京时间当天的 0 点（用 UTC 位移算，不依赖运行环境时区）。 */
	const beijingDayStart = (ms) => Math.floor((ms + BEIJING_OFFSET) / DAY) * DAY - BEIJING_OFFSET;
	const beijingDayOfWeek = (ms) => new Date(ms + BEIJING_OFFSET).getUTCDay();
	const isWeekend = (day) => day === 0 || day === 6;

	/**
	 * 找 now 前后两次计价切换时刻（epoch ms）。
	 * 只有工作日有高峰窗口；周末整天是谷时，所以「上一次切换」会落在周五 18:00，
	 * 「下一次切换」落在下周一 09:00。
	 */
	function priceBoundaries(now) {
		const today = beijingDayStart(now);
		const cuts = [];
		for (let offset = -7; offset <= 8; offset += 1) {
			const dayStart = today + offset * DAY;
			if (isWeekend(beijingDayOfWeek(dayStart))) continue;
			for (const [start, end] of PEAK_WINDOWS) {
				cuts.push({ at: dayStart + start * MINUTE, peak: true });
				cuts.push({ at: dayStart + end * MINUTE, peak: false });
			}
		}
		cuts.sort((a, b) => a.at - b.at);
		let prev = null;
		let next = null;
		for (const cut of cuts) {
			if (cut.at <= now) prev = cut;
			else if (!next) next = cut;
		}
		return { prev, next };
	}

	/** 把毫秒差写成「1 小时 23 分 / 42 分钟 / 不到 1 分钟」。 */
	function formatCountdown(ms) {
		const remain = Math.max(0, Number(ms) || 0);
		const totalMinutes = Math.floor(remain / MINUTE);
		if (totalMinutes < 1) return "不到 1 分钟";
		if (totalMinutes < 60) return `${totalMinutes} 分钟`;
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
	}

	/**
	 * 现在是不是高峰计价（北京时间）+ 距下一次切换还有多久。
	 * 工作日 9:00–12:00、14:00–18:00 为高峰；其余时间为谷时；周末全天谷价。
	 */
	function priceWindow(date = new Date()) {
		const stamp = date instanceof Date ? date : new Date(date);
		if (Number.isNaN(stamp.getTime())) {
			return {
				peak: false, weekend: false, minutes: 0, label: "谷时", detail: "现在计价更低",
				window: "", schedule: PEAK_TEXT, nextAt: 0, nextPeak: false, remainMs: 0, progress: 0, nextText: "",
			};
		}
		const now = stamp.getTime();
		const shifted = new Date(now + BEIJING_OFFSET);
		const day = shifted.getUTCDay(); // 0 = 周日
		const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
		const weekend = isWeekend(day);
		const window = PEAK_WINDOWS.find(([start, end]) => minutes >= start && minutes < end) || null;
		const peak = !weekend && Boolean(window);
		const detail = peak
			? `${clock(window[0])}–${clock(window[1])}`
			: weekend ? "周末全天谷价" : "现在计价更低";
		const { prev, next } = priceBoundaries(now);
		const span = prev && next ? next.at - prev.at : 0;
		const progress = span > 0 ? clamp((now - prev.at) / span, 0, 1) : 0;
		const remainMs = next ? Math.max(0, next.at - now) : 0;
		const nextPeak = Boolean(next && next.peak);
		return {
			peak,
			weekend,
			minutes,
			label: peak ? "高峰" : "谷时",
			detail,
			window: window ? `${clock(window[0])}–${clock(window[1])}` : "",
			schedule: PEAK_TEXT,
			nextAt: next ? next.at : 0,
			nextPeak,
			remainMs,
			progress,
			nextText: next ? `距${nextPeak ? "进入高峰" : "进入谷时"} ${formatCountdown(remainMs)}` : "",
		};
	}


	/** 金额显示：CNY 用 ¥，其它币种写后缀。 */
	function formatMoney(amount, currency = "") {
		const value = Number(amount);
		if (!Number.isFinite(value)) return "—";
		const code = String(currency || "").toUpperCase();
		if (!code || code === "CNY" || code === "RMB") return `¥${value.toFixed(2)}`;
		return `${value.toFixed(2)} ${code}`;
	}

	/** 每轮消耗：金额很小，小数位按量级自适应（1 元以上 2 位、1 分以上 3 位、更小 4 位）。 */
	function formatCost(amount) {
		const value = Number(amount);
		if (!Number.isFinite(value)) return "—";
		const decimals = value >= 1 ? 2 : value >= 0.01 ? 3 : 4;
		return `¥${value.toFixed(decimals)}`;
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
	 * 组合盒：桌子段 + 人物立绘的并集。
	 * 人物比座位段宽，抽段后会探出桌子两端；这里算出内容的最小/最大 x 与需要右移的 offset，
	 * 让整个盒子贴边时不会被视口裁掉。
	 */
	function frameBounds(layout) {
		const segments = layout && Array.isArray(layout.segments) ? layout.segments : [];
		const tableWidth = Math.max(1, Number(layout && layout.width) || TABLE.width);
		const left = Math.min(0, ...segments.map((segment) => segment.x));
		const right = Math.max(tableWidth, ...segments.map((segment) => segment.x + (TABLE.widths[segment.id] || TABLE.charWidth)));
		return {
			width: Math.round(right - left),
			offset: left === 0 ? 0 : Math.round(-left),
			left,
			right,
			segments,
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

	/** 随便挑一句彩蛋台词；传了自定义列表就用自定义的。 */
	function pickEggLine(lines) {
		const pool = Array.isArray(lines) && lines.length ? lines : EGG_LINES;
		return String(pool[Math.floor(Math.random() * pool.length)] || "");
	}

	/**
	 * 双击彩蛋：按「在场的人」挑台词。
	 * - 只有一个人在场：只出这个人的台词（lines[id]）
	 * - 多人在场：先找组合台词（"id+id"，顺序无关），按 comboChance 概率触发；
	 *   没命中就退回在场某一个人的单人台词
	 * - lines 里没有的键用 DEFAULT_EGG_LINES 兜底，再没有就用 EGG_LINES
	 */
	function pickEgg(presentIds, options = {}) {
		const ids = Array.isArray(presentIds) ? presentIds.filter(Boolean) : [];
		const custom = options.lines && typeof options.lines === "object" ? options.lines : {};
		const fallback = Array.isArray(options.fallback) && options.fallback.length ? options.fallback : EGG_LINES;
		const chance = Number.isFinite(Number(options.comboChance)) ? clamp(Number(options.comboChance), 0, 1) : 0.5;
		const table = {};
		const normKey = (key) => String(key).split("+").map((part) => part.trim()).filter(Boolean).sort().join("+");
		const normPool = (list) => (Array.isArray(list) ? list.map(normalizeEggEntry).filter(Boolean) : []);
		for (const key of Object.keys(DEFAULT_EGG_LINES)) table[normKey(key)] = normPool(DEFAULT_EGG_LINES[key]);
		for (const key of Object.keys(custom)) {
			const pool = normPool(custom[key]);
			if (pool.length) table[normKey(key)] = pool;
		}
		const fallbackPool = normPool(fallback);
		const pick = (pool) => pool[Math.floor(Math.random() * pool.length)] || { ja: "", zh: "", voice: "" };
		const own = (id) => (table[id] && table[id].length ? pick(table[id]) : pick(fallbackPool));
		const keyOf = (list) => [...list].sort().join("+");
		if (ids.length === 1) return own(ids[0]);
		if (ids.length > 1) {
			// 从人数多的组合往少的找，命中哪个就用哪个
			for (let size = ids.length; size >= 2; size -= 1) {
				for (const subset of combinations(ids, size)) {
					const pool = table[keyOf(subset)];
					if (Array.isArray(pool) && pool.length && Math.random() < chance) return pick(pool);
				}
			}
			return own(ids[Math.floor(Math.random() * ids.length)]);
		}
		return pick(fallback);
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
			turnBubble: source.turnBubble !== false,
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
		EGG_LINES,
		PEAK_WINDOWS,
		PEAK_TEXT,
		segmentBounds,
		layoutSegments,
		frameBounds,
		clamp,
		formatCountdown,
		priceBoundaries,
		formatMoney,
		formatCost,
		parseBalance,
		priceWindow,
		snapToEdge,
		defaultPosition,
		rollAmount,
		pickLine,
		pickEggLine,
		pickEgg,
		eggText,
		eggBeats,
		normalizeEggEntry,
		DEFAULT_EGG_LINES,
		statusInfo,
		sanitizeSettings,
	};
});
