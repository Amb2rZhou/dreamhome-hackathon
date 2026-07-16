# 原型视觉/IP 升级:D 治愈风定稿 + 包公球全程陪伴

日期:2026-07-16
范围:`web/prototype/` 全部页面
目标:视觉/IP 升级——定稿 D「生活方式治愈版」视觉方向,把包公球从单点出场升级为全程陪伴的小管家(只有动效,不说话),并把「刷一刷」从占位页重做为完整的圈选投喂闭环。

## 背景与决策记录

- 视觉方向:四个变体(A 柔光 / B 手作图纸 / C 夜间扫描 / D 治愈)中定稿 **D**。现有 `dreamhome-d-system.css` 已是 sage 绿主色,与 D 一致,改造成本最低。
- 包公球角色:**全程陪伴的小管家**,每个页面都有,状态随场景变化。
- 互动深度:**只有动效不说话**——不出气泡台词;唯一的文字出口是完工通知胶囊(产品要求:"好了之后会告诉我 N 件 3D 资产已打造好")。
- 明星交互(用户原始描述):刷视频时包公球悬挂在边上;圈选家具移动给它的过程中它有动效反应;用户继续往下刷,它有"在打造"的动效;好了之后通知"两件 3D 资产已经打造好"。

## 1. 共享组件:`pages/shared/mascot.js` + `pages/shared/mascot.css`

悬浮包公球 widget,ES module,各页面一行引入(与现有 `five-tabbar.css`、`asset-library-data.js` 的 shared 模式一致)。

### API

```js
const mascot = createMascot(hostElement, { dock: 'right' });
mascot.setState('idle');            // initial | idle | thinking | working | happy | sleeping
mascot.queue(2);                    // 队列徽标数字,0 时隐藏
mascot.notify({ title, onTap });    // 顶部滑入通知胶囊,点按回调(用于跳转)
mascot.dock('right');               // right | bottom-right
```

### 表现(纯 CSS 动画,零外部依赖)

- 常驻:呼吸浮动(translateY 循环,约 3s)。
- 状态切换:弹跳 + 交叉淡入过渡。
- working:小锤子伪元素敲击 + 本体微晃。
- happy:一次性弹跳转圈,随后回落到调用方指定的下一状态。
- sleeping:飘"Zzz"伪元素;页面无操作约 30s 后由 idle 自动切入,任意交互唤醒回 idle。
- 通知胶囊:顶部滑入,含 happy 小头像 + 标题文字,点按触发 onTap,可自动消失。
- 六张状态图 JS 预加载,防止切换闪烁。
- `prefers-reduced-motion`:停用浮动/敲击等循环动画,仅保留状态图切换。

### 素材

- 把 `web/assets/mascot/` 的六态 PNG(各约 160–240KB)复制到 `web/prototype/assets/mascot/states/`,组件内统一相对路径引用。
- 修复现存问题:原型当前引用的 `prototype/assets/mascot/mascot-idle.png` 是 3MB 大图,全部改为六态套图中的版本,3MB 大图删除(git 历史可恢复)。

## 2. 刷一刷(`pages/discover/`):明星页完整重做

### Mock 视频流

- 竖向全屏卡片 + CSS scroll-snap 贴屏滑动,3–4 条"视频"。
- 布景用渐变 + `web/assets/gallery/` 的 6 张家具实拍图(sofa / armchair / cabinet / chair / lamp / plant)作为可圈选目标。
- 每条卡片:左下博主名 + 文案,右侧点赞/评论/分享动作栏,还原刷视频观感。
- 包公球停靠右侧中部,初始 idle。

### 圈选投喂

1. 点右侧「圈选」按钮进入选取模式:画面变暗定格(模拟暂停帧)。
2. 拖动画出虚线圆角框,圈住某件家具(gallery 图对应的热区)。
3. 松手:家具缩略图沿弧线飞向包公球(CSS keyframes)。
4. 包公球 happy 一闪(接住反应),随即切 working 低头开工。

### 后台打造(mock 异步)

- 每件投喂的资产挂一个 8–15s 的 mock 定时器,模拟后端 `queued → processing → ready`。
- working 状态 + 徽标显示队列数;用户继续滑动浏览互不打断;再圈一件徽标 +1。
- 全部完成:happy 举起成果 → `notify({ title: 'N 件 3D 资产已打造好 ✨' })` → 点按跳转灵感库。
- 接真后端时,仅需把定时器替换为对 `/api` 任务状态的轮询,交互层不变。

## 3. 数据闭环(localStorage)

- 新 key:`dreamhome.crafted-assets.v1`(命名跟随现有 `dreamhome.asset-library.v1`)。
- 完工资产结构:`{ id, kind: 'furniture', name, category, source: 'discover', createdAt, isNew: true }`,字段与 `asset-library-data.js` 的 asset 结构对齐。
- 灵感库读取并合并进组件目录,渲染「NEW」角标;用户查看后 isNew 置 false。
- 效果:刷一刷圈选的家具,真实出现在灵感库里,demo 全程闭环。

## 4. 其他页面轻改

| 页面 | 改动 |
|---|---|
| 灵感库 `inspiration-library/` | 右下角 idle 包公球(不遮 tabbar);收藏空态改 sleeping + 现有文案风格的引导;合并显示 crafted 资产 + NEW 角标 |
| 我的家 `my-home/` | 保留现有 generation-orbit 装修动画;选户型阶段加 thinking;`ready` 时 happy 一闪;编辑器阶段角落 idle |
| 画一笔 `draw/`、拍一张 `capture/` | 从 6 行占位页升级为有场景感的页面:D 风 hero 区、包公球(draw 用 thinking,capture 用 idle)、步骤说明卡、CTA 按钮;交互仍为 mock |
| main-interface | 统一 D 风配色与 tabbar,停靠 idle 包公球 |

## 5. 约束

- 页面间与资源全部相对路径,兼容 GitHub Pages 的 `/dreamhome-hackathon/` 前缀;不使用 `/pages/...` 根路径。
- 零外部依赖(无 CDN、无 npm 包),动画纯 CSS,脚本为原生 ES module(需经 HTTP 服务器预览)。
- 不改动 `web/` 主应用(PWA)与 `mobile/`;本轮只动 `web/prototype/`。
- 不提交密钥或内部地址到前端代码。

## 6. 验证

- 本地 `python3 -m http.server 5178 --directory web` 全页面走查:六个页面 × 包公球状态、刷一刷完整投喂闭环、灵感库 NEW 资产出现。
- 375px 视口(iPhone SE 宽度)检查布局与包公球不遮挡关键操作。
- 浏览器 Console / Network 无报错、无 404。
- `prefers-reduced-motion` 模拟开启后循环动画停用。

## 非目标(本轮不做)

- 真实后端接入(保留 mock 定时器与轮询替换点)。
- 画一笔的真实画布、拍一张的真实相机调用。
- 语音、气泡台词、可点击互动台词(已明确"只有动效不说话")。
- `web/` 主应用与 `mobile/` 的视觉同步(后续单独一轮)。
