import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

/** 造一个假的 ctx：记录 webServer 注册的 handler，按需提供 credentials / deepseekAccount。 */
function makeCtx({ credentials, account } = {}) {
	const ctx = {
		effect(fn) { return fn(); },
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

/** 造一个假的 res，收集 JSON 输出。 */
function callBalance(handler, query = "") {
	const captured = { status: 0, headers: null, body: "" };
	const res = {
		writeHead(status, headers) { captured.status = status; captured.headers = headers; },
		end(payload) { captured.body = payload ? payload.toString("utf8") : ""; },
	};
	const req = { method: "GET", url: `/dsh-kon-fee-widget/balance${query}` };
	return handler(req, res).then(() => ({ ...captured, json: captured.body ? JSON.parse(captured.body) : null }));
}

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
