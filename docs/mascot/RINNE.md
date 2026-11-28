# 看板娘「环音 / Rinne」角色设定与出图规范

**RINNE RELAY**（`MULTI-AGENT RELAY` / `RN`）的原创看板娘。本文件给 AI 生图用：设定、提示词、表情清单、文件规范与当前同步进度一应俱全，出完图按「文件规范」放进 `public/mascot/` 即可，界面会自动优先加载 `.png` 替换矢量 `.svg` 占位图。

> 原创边界：只借参考图的**风格**（高调白蓝、细线稿、钴蓝轨道、柠檬黄点缀、科技 HUD），**不借角色**。人物、发型配色、服装、徽记、签名都不能接近参考图或任何游戏角色。提示词里不要写任何游戏名、角色名、画师名。

---

## 0. 当前项目与立绘同步进度（2026-11-28）

- **品牌与界面已定稿**：品牌标识为 `RINNE RELAY`（`VOL.01` / `RN`），支持浅色与深色双主题、杂志封面空态（`JournalCover`）与右下角悬浮停靠（`dock`）。
- **组件加载规则（[RinneMascot.tsx](../../src/components/RinneMascot.tsx)）**：
  - 优先查找 `public/mascot/rinne-<state>.png`，缺失时自动回退到矢量占位 `rinne-<state>.svg` → `rinne-idle.png/.svg` → 内置剪影。
  - 目前 `public/mascot/` 下 **9 张精绘透明底 `.png` 已全部生成并就位**（`hero` 1000×1200、`idle/listening/working/approval/error/done/sleep` 800×800、`avatar` 512×512），界面自动优先渲染精绘立绘。
- **最新协作场景（供表情与道具呼应）**：多模型并行群聊与可设/无限互聊接力、工作区代码分屏（持久化）、可视化 12 节点画布、MCP Server / 文件桥接 / 保活待命监听、Token 消耗与订阅制 `%` / 积分追踪。

---

## 1. 角色设定

| 项目 | 内容 |
| --- | --- |
| 名字 | 环音（Rinne）—— 取「循环 / ∞」之意 |
| 身份 | 本地协作中枢的「接线员」：把任务光球在各个模型之间传来传去，盯进度、喊人拍板 |
| 性格 | 冷静干练、话少，偶尔犯迷糊；对「拍板」这件事格外认真 |
| 标志物 | 柠檬色任务光球（她的「任务令牌」）、一侧耳罩是发光的「事件视界之眼」的耳机、轨道枕木发夹 |
| 口头禅 | 「已接线。」「这一单，等你拍板。」 |

### 外形要点（固定锚点，每张图都要一致）

- **发型**：深海军蓝**长直发**，过腰；发梢带**棱镜渐变**（青 → 薄荷 → 淡粉）；左侧一根细编辫，别着 3 枚钴蓝「轨道枕木」小发夹。
- **眼睛**：**柠檬黄**瞳色，瞳孔里有细小的十字星芒高光。
- **耳机**：白色大耳机。右耳罩是圆形发光的「眼」：深蓝核心 + 紫粉光晕 + 一道横向细光。左耳罩是白色，印着细字 `RN-∞`。
- **服装**：白色短款工装外套（oversized、袖口宽），**钴蓝内衬**和钴蓝走线。里面是深海军蓝高领紧身衣。黑色短褶裙，裙边一条柠檬黄细线。外套和腰间有白色技术绑带，带金属扣。
- **配件**：左臂一圈半透明的 HUD 臂环，上面滚动小字 `RELAY // ONLINE`。脚上是白色厚底短靴（只在全身图里出现）。
- **体型 / 年龄感**：青年，约 18–20 岁，身形纤细，比例写实偏动漫（7 头身左右）。

### 配色（和界面主题一致）

| 用途 | 色值 |
| --- | --- |
| 钴蓝（主色） | `#2A4DE6` |
| 深海军蓝（头发、内衣） | `#0D1A66` / `#0A1240` |
| 柠檬黄（眼睛、光球、点缀） | `#F4E27A` |
| 紫粉（耳罩光晕） | `#C26CF0` / `#F1B8F6` |
| 白（外套） | `#F8FAFC` |
| 背景基调 | `#EEF1F6` |

### 和参考图的区分清单（出图后自查）

- [ ] 头发**不是**银白 / 浅灰，也**不是**短发 / 波波头
- [ ] 外套**不是**蓝色主体（是白色外套 + 钴蓝内衬）
- [ ] 瞳色**不是**蓝色（是柠檬黄）
- [ ] 没有黑色乐福鞋 + 白长袜的组合
- [ ] 画面里没有任何签名、游戏 Logo、∞ 以外的徽记

---

## 2. 文件规范

全部放到 `public/mascot/`，**透明背景 PNG**，文件名必须一致：

| 文件 | 用途 | 构图 | 建议尺寸 |
| --- | --- | --- | --- |
| `rinne-hero.png` | 空白会话的大立绘（从卡片上方探出来） | 腰部以上，微微前倾招手，**头顶和左右留白少** | 1000 × 1200 |
| `rinne-idle.png` | 待命 | 胸像（胸口以上），正面偏 3/4 | 800 × 800 |
| `rinne-listening.png` | 监听待命（有外部 Agent 在挂机等任务） | 胸像，一手扶耳机，眼睛看向侧上方 | 800 × 800 |
| `rinne-working.png` | 工作中（有成员在跑） | 胸像，手心托着旋转的柠檬光球，专注 | 800 × 800 |
| `rinne-approval.png` | 等你拍板 | 胸像，举着一块小 HUD 牌 `APPROVE?`，眼神期待 | 800 × 800 |
| `rinne-error.png` | 出错 / 失败 | 胸像，皱眉，耳机的「眼」闪红色，头顶小汗滴 | 800 × 800 |
| `rinne-done.png` | 完成 | 胸像，比 V 或轻轻点头微笑，光球变成小星星 | 800 × 800 |
| `rinne-sleep.png` | 全员离线 | 胸像，打瞌睡，耳机滑到脖子上，头顶一个小 `zZ` | 800 × 800 |
| `rinne-avatar.png`（可选） | 群助手头像 / 应用图标 | 头部特写，正方形 | 512 × 512 |

**要求：**
- 胸像系列**同一机位、同一大小**：头顶到画布顶部约 8%，肩膀从画布底部出框。这样切换表情时人物不会跳。
- 光源统一：左上方柔光，整体高调（亮），阴影偏冷蓝。
- 生成工具不能直接出透明背景的话，先出纯白或纯色背景，再用抠图工具去背景，边缘保留 1–2px 柔边。
- 只有部分图也没关系：缺哪张，界面就自动用 `rinne-idle.png` 顶上；连 idle 都没有时显示占位剪影。

---

## 3. 提示词

### 3.1 通用风格（每张都加在最前面）

```
clean modern anime illustration, high-key bright palette, white and cobalt blue color scheme with lemon yellow accents, thin crisp line art, soft cel shading with subtle gradients, glossy specular highlights, sci-fi techwear, minimal HUD decoration, soft cool-blue shadows, professional character design, highly detailed, sharp focus
```

### 3.2 角色锚定（每张都加，保证同一个人）

```
1girl, Rinne, young woman around 19, slender, long straight deep navy blue hair reaching the waist, hair tips with a prismatic gradient of cyan mint and pale pink, a thin side braid on the left with three small cobalt blue hair clips shaped like rail ties, lemon yellow eyes with tiny four-pointed star highlights in the pupils, large white over-ear headphones, the right ear cup is a glowing circular eye with a deep blue core, violet-pink halo and a thin horizontal light streak, the left ear cup is white with small text "RN-∞", oversized cropped white utility jacket with cobalt blue lining and cobalt stitching, wide cuffs, white technical straps with metal buckles, deep navy high-neck bodysuit underneath, black short pleated skirt with a thin lemon yellow trim, translucent holographic armband on the left arm
```

### 3.3 每张图的动作

| 文件 | 追加提示词 |
| --- | --- |
| hero | `waist-up portrait, leaning slightly forward, waving one hand in greeting, the other hand holding a small glowing lemon-yellow orb, gentle confident smile, looking at viewer, three-quarter view, transparent background` |
| idle | `bust portrait from chest up, three-quarter view, calm neutral expression, slight smile, looking at viewer, transparent background` |
| listening | `bust portrait from chest up, one hand pressing the headphone ear cup, eyes glancing up to the side, attentive expression, faint sound-wave HUD lines near the ear, transparent background` |
| working | `bust portrait from chest up, holding a spinning glowing lemon-yellow orb above the palm, focused expression, small floating HUD panels, motion lines around the orb, transparent background` |
| approval | `bust portrait from chest up, holding up a small holographic sign that reads "APPROVE?", hopeful expectant eyes, slight head tilt, transparent background` |
| error | `bust portrait from chest up, worried frown, the glowing eye ear cup flashing red, a small sweat drop on the head, small red warning HUD icon, transparent background` |
| done | `bust portrait from chest up, gentle happy smile with closed eyes, making a small V sign, the orb turned into tiny sparkling stars, transparent background` |
| sleep | `bust portrait from chest up, dozing off with eyes closed, headphones slipped down around the neck, small "zZ" floating above the head, relaxed, transparent background` |
| avatar | `head and shoulders close-up, centered, looking at viewer, soft smile, simple light blue-white gradient background, square composition` |

### 3.4 负面提示词

```
silver hair, white hair, grey hair, short hair, bob cut, blue jacket, blue eyes, loafers, white knee socks, logo, watermark, signature, text artifacts, extra fingers, deformed hands, blurry, low quality, dark gloomy lighting, heavy shadows, chibi, 3d render, photorealistic
```

### 3.5 保持一致的小技巧

1. **先出 hero**，挑一张最满意的，把它当成「角色参考图」（image reference / character reference / IP-Adapter，叫法看工具），后面每张都带上它。
2. 胸像系列可以先出 idle，再以 idle 为底图做局部重绘（只改表情和手），机位就天然一致。
3. 固定种子、固定画幅比例，提示词只改「动作」那一段。

---

## 4. 台词（界面气泡用，已写进代码，可随意改）

| 状态 | 台词 |
| --- | --- |
| idle | 已接线，随时待命。 |
| listening | 有成员在监听，任务一来就送到。 |
| working | 正在协作中…（N 位成员工作中） |
| approval | 这一单，等你拍板。 |
| error | 线路出错了，看看排障提示？ |
| done | 完成，交付已归档。 |
| sleep | 大家都不在线…我先眯一会儿。 |
