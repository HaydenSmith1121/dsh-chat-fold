/*
 * dsh-chat-fold —— 宿主半。
 *
 * 折叠是纯浏览器行为（改的是已经渲染出来的正文行），所以宿主半不需要 wire 代码，
 * 也不注册任何远端服务。它只做一件事：作为一个正常的 Loader 行存在，
 * 让 cordis.patch.yml 有一行可定位、可禁用、可 reload 的挂载点。
 *
 * 之所以仍然要一个宿主半：客户端的 bundle 是靠启动图的那一行（name = 包名）
 * 才被 ClientModuleRegistry 找到并加载的。没有这一行，lib/client.js 永远不会被注入。
 */

/**
 * 宿主插件入口。
 *
 * @param ctx - 宿主 Cordis 上下文。
 */
export function apply(ctx) {
  // 这一行不发布任何服务、不监听任何事件，因此没有需要回收的副作用。
  // 启动图的存在本身就是它的职责；留一条 debug 级别的可观测记录，
  // 便于在隔离环境里确认这一行确实被装配上了。
  const logger = ctx.get('logger')
  if (logger !== undefined && typeof logger.debug === 'function') {
    logger.debug('dsh-chat-fold: client folding row mounted')
  }
}
