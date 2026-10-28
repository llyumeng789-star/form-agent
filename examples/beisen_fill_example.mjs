// 示例：北森（Beisen phoenix UI）网申表单自动填写
// 个人信息全部来自本地 JSON（不入 git），脚本中不含任何真实数据。
import { connect, disconnect, sleep, setup, fillText, pick, pickCalDate, areaSelect, pickRadio, upload, mouseClick } from '../boekit.mjs';
import { readFileSync } from 'node:fs';

// 本地配置文件示例见 examples/profile.example.json
const profile = JSON.parse(readFileSync(new URL('./profile.example.json', import.meta.url), 'utf8'));

const { browser, page } = await connect({ host: 'campus.example.com' });
await page.goto(process.env.FORM_URL, { waitUntil: 'domcontentloaded' });
await sleep(6000);
await setup(page); // 注入 label→widget 定位器 window.__boeFind

const log = (...a) => console.log('[fill]', ...a);

// 1. 文本字段（受控组件：native setter + input/change 事件）
for (const [label, key] of [['姓名', 'name'], ['邮箱', 'email'], ['身高', 'height']]) {
  await fillText(page, label, profile[key]);
  log(label, '✓');
}

// 2. 证件号码等敏感输入：部分组件 blur 时清空程序化赋值，需真键盘逐字输入
{
  const h = await page.evaluateHandle(() => window.__boeFind('证件号码', 0).inp);
  const inp = await h.asElement();
  await mouseClick(page, inp);
  await inp.type(profile.idNumber, { delay: 25 });
  await page.keyboard.press('Tab');
  log('证件号码 ✓');
}

// 3. 单选
await pickRadio(page, '性别', profile.gender);
await pickRadio(page, '海外院校毕业', '是');

// 4. 普通下拉（React 受控面板，需真鼠标事件）
for (const [label, value] of [['民族', profile.ethnicity], ['政治面貌', '共青团员'], ['在读学历', '硕士研究生']]) {
  const r = await pick(page, label, value);
  log(label, '->', r && r.v);
}

// 5. 日历日期（年面板十年翻页 -> 月 -> 日；年月精度面板自动兜底）
await pickCalDate(page, '出生日期', profile.birthDate);

// 6. 级联地区选择（点名称=下钻，点图标=选中，最后点「确定」）
await areaSelect(page, '籍贯', ['河北省', '保定市', '定州市']);
await areaSelect(page, '生源地', ['北京市']);

// 7. 文件上传
await upload(page, '证件照', profile.photoPath);
await upload(page, '简历附件', profile.resumePath);

// 8. 全量回读校验 + 截图 —— 然后停下，由人工复核后手动提交
const state = await page.evaluate(() => {
  const out = {};
  for (const lab of ['姓名', '证件号码', '民族', '籍贯', '生源地']) out[lab] = window.__boeFind(lab, 0)?.inp.value;
  return out;
});
console.log(JSON.stringify(state, null, 1));
await page.screenshot({ path: './filled.png' });

// ⚠️ 永远不要在脚本里点击「提交」。人工确认后手动操作。
await disconnect(browser);
