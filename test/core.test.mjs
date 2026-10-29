import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../src/core.cjs");

test("默认设置：显示、1.0×、吸附开、60 秒、阈值 5 元、全展示", () => {
	const settings = Core.sanitizeSettings({});
	assert.equal(settings.visible, true);
	assert.equal(settings.scale, 1);
	assert.equal(settings.snap, true);
	assert.equal(settings.refreshSeconds, 60);
	assert.equal(settings.warnBelow, 5);
	assert.equal(settings.showAll, true);
	assert.deepEqual(settings.characters, { mio: true, ritsu: true, yui: true, tsumugi: true, azusa: true });
	assert.equal(settings.pos, null);
});

test("设置清洗：坏值回默认、范围钳制、角色开关保留", () => {
	const fixed = Core.sanitizeSettings({
		visible: false,
		scale: 9,
		snap: false,
		refreshSeconds: 45,
		warnBelow: -3,
		showAll: false,
		characters: { mio: false, yui: "yes", nope: false },
		pos: { x: 12.6, y: 40.2 },
		edge: "left",
	});
	assert.equal(fixed.visible, false);
	assert.equal(fixed.scale, Core.SCALE_MAX);
	assert.equal(fixed.snap, false);
	assert.equal(fixed.refreshSeconds, 60);
	assert.equal(fixed.warnBelow, 0);
	assert.equal(fixed.showAll, false);
	assert.equal(fixed.characters.mio, false);
	assert.equal(fixed.characters.ritsu, true, "没写的角色默认在桌上");
	assert.equal(fixed.characters.yui, true, "非 false 的值一律视为显示");
	assert.deepEqual(fixed.pos, { x: 13, y: 40 });
	assert.equal(Core.sanitizeSettings({ scale: 0.1 }).scale, Core.SCALE_MIN);
	assert.equal(Core.sanitizeSettings({ pos: { x: "a", y: 1 } }).pos, null);
});

test("金额格式化与余额解析", () => {
	assert.equal(Core.formatMoney(12.3), "¥12.30");
	assert.equal(Core.formatMoney(1.005, "USD"), "1.00 USD");
	assert.equal(Core.formatMoney(Number.NaN), "—");
	assert.deepEqual(Core.parseBalance({ balance_infos: [{ total_balance: "12.34", currency: "CNY" }] }), { ok: true, amount: 12.34, currency: "CNY" });
	assert.equal(Core.parseBalance(null).ok, false);
});

test("峰谷：工作日两个高峰窗口、午休与晚间谷时、周末全天谷价", () => {
	// 2026-10-29 是周四；UTC 02:00 = 北京 10:00
	const peakMorning = Core.priceWindow(new Date(Date.UTC(2026, 9, 29, 2, 0)));
	assert.equal(peakMorning.peak, true);
	assert.equal(peakMorning.label, "高峰");
	assert.equal(peakMorning.window, "09:00–12:00");

	const peakAfternoon = Core.priceWindow(new Date(Date.UTC(2026, 9, 29, 7, 30))); // 北京 15:30
	assert.equal(peakAfternoon.peak, true);
	assert.equal(peakAfternoon.window, "14:00–18:00");

	assert.equal(Core.priceWindow(new Date(Date.UTC(2026, 9, 29, 4, 30))).peak, false, "北京 12:30 午休");
	assert.equal(Core.priceWindow(new Date(Date.UTC(2026, 9, 29, 10, 0))).peak, false, "北京 18:00 下班");
	assert.equal(Core.priceWindow(new Date(Date.UTC(2026, 9, 29, 0, 30))).peak, false, "北京 08:30 早间");

	const weekend = Core.priceWindow(new Date(Date.UTC(2026, 10, 1, 2, 0))); // 2026-11-01 周日 10:00
	assert.equal(weekend.weekend, true);
	assert.equal(weekend.peak, false);
	assert.match(weekend.detail, /周末/);

	const morningStart = Core.priceWindow(new Date(Date.UTC(2026, 9, 29, 1, 0))); // 北京 09:00
	assert.equal(morningStart.peak, true, "9:00 整算高峰");
});

test("峰谷倒计时：距下一次切换的时刻与进度", () => {
	// 周四 10:00 → 距 12:00 进谷还有 2 小时，进度 (10-9)/(12-9) = 1/3
	const ten = Core.priceWindow(new Date(Date.UTC(2026, 9, 29, 2, 0)));
	assert.equal(ten.nextPeak, false, "下一个切换是进谷时");
	assert.equal(ten.remainMs, 2 * 3600 * 1000);
	assert.ok(Math.abs(ten.progress - 1 / 3) < 1e-6);
	assert.equal(ten.nextText, "距进入谷时 2 小时");

	// 周四 12:30 → 距 14:00 进高峰还有 1.5 小时
	const noon = Core.priceWindow(new Date(Date.UTC(2026, 9, 29, 4, 30)));
	assert.equal(noon.nextPeak, true);
	assert.equal(noon.remainMs, 90 * 60 * 1000);
	assert.equal(noon.nextText, "距进入高峰 1 小时 30 分");

	// 周四 18:30 → 下一次是周五 09:00
	const evening = Core.priceWindow(new Date(Date.UTC(2026, 9, 29, 10, 30)));
	assert.equal(evening.nextPeak, true);
	assert.equal(evening.remainMs, (14 * 60 + 30) * 60 * 1000);

	// 周六 10:00 → 下一次是周一 09:00（周末全天谷价）
	const saturday = Core.priceWindow(new Date(Date.UTC(2026, 9, 31, 2, 0)));
	assert.equal(saturday.nextPeak, true);
	assert.equal(saturday.remainMs, 47 * 3600 * 1000);

	// 倒计时文案
	assert.equal(Core.formatCountdown(30 * 1000), "不到 1 分钟");
	assert.equal(Core.formatCountdown(42 * 60 * 1000), "42 分钟");
	assert.equal(Core.formatCountdown((2 * 60 + 5) * 60 * 1000), "2 小时 5 分");
	assert.equal(Core.formatCountdown(3 * 3600 * 1000), "3 小时");
	assert.equal(Core.PEAK_TEXT, "09:00–12:00 · 14:00–18:00", "界面用的高峰时段文案");
	assert.equal(Core.priceWindow(new Date(Date.UTC(2026, 9, 29, 4, 30))).schedule, Core.PEAK_TEXT);
});

test("吸附：靠近边缘才吸，越界夹回", () => {
	const viewport = { width: 1000, height: 700 };
	const size = { width: 288, height: 160 };
	const left = Core.snapToEdge({ x: 10, y: 300 }, size, viewport, { threshold: 24 });
	assert.deepEqual([left.x, left.y, left.edge], [0, 300, "left"]);
	const right = Core.snapToEdge({ x: 900, y: 300 }, size, viewport, { threshold: 24 });
	assert.deepEqual([right.x, right.edge], [viewport.width - size.width, "right"]);
	const off = Core.snapToEdge({ x: -50, y: 9999 }, size, viewport, { threshold: 24 });
	assert.deepEqual([off.x, off.y], [0, viewport.height - size.height]);
	const noSnap = Core.snapToEdge({ x: 10, y: 10 }, size, viewport, { enabled: false, threshold: 24 });
	assert.deepEqual([noSnap.x, noSnap.y, noSnap.edge], [10, 10, null]);
});

test("默认位置在左下角", () => {
	const spot = Core.defaultPosition({ width: 288, height: 160 }, { width: 1000, height: 700 });
	assert.deepEqual(spot, { x: 0, y: 700 - 160 });
});

test("数字滚动：起止与缓动单调", () => {
	assert.equal(Core.rollAmount(1, 5, 0), 1);
	assert.equal(Core.rollAmount(1, 5, 1), 5);
	assert.ok(Core.rollAmount(1, 5, 0.2) < Core.rollAmount(1, 5, 0.8));
	assert.equal(Core.rollAmount(1, 5, 2), 5);
});

test("状态行与台词", () => {
	assert.equal(Core.statusInfo({ configMissing: true }).text, "未配置 API key");
	assert.equal(Core.statusInfo({ loading: true }).text, "读取中…");
	assert.equal(Core.statusInfo({ error: "network", stale: true }).text, "读取失败（显示上次）");
	assert.equal(Core.statusInfo({ updatedAt: 0 }).text, "等待刷新");
	const low = Core.pickLine("ok", 1.2, "CNY", 5);
	assert.ok(low.includes("¥1.20"));
	assert.ok(Core.pickLine("error").length > 0);
});

test("双击彩蛋：单人只出本人台词，组合按概率触发，键顺序无关", () => {
	// 单人在场：只出这个人的
	const zhOf = (list) => new Set(list.map((entry) => Core.eggText(entry, "zh")));
	const mio = zhOf(Core.DEFAULT_EGG_LINES.mio);
	for (let i = 0; i < 20; i += 1) assert.ok(mio.has(Core.eggText(Core.pickEgg(["mio"]), "zh")), "澪单独在场只出澪的台词");
	const azusa = zhOf(Core.DEFAULT_EGG_LINES.azusa);
	for (let i = 0; i < 20; i += 1) assert.ok(azusa.has(Core.eggText(Core.pickEgg(["azusa"]), "zh")), "梓单独在场只出梓的台词");

	// 组合 100% 命中
	const combos = zhOf(Core.DEFAULT_EGG_LINES["azusa+yui"]);
	for (let i = 0; i < 20; i += 1) assert.ok(combos.has(Core.eggText(Core.pickEgg(["yui", "azusa"], { comboChance: 1 }), "zh")), "唯+梓走组合台词");

	// 组合概率 0：退回单人（不是组合句）
	const singlePool = new Set([...zhOf(Core.DEFAULT_EGG_LINES.yui), ...zhOf(Core.DEFAULT_EGG_LINES.azusa)]);
	for (let i = 0; i < 20; i += 1) {
		const line = Core.eggText(Core.pickEgg(["yui", "azusa"], { comboChance: 0 }), "zh");
		assert.ok(singlePool.has(line), "没有组合命中时退回单人的台词");
	}

	// 法定节假日全天谷价：国庆 10-01 10:00 北京 = 谷时；10-08 同日同时刻 = 高峰
	const holiday = Core.priceWindow(new Date("2026-10-01T02:00:00Z"));
	assert.equal(holiday.peak, false);
	assert.match(holiday.detail, /节假日/);
	const workday = Core.priceWindow(new Date("2026-10-08T02:00:00Z"));
	assert.equal(workday.peak, true);
	const spring = Core.priceWindow(new Date("2026-02-16T02:00:00Z"));
	assert.equal(spring.peak, false);

	// 组合对白按 ｜ 拆成一人一句的节拍
	assert.deepEqual(Core.eggBeats({ zh: "澪：甲｜律：乙", ja: "" }), ["澪：甲", "律：乙"]);
	assert.deepEqual(Core.eggBeats({ zh: "单人一句", ja: "" }), ["单人一句"]);
	assert.deepEqual(Core.eggBeats({ ja: "唯：A｜梓：B", zh: "" }, "ja"), ["唯：A", "梓：B"]);

	// 自定义组合，键顺序反过来也认
	const custom = Core.eggText(Core.pickEgg(["ritsu", "mio"], { lines: { "ritsu+mio": ["自定义组合"] }, comboChance: 1 }), "zh");
	assert.equal(custom, "自定义组合");

	// 日中对照：同一条能按语言取到对应文案
	const entry = Core.pickEgg(["mio"], { lines: { mio: [{ zh: "中文", ja: "日本語" }] }, comboChance: 1 });
	assert.equal(Core.eggText(entry, "zh"), "中文");
	assert.equal(Core.eggText(entry, "ja"), "日本語");
	// 只写一种语言时两边都能出
	const onlyZh = Core.pickEgg(["mio"], { lines: { mio: ["只有中文"] }, comboChance: 1 });
	assert.equal(Core.eggText(onlyZh, "ja"), "只有中文");
});

test("茶桌几何：五个座位、坐标与帧宽", () => {
	assert.equal(Core.TABLE.seats.length, 5);
	assert.deepEqual(Core.TABLE.seats.map((seat) => seat.id), ["mio", "ritsu", "yui", "tsumugi", "azusa"]);
	assert.deepEqual(Core.TABLE.seats.map((seat) => seat.x), [0, 64, 112, 176, 224]);
	assert.equal(Core.TABLE.widths.ritsu, 80);
	assert.equal(Core.FRAME.columns, 4);
	assert.deepEqual(Core.ANIM.yui, [0, 4, 5, 6, 7]);
});

test("按座位切段：五人全坐还原整张桌子，抽掉一段后宽度和偏移正确", () => {
	assert.deepEqual(Core.segmentBounds(), [0, 68, 124, 176, 232, 288]);

	const all = Core.layoutSegments(Core.TABLE.seats.map((seat) => seat.id));
	assert.equal(all.width, 288);
	assert.equal(all.segments.length, 5);
	assert.deepEqual(all.segments.map((segment) => segment.offset), [0, 0, 0, 0, 0]);
	assert.deepEqual(all.segments.map((segment) => segment.x), [0, 64, 112, 176, 224]);
	assert.deepEqual(all.segments.map((segment) => segment.width), [68, 56, 52, 56, 56]);

	const withoutYui = Core.layoutSegments(["mio", "ritsu", "tsumugi", "azusa"]);
	assert.equal(withoutYui.width, 288 - 52, "抽掉唯那一段（52 宽）");
	assert.deepEqual(withoutYui.segments.map((segment) => segment.id), ["mio", "ritsu", "tsumugi", "azusa"]);
	assert.equal(withoutYui.segments.find((segment) => segment.id === "tsumugi").offset, 52);
	assert.equal(withoutYui.segments.find((segment) => segment.id === "azusa").x, 224 - 52, "后面的人跟着左移");

	const all2 = Core.layoutSegments(null);
	assert.equal(all2.segments.length, 5, "null = 不做筛选，保留整张桌子");
	assert.equal(all2.width, 288);
});

test("组合盒：把探出桌子两端的人物算进盒子，贴边不被裁", () => {
	const all = Core.frameBounds(Core.layoutSegments(null));
	assert.deepEqual([all.width, all.offset], [288, 0], "五个人全坐时盒子就是桌子");

	const withoutMio = Core.layoutSegments(["ritsu", "yui", "tsumugi", "azusa"]);
	assert.equal(withoutMio.width, 220);
	const frame = Core.frameBounds(withoutMio);
	assert.equal(withoutMio.segments[0].x, -4, "律的立绘探到桌子左边 4px");
	assert.equal(frame.width, 224, "盒子把探出的 4px 算进来");
	assert.equal(frame.offset, 4, "整组内容右移 4px");
	assert.ok(withoutMio.segments.every((segment) => segment.x + frame.offset >= 0), "每个座位都在盒子内");

	const middleGone = Core.frameBounds(Core.layoutSegments(["mio", "ritsu", "tsumugi", "azusa"]));
	assert.equal(middleGone.width, 236, "抽掉中间的人时两头都在桌内，盒子就是桌子");
	assert.equal(middleGone.offset, 0);
});
