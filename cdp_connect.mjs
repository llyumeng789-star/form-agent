/**
 * CDP 连接的唯一入口 —— 强制自愈，调用方不可能忘记。
 *
 * 背景（实测踩过的坑）：
 *   常驻 Chrome 会进入「端口有响应，但 page target 数为 0」的假活状态
 *   （窗口被关掉、崩溃后自动重启等都可能触发）。这时直接 connectOverCDP
 *   会抛 "Browser context management is not supported" 并连不上，
 *   连兜底的 newPage() 都来不及执行。
 *
 * 曾经把这个预检写成每个脚本内部的一个函数，结果新脚本里定义了却没调用，
 * 照样崩。所以收敛成唯一入口：所有脚本只能 import 这里的 connect()，
 * 自愈在连接内部完成，调用方无感知、也无法跳过。
 *
 * 用法：
 *   import { connect } from './cdp_connect.mjs';
 *   const { browser, ctx, page } = await connect({ host: 'job.citicbank.com' });
 */
import pkg from '/Users/liyumeng/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pkg;

const CDP = 'http://127.0.0.1:9222';
const log = (...a) => console.log('[cdp]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function listTargets() {
  try {
    const r = await fetch(`${CDP}/json/list`);
    return await r.json();
  } catch { return []; }
}

/** 确保至少一个 page target 存在；不存在就补建。 */
async function ensureTarget() {
  let targets = await listTargets();
  if (targets.some(t => t.type === 'page')) return targets;

  log('no page target -> creating one');
  // 新版 Chrome 的 /json/new 要求 PUT，旧版接受 GET。两种都试，避免版本差异。
  for (const method of ['PUT', 'GET']) {
    try {
      const r = await fetch(`${CDP}/json/new?about:blank`, { method });
      if (r.ok) break;
    } catch { /* 换下一种方法 */ }
  }
  await sleep(1000);
  targets = await listTargets();
  if (!targets.some(t => t.type === 'page')) {
    throw new Error('CDP daemon has no page target and could not create one');
  }
  return targets;
}

/**
 * 连接常驻浏览器。
 * @param {object}  opts
 * @param {string} [opts.host]       优先复用访问该域名的页面（保持登录态/向导进度）
 * @param {boolean} [opts.newTab]    强制新开标签页
 * @param {string} [opts.cdp]        CDP 地址，默认 9222
 * @returns {Promise<{browser, ctx, page}>}
 */
export async function connect(opts = {}) {
  const { host = '', newTab = false, cdp = CDP } = opts;
  await ensureTarget();

  const browser = await chromium.connectOverCDP(cdp);
  const ctx = browser.contexts()[0];

  let page = null;
  if (!newTab && host) {
    // 优先选 SPA 主路径（#/MyResume 等）；site 会留下 /build/0 中间跳转页，URL 含 host 但无内容
    page = ctx.pages().find(p => p.url().includes(host) && p.url().includes('/index.html#/')) || null;
    if (!page) page = ctx.pages().find(p => p.url().includes(host)) || null;
  }
  if (!page) page = ctx.pages()[0] || null;
  if (!page || newTab) page = await ctx.newPage();

  return { browser, ctx, page };
}

/** 关闭连接。注意：不断开守护进程，浏览器继续存活。 */
export async function disconnect(browser) {
  try { await browser.close(); } catch { /* 已断开 */ }
}

export { CDP };
