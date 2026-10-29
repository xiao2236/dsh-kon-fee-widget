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

test("茶桌几何：五个座位、坐标与帧宽", () => {
	assert.equal(Core.TABLE.seats.length, 5);
	assert.deepEqual(Core.TABLE.seats.map((seat) => seat.id), ["mio", "ritsu", "yui", "tsumugi", "azusa"]);
	assert.deepEqual(Core.TABLE.seats.map((seat) => seat.x), [0, 64, 112, 176, 224]);
	assert.equal(Core.TABLE.widths.ritsu, 80);
	assert.equal(Core.FRAME.columns, 4);
	assert.deepEqual(Core.ANIM.yui, [0, 4, 5, 6, 7]);
});
