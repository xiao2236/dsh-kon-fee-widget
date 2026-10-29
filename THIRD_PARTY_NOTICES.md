# Third-party notices

`dsh-kon-fee-widget` 的**代码**以 MIT 发布。以下内容不属于 MIT 授权范围。

## 1. 角色图像（非 MIT）

| 内容 | 文件 | 来源 | 权利状态 |
| --- | --- | --- | --- |
| 秋山澪 精灵图集 | `assets/characters/mio/sheet.png` | 原版 Windows 桌宠 `k-on-pet` 的 `Mascot*.arc` 资源包，经 `.el` 解码重建（取自同作者的 `dsh-k-on-pet` 项目） | 版权归原作者及《K-ON!》相关权利方；原分发未见明确再分发许可 |
| 帧包围盒 / 动作分组 | `assets/characters/mio/meta.json` | 由上述图集计算，只保留动作行与帧数据（已去掉语音与台词） | 事实性数据；随图集一并提供 |

角色名称「秋山澪」及《K-ON! 轻音少女》相关名称、形象，版权归 Kakifly / 芳文社 / 京都动画及各自权利方所有。本项目是**非官方同人作品**，与上述权利方无关联，也未获其背书；素材随插件提供，仅用于**个人学习、同人欣赏**。

权利方若要求下架，请开 issue 或联系维护者；维护者会删除对应资产或整包。

## 2. 运行时依赖（不随包捆绑）

插件把 React 等声明为 peer dependency，由 DSH profile 提供，不复制其源码。
