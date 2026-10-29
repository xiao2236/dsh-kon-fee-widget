import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../src/core.cjs");

test("默认设置：显示、1.0×、吸附开、60 秒、阈值 5 元", () => {
	const settings = Core.sanitizeSettings({});
	assert.equal(settings.visible, true);
	assert.equal(settings.scale, 1);
	assert.equal(settings.snap, true);
	assert.equal(settings.refreshSeconds, 60);
	assert.equal(settings.warnBelow, 5);
	assert.equal(settings.pos, null);
	assert.equal(settings.edge, null);
});

test("设置清洗：坏值回默认、范围钳制、位置取整", () => {
	const fixed = Core.sanitizeSettings({ visible: false, scale: 9, snap: false, refreshSeconds: 45, warnBelow: -3, pos: { x: 12.6, y: 40.2 }, edge: "left" });
	assert.equal(fixed.visible, false);
	assert.equal(fixed.scale, Core.SCALE_MAX);
	assert.equal(fixed.snap, false);
	assert.equal(fixed.refreshSeconds, 60, "45 不在 30/60/120 里，回默认");
	assert.equal(fixed.warnBelow, 0);
	assert.deepEqual(fixed.pos, { x: 13, y: 40 });
	assert.equal(fixed.edge, "left");
	assert.deepEqual(Core.sanitizeSettings({ pos: { x: "a", y: 1 }, edge: "top" }).pos, null);
	assert.equal(Core.sanitizeSettings({ edge: "top" }).edge, null);
});

test("金额格式化：CNY 用 ¥，其它币种写后缀", () => {
	assert.equal(Core.formatMoney(12.3), "¥12.30");
	assert.equal(Core.formatMoney("3.5", "CNY"), "¥3.50");
	assert.equal(Core.formatMoney(1.005, "USD"), "1.00 USD");
	assert.equal(Core.formatMoney(Number.NaN), "—");
});

test("解析 DeepSeek /user/balance 返回", () => {
	assert.deepEqual(Core.parseBalance({ balance_infos: [{ total_balance: "12.34", currency: "CNY" }] }), { ok: true, amount: 12.34, currency: "CNY" });
	assert.deepEqual(Core.parseBalance({ balance_infos: [] }), { ok: false, amount: 0, currency: "" });
	assert.equal(Core.parseBalance(null).ok, false);
});

test("吸附：靠近边缘才吸，贴左镜像，越界夹回", () => {
	const viewport = { width: 1000, height: 700 };
	const size = { width: 176, height: 146 };
	const left = Core.snapToEdge({ x: 10, y: 300 }, size, viewport, { threshold: 24 });
	assert.equal(left.x, 0);
	assert.equal(left.edge, "left");
	assert.equal(left.mirrored, true);

	const right = Core.snapToEdge({ x: 900, y: 300 }, size, viewport, { threshold: 24 });
	assert.equal(right.x, viewport.width - size.width);
	assert.equal(right.mirrored, false);

	const middle = Core.snapToEdge({ x: 300, y: 300 }, size, viewport, { threshold: 24 });
	assert.deepEqual([middle.x, middle.y, middle.edge], [300, 300, null]);

	const off = Core.snapToEdge({ x: -50, y: 9999 }, size, viewport, { threshold: 24 });
	assert.deepEqual([off.x, off.y], [0, viewport.height - size.height]);

	const noSnap = Core.snapToEdge({ x: 10, y: 10 }, size, viewport, { enabled: false, threshold: 24 });
	assert.deepEqual([noSnap.x, noSnap.y, noSnap.mirrored], [10, 10, false]);
});

test("默认位置在左下角且镜像", () => {
	const spot = Core.defaultPosition({ width: 176, height: 146 }, { width: 1000, height: 700 });
	assert.equal(spot.x, 0);
	assert.equal(spot.y, 700 - 146);
	assert.equal(spot.mirrored, true);
});

test("数字滚动：起止与缓动单调", () => {
	assert.equal(Core.rollAmount(1, 5, 0), 1);
	assert.equal(Core.rollAmount(1, 5, 1), 5);
	const mid = Core.rollAmount(1, 5, 0.5);
	assert.ok(mid > 1 && mid < 5);
	assert.ok(Core.rollAmount(1, 5, 0.2) < Core.rollAmount(1, 5, 0.8), "进度越大越接近目标");
	assert.equal(Core.rollAmount(1, 5, 2), 5, "超过 1 按 1 算");
});

test("状态行：未配置 / 读取中 / 失败 / 更新时间", () => {
	assert.equal(Core.statusInfo({ configMissing: true }).text, "未配置 API key");
	assert.equal(Core.statusInfo({ loading: true }).text, "读取中…");
	assert.equal(Core.statusInfo({ error: "network", stale: true }).text, "读取失败（显示上次）");
	assert.equal(Core.statusInfo({ error: "network" }).text, "读取失败");
	assert.equal(Core.statusInfo({ updatedAt: 0 }).text, "等待刷新");
	const stamp = new Date(2026, 9, 29, 9, 5).getTime();
	assert.equal(Core.statusInfo({ updatedAt: stamp }).text, "更新于 09:05");
});

test("台词：低于阈值走省钱台词，{money} 被替换", () => {
	const low = Core.pickLine("ok", 1.2, "CNY", 5);
	assert.ok(low.includes("¥1.20"), low);
	assert.ok(Core.LINES.low.includes(low.replace("¥1.20", "{money}")), "应是 low 池里的句子");
	const rich = Core.pickLine("ok", 99, "CNY", 5);
	assert.ok(rich.includes("¥99.00"));
	assert.ok(Core.LINES.ok.includes(rich.replace("¥99.00", "{money}")), "应是 ok 池里的句子");
	assert.ok(Core.pickLine("error").length > 0);
});
