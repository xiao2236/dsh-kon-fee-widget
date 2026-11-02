#!/usr/bin/env node
/**
 * 原子部署：先拷到同级隐藏目录 → 校验 → 再整体替换，避免"删了一半/拷了一半"的半成品。
 *
 * 用法：
 *   node scripts/deploy.mjs                       # 默认装到桌面 profile
 *   node scripts/deploy.mjs --target <目录>        # 指定安装目录
 *   node scripts/deploy.mjs --dry                 # 只拷贝+校验，不替换
 *
 * 为什么要这样：直接 Remove-Item + Copy-Item 到运行中的目录时，Windows 文件占用或
 * 杀软扫描会让部分文件复制失败（旧脚本还吞了错误），结果就是一个"缺 assets 的插件"，
 * 现象是挂件完全不显示。原子替换保证目标目录只会在校验通过后出现。
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const sourceRoot = resolve(import.meta.dirname, "..");
const ITEMS = [
	"lib", "src", "assets", "scripts", "test", "docs",
	"package.json", "cordis.patch.yml", "icon.png",
	"LICENSE", "NOTICE", "README.md", "THIRD_PARTY_NOTICES.md", "screenshots.json",
];
const SKIP = /^(\.git|node_modules|\.work|dist|\.gitignore|\.DS_Store)$/;

function option(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const dry = process.argv.includes("--dry");
const defaultTarget = join(process.env.USERPROFILE ?? homedir(), ".dsh", "profiles", "desktop", "node_modules", "dsh-kon-fee-widget");
const target = resolve(option("--target", defaultTarget));
const staging = join(dirname(target), `.${basename(target)}.new`);
const backup = join(dirname(target), `.${basename(target)}.old`);

async function listFiles(root) {
	const out = [];
	async function walk(dir) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			if (SKIP.test(entry.name)) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) await walk(full);
			else out.push(full.slice(root.length + 1));
		}
	}
	await walk(root);
	return out;
}

async function verify(stage) {
	const sourceFiles = await listFiles(sourceRoot);
	const missing = sourceFiles.filter((rel) => !existsSync(join(stage, rel)));
	if (missing.length) {
		console.error(`✗ 暂存目录缺少 ${missing.length} 个文件：`);
		for (const rel of missing.slice(0, 20)) console.error(`   - ${rel}`);
		return false;
	}
	console.log(`✓ 暂存目录完整（${sourceFiles.length} 个文件）`);
	return true;
}

async function copyInto(destination) {
	await mkdir(destination, { recursive: true });
	for (const item of ITEMS) {
		await cp(join(sourceRoot, item), join(destination, item), { recursive: true, force: true });
	}
}

async function main() {
	console.log(`源目录：${sourceRoot}`);
	console.log(`目标：  ${target}`);
	await rm(staging, { recursive: true, force: true });
	await rm(backup, { recursive: true, force: true });
	await copyInto(staging);
	if (!(await verify(staging))) {
		await rm(staging, { recursive: true, force: true });
		process.exit(1);
	}
	if (dry) {
		console.log(`--dry：保留暂存目录 ${staging}，未替换目标`);
		return;
	}

	const existed = existsSync(target);
	try {
		if (existed) await rename(target, backup);
		await rename(staging, target);
		await rm(backup, { recursive: true, force: true });
		console.log("✓ 原子替换完成");
	} catch (error) {
		console.warn(`原子替换失败（${error.code || error.message}），回退到原地覆盖…`);
		try {
			if (existsSync(backup) && !existsSync(target)) await rename(backup, target);
		} catch { /* 尽力恢复 */ }
		await copyInto(target);
		if (!(await verify(target))) {
			console.error("✗ 原地覆盖后校验失败");
			process.exit(1);
		}
		console.log("✓ 原地覆盖完成（下一次建议先退出 DSH 再部署，才能走原子路径）");
	}

	const version = JSON.parse(execFileSync(process.execPath, ["-e", `console.log(JSON.stringify(require(${JSON.stringify(join(target, "package.json"))})))`], { encoding: "utf8" })).version;
	console.log(`已部署版本：${version}`);
	console.log("提示：宿主的改动要重启 DSH；素材改动刷新页面即可。自检：GET /dsh-kon-fee-widget/health");
}

await main();
