# 轻音部费罐（dsh-kon-fee-widget）

DSH 上的一个小挂件：**原版的大茶桌**当底座，轻音部五个人坐成一排，帮你盯着 DeepSeek 账户的"部费"。

平时桌上看不到任何数字；**点一下茶桌**才弹出账本：余额、峰谷时段、更新时间。

- 茶桌三层切分：`desk00` 背景 + 五人坐姿 + `desk01` 前景（中间三人坐姿动画、两侧静态）
- **按座位段切桌子**：五段边界 0 / 68 / 124 / 176 / 232 / 288，勾掉谁就连带自己那一段桌子一起收起来，桌子随之变短，后面的人跟着左移
- 点一下弹账本（6 秒自动收起），显示 **余额 + 高峰/谷时 + 更新时间**
- 峰谷按北京时间：工作日 9:00–12:00、14:00–18:00 高峰，其余谷时，周末全天谷价
- 拖拽移动、四边吸附、按压 Q 弹
- 全展示（五人坐满）可切；关掉后能单独勾选谁坐桌上
- 余额低于阈值时账本数字变红、台词换成"省钱"版
- 设置页：显示、全展示、角色、大小、吸附、刷新间隔、阈值、立即刷新、重置位置

## 安装

### 桌面客户端（Electron）

1. 把本仓库复制到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-kon-fee-widget`；
2. 在该 profile 的 `package.json` 里加依赖 `"dsh-kon-fee-widget": "file:<仓库路径>"`，并加进 `dsh.profile.bundles`；
3. 重启 DSH（客户端包只在启动时加载）。

### DSH Web

```bash
dsh plugin --profile web add github:xiao2236/dsh-kon-fee-widget
```

## 余额从哪来

宿主侧（`lib/index.js`）：

1. 优先读 DSH 凭据里的 `DEEPSEEK_API_KEY`（`ctx.get('credentials')`，读不到回退环境变量）；
2. `GET https://api.deepseek.com/user/balance` → `balance_infos[0].total_balance`；
3. 没有 key 但有 DSH 账号登录态时，用 `deepseekAccount.getBalance()`（充值钱包 + 赠金相加）；
4. 结果缓存 45 秒；失败沿用上次余额（前端显示"读取失败（显示上次）"）。

浏览器只请求 `/dsh-kon-fee-widget/balance`，**API key 不会下发到前端**。

## 开发

```bash
node scripts/build-client.mjs   # src/core.cjs + src/client.js → lib/client.js
node scripts/check.mjs          # 清单/素材/常量自检
node --test test/core.test.mjs test/host.test.mjs
```

`test/harness.html` 是本地夹具：不启动 DSH 也能看茶桌挂件和设置页（余额用假数据）。

## 素材与来源

- 茶桌、五人坐姿、点缀物：取自原版 Windows 桌宠 `MascotTable.exe` 的资源（同作者 `dsh-k-on-pet` 项目），**不属于 MIT**，详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
- 交互（吸附 / Q 弹 / 峰谷 / 点击冒泡）参考了 [`dsh-whale-widget`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT, Copyright (c) 2026 MeteorNOX）；**未复制其源码与素材**，详见 [`NOTICE`](NOTICE)。

## License

代码 MIT，角色与茶桌图像不属于 MIT（见上）。
