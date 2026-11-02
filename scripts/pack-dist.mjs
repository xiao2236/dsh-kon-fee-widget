#!/usr/bin/env node
/**
 * 打发布包：`dist/dsh-kon-fee-widget-<version>.tgz`。
 *
 * 这个 tgz 就是安装源——比手工拷目录可靠（npm 会做完整性校验），
 * 可以挂到 GitHub Release，也可以用 `dsh plugin add <tgz>` / `npm i <tgz>` 安装。
 */
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
await mkdir(dist, { recursive: true });
const output = execFileSync("npm", ["pack", "--pack-destination", "dist", "--silent"], {
	cwd: root,
	encoding: "utf8",
	shell: process.platform === "win32",
}).trim();
console.log(`✓ 已打包：${join(dist, output)}`);
