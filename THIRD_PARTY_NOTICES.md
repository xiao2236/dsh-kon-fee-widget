# Third-party notices

`dsh-kon-fee-widget` 的**代码**以 MIT 发布。以下内容不属于 MIT 授权范围。

## 1. 茶桌与角色图像（非 MIT）

| 内容 | 文件 | 来源 | 权利状态 |
| --- | --- | --- | --- |
| 茶桌背景/前景 | `assets/table/desk00.png`、`assets/table/desk01.png` | 原版 Windows 桌宠 `MascotTable.exe` 的 `MascotTable_d` 资源，经 `.el` 解码重建（取自同作者的 `dsh-k-on-pet` 项目） | 版权归原作者及《K-ON!》相关权利方；原分发未见明确再分发许可 |
| 五人坐姿 | `assets/table/{mio,ritsu,yui,tsumugi,azusa}.png`、`assets/table/{yui,ritsu,tsumugi,azusa,mio}-frames.png` | 同上，按 4×2 帧表切片 | 同上 |
| 座位/帧表数据 | `assets/table/characters.json` | 从 `main.sd` 还原的座位顺序、帧宽与动画帧列表 | 事实性数据；随素材一并提供 |
| 点缀物（音符/花） | `assets/table/notes.png`、`assets/table/yui-dance.png` | 同上 | 同上 |

角色名称「平泽唯」「秋山澪」「田井中律」「琴吹䌷」「中野梓」及《K-ON! 轻音少女》相关名称、形象，版权归 Kakifly / 芳文社 / 京都动画及各自权利方所有。本项目是**非官方同人作品**，与上述权利方无关联，也未获其背书；素材随插件提供，仅用于**个人学习、同人欣赏**。

权利方若要求下架，请开 issue 或联系维护者；维护者会删除对应资产或整包。

## 2. 运行时依赖（不随包捆绑）

插件把 React 等声明为 peer dependency，由 DSH profile 提供，不复制其源码。
