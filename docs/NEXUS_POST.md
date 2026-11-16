# Case Workshop — 一个不用装东西的机箱 mod 编辑器

写给 Nexus 的 PCBS2 版块。正文英文在上（Nexus 主语言），中文在下，可直接复制。

---

## 一、Nexus 帖子正文（English）

**Title:** `Case Workshop — edit case mods in your browser, see the shop card before you launch`

**Category:** Miscellaneous / Utilities
**Requires the game:** No (it is a browser page, not a mod)
**Virus scan:** N/A — nothing executes, it is HTML + JS in a folder

---

### What this is

A little offline web page that edits PCBS2 **case** mods. You open it, drop your
`.xml` on it, change numbers, and the shop card redraws next to your edits. Save
gives you the same file back.

It exists because almost every case mod is a copied vanilla prefab, and the
prefab brings its **physics** with it: GPU clearance, radiator sizes, drive bays,
motherboard support. Those numbers still describe the case you copied from. The
shop will happily sell yours while its spec sheet describes somebody else's case.

### What it is not

- Not a mod. Nothing gets installed into the game.
- Not a `.exe`. No DLLs, no loaders, no dependencies. It is a folder with an
  `index.html` in it.
- Not a general part editor. Cases only — the groups, dropdowns and checks are
  tuned for the 77 case fields. Other part types will load and show their fields,
  but `Part Type` will complain about them.

### Three things it does that matter

**1. The card is real, and it is instant.**

Editing a case normally costs you a full game launch per iteration: edit XML →
start game → load career → open shop → look → quit. Here the thumbnail is decoded
from the game's own `_MINI` sprite, so it is the same picture the shop will draw,
redrawn on every keystroke.

The resolution rule is worth knowing on its own: the card comes from the **last
segment of `Asset Path`**, looked up as `<segment>_MINI` in
`resources.assets`. `Icon Path` is **not** consulted. Get that wrong and you ship
a blank white rectangle — which is exactly what the tool shows you, before you
launch anything.

**2. It tells you which fields you forgot.**

Every field is diffed against the vanilla case your prefab came from. Content
changes are separated from identity changes (`ID`, `Part Name`, `Asset Path`),
because those are supposed to differ and counting them inflates the number into
uselessness.

Measured across 22 published case mods: **573 field-level differences**, of which
**503 are content** — real "you probably meant to change this" rows. Each row has
a one-click revert to the vanilla value.

**3. It catches a column that mod files silently drop.**

`Max PCI Size` exists in all 382 vanilla cases (381 of them hold `3`). **20 of
the 22 published case mods omit it entirely.** The game falls back to a default,
so nothing visibly breaks — which is exactly why nobody noticed.

### Does it damage my files?

No, and this was the part I was most careful about. Opening a file and saving it
without edits must not change a single byte. That is harder than it sounds:

- Retail files use **CRLF**, so line endings are captured from the input
- Some files carry a **UTF-8 BOM**, which is preserved
- Some cells contain **trailing spaces** (`"S-ATX, "`), so untouched cells are
  written back from their original text rather than re-encoded

All 22 published case mods round-trip **byte-identically**. There is a regression
test for each of the three traps above.

### Install / use

**Try it first — no download:** https://sefui12.github.io/pcbs2-case-workshop/web/index.html

1. Download, unzip anywhere (no admin, no folder requirement).
2. Open `web/index.html`. That is it.
3. Drop your `.xml` files on the page, or point it at your whole `mods` folder.
4. Edit. `Ctrl+S` saves the current file; "Save all" writes every dirty file.

If your browser refuses `file://` for some reason, `启动工坊.bat` serves the same
thing on `127.0.0.1:8770`.

### Privacy

There is no network code in it. Not "we don't collect data" — there is nothing to
collect with. Grep `web/js/` for `fetch`, `XMLHttpRequest` or `http` and you will
find none. Your files are read with the File API and never leave the tab.

### Limits (so you don't discover them yourself)

- **No 3D preview.** The mesh lives in `catalog.bin` and external `CAB-*`
  bundles; nothing here touches them. You get the icon, not the model.
- **No new prefabs.** You still copy a vanilla `Asset Path`. A genuinely new case
  shape needs new geometry, which is a different project.
- **The vanilla table is a snapshot** of one game build. If a patch adds cases,
  the tool won't know about them until the data is regenerated (documented in the
  repo; it takes three Python scripts against your own install).

### Source

Code and data are on GitHub under MIT:
**https://github.com/SEFUI12/pcbs2-case-workshop**

If you would rather build the icon library from your own install instead of
trusting my extracted copy, the repo documents exactly how. The tool behaves
identically either way.

Bug reports and "this case field makes no sense" are both welcome — the second
kind is usually how the checks get better.

---

## 二、中文版（发在中文社区 / 贴吧 / B站专栏时用）

**标题：** `Case Workshop —— 不用装任何东西的机箱 mod 编辑器`

### 这是什么

一个离线的网页，用来改 PCBS2 的**机箱** mod。打开它，把 `.xml` 拖进去，改数值，右边的商店卡片会跟着重画。保存就是把同一个文件还给你。

做它的原因很具体：几乎每个机箱 mod 都是复制一个原版 prefab 改出来的，而 prefab 会把它的一整套**物理参数**一起带过来——显卡限长、冷排尺寸、硬盘位、主板支持。这些数字描述的其实还是你复制的那台机箱。游戏会照卖不误，但你的参数表写的是别人的机箱。

### 它不是什么

- 不是 mod，不往游戏里装任何东西。
- 不是 `.exe`。没有 DLL、没有加载器、没有依赖，就是一个装着 `index.html` 的文件夹。
- 不是通用部件编辑器。只针对机箱——分组、下拉框和检查项都是按机箱的 77 个字段调的。别的部件能载入、能看字段，但 `Part Type` 会报错（这是限制，不是结论）。

### 三个真正有用的地方

**1. 卡片是真的，而且是即时的。**

平时改一个机箱，一轮的成本是：改 XML → 开游戏 → 读档 → 开商店 → 看 → 退出。这里缩略图是从游戏自己的 `_MINI` sprite 解出来的，和商店要画的是同一张图，每次按键都重画。

顺便说一个值得单独记的规则：卡片取的是 **`Asset Path` 的最后一段**，去 `resources.assets` 里找 `<那一段>_MINI`。**`Icon Path` 完全不参与**。搞错了就是一张纯白空卡——而它会在你启动游戏之前就先把白卡给你看。

**2. 它告诉你哪些字段你漏改了。**

每个字段都和你的 prefab 来源的那台原版机箱做对比。内容改动和身份字段（`ID`、`Part Name`、`Asset Path`）分开算，因为身份字段本来就该不一样，混进去只会把数字撑大、变得没意义。

在 22 个已发布机箱 mod 上实测：**573 处字段级差异**，其中 **503 处是内容差异**——也就是真正"你可能忘了改"的那些。每一行都有一个按钮，一键改回原版值。

**3. 它能揪出一个被 mod 文件悄悄丢掉的列。**

`Max PCI Size` 在全部 382 个原版机箱里都有（381 个填的是 `3`）。**22 个已发布机箱 mod 里有 20 个整列缺失。** 游戏会读默认值，所以表面上看不出任何问题——这正是为什么一直没人发现。

### 会不会弄坏我的文件

不会，这部分我最小心。打开一个文件、不做任何修改、直接保存，必须一个字节都不变。这事比听起来难：

- 零售文件用 **CRLF**，所以行尾是从输入里读出来保留的
- 有些文件带 **UTF-8 BOM**，保留
- 有些单元格里有**尾随空格**（`"S-ATX, "`），所以没动过的单元格按原始文本写回，不重新编码

22 个已发布机箱 mod 全部**字节级一致**往返。上面三个坑各有一条回归测试盯着。

### 怎么用

**先在线试，不用下载：** https://sefui12.github.io/pcbs2-case-workshop/web/index.html

1. 下载，解压到任意位置（不需要管理员权限，不需要特定目录）。
2. 打开 `web/index.html`。就这一步。
3. 把 `.xml` 拖到页面上，或者直接选整个 `mods` 文件夹。
4. 改。`Ctrl+S` 存当前文件，"Save all" 存所有改过的文件。

如果你的浏览器因为某些原因不让用 `file://`，双击 `启动工坊.bat`，它会在 `127.0.0.1:8770` 上起同样的东西。

### 隐私

里面没有任何联网代码。不是"我们不收集数据"，而是根本没有能收集数据的东西。在 `web/js/` 里搜 `fetch`、`XMLHttpRequest`、`http`，一个都找不到。文件用 File API 读，不出标签页。

### 已知限制（省得你自己撞）

- **没有 3D 预览。** 模型在 `catalog.bin` 和外部 `CAB-*` 包里，这里完全不碰。你看到的是图标，不是模型。
- **不能造新 prefab。** 还是要复制一个原版 `Asset Path`。真正全新的机箱外形需要新的几何体，那是另一个项目。
- **原版数据是某个版本的快照。** 如果游戏更新加了新机箱，工具不会知道，直到你按仓库里的说明重新生成（三个 Python 脚本，跑在你自己装的游戏上）。

### 源码

MIT，在 GitHub 上：
**https://github.com/SEFUI12/pcbs2-case-workshop**

如果你更想用自己游戏里的资源重建图标库、而不是信任我提取的那份，仓库里写清了怎么做。两条路工具的表现完全一样。

bug 报告和"这个机箱字段根本讲不通"都欢迎——第二种通常才是检查项变好的原因。

---

## 三、发帖时的操作清单

| 步骤 | 具体做什么 |
|---|---|
| 1 | 先发 GitHub Release 里的 `v1.0.1`（已完成），确认链接能打开 |
| 2 | Nexus 帖子分类选 **Miscellaneous → Utilities**，勾 "this is not a mod" |
| 3 | 上传 2 张图：`docs/screenshots/editor.png`（主图）、`docs/screenshots/landing.png` |
| 4 | 正文用上面的英文版，中文版可以放到回复里或你的中文社区 |
| 5 | 结尾加一句 "Feedback welcome — especially if a case field behaves in a way this tool gets wrong" |
| 6 | 发完之后，在你已有的 22 个 case mod 页面描述里各加一行工具链接（**这一步的转化率最高**） |

第 6 步比前五步加起来都值钱：正在下载你机箱 mod 的人，正是最可能想自己做一个的那批人。

---

## 四、诚实的预期

- Nexus 上的 PCBS2 工具帖，历史区间是**几十到一两百次浏览**，十个左右的实际下载。
- 不会有任何"爆"的可能——这个游戏的 mod 板块总共只有 102 个 mod。
- 真正的收益不是下载量，是**你会收到几条实质反馈**，而在这个规模的社区里，能被一个懂的人指出错误已经很值。