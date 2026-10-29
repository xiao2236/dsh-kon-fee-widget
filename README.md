# 轻音部费罐（dsh-kon-fee-widget）

DSH 上的一个小挂件：**原版的大茶桌**当底座，轻音部五个人坐成一排，帮你盯着 DeepSeek 账户的"部费"。

平时桌上看不到任何数字；**点一下茶桌**才弹出账本：余额、峰谷时段、更新时间。

- 茶桌三层切分：`desk00` 背景 + 五人坐姿 + `desk01` 前景（中间三人坐姿动画、两侧静态）
- 点一下弹"部费账本"：卡带/动物两种背景（`bubbleStyle` 配置切换）+ 右上角高峰/谷价标签 + 大字余额 + 今天花费 + 计价进度条 + 左下角更新时间，默认 8 秒自动收起
- 峰谷按北京时间：工作日 9:00–12:00、14:00–18:00 高峰，其余谷时，周末全天谷价；倒计时逐秒走
- 拖拽移动、四边吸附、按压 Q 弹；右上角**齿轮**菜单可直接改大小（**气泡跟着一起缩放**）、一键「回到右下角」（点齿轮会先收起账本）
- 缩放走 CSS `transform: scale()`，不改布局、不重绘 canvas，拖滑杆不闪
- **双击茶桌弹彩蛋台词**（`easterEgg` 开关，`easterEggLines` 可自定义）；点茶桌外任意处收起账本
- **每轮对话结束弹一条消耗气泡**：`本轮 ¥0.012 · 1.2k tokens · 谷时`（宿主订阅 `session/event`，按官方价目表估算）
- 余额低于阈值时账本数字变红、台词换成"省钱"版
- 设置页只有两块：**坐上桌的人**（五个按钮，勾掉谁就连它那段桌子一起收起；五个全不勾 → 整张桌子不显示）和**编辑配置**（弹窗直接改 JSON）；其他旋钮也可以手改 `~/.dsh/kon-fee-widget.json`（带注释的 JSON）

## 配置

首次启动会自动生成 `~/.dsh/kon-fee-widget.json`（JSONC，带中文注释）：

```jsonc
{
  // 整个挂件是否显示（false = 茶桌完全消失）
  "visible": true,
  // 五个人谁坐上桌（false = 这个人连同自己那一段桌子一起收起）
  // 可选值：mio（澪）ritsu（律）yui（唯）tsumugi（䌷）azusa（梓）
  "characters": { "mio": true, "ritsu": true, "yui": true, "tsumugi": true, "azusa": true },
  // 整张茶桌缩放，0.5 ~ 1.6
  "scale": 1,
  // 拖到屏幕边缘松手后是否自动贴边
  "snap": true,
  // 余额自动刷新间隔（秒，15 ~ 600；点茶桌也会刷新）
  "refreshSeconds": 60,
  // 余额低于这个数（元）时，账本数字变红、台词换成省钱的
  "warnBelow": 5,
  // 每轮对话结束是否弹「本轮消耗」小气泡
  "turnBubble": true,
  // 账本气泡停留时长（毫秒）
  "panelDurationMs": 8000
}
```

设置页的五个角色按钮会直接改写 `characters`；其余键手改即可（改完刷新页面）。

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
