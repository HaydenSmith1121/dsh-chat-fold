/*
 * dsh-chat-fold —— 客户端半（浏览器 bundle）
 *
 * ★ 这是一个 **classic script**，不是 ES module：不能出现 import / export / 顶层
 *   await。宿主用 <script async src=...> 加载它（没有 type="module"），写了
 *   export 就是 SyntaxError，页面会报 “loaded without registering”。
 *
 * ★ load({ id }) 里的 id **必须**等于包名 dsh-chat-fold：它同时是启动图的行 id
 *   （cordis.patch.yml 里的 name）与 ClientModuleRegistry 的注册键。
 *
 * ◆ 为什么需要这个插件
 *   Chat 本身已经有「回合过程折叠」，且 Compact 就是默认值。但那是一条 React
 *   投影，恰好在本会话最长的情况下被关掉：
 *
 *     processWindowReady = compactTranscript
 *                       && answerAnchorSeq !== null
 *                       && turnClosed          // ← 回合必须已经结束
 *                       && !historyIncomplete  // ← 历史必须已经全部加载
 *
 *   于是只要回合还在跑，或会话里还挂着「加载更早」（分页未读完），就 **一行都不
 *   折叠**：一个较长的回合会把几十条思考与工具行铺在正文里，读者再也找不到之前
 *   的内容。
 *
 * ◆ 它做什么
 *   在既有投影之外补一层，不改写、不替换官方节点：
 *     1. 每条思考行 / 工具行都能点自己的标题行单独收起、展开；
 *     2. 已经结束的回合自动收起过程行，只留最终答复；最新那一轮保持展开；
 *     3. 每一轮上方给一个「折叠本轮 / 展开本轮」的整体开关。
 *   只会隐藏自己标记过的行，并按行记录读者选择，所以官方投影接管或刷新页面后
 *   都不会留下不一致的正文。
 */
window.__ModuleLoader__.load({
	id: "dsh-chat-fold",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		/** 标记：这一行由本插件管理。 */
		var OWNED = "data-chatfold-owned";
		/** 标记：这一行当前被收起。 */
		var FOLDED = "data-chatfold-folded";
		/** 标记：这是某一轮的过程行。 */
		var ROW = "data-chatfold-row";
		/** 标记：行内的单行开关。 */
		var TOGGLE = "data-chatfold-toggle";
		/** 标记：轮级开关容器。 */
		var TURNBAR = "data-chatfold-turnbar";

		/** 正文行的稳定选择器（官方契约）。 */
		var FLOW_SELECTOR = ".EvIC1a_flowItem[data-chat-flow-kind]";

		/**
		 * 属于「过程」、可以折的行类型。
		 * assistant-step 既承载思考也承载中间叙述，所以只折「不是本轮最终答复」
		 * 的那些（见 answerKey）。
		 */
		var FOLDABLE_KINDS = {
			"tool-call": 1,
			command: 1,
			context: 1,
			"assistant-step": 1,
			retry: 1,
		};

		/** 永远不折的行类型：答复、报错、提问、轮尾。 */
		var NEVER_FOLD = {
			"turn-tail": 1,
			"turn-error": 1,
			"turn-max-tokens": 1,
			"turn-navigation": 1,
			user: 1,
			steering: 1,
		};

		/**
		 * 本插件的样式。颜色一律走产品自己的 alias token，
		 * 因此亮色 / 暗色主题都不需要第二套规则。
		 */
		function stylesheet() {
			return [
				"[data-chatfold-toggle]{",
				"display:inline-flex;align-items:center;gap:6px;",
				"font:inherit;color:var(--dsw-alias-label-caption,#8a8f98);",
				"background:none;border:0;padding:2px 6px;margin:0 0 2px 0;",
				"cursor:pointer;border-radius:6px;line-height:inherit;text-align:start;",
				"}",
				"[data-chatfold-toggle]:hover{",
				"background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.12));",
				"color:var(--dsw-alias-label-secondary,#5f636b);",
				"}",
				"[data-chatfold-toggle]:focus-visible{",
				"outline:2px solid var(--dsw-static-deepseek-500,#4d6bfe);outline-offset:1px;",
				"}",
				"[data-chatfold-toggle]>[data-chatfold-chevron]{",
				"flex:none;transition:transform .15s ease;",
				"}",
				'[data-chatfold-toggle][aria-expanded="true"]>[data-chatfold-chevron]{',
				"transform:rotate(90deg);",
				"}",
				"@media (prefers-reduced-motion:reduce){",
				"[data-chatfold-toggle]>[data-chatfold-chevron]{transition:none}",
				"}",
				"[data-chatfold-row][hidden]{display:none !important}",
				"[data-chatfold-turnbar]{",
				"display:flex;align-items:center;gap:8px;padding:2px 0;",
				"color:var(--dsw-alias-label-caption,#8a8f98);",
				"font-size:var(--dsh-content-font-size-secondary,13px);",
				"line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));",
				"}",
				"[data-chatfold-turnbar]>button{",
				"display:inline-flex;align-items:center;gap:6px;",
				"font:inherit;color:inherit;background:none;border:0;",
				"padding:2px 6px;margin:0;cursor:pointer;border-radius:6px;",
				"}",
				"[data-chatfold-turnbar]>button:hover{",
				"background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.12));",
				"color:var(--dsw-alias-label-secondary,#5f636b);",
				"}",
				"[data-chatfold-turnbar]>button:focus-visible{",
				"outline:2px solid var(--dsw-static-deepseek-500,#4d6bfe);outline-offset:1px;",
				"}",
			].join("");
		}

		/**
		 * 取某一轮的全部正文行，按文档顺序。
		 * @param turn - 轮次号（字符串）。
		 * @returns 该轮的行数组。
		 */
		function rowsOfTurn(turn) {
			return Array.prototype.slice.call(
				document.querySelectorAll(FLOW_SELECTOR + '[data-chat-turn="' + turn + '"]'),
			);
		}

		/**
		 * 当前已渲染的全部轮次，按文档顺序去重。
		 * @returns 轮次号数组（字符串）。
		 */
		function renderedTurns() {
			var seen = [];
			var set = {};
			var rows = document.querySelectorAll(FLOW_SELECTOR);
			for (var i = 0; i < rows.length; i += 1) {
				var turn = rows[i].getAttribute("data-chat-turn");
				if (turn === null || set[turn] === 1) continue;
				set[turn] = 1;
				seen.push(turn);
			}
			return seen;
		}

		/**
		 * 本轮最终答复的 anchor key：最后一条有可见文字的 assistant-step。
		 * 它代表的正是「答案」，必须始终可见。
		 * @param turn - 轮次号。
		 * @returns anchor key，或 null（本轮还没有答复）。
		 */
		function answerKeyOf(turn) {
			var rows = rowsOfTurn(turn);
			for (var i = rows.length - 1; i >= 0; i -= 1) {
				if (rows[i].getAttribute("data-chat-flow-kind") !== "assistant-step") continue;
				if ((rows[i].textContent || "").replace(/\s+/g, "") !== "") {
					return rows[i].getAttribute("data-chat-anchor-key");
				}
			}
			return null;
		}

		/**
		 * 这一轮是否已经结束。结束的回合会渲染出轮尾 / 导航 / 报错行，正在跑的没有。
		 * 这个判据只看读者可见的事实，所以在历史还没分页读完时同样成立。
		 * @param turn - 轮次号。
		 * @returns 是否已结束。
		 */
		function turnEnded(turn) {
			var rows = rowsOfTurn(turn);
			for (var i = 0; i < rows.length; i += 1) {
				var kind = rows[i].getAttribute("data-chat-flow-kind");
				if (kind === "turn-tail" || kind === "turn-navigation" || kind === "turn-error") {
					return true;
				}
			}
			return false;
		}

		/**
		 * 判断一行是否可折，并给出标题文字。
		 * @param row - 一条正文行。
		 * @param answerKey - 本轮最终答复的 anchor key。
		 * @returns 标题文字；不可折时为 null。
		 */
		function labelFor(row, answerKey) {
			var kind = row.getAttribute("data-chat-flow-kind");
			if (kind === null || NEVER_FOLD[kind] === 1) return null;
			if (FOLDABLE_KINDS[kind] !== 1) return null;
			if (kind === "assistant-step" && row.getAttribute("data-chat-anchor-key") === answerKey) {
				return null;
			}
			if (kind === "tool-call") {
				var tool = row.querySelector("[data-tool]");
				var name = tool === null ? null : tool.getAttribute("data-tool");
				return name === null || name === "" ? "工具调用 · Tool call" : "工具调用 · " + name;
			}
			if (kind === "command") return "指令 · Command";
			if (kind === "context") return "上下文注入 · Context";
			if (kind === "retry") return "重试 · Retry";
			if (kind === "assistant-step") return "思考 · Thinking";
			return null;
		}

		/**
		 * 收起 / 展开一行，并同步行内开关的 aria 状态。
		 * @param row - 正文行。
		 * @param folded - 是否收起。
		 */
		function setFolded(row, folded) {
			if (folded) row.setAttribute("hidden", "");
			else row.removeAttribute("hidden");
			row.setAttribute(FOLDED, folded ? "1" : "0");
			var button = row.querySelector("[" + TOGGLE + "]");
			if (button !== null) button.setAttribute("aria-expanded", folded ? "false" : "true");
		}

		/**
		 * 给一行装上单行开关。开关插在该行最前面，只控制这一行，不改动官方节点结构。
		 * @param row - 正文行。
		 * @param label - 标题文字。
		 * @returns 创建出来的按钮。
		 */
		function attachToggle(row, label) {
			var button = document.createElement("button");
			button.type = "button";
			button.setAttribute(TOGGLE, "1");
			button.setAttribute("aria-expanded", "true");
			button.title = label;

			var chevron = document.createElement("span");
			chevron.setAttribute("data-chatfold-chevron", "");
			chevron.setAttribute("aria-hidden", "true");
			chevron.textContent = "\u25B6";
			chevron.style.fontSize = "9px";
			chevron.style.lineHeight = "1";

			var text = document.createElement("span");
			text.textContent = label;

			button.appendChild(chevron);
			button.appendChild(text);
			row.insertBefore(button, row.firstChild);
			return button;
		}

		/**
		 * 建轮级开关。
		 * @param isFolded - 询问当前是否处于「已折叠」状态。
		 * @param onToggle - 收到目标折叠状态。
		 * @returns 容器元素。
		 */
		function buildTurnBar(isFolded, onToggle) {
			var bar = document.createElement("div");
			bar.setAttribute(TURNBAR, "");
			var button = document.createElement("button");
			button.type = "button";
			bar.appendChild(button);
			/**
			 * 按「当前实际状态」重画：标签描述的是**点击后会做的事**，
			 * 所以已折叠时显示「展开」，展开时显示「折叠」。
			 */
			function paint() {
				var folded = isFolded();
				button.textContent = folded
					? "展开本轮过程 · Show process"
					: "折叠本轮过程 · Hide process";
				button.setAttribute("aria-expanded", folded ? "false" : "true");
			}
			bar.chatfoldPaint = paint;
			button.addEventListener("click", function (event) {
				event.preventDefault();
				onToggle(!isFolded());
				paint();
			});
			paint();
			return bar;
		}

		/**
		 * 把插件施加到当前已渲染的正文上。
		 * @param state - 插件状态（读者选择 / 已装开关的轮）。
		 */
		function decorate(state) {
			var turns = renderedTurns();
			if (turns.length === 0) return;

			// 最后那个尚未结束的轮保持展开，正在写的答复才读得下去。
			var openTurn = null;
			for (var i = turns.length - 1; i >= 0; i -= 1) {
				if (!turnEnded(turns[i])) {
					openTurn = turns[i];
					break;
				}
			}

			for (var t = 0; t < turns.length; t += 1) {
				var turn = turns[t];
				var answerKey = answerKeyOf(turn);
				var rows = rowsOfTurn(turn);
				var foldable = 0;
				var ended = turnEnded(turn);
				// 轮级开关的默认：已结束且不是最新一轮 → 收起。
				var defaultFolded = ended && turn !== openTurn;
				var turnChoice = state.turnChoice[turn];

				for (var r = 0; r < rows.length; r += 1) {
					var row = rows[r];
					var label = labelFor(row, answerKey);
					if (label === null) {
						// 不是过程行：绝不动它。
						if (row.hasAttribute(OWNED)) row.removeAttribute(OWNED);
						continue;
					}
					row.setAttribute(OWNED, "1");
					row.setAttribute(ROW, "1");
					foldable += 1;

					if (row.querySelector("[" + TOGGLE + "]") === null) {
						(function (target) {
							var button = attachToggle(target, label);
							button.addEventListener("click", function (event) {
								event.preventDefault();
								event.stopPropagation();
								var next = !target.hasAttribute("hidden");
								setFolded(target, next);
								// 只有读者亲手点的那一行才记成显式选择。
								state.manual[target.getAttribute("data-chat-anchor-key") || ""] = next;
								reSyncBars(state);
							});
						})(row);
					}

					var key = row.getAttribute("data-chat-anchor-key") || "";
					if (state.manual[key] !== undefined) {
						// 读者的逐行选择优先级最高。
						setFolded(row, state.manual[key]);
					} else if (turnChoice !== undefined) {
						// 其次是读者的轮级选择。
						setFolded(row, turnChoice);
					} else {
						setFolded(row, defaultFolded);
					}
				}

				if (foldable > 0 && rows.length > 0 && state.bars[turn] === undefined) {
					(function (ownerTurn, anchorRow) {
						var bar = buildTurnBar(
							function () {
								return anyOwnedFolded(ownerTurn);
							},
							function (folded) {
								// 轮级开关是一次显式选择：清掉这一轮里逐行的旧选择，
								// 否则「展开本轮」会被先前的逐行收起状态盖回去。
								var list = rowsOfTurn(ownerTurn);
								for (var k = 0; k < list.length; k += 1) {
									var k2 = list[k].getAttribute("data-chat-anchor-key") || "";
									if (state.manual[k2] !== undefined) delete state.manual[k2];
									if (list[k].hasAttribute(OWNED)) setFolded(list[k], folded);
								}
								state.turnChoice[ownerTurn] = folded;
								reSyncBars(state);
							},
						);
						if (anchorRow.parentElement !== null) {
							anchorRow.parentElement.insertBefore(bar, anchorRow);
						}
						state.bars[ownerTurn] = bar;
					})(turn, rows[0]);
				}
			}
		}

		/**
		 * 这一轮是否还有任意一行处于收起状态。
		 * @param turn - 轮次号。
		 * @returns 是否已（部分）收起。
		 */
		function anyOwnedFolded(turn) {
			var rows = rowsOfTurn(turn);
			for (var i = 0; i < rows.length; i += 1) {
				if (rows[i].hasAttribute(OWNED) && rows[i].hasAttribute("hidden")) return true;
			}
			return false;
		}

		/**
		 * 按各轮的实际折叠状态重画轮级开关的文案。
		 * @param state - 插件状态。
		 */
		function reSyncBars(state) {
			for (var turn in state.bars) {
				if (!Object.prototype.hasOwnProperty.call(state.bars, turn)) continue;
				var bar = state.bars[turn];
				if (bar && typeof bar.chatfoldPaint === "function") bar.chatfoldPaint();
			}
		}

		/**
		 * 客户端插件入口。
		 * @param ctx - 客户端 Cordis 上下文。
		 */
		function apply(ctx) {
			var style = document.createElement("style");
			style.setAttribute("data-plugin", "dsh-chat-fold");
			style.setAttribute("data-plugin-css", "dsh-chat-fold");
			style.textContent = stylesheet();
			document.head.appendChild(style);

			var state = {
				/** 读者对某一行的显式选择，按 anchor key 记。 */
				manual: {},
				/** 读者对整轮的显式选择，按轮次号记。 */
				turnChoice: {},
				/** 已经装过轮级开关的轮：轮次号 → 开关元素。 */
				bars: {},
			};

			var scheduled = false;
			function run() {
				scheduled = false;
				decorate(state);
			}
			function schedule() {
				if (scheduled) return;
				scheduled = true;
				requestAnimationFrame(run);
			}

			// 流式输出期间正文一直在变，所以用 MutationObserver 跟上。
			var observer = new MutationObserver(schedule);
			observer.observe(document.body, { childList: true, subtree: true });
			schedule();

			ctx.effect(function () {
				return function () {
					observer.disconnect();
					style.remove();
					var owned = document.querySelectorAll("[" + OWNED + "]");
					for (var i = 0; i < owned.length; i += 1) {
						owned[i].removeAttribute(OWNED);
						owned[i].removeAttribute(ROW);
						owned[i].removeAttribute(FOLDED);
						owned[i].removeAttribute("hidden");
						var button = owned[i].querySelector("[" + TOGGLE + "]");
						if (button !== null) button.remove();
					}
					var bars = document.querySelectorAll("[" + TURNBAR + "]");
					for (var b = 0; b < bars.length; b += 1) bars[b].remove();
					state.bars = {};
				};
			});
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	},
});
