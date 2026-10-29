#!/usr/bin/env node
/**
 * 轻量自检：不启动 DSH，只检查插件清单、素材与两侧常量是否自洽。
 * 运行：node scripts/check.mjs
 */
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderClient } from "./build-client.mjs";

const require = createRequire(import.meta.url);
const Core = require("../src/core.cjs");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

async function mustExist(rel) {
	try {
		const info = await stat(join(root, rel));
		if (!info.isFile()) problems.push(`不是文件：${rel}`);
		return info;
	} catch {
		problems.push(`缺少文件：${rel}`);
		return null;
	}
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const patch = await readFile(join(root, "cordis.patch.yml"), "utf8");
const client = await readFile(join(root, "lib/client.js"), "utf8");
const host = await readFile(join(root, "lib/index.js"), "utf8");

if (pkg.name !== "dsh-kon-fee-widget") problems.push(`包名应为 dsh-kon-fee-widget，实际 ${pkg.name}`);
if (!/^\s+- id: dsh-kon-fee-widget\s*$/m.test(patch)) problems.push("cordis.patch.yml 缺少 id: dsh-kon-fee-widget");
if (!patch.includes("name: 'dsh-kon-fee-widget'")) problems.push("cordis.patch.yml 缺少 name: 'dsh-kon-fee-widget'");
if (!pkg.dsh?.bundle?.patch) problems.push("package.json 缺少 dsh.bundle.patch");
if (!pkg.dsh?.client?.platform) problems.push("package.json 缺少 dsh.client.platform");
if (!pkg.dsh?.compatibility?.dshReleases) problems.push("package.json 缺少 dsh.compatibility.dshReleases");
if (!pkg.icon) problems.push("package.json 缺少 icon");
if (!Array.isArray(pkg.files) || !pkg.files.includes("src")) problems.push("package.json files 缺少 src（发布包需要源码）");

const expectedClient = await renderClient();
if (client !== expectedClient) problems.push("lib/client.js 与 src/ 不同步，请运行 node scripts/build-client.mjs");

for (const rel of [
	"icon.png",
	"src/core.cjs",
	"src/client.js",
	"lib/index.js",
	"lib/client.js",
	"assets/table/characters.json",
	"assets/table/desk00.png",
	"assets/table/desk01.png",
	...Core.TABLE.seats.map((seat) => (Core.ANIM[seat.id] ? `assets/table/${seat.id}-frames.png` : `assets/table/${seat.id}.png`)),
	"cordis.patch.yml",
	"README.md",
	"LICENSE",
	"NOTICE",
	"THIRD_PARTY_NOTICES.md",
	"test/core.test.mjs",
	"test/host.test.mjs",
]) {
	await mustExist(rel);
}

const hostPrefix = host.match(/const PREFIX = "([^"]+)"/)?.[1];
const clientBase = client.match(/const ASSET_BASE = "([^"]+)"/)?.[1];
if (!hostPrefix || !clientBase || hostPrefix !== clientBase) {
	problems.push(`素材路径不一致：host=${hostPrefix} client=${clientBase}`);
}

try {
	const layout = JSON.parse(await readFile(join(root, "assets/table/characters.json"), "utf8"));
	const anims = Object.keys(layout.animations || {});
	const known = new Set(Core.TABLE.seats.map((seat) => seat.id));
	for (const id of anims) {
		if (!known.has(id)) problems.push(`characters.json 的动画 ${id} 不在茶桌座位里`);
		if (!Core.ANIM[id]) problems.push(`characters.json 有 ${id} 的动画，但 core.ANIM 没同步`);
	}
	for (const id of Object.keys(Core.ANIM)) {
		if (!anims.includes(id)) problems.push(`core.ANIM 有 ${id}，但 characters.json 没声明`);
	}
	for (const [id, width] of Object.entries(layout.frame?.widths || {})) {
		if ((Core.TABLE.widths[id] || Core.TABLE.charWidth) !== width) problems.push(`characters.json 里 ${id} 的帧宽 ${width} 与 core.TABLE 不一致`);
	}
	if (layout.frame?.height !== Core.TABLE.charHeight) problems.push("characters.json 帧高与 core.TABLE.charHeight 不一致");
	notes.push(`茶桌 ${Core.TABLE.width}×${Core.TABLE.height}，${Core.TABLE.seats.length} 个座位，动画 ${anims.join("/")}`);
} catch (error) {
	problems.push(`characters.json 读取失败：${error.message}`);
}

if (problems.length) {
	console.error("✗ dsh-kon-fee-widget 自检失败：");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
console.log("✓ dsh-kon-fee-widget 自检通过");
for (const note of notes) console.log(`  ${note}`);
