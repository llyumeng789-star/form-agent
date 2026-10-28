// 京东方（campus.boe.com，北森 Beisen phoenix UI）填表库
import { connect, disconnect } from './cdp_connect.mjs';
export { connect, disconnect };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 找 label 精确匹配的 widget（返回含 input 的容器），供 evaluate 使用 */
export function locators() {
  window.__boeFind = (label, nth = 0) => {
    const labels = [...document.querySelectorAll('label, [class*="label"], [class*="Label"]')]
      .filter(l => {
        const t = (l.textContent || '').replace(/\*/g, '').trim();
        if (t !== label) return false;
        const r = l.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    // 每个 label 向上找最近的、包含 input 的容器，去重
    const seen = new Set(), hits = [];
    for (const l of labels) {
      let el = l;
      for (let i = 0; i < 6 && el; i++) {
        el = el.parentElement;
        if (!el) break;
        const inp = el.querySelector('input:not([type=hidden]), textarea');
        if (inp && !seen.has(inp)) { seen.add(inp); hits.push({ inp, el }); break; }
      }
    }
    return hits[nth] || null;
  };
}
export async function setup(page) { await page.evaluate(locators); }

export async function fillText(page, label, value, nth = 0) {
  const r = await page.evaluate(({ label, nth, value }) => {
    const h = window.__boeFind(label, nth);
    if (!h) return { err: 'not found' };
    const inp = h.inp;
    inp.scrollIntoView({ block: 'center' });
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const setTa = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    inp.focus();
    (inp.tagName === 'TEXTAREA' ? setTa : set).call(inp, value);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, v: inp.value };
  }, { label, nth, value });
  if (r.err) throw new Error(`${label}: ${r.err}`);
  return r;
}

/** 真鼠标点击（React 组件必须真事件；down/up 间隔 120ms，部分组件快速点击不识别） */
export async function mouseClick(page, handle) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('no box');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await sleep(120);
  await page.mouse.up();
}

/** 面板内查找可选项（两套类名都兼容） */
export async function findPanelItem(page, text) {
  const handle = await page.evaluateHandle((txt) => {
    const sels = ['.phoenix-selectList__listItem', 'div.list-item-container'];
    let items = [];
    for (const sel of sels) {
      items = items.concat([...document.querySelectorAll(sel)].filter(d => d.checkVisibility?.() && d.getBoundingClientRect().height > 5));
    }
    return items.reverse().find(d => {
      const lb = d.querySelector('.phoenix-selectList__singleLabel, .item-text-label, [class*="item-text"], [class*="singleLabel"]');
      return lb ? lb.textContent.trim() === txt : d.textContent.trim() === txt;
    }) || null;
  }, text);
  return await handle.asElement();
}

async function panelVisible(page) {
  return page.evaluate(() => {
    const sels = ['.phoenix-selectList__listItem', 'div.list-item-container'];
    for (const sel of sels) {
      if ([...document.querySelectorAll(sel)].some(d => d.checkVisibility?.() && d.getBoundingClientRect().height > 5)) return true;
    }
    return false;
  });
}

/** 打开下拉并真鼠标点选（数组 = 级联多列） */
export async function pick(page, label, texts, nth = 0) {
  const arr = Array.isArray(texts) ? texts : [texts];
  const elH = await page.evaluateHandle(({ label, nth }) => { const h = window.__boeFind(label, nth); if (!h) return null; h.inp.scrollIntoView({ block: 'center' }); return h.el; }, { label, nth });
  const elE = await elH.asElement();
  if (!elE) throw new Error(`${label}: 控件未找到`);
  await sleep(300);
  // 真点容器；不行再合成点 input / 容器
  for (let a = 0; a < 4; a++) {
    if (a === 0) { try { await mouseClick(page, elE); } catch {} }
    else if (a === 1) { await page.evaluate(({ label, nth }) => window.__boeFind(label, nth).inp.click(), { label, nth }); }
    else if (a === 2) { try { await mouseClick(page, elE); } catch {} }
    else { await page.evaluate(({ label, nth }) => window.__boeFind(label, nth).el.click(), { label, nth }); }
    for (let i = 0; i < 4; i++) {
      await sleep(400);
      if (await panelVisible(page)) { a = 9; break; }
    }
    if (await panelVisible(page)) break;
  }
  if (!(await panelVisible(page))) throw new Error(`${label}: 面板未弹出`);
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i];
    let el = await findPanelItem(page, t);
    if (!el) throw new Error(`${label}: 选项「${t}」未找到（第${i + 1}列）`);
    await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
    await sleep(350);
    el = await findPanelItem(page, t);
    if (!el) throw new Error(`${label}: 滚动后丢失「${t}」`);
    await mouseClick(page, el);
    await sleep(700);
    if (i === arr.length - 1) {
      const v = await page.evaluate(({ label, nth }) => window.__boeFind(label, nth)?.inp.value ?? '', { label, nth });
      if (!v) {
        // 「constant 选择器」类面板：选中后需点右下角「确定」才落值
        const okBtn = await page.evaluateHandle(() => {
          const btns = [...document.querySelectorAll('.selector-footer-button .phoenix-button__content, [class*="selector-footer"] *')]
            .filter(e => (e.textContent || '').trim() === '确定' && e.checkVisibility?.());
          return btns[btns.length - 1] || null;
        });
        const okEl = await okBtn.asElement();
        if (okEl) { await mouseClick(page, okEl); await sleep(800); }
        // 仍无值 → 点文字兜底
        const v2 = await page.evaluate(({ label, nth }) => window.__boeFind(label, nth)?.inp.value ?? '', { label, nth });
        if (!v2) {
          const span = await page.evaluateHandle((txt) => {
            const sels = ['.phoenix-selectList__listItem', 'div.list-item-container'];
            let items = [];
            for (const sel of sels) items = items.concat([...document.querySelectorAll(sel)].filter(d => d.checkVisibility?.()));
            const it = items.reverse().find(d => (d.textContent || '').trim() === txt);
            return it || null;
          }, t);
          const s = await span.asElement();
          if (s) { await mouseClick(page, s); await sleep(700); }
        }
      }
    }
  }
  return await page.evaluate(({ label, nth }) => {
    const h = window.__boeFind(label, nth);
    return h ? { v: h.inp.value, tag: h.inp.tagName } : null;
  }, { label, nth });
}

/** 日期字段：面板是「搜索 + 日期列表」。点开 → 面板搜索框键入 → 点匹配项 */
export async function pickDate(page, label, value, nth = 0) {
  const opened = await page.evaluate(({ label, nth }) => {
    const h = window.__boeFind(label, nth);
    if (!h) return { err: 'not found' };
    h.inp.scrollIntoView({ block: 'center' });
    h.inp.click();
    return { ok: true };
  }, { label, nth });
  if (opened.err) throw new Error(`${label}: ${opened.err}`);
  let up = false;
  for (let i = 0; i < 10; i++) {
    await sleep(400);
    up = await page.evaluate(() => [...document.querySelectorAll('div.list-item-container')].some(d => d.checkVisibility?.()));
    if (up) break;
  }
  if (!up) throw new Error(`${label}: 面板未弹出`);
  // 面板搜索框
  const sh = await page.evaluateHandle(() => {
    const s = [...document.querySelectorAll('.phoenix-search input, [class*="search"] input')].filter(i => i.checkVisibility?.());
    return s[s.length - 1] || null;
  });
  const sEl = await sh.asElement();
  if (!sEl) throw new Error(`${label}: 面板搜索框未找到`);
  await mouseClick(page, sEl);
  await sleep(300);
  await sEl.type(value, { delay: 40 });
  await sleep(900);
  let el = await findPanelItem(page, value);
  if (!el) {
    // 日期项可能带时间后缀，做前缀匹配
    el = await page.evaluateHandle((v) => {
      const items = [...document.querySelectorAll('div.list-item-container')].filter(d => d.checkVisibility?.());
      return items.reverse().find(d => (d.querySelector('.item-text-label, [class*="item-text"]')?.textContent.trim() || '').startsWith(v)) || null;
    }, value).then(h => h.asElement()).then(e => e);
  }
  if (!el) throw new Error(`${label}: 日期项「${value}」未找到`);
  await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await sleep(350);
  const el2 = await (async () => {
    const h = await page.evaluateHandle((v) => {
      const items = [...document.querySelectorAll('div.list-item-container')].filter(d => d.checkVisibility?.());
      return items.reverse().find(d => (d.querySelector('.item-text-label, [class*="item-text"]')?.textContent.trim() || '').startsWith(v)) || null;
    }, value);
    return h.asElement();
  })();
  if (!el2) throw new Error(`${label}: 滚动后丢失日期项`);
  await mouseClick(page, el2);
  await sleep(700);
  return await page.evaluate(({ label, nth }) => window.__boeFind(label, nth)?.inp.value ?? '', { label, nth });
}

/** 单选（男/女 等）：点文本节点 */
export async function pickRadio(page, label, text) {
  await page.evaluate(({ label }) => {
    const h = window.__boeFind(label, 0);
    if (h) h.el.scrollIntoView({ block: 'center' });
  }, { label });
  await sleep(300);
  const handle = await page.evaluateHandle(({ label, text }) => {
    const h = window.__boeFind(label, 0);
    const root = h ? h.el.parentElement.closest('div') || h.el : null;
    const scope = root || document;
    const nodes = [...scope.querySelectorAll('label, span, div, [class*="radio"]')];
    return nodes.reverse().find(n => (n.textContent || '').trim() === text && n.getBoundingClientRect().width > 0) || null;
  }, { label, text });
  const el = await handle.asElement();
  if (!el) throw new Error(`${label}: 单选项「${text}」未找到`);
  await mouseClick(page, el);
  await sleep(300);
  return true;
}

/** 日期：先试直接键入 */
export async function fillDate(page, label, value, nth = 0) {
  await fillText(page, label, value, nth);
  await page.keyboard.press('Enter');
  await sleep(500);
  const v = await page.evaluate(({ label, nth }) => {
    const h = window.__boeFind(label, nth);
    return h ? h.inp.value : null;
  }, { label, nth });
  if (v !== value) {
    // 键入失败 → 走日历面板（由调用方用 pickDate 处理）
    return { typed: false, v };
  }
  return { typed: true, v };
}

/** 上传文件：file input setInputFiles */
export async function upload(page, label, filePath, nth = 0) {
  const h = await page.evaluateHandle(({ label, nth }) => {
    const w = window.__boeFind(label, nth);
    const el = w ? w.el : null;
    return el ? el.querySelector('input[type=file]') : null;
  }, { label, nth });
  const input = await h.asElement();
  if (!input) throw new Error(`${label}: 找不到 file input`);
  await input.setInputFiles(filePath);
  await sleep(2500);
  return true;
}

/** 点「添加XX」按钮（id 以 _addButton 结尾的容器） */
export async function clickAdd(page, text) {
  const handle = await page.evaluateHandle((t) => {
    const btns = [...document.querySelectorAll('div[id$="_addButton"], div[id*="_addButton"]')]
      .filter(d => (d.textContent || '').includes(t) && d.getBoundingClientRect().width > 0);
    return btns[btns.length - 1] || null;
  }, text);
  const el = await handle.asElement();
  if (!el) throw new Error(`按钮「${text}」未找到`);
  await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await mouseClick(page, el);
  await sleep(1200);
  // 校验：记录数变化由调用方检查
}

/** 点「至今」复选框（在某 label 所在的块内） */
export async function checkZhijin(page, sectionLabel) {
  const handle = await page.evaluateHandle((lab) => {
    const labels = [...document.querySelectorAll('label, [class*="label"]')]
      .filter(l => (l.textContent || '').replace(/\*/g, '').trim() === lab && l.getBoundingClientRect().width > 0);
    // 取最后一个（最新添加的记录块）
    const l = labels[labels.length - 1];
    if (!l) return null;
    let el = l;
    for (let i = 0; i < 8 && el; i++) { el = el.parentElement; if (!el) break; const c = el.querySelector('input[type=checkbox]'); if (c) return c; }
    return null;
  }, sectionLabel);
  const el = await handle.asElement();
  if (!el) return false;
  await mouseClick(page, el);
  await sleep(300);
  return true;
}

/** 日历式日期选择：点 widget 容器开日历 → 年面板 → 月 → 日 */
export async function pickCalDate(page, label, dateStr, nth = 0) {
  const [y, m, d] = dateStr.split('-').map(s => parseInt(s, 10));
  // 开日历：真鼠标点容器；不行再合成 click；轮询等日历出现
  const elH = await page.evaluateHandle(({ label, nth }) => { const h = window.__boeFind(label, nth); h.el.scrollIntoView({ block: 'center' }); return h.el; }, { label, nth });
  const elE = await elH.asElement();
  if (!elE) throw new Error(`${label}: 容器未找到`);
  await sleep(300);
  // 点击可能因面板已开而变成「关闭」，所以试 3 次：点→轮询→再点
  for (let a = 0; a < 3; a++) {
    try { await mouseClick(page, elE); } catch {}
    for (let i = 0; i < 5; i++) {
      await sleep(400);
      const ok = await page.evaluate(() => !![...document.querySelectorAll('.phoenix-date-picker')].filter(e => e.checkVisibility?.() && e.getBoundingClientRect().height > 100).length);
      if (ok) { a = 9; break; }
    }
  }
  const calOk = await page.evaluate(() => !![...document.querySelectorAll('.phoenix-date-picker')].filter(e => e.checkVisibility?.() && e.getBoundingClientRect().height > 100).length);
  if (!calOk && true) {
    await page.evaluate(({ label, nth }) => { const h = window.__boeFind(label, nth); h.el.click(); }, { label, nth });
    for (let i = 0; i < 5; i++) {
      await sleep(400);
      if (await page.evaluate(() => !![...document.querySelectorAll('.phoenix-date-picker')].filter(e => e.checkVisibility?.() && e.getBoundingClientRect().height > 100).length)) break;
    }
  }
  const calOk2 = await page.evaluate(() => !![...document.querySelectorAll('.phoenix-date-picker')].filter(e => e.checkVisibility?.() && e.getBoundingClientRect().height > 100).length);
  if (!calOk2) throw new Error(`${label}: 日历未弹出`);
  await sleep(300);
  // 头部年月文本
  const ym = await page.evaluateHandle(() => {
    const cal = [...document.querySelectorAll('.phoenix-date-picker')].filter(e => e.checkVisibility?.())[0];
    if (!cal) return null;
    const els = [...cal.querySelectorAll('[class*="header"] span, [class*="header"] div, [class*="header"] a')]
      .filter(e => /^\d{4}年\d{1,2}月$/.test((e.textContent || '').trim()) && e.getBoundingClientRect().height > 5);
    return els[0] || null;
  });
  const ymEl = await ym.asElement();
  if (!ymEl) throw new Error(`${label}: 日历未打开`);
  await mouseClick(page, ymEl);
  await sleep(1000);
  // 点年（若目标年不在当前十年视图，用上/下十年按钮翻）
  let y2 = null;
  for (let i = 0; i < 12 && !y2; i++) {
    const h = await page.evaluateHandle((yy) => {
      const cal = [...document.querySelectorAll('.phoenix-date-picker')].filter(e => e.checkVisibility?.())[0];
      if (!cal) return null;
      const cells = [...cal.querySelectorAll('.phoenix-calendar-year-panel-year')]
        .filter(e => e.getBoundingClientRect().height > 5 && (e.textContent || '').trim() === String(yy));
      return cells[0] || null;
    }, y);
    y2 = await h.asElement();
    if (y2) break;
    const nav = await page.evaluateHandle((yy) => {
      const cal = [...document.querySelectorAll('.phoenix-date-picker')].filter(e => e.checkVisibility?.())[0];
      if (!cal) return null;
      const prev = cal.querySelector('.phoenix-calendar-year-panel-prev-decade-btn');
      const next = cal.querySelector('.phoenix-calendar-year-panel-next-decade-btn');
      const decade = (cal.querySelector('.phoenix-calendar-year-panel-decade-select-con')?.textContent || '').match(/(\d{4})-(\d{4})/);
      if (!decade) return null;
      const lo = +decade[1], hi = +decade[2];
      if (yy < lo && prev) return prev;
      if (yy > hi && next) return next;
      return null;
    }, y);
    const navEl = await nav.asElement();
    if (!navEl) break;
    await mouseClick(page, navEl);
    await sleep(800);
  }
  if (!y2) throw new Error(`${label}: 年份 ${y} 未找到`);
  await mouseClick(page, y2);
  await sleep(1000);
  // 点月份下拉（.phoenix-calendar-month-select，如「4月」）
  const mSel = await page.evaluateHandle(() => {
    const cal = [...document.querySelectorAll('.phoenix-date-picker')].filter(e => e.checkVisibility?.() && e.getBoundingClientRect().height > 100)[0];
    return cal ? cal.querySelector('.phoenix-calendar-month-select') : null;
  });
  const mS = await mSel.asElement();
  if (!mS) throw new Error(`${label}: 月份下拉未找到`);
  await mouseClick(page, mS);
  await sleep(1000);
  // 月面板里点目标月
  const m2 = await page.evaluateHandle((mm) => {
    const cells = [...document.querySelectorAll('[class*="month-panel-month"], .phoenix-calendar-month-select-dropdown *, td[class*="month"]')]
      .filter(e => e.getBoundingClientRect().height > 5 && (e.textContent || '').trim().replace(/月$/, '') === String(mm) && e.children.length === 0);
    return cells[0] || null;
  }, m);
  const mE = await m2.asElement();
  if (!mE) throw new Error(`${label}: 月份 ${m} 未找到`);
  await mouseClick(page, mE);
  await sleep(1000);
  // 点日：当前月网格里第一个文本匹配的 .phoenix-calendar-date（年月精度面板无日网格，直接返回当前值）
  const dEl = await page.evaluateHandle((dd) => {
    const cells = [...document.querySelectorAll('div.phoenix-calendar-date, .phoenix-calendar-date')]
      .filter(e => e.checkVisibility?.() && (e.textContent || '').trim() === String(dd) && e.getBoundingClientRect().height > 10);
    return cells[0] || null;
  }, d);
  const d2 = await dEl.asElement();
  if (d2) {
    await mouseClick(page, d2);
    await sleep(900);
  }
  return await page.evaluate(({ label, nth }) => window.__boeFind(label, nth)?.inp.value ?? '', { label, nth });
}
