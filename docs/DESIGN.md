# 设计说明 · dsh-chat-fold

这份文档记录**为什么这样做**，以及验证过的边界。结论都来自在隔离环境里对真实会话的实测，
不是从类型声明推断的。

---

## 一、先确认官方已经有什么

在动手写之前，第一步是读官方 Chat 的实现，确认「折叠」这件事是否已经存在 —— 避免重复造轮子。

结论：**已经存在**，而且默认开启。

`@deepseek-ai/dsh-client-ui-chat` 里：

```js
const DEFAULT_TRANSCRIPT_VIEW_MODE = "compact";   // ← 默认就是 compact
```

`Compact` 的行为写在它的 README 里：回合结束时把过程行收起，只留最终答复。

所以第一版怀疑是「用户的设置不对」。`~/.dsh/settings.yaml` 里没有 `ui-chat` 段，
说明用的正是默认值 `compact`。**设置没问题。**

## 二、真正的根因

继续读 `ChatNodeSeat`，找到折叠的生效条件：

```js
const processWindowReady = processSpec !== void 0
  && processPresentation !== void 0
  && compactTranscript
  && processSpec.answerAnchorSeq !== null
  && processPresentation.turn === processSpec.turn
  && processPresentation.turnClosed      // ← 回合必须已结束
  && !historyIncomplete;                 // ← 历史必须已全部加载

const processMember = ... && processWindowReady && ...;
const foldable = processWindowReady && (...);
const processHidden = controllerInactive || foldable && processMember && !processOpen;
```

关键在 `processWindowReady` 的两个条件。它们意味着：

| 情况 | 结果 |
|---|---|
| 回合还在跑（`turnClosed === false`） | 一行不折 |
| 会话还有「加载更早」（`historyIncomplete === true`） | 一行不折 |

也就是说，**正文最长的时候，折叠恰好是关着的**。

### 在隔离环境里实测确认

把一份真实的生产会话复制进隔离环境，打开后发现：

```
总行数 94：tool-call 47 / assistant-step 39 / context 4 / command 2 / turn-process 1 / turn-tail 1

turn-process 控制器：key = "12:turn-process2"  hidden = true   ← 控制器被隐藏
页面存在「加载更早」                        ← historyIncomplete === true
正文高度：4616 px
```

`hidden: true` 的控制器就是证据：`foldable` 为假，官方折叠完全没有生效。
这就是用户看到的那面「墙」。

## 三、于是怎么做

官方折叠是 React 投影，无法在不替换官方节点的前提下「补条件」。所以选择在 **DOM 层**
补一层纯增量能力，只依赖正文行的稳定标记：

```
.EvIC1a_flowItem[data-chat-flow-kind][data-chat-turn]
  └─ [data-chat-anchor-key]        ← 行的稳定身份
  └─ [data-tool]                   ← 工具名（tool-call 行）
```

规则：

1. **可折的行**：`tool-call` / `command` / `context` / `retry`，以及**不是最终答复**的 `assistant-step`。
2. **永不折的行**：`turn-tail` / `turn-error` / `turn-max-tokens` / `turn-navigation` / `user` / `steering`。
3. **最终答复**怎么认定：本轮**最后一条有可见文字**的 `assistant-step`。它必须始终可见 ——
   否则「折叠」会把答案本身藏起来。
4. **哪一轮保持展开**：最后一个**尚未结束**的轮。判据是这一轮里有没有 `turn-tail` /
   `turn-navigation` / `turn-error` 行 —— 这是读者可见的事实，与官方的 `turnClosed` 无关，
   所以历史没读完时同样成立。

优先级：**逐行选择 > 轮级选择 > 默认规则**。

## 四、踩到的坑（都已修）

### 坑 1：自动折叠的状态污染了读者选择

第一版把「自动折叠的结果」和「读者的点击」记在同一个 `manual` 表里。后果是：
一旦自动折过，`manual` 里就全是 `true`，**「展开本轮」再也点不动** ——
它被逐行的旧选择盖回去了。

实测证据（修复前）：

```
afterBarExpand: folded=91/91     ← 点了展开，一行没动
```

修法：拆成两张表。`manual`（逐行，读者点的）与 `turnChoice`（整轮，读者点的）。
自动折叠**不写**任何一张，只在两张都没有时作为默认值生效。
轮级开关点击时清掉该轮的逐行旧选择。

修复后：

```
folded=91/91, scrollH=263
afterBarExpand:    folded=0/91,  scrollH=7208
afterBarCollapse:  folded=91/91, scrollH=263
```

### 坑 2：轮级开关文案反了

`buildTurnBar` 里自己维护了一个 `folded` 变量，但它和正文的实际状态是两条独立的状态线，
于是出现「已经展开了却显示『展开本轮过程』」。修法：不再自己存状态，
改成传入 `isFolded()` 回调，**按正文的真实状态**重画，并在逐行点击后重新同步所有轮级开关。

### 坑 3：客户端 bundle 必须是 classic script

第一版按 ESM 写了 `export function apply`。但客户端 bundle 是宿主用
`<script async src=...>` 加载的（**没有** `type="module"`），写 `export` 直接是
SyntaxError，页面会报 “loaded without registering”。

必须写成：

```js
window.__ModuleLoader__.load({
  id: "dsh-chat-fold",            // 必须逐字等于包名 = 启动图行 id
  factory: (require) => {
    var module = { exports: {} };
    // ... 全部实现 ...
    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
```

## 五、验证过什么

| 验证项 | 方法 | 结果 |
|---|---|---|
| 插件确实加载 | 数 `[data-chatfold-owned]` | 91 行 |
| 折叠生效 | 对比 `scrollHeight` | 4616 px → **263 px** |
| 单行开关独立 | 点某一行自己的开关 | 只展开那一行（263 → 304） |
| 整轮展开 | 点「展开本轮过程」 | 0/91 折叠，7208 px |
| 整轮收起 | 再点一次 | 91/91 折叠，263 px |
| 文案正确 | 读按钮文字 | 收起时「展开本轮」，展开时「折叠本轮」 |
| 最终答复保持可见 | 检查最后一条有内容的 assistant 行 | `hidden=false, owned=false` ✓ |
| **卸载可逆** | 移除 bundle 后重开页面 | `owned:0 bars:0 toggles:0 styles:0` —— **零残余** |

「卸载可逆」是最重要的一条：插件的清理函数会移除自己插入的按钮、样式与全部标记属性，
用完即净，正文回到原样。

## 六、隔离怎么做的

开发与测试全程在**独立主目录**里，不碰日常环境：

| | 生产 | 隔离 |
|---|---|---|
| `DSH_HOME` | `~/.dsh` | `~/.dsh-dev` |
| 端口 | 3080 | 3090 |
| 插件树 | 9 个业务插件 | 只有本插件（+ base/web-app） |

隔离靠 `DSH_HOME` 环境变量（bootstrap-only），不是在同一个主目录里换 profile 名。
测试用的会话是从生产**复制**进隔离环境的只读副本，生产侧的会话日志与插件树全程未被写入。

## 七、已知边界

- **依赖官方类名**。正文行的标记（`EvIC1a_flowItem`、`data-chat-flow-kind`、`data-chat-turn`、
  `data-chat-anchor-key`）是当前版本的实现细节。上游若改名，插件会**静默不生效** ——
  它不会报错，也不会误伤正文（因为选择器匹配不到就什么都不做）。
- **不做持久化**。折叠状态随页面存活，刷新后回到默认。这与官方投影的语义一致：
  逐行展开本身也不落盘。
- **自动折叠不写读者选择**，所以新来的内容不会继承旧的选择，行为可预期。
