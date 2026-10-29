# 轻音部费罐（dsh-kon-fee-widget）

DSH Web 界面上的一个小挂件：**秋山澪**帮你盯着 DeepSeek 账户余额，管着轻音部的"部费"。

- 余额大字 + 数字滚动；60 秒自动刷新，点她一下立刻刷新并冒泡说话
- 拖拽移动、四边吸附、贴左时整体镜像翻转、按压 Q 弹
- 余额低于阈值会换成"省钱"台词，卡片描边变色
- 全部设置都在「设置 → 轻音部费罐」：显示开关、大小、吸附、刷新间隔、低余额阈值、重置位置

> 只在 DSH 里显示余额，**不做**逐轮消耗、峰谷定价、多厂商记账——那些是另一个插件的事。

## 安装

### 桌面客户端（Electron）

桌面端读的是 `desktop` profile，CLI 不接受 `--profile desktop`，所以：

1. 把本仓库的 `src/client.js`、`src/core.cjs`、`lib/client.js` 复制到
   `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-kon-fee-widget\` 对应位置；
2. 在该 profile 的 `cordis.patch.yml` 里加一行 `dsh-kon-fee-widget`（或用 bundle patch 安装）；
3. 重启 DSH。

### DSH Web

```bash
dsh plugin --profile web add github:xiao2236/dsh-kon-fee-widget
```

## 余额从哪来

宿主侧（`lib/index.js`）：

1. 优先读 DSH 凭据里的 `DEEPSEEK_API_KEY`（`ctx.get('credentials')`，读不到就回退环境变量）；
2. 调 `GET https://api.deepseek.com/user/balance`（`Authorization: Bearer <key>`），取 `balance_infos[0].total_balance`；
3. 又没配 key、又有 DSH 账号登录态时，尝试 `deepseekAccount` 服务的余额；
4. 结果缓存 45 秒；失败时沿用上次余额（前端显示"读取失败（显示上次）"）。

浏览器只请求 `/dsh-kon-fee-widget/balance`，**API key 不会出现在前端**。

## 开发

```bash
node scripts/build-client.mjs   # src/core.cjs + src/client.js → lib/client.js
node scripts/check.mjs          # 清单/素材/常量自检
node test/core.test.mjs         # 单元测试
```

仓库里的 `test/harness.html` 是本地夹具：不启动 DSH 也能看挂件和设置页（余额用假数据）。

## 来源与致谢

- 交互（吸附 / 镜像翻转 / Q 弹 / 数字滚动 / 点击冒泡）参考了 [`dsh-whale-widget`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT, Copyright (c) 2026 MeteorNOX）；**未复制其源码与素材**，仅作致谢标注。详见 [`NOTICE`](NOTICE)。
- 角色图集来自同作者的 `dsh-k-on-pet` 项目，权利状态见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## License

代码 MIT，角色图像不属于 MIT（见上）。
