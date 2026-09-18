# scripts/ — 在浏览器控制台里跑的验证脚本

这三个脚本是本次开发**实际用来判定「插件到底有没有生效」**的那几个，不是事后补的。
它们都只读 DOM、返回一行 JSON，因此在 DevTools 控制台里直接粘贴即可，
或通过 Playwright / agent-browser 的 `eval` 执行。

> 前提：页面已经打开一个**有内容的会话**。判定都基于正文行的稳定标记
> （`.EvIC1a_flowItem[data-chat-flow-kind][data-chat-turn]`），没有这个契约的页面
> 会得到 0，那就说明当前页面没渲染正文，而不是插件坏了。

## `verify-fold.js` — 插件有没有生效

最常用的一条。返回插件是否加载、接管了多少行、收起了多少行、以及**正文高度**。

```
{
  "pluginLoaded": true,
  "totalRows": 94,
  "ownedRows": 91,
  "foldedRows": 91,
  "turnBars": 1,
  "toggles": 91,
  "scrollHeight": 263,
  "visibleRows": 2
}
```

判据：

| 字段 | 期望 | 含义 |
|---|---|---|
| `pluginLoaded` | `true` | 页面上存在单行开关或轮级开关 |
| `ownedRows` | > 0 | 插件接管的过程行数量 |
| `foldedRows` | ≈ `ownedRows` | 已结束回合应全部收起 |
| `scrollHeight` | 明显变小 | 对比没装插件时的基线 |

## `test-interact.js` — 交互是不是真的对

它按顺序做四件事并逐步打印正文高度，用来抓「点了没反应」这类问题：

1. 记录初始折叠数与高度；
2. 点**第一条自己**的开关 → 只应展开那一行；
3. 点「展开本轮过程」→ 应变成 `0/N` 且高度涨回去；
4. 再点一次 → 应回到 `N/N`。

```
["folded=91/91", "scrollH=263",
 "afterClickFirst: hidden=false aria=true", "scrollH_afterOne=304",
 "afterBarExpand: folded=0/91", "scrollH_expanded=7208",
 "afterBarCollapse: folded=91/91", "scrollH_recollapsed=263"]
```

★ 第 3 步是关键回归点：早期版本因为把「自动折叠的结果」也写进了读者选择表，
**「展开本轮」点不动**（始终 91/91）。这一条就是当时用来复现它的。

## `check-markers.js` — 卸载干不干净

数一下插件在 DOM 上留下的痕迹，用来验证「停用后零残余」：

```
{"owned":91,"bars":1,"toggles":91,"hiddenByUs":88,"styles":1}
```

把插件从 `dsh.profile.bundles` 移除、重启后重跑，**五个数都应该是 0**。
只要有一个不是 0，就说明清理函数漏了东西。
