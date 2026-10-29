import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

/** 造一个假的 ctx：记录 webServer 注册的 handler 与会话事件订阅。 */
function makeCtx({ credentials, account } = {}) {
	const ctx = {
		handlers: {},
		effect(fn) { return fn(); },
		on(event, listener) {
			ctx.handlers[event] = listener;
			return () => {};
		},
		get(name) {
			if (name === "credentials") return credentials || null;
			if (name === "deepseekAccount") return account || null;
			return null;
		},
		webServer: {
			register(options) {
				ctx.handler = options.handler;
				return () => {};
			},
		},
	};
	apply(ctx);
	return ctx;
}

/** 调一条路由，收集 JSON。 */
function callRoute(handler, path) {
	const captured = { status: 0, headers: null, body: "" };
	const res = {
		writeHead(status, headers) { captured.status = status; captured.headers = headers; },
		end(payload) { captured.body = payload ? payload.toString("utf8") : ""; },
	};
	const req = { method: "GET", url: path };
	return handler(req, res).then(() => ({ ...captured, json: captured.body ? JSON.parse(captured.body) : null }));
}

/** 造一个假的 res，收集 JSON 输出。 */
function callBalance(handler, query = "") {
	return callRoute(handler, `/dsh-kon-fee-widget/balance${query}`);
}

/** POST 一条 JSON 路由。 */
function callPost(handler, path, payload) {
	const body = Buffer.from(JSON.stringify(payload), "utf8");
	const req = {
		method: "POST",
		url: path,
		async *[Symbol.asyncIterator]() {
			yield body;
		},
	};
	const captured = { status: 0, headers: null, body: "" };
	const res = {
		writeHead(status, headers) { captured.status = status; captured.headers = headers; },
		end(data) { captured.body = data ? data.toString("utf8") : ""; },
	};
	return handler(req, res).then(() => ({ ...captured, json: captured.body ? JSON.parse(captured.body) : null }));
}

test("配置文件：默认值带注释写盘、POST 修改、手改后能重新读到", async () => {
	const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = await mkdtemp(join(tmpdir(), "kon-fee-config-"));
	const file = join(dir, "kon-fee-widget.json");
	const previous = process.env.KON_FEE_CONFIG;
	process.env.KON_FEE_CONFIG = file;
	try {
		const ctx = makeCtx({});
		const first = await callRoute(ctx.handler, "/dsh-kon-fee-widget/config");
		assert.equal(first.json.ok, true);
		assert.deepEqual(first.json.config.characters, { mio: true, ritsu: true, yui: true, tsumugi: true, azusa: true });
		assert.equal(first.json.config.scale, 1);
		assert.equal(first.json.config.bubbleStyle, "cassette", "默认卡带背景");
		assert.equal(first.json.path, file);

		const written = await readFile(file, "utf8");
		assert.ok(written.includes("// 五个人谁坐上桌"), "默认配置写盘时带中文注释");
		assert.ok(written.includes('"mio": true'));

		const posted = await callPost(ctx.handler, "/dsh-kon-fee-widget/config", { characters: { mio: false }, scale: 1.45, warnBelow: 2 });
		assert.equal(posted.json.config.characters.mio, false);
		assert.equal(posted.json.config.characters.ritsu, true, "没点名的角色保持显示");
		assert.equal(posted.json.config.scale, 1.45);
		assert.equal(posted.json.config.warnBelow, 2);
		const afterPost = await readFile(file, "utf8");
		assert.ok(afterPost.includes('"mio": false'), "POST 后写回文件");
		const bg = await callPost(ctx.handler, "/dsh-kon-fee-widget/config", { bubbleStyle: "mascot" });
		assert.equal(bg.json.config.bubbleStyle, "mascot");
		const bgFile = await readFile(file, "utf8");
		assert.ok(bgFile.includes('"bubbleStyle": "mascot"'), "背景选择写回文件");
		const bad = await callPost(ctx.handler, "/dsh-kon-fee-widget/config", { bubbleStyle: "nope" });
		assert.equal(bad.json.config.bubbleStyle, "cassette", "非法值回默认");

		// 手改文件（带注释、只写一部分）→ 下次 GET 能读到
		await writeFile(file, `{
  // 手改：只留空桌子
  "showCharacters": false,
  "scale": 0.8
}
`, "utf8");
		const reread = await callRoute(ctx.handler, "/dsh-kon-fee-widget/config");
		assert.equal(reread.json.config.characters.mio, false);
		assert.equal(reread.json.config.characters.azusa, false);
		assert.equal(reread.json.config.scale, 0.8);
		assert.equal(reread.json.config.turnBubble, true, "没写的键回默认");

		// 非法 JSON → 回默认并重写文件
		await writeFile(file, "{ 不是 json", "utf8");
		const broken = await callRoute(ctx.handler, "/dsh-kon-fee-widget/config");
		assert.equal(broken.json.config.characters.mio, true);
	} finally {
		if (previous === undefined) delete process.env.KON_FEE_CONFIG;
		else process.env.KON_FEE_CONFIG = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("有 API key：走 /user/balance 并解析 total_balance", async (t) => {
	const originalFetch = globalThis.fetch;
	const originalKey = process.env.DEEPSEEK_API_KEY;
	delete process.env.DEEPSEEK_API_KEY;
	let calls = 0;
	globalThis.fetch = async (url, options) => {
		calls += 1;
		assert.match(url, /api\.deepseek\.com\/user\/balance/);
		assert.equal(options.headers.authorization, "Bearer sk-test");
		return { ok: true, status: 200, json: async () => ({ balance_infos: [{ total_balance: "8.88", currency: "CNY" }] }) };
	};
	try {
		const ctx = makeCtx({ credentials: { get: async () => "sk-test" } });
		const result = await callBalance(ctx.handler);
		assert.equal(result.status, 200);
		assert.equal(result.json.ok, true);
		assert.equal(result.json.amount, 8.88);
		assert.equal(result.json.currency, "CNY");
		assert.equal(result.json.source, "api");
		assert.equal(calls, 1);

		// 缓存：45 秒内再请求不应该再打上游
		const second = await callBalance(ctx.handler);
		assert.equal(second.json.amount, 8.88);
		assert.equal(calls, 1, "应该命中缓存");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalKey !== undefined) process.env.DEEPSEEK_API_KEY = originalKey;
	}
});

test("没有 key 但有账号登录态：充值钱包 + 赠金相加", async (t) => {
	const originalFetch = globalThis.fetch;
	const originalKey = process.env.DEEPSEEK_API_KEY;
	delete process.env.DEEPSEEK_API_KEY;
	globalThis.fetch = async () => { throw new Error("不应该调用上游"); };
	try {
		const account = {
			getBalance: async (options) => {
				assert.equal(options.locale.length > 0, true);
				return { status: "ready", value: [{ balance: "3.5", currency: "CNY" }], bonusWallets: [{ balance: "1.25", currency: "CNY" }] };
			},
		};
		const ctx = makeCtx({ account });
		const result = await callBalance(ctx.handler, "?force=1");
		assert.equal(result.json.ok, true);
		assert.equal(result.json.amount, 4.75);
		assert.equal(result.json.source, "account");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalKey !== undefined) process.env.DEEPSEEK_API_KEY = originalKey;
	}
});

test("都没有：返回 no-key，前端据此显示未配置", async (t) => {
	const originalKey = process.env.DEEPSEEK_API_KEY;
	delete process.env.DEEPSEEK_API_KEY;
	try {
		const ctx = makeCtx({});
		const result = await callBalance(ctx.handler, "?force=1");
		assert.equal(result.json.ok, false);
		assert.equal(result.json.error, "no-key");
	} finally {
		if (originalKey !== undefined) process.env.DEEPSEEK_API_KEY = originalKey;
	}
});

test("上游失败但没有账号：request-failed", async (t) => {
	const originalFetch = globalThis.fetch;
	const originalKey = process.env.DEEPSEEK_API_KEY;
	delete process.env.DEEPSEEK_API_KEY;
	globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
	try {
		const ctx = makeCtx({ credentials: { get: async () => "sk-bad" } });
		const result = await callBalance(ctx.handler, "?force=1");
		assert.equal(result.json.ok, false);
		assert.equal(result.json.error, "key-invalid");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalKey !== undefined) process.env.DEEPSEEK_API_KEY = originalKey;
	}
});

test("每轮消耗：assistant/message 聚合 + turn/end 结算", async () => {
test("每轮消耗：assistant/message 聚合 + turn/end 结算 + 今天合计", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = await mkdtemp(join(tmpdir(), "kon-fee-turn-"));
	const previous = process.env.KON_FEE_CONFIG;
	process.env.KON_FEE_CONFIG = join(dir, "kon-fee-widget.json");
	try {
		const ctx = makeCtx({});
		assert.equal(typeof ctx.handlers["session/event"], "function", "订阅了会话事件流");
		const emit = (session, event) => ctx.handlers["session/event"](session, event);

		const empty = await callRoute(ctx.handler, "/dsh-kon-fee-widget/last-turn");
		assert.equal(empty.json.ok, true);
		assert.equal(empty.json.turn, null, "还没跑过对话时没有记录");
		assert.equal(empty.json.today.turns, 0, "今天还没花");

		// Flash：命中 2000、未命中 1000、输出 500
		emit({ id: "s1" }, {
			type: "assistant/message",
			data: { turn: 1, usage: { inputTokens: 1000, cacheReadTokens: 2000, outputTokens: 500 }, message: { source: { model: "deepseek-v4-flash" } } },
		});
		emit({ id: "s1" }, { type: "turn/end" });
		const firstBody = (await callRoute(ctx.handler, "/dsh-kon-fee-widget/last-turn")).json;
		const first = firstBody.turn;
		assert.equal(first.tokens, 3500, "token 总数 = 命中 + 未命中 + 输出");
		assert.equal(first.model, "deepseek-v4-flash");
		const price = first.peak ? { hit: 0.04, miss: 2, out: 8 } : { hit: 0.02, miss: 1, out: 4 };
		const expected = (2000 / 1e6) * price.hit + (1000 / 1e6) * price.miss + (500 / 1e6) * price.out;
		assert.ok(Math.abs(first.amount - expected) < 1e-9, `金额按峰谷价算（${first.amount} ≈ ${expected}）`);
		assert.equal(firstBody.today.turns, 1, "今天记了 1 轮");
		assert.ok(Math.abs(firstBody.today.amount - first.amount) < 1e-9, "今天合计 = 第一轮");

		// 第二轮（Pro，100 万未命中）覆盖 lastTurn，并累加到今天
		emit({ id: "s1" }, {
			type: "assistant/message",
			data: { turn: 2, usage: { inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 }, message: { source: { model: "deepseek-v4-pro" } } },
		});
		emit({ id: "s1" }, { type: "turn/end" });
		const secondBody = (await callRoute(ctx.handler, "/dsh-kon-fee-widget/last-turn")).json;
		const second = secondBody.turn;
		assert.equal(second.tokens, 1_000_000);
		assert.equal(second.model, "deepseek-v4-pro");
		assert.ok(second.amount > first.amount, "Pro 更贵");
		assert.equal(secondBody.today.turns, 2);
		assert.ok(Math.abs(secondBody.today.amount - (first.amount + second.amount)) < 1e-6, "两轮金额累加");

		// 中途换轮：还没 turn/end 又来了新 turn，旧的一轮先结算
		emit({ id: "s1" }, {
			type: "assistant/message",
			data: { turn: 3, usage: { inputTokens: 100, cacheReadTokens: 0, outputTokens: 0 }, message: { source: { model: "deepseek-v4-flash" } } },
		});
		emit({ id: "s1" }, {
			type: "assistant/message",
			data: { turn: 4, usage: { inputTokens: 200, cacheReadTokens: 0, outputTokens: 0 }, message: { source: { model: "deepseek-v4-flash" } } },
		});
		const afterShift = (await callRoute(ctx.handler, "/dsh-kon-fee-widget/last-turn")).json.turn;
		assert.ok(afterShift, "换轮时旧轮已结算");
		// 第三轮结算后应该是 turn 4 的 200
		emit({ id: "s1" }, { type: "turn/end" });
		const last = (await callRoute(ctx.handler, "/dsh-kon-fee-widget/last-turn")).json;
		assert.equal(last.turn.tokens, 200);
		assert.ok(last.today.turns >= 4, "今天累计到 4 轮以上");
	} finally {
		if (previous === undefined) delete process.env.KON_FEE_CONFIG;
		else process.env.KON_FEE_CONFIG = previous;
		await rm(dir, { recursive: true, force: true });
	}
});
});

test("静态素材路由仍然可用，非本插件前缀返回 404", async () => {
	const { PassThrough } = await import("node:stream");
	const ctx = makeCtx({});
	const makeRes = () => {
		const res = new PassThrough();
		res.status = 0;
		res.writeHead = (status) => { res.status = status; };
		return res;
	};
	const res = makeRes();
	await ctx.handler({ method: "GET", url: "/dsh-kon-fee-widget/table/characters.json" }, res);
	await new Promise((done) => setTimeout(done, 200));
	assert.equal(res.status, 200);
	const missing = makeRes();
	await ctx.handler({ method: "GET", url: "/other/thing" }, missing);
	await new Promise((done) => setTimeout(done, 50));
	assert.equal(missing.status, 404);
});
