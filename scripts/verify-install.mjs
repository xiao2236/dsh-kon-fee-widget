#!/usr/bin/env node
/**
 * 安装副本自检：对比「仓库里有这个文件」和「装到 profile 里的副本有没有」。
 *
 * 用法：node scripts/verify-install.mjs <安装目录>
 * 例：  node scripts/verify-install.mjs "C:/Users/me/.dsh/profiles/desktop/node_modules/dsh-kon-fee-widget"
 *
 * 为什么需要：之前 assets/table 整目录在部署时漏拷，canvas 画不出茶桌，
 * 表现就是"挂件完全不显示"，而源码目录的自检是绿的。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const sourceRoot = resolve(import.meta.dirname, "..");
const targetRoot = resolve(process.argv[2] || "");

if (!process.argv[2]) {
	console.error("用法：node scripts/verify-install.mjs <安装目录>");
	process.exit(2);
}
if (!existsSync(targetRoot)) {
	console.error(`安装目录不存在：${targetRoot}`);
	process.exit(2);
}

const SKIP = /^(\.git|node_modules|\.work|\.gitignore|\.DS_Store)$/;
const files = [];
(function walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.test(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full);
		else files.push(relative(sourceRoot, full));
	}
})(sourceRoot);

const missing = files.filter((rel) => !existsSync(join(targetRoot, rel)));
const extraRequired = ["assets/table/desk00.png", "assets/table/desk01.png", "assets/ui/cassette.png", "lib/client.js"];
const empty = extraRequired.filter((rel) => {
	const path = join(targetRoot, rel);
	return !existsSync(path) || statSync(path).size === 0;
});

if (missing.length === 0 && empty.length === 0) {
	console.log(`✓ 安装副本完整（${files.length} 个文件）: ${targetRoot}`);
	process.exit(0);
}

if (missing.length) {
	console.error(`✗ 安装副本缺少 ${missing.length} 个文件：`);
	for (const rel of missing.slice(0, 40)) console.error(`   - ${rel}`);
	if (missing.length > 40) console.error(`   …还有 ${missing.length - 40} 个`);
}
if (empty.length) {
	console.error("✗ 关键文件缺失或为空：");
	for (const rel of empty) console.error(`   - ${rel}`);
}
process.exit(1);
