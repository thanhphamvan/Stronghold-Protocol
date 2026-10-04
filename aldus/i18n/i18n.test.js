// The i18n layer of the Aldus build (aldus/i18n): the catalogs, the translator, the choice of the locale, and how much of
// the original client's text each catalog covers: the interface text of its source, and the text of the game data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranslator, negotiate, tidy, segments, plain, isStyled, place, CJK } from './translator.js';
import { extractFragments, coverage, gameCoverage } from './extract.mjs';
import { gameText, NOT_DRAWN } from './gametext.mjs';
import { remark, balanced, overlay } from './official.mjs';
import { buildCatalogs, operatorNames, gameTextCatalog, bountyVariant, plainQuotes, BOUNTY_BATTLES } from '../build.mjs';
import { parseRichText, richTextPlain, formatBondEffect } from '../../public/js/ui/richText.js';
import { bountyText, MULTI_ROUND_BOUNTY_BATTLES } from '../../server/match/choices.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const catalogs = fs.readdirSync(path.join(HERE, 'locales')).filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(HERE, 'locales', f), 'utf8'))]);
/** The files of game text: locales/<locale>/<name>.json. */
const textFiles = catalogs.flatMap(([, cat]) => {
  const dir = path.join(HERE, 'locales', cat.locale);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => [`${cat.locale}/${f}`, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]) : [];
});
const PLACEHOLDERS = /\{\d{1,2}(?::[^{}]{1,12})?\}/g;
const placeholders = (s) => (s.match(PLACEHOLDERS) || []).map((x) => x.replace(/:.*\}$/, '}')).sort().join(' ');
/** The shape of a rich text: P for a plain piece, S for a styled piece, B for a line break. */
const shape = (s) => segments(s).map((seg) => (seg.br ? 'B' : isStyled(seg) ? 'S' : 'P')).join('');

test('every catalog is well formed: a locale, source strings as keys, translations without source text', () => {
  assert.ok(catalogs.length >= 1);
  for (const [file, cat] of catalogs) {
    assert.equal(`${cat.locale}.json`, file);
    assert.ok(cat.name, `${file}: a name for the language switch`);
    for (const [k, v] of Object.entries(cat.messages)) {
      assert.ok(CJK.test(k), `${file}: the key "${k}" is source text`);
      assert.equal(typeof v, 'string', `${file}: "${k}"`);
      assert.ok(!CJK.test(v), `${file}: the translation of "${k}" still has source text`);
    }
    for (const [re, to] of cat.patterns) {
      assert.doesNotThrow(() => new RegExp(re), `${file}: ${re}`);
      assert.ok(re.startsWith('^') && re.endsWith('$'), `${file}: ${re} matches a whole string`);
      assert.ok(!CJK.test(to), `${file}: the replacement of ${re}`);
    }
  }
});

test('translate: a whole string, a pattern, a string cut into known parts — or nothing', () => {
  const { translate, missing } = createTranslator({
    messages: { '开始': 'Start', '整备区': 'Bench', '已满': 'is full', '第': '#', '名': '' },
    patterns: [['^第\\s*(\\d+)\\s*回合$', 'Round $1'], ['^(.+)博士中途退出了模拟$', 'Dr. $1 left']],
  });
  assert.equal(translate('开始'), 'Start');
  assert.equal(translate('  开始\n'), '  Start\n', 'white space around the text stays');
  assert.equal(translate('第 3 回合'), 'Round 3');
  assert.equal(translate('开始博士中途退出了模拟'), 'Dr. Start left', 'a known name inside a pattern is translated too');
  assert.equal(translate('小明博士中途退出了模拟'), 'Dr. 小明 left', 'a name a player typed stays');
  assert.equal(translate('整备区已满'), 'Bench is full', 'cut into two known parts');
  assert.equal(translate('整备区，已满。'), 'Bench, is full.', 'punctuation of the source becomes that of the translation');
  assert.equal(translate('名'), '', 'an empty translation is a translation');
  assert.equal(translate('整备区第三'), null, 'one unknown part: nothing changes');
  assert.equal(translate('第'), '#');
  assert.equal(translate('整备区第'), null, 'a one-character message is a word only when it stands alone');
  assert.equal(translate('Start 12'), null, 'no source text: nothing to do');
  assert.deepEqual([...missing], ['整备区第三', '整备区第']);
  assert.equal(tidy('a ，b（c）'), 'a, b (c)');
});

test('segments is parseRichText of the original client, for every string of the game data', () => {
  let strings = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      strings += 1;
      assert.deepEqual(segments(v), parseRichText(v), v.slice(0, 60));
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const f of fs.readdirSync(path.join(ROOT, 'data')).filter((n) => n.endsWith('.json') && n !== 'assets.json')) {
    walk(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')));
  }
  assert.ok(strings > 10000, `${strings} strings`);
  // the same for each translation: the page draws it with the same parser
  for (const [, file] of textFiles) for (const v of Object.values(file.text)) assert.deepEqual(segments(v), parseRichText(v));
  const raw = '攻击力<@ba.vup>+80%</>，<$ba.stun>晕眩</>目标\n<不是标签>';
  assert.equal(plain(raw), richTextPlain(raw));
  assert.equal(plain(raw), '攻击力+80%，晕眩目标\n<不是标签>');
});

test('every file of game text is well formed: source text as keys, translations without it, the markup and the placeholders kept', () => {
  assert.ok(textFiles.length >= 2, 'the official text and the text of the mode');
  for (const [name, file] of textFiles) {
    assert.ok(file.source, `${name}: says where its text comes from`);
    for (const [k, v] of Object.entries(file.text)) {
      assert.ok(CJK.test(k), `${name}: the key ${JSON.stringify(k)} is source text`);
      assert.equal(k, plain(k), `${name}: the key ${JSON.stringify(k)} is the text as the page shows it, with no markup`);
      assert.ok(typeof v === 'string' && v.trim(), `${name}: ${JSON.stringify(k)} has a translation`);
      assert.ok(!CJK.test(v), `${name}: the translation of ${JSON.stringify(k)} still has source text: ${v}`);
      // each tag is closed, and no closer is left over (a stray one would be drawn as text)
      assert.equal((v.match(/<[@$][A-Za-z0-9_.\-]{1,48}>/g) || []).length, (v.match(/<\/>/g) || []).length, `${name}: the tags of ${JSON.stringify(v)}`);
      assert.ok(!plain(v).includes('</>'), `${name}: a closing tag with no opening tag in ${JSON.stringify(v)}`);
      assert.equal(placeholders(v), placeholders(k), `${name}: the placeholders of ${JSON.stringify(k)}`);
    }
  }
});

test('the text of the mode keeps the pieces of the source: the same lines, and the same styled pieces in each line', () => {
  const game = textFiles.find(([name]) => name === 'en/game.json')[1];
  const units = gameText();
  const off = [];
  for (const [k, v] of Object.entries(game.text)) {
    const unit = units.get(k);
    if (!unit) continue;
    const lines = (s) => shape(s).split('B').map((l) => l.replace(/P/g, '').length).join(',');
    if (lines(unit.raw) !== lines(v)) off.push(k);
  }
  // a line whose styled pieces differ is drawn as plain text (translator.js place): correct, but with no highlight
  assert.deepEqual(off, [], `the styled pieces differ from the source in: ${off.slice(0, 5).map((k) => JSON.stringify(k.slice(0, 40))).join(', ')}`);
});

test('rich and translate: the translation with its markup, and as plain text', () => {
  const { translate, rich } = createTranslator({
    messages: { '休整期': 'Rest Phase' },
    text: {
      '攻击力+80%，优先攻击空中单位': 'ATK <@ba.vup>+80%</>, attacks aerial enemies first',
      '【炎】干员攻击力+{0:0%}（受层数影响）': '[Yan] Operators gain ATK <@ba.vup>+{0:0%}</><@ba.acrem> (scales with stacks)</>',
      '{0}博士对敌方领袖造成的伤害超过20%!': '<@ba.vup>Dr. {0}</> dealt more than 20% damage to the Enemy Leader!',
      '炎佑': 'Yan\'s Blessing', '休整期': 'not this one',
      '这是一句很长的句子，它不会被当作词语使用': 'A long sentence that is never a part',
    },
    patterns: [['^获得(.+)$', 'Gained $1']],
  });
  assert.equal(rich('攻击力+80%，优先攻击空中单位'), 'ATK <@ba.vup>+80%</>, attacks aerial enemies first');
  assert.equal(translate('攻击力+80%，优先攻击空中单位'), 'ATK +80%, attacks aerial enemies first', 'plain text has no markup');
  assert.equal(translate('休整期'), 'Rest Phase', 'a message wins over a text of the game data');
  // a template: the drawn value goes to the placeholder of the translation
  assert.equal(rich('【炎】干员攻击力+15%（受层数影响）'), '[Yan] Operators gain ATK <@ba.vup>+15%</><@ba.acrem> (scales with stacks)</>');
  assert.equal(translate('小明博士对敌方领袖造成的伤害超过20%!'), 'Dr. 小明 dealt more than 20% damage to the Enemy Leader!');
  assert.equal(translate('【炎】干员攻击力+15%'), null, 'a template matches the whole text only');
  // a short text of the data is a name: it is found inside a pattern; a sentence of the data is not a part
  assert.equal(translate('获得炎佑'), 'Gained Yan\'s Blessing');
  assert.equal(translate('获得这是一句很长的句子，它不会被当作词语使用'), 'Gained 这是一句很长的句子, 它不会被当作词语使用', 'the sentence stays as it is');
  assert.equal(translate('这是一句很长的句子，它不会被当作词语使用'), 'A long sentence that is never a part');
});

test('one character alone is the badge of a name: the first letter of its translation', () => {
  const { translate } = createTranslator({
    messages: { '卡西米尔': 'Kazimierz', '层': 'stack', '阿戈尔': 'Ægir' },
    text: { '卡缇': 'Cardigan', '卡达': 'Click', '炎佑': 'Yan\'s Blessing', '“解决麻烦”': '\'Problem Solver\'', '这句话很长很长很长很长很长很长很长': 'Zzz' },
  });
  assert.equal(translate('卡'), 'K', 'a message decides: the Alliance, not the two operators');
  assert.equal(translate('阿'), 'Æ');
  assert.equal(translate('炎'), 'Y', 'else the names of the game data');
  assert.equal(translate('层'), 'stack', 'a message for the character itself comes first');
  assert.equal(translate('这'), null, 'a sentence is not a name');
  assert.equal(translate('水'), null, 'no name starts with it');
});

test('official.mjs: the English tables over the Chinese ones, closed tags, and the values of the source styled again', () => {
  // only a string with Chinese text takes the English string at the same path
  assert.deepEqual(overlay({ id: 'x', name: '隐现', n: 3, list: ['陈', 'abc'], deep: { desc: '攻击力' } }, { id: 'y', name: 'Insider', n: 9, list: ["Ch'en", 'zzz'], deep: { desc: 'ATK' } }),
    { id: 'x', name: 'Insider', n: 3, list: ["Ch'en", 'abc'], deep: { desc: 'ATK' } });
  assert.deepEqual(overlay({ name: '隐现', extra: '未翻译' }, { name: '' }), { name: '隐现', extra: '未翻译' }, 'no English: the Chinese stays');
  assert.equal(balanced('ATK <@ba.vup>+20%</>\n<@ba.rem>8 ammo'), 'ATK <@ba.vup>+20%</>\n<@ba.rem>8 ammo</>');
  assert.equal(balanced('ATK +20%</>'), 'ATK +20%');
  // a value of the source gets its tag in the English that has none
  assert.equal(remark('攻击力<@ba.vup>+15%</>', 'ATK +15%'), 'ATK <@ba.vup>+15%</>');
  assert.equal(remark('每秒流失<@ba.vdown>60</>点生命值，攻击力<@ba.vup>+40%</>', 'Loses 60 HP every second, ATK +40%'), 'Loses <@ba.vdown>60</> HP every second, ATK <@ba.vup>+40%</>');
  assert.equal(remark('攻击力<@ba.vup>+15%</>\n<@ba.rem>可充能2次</>', 'ATK +15%\n<@ba.rem>Can store 2 charges</>'), 'ATK <@ba.vup>+15%</>\n<@ba.rem>Can store 2 charges</>');
  // a line that agrees, a styled piece of words, a value that is not there: as the official client has it
  assert.equal(remark('攻击力<@ba.vup>+15%</>', 'ATK <@ba.vup>+15%</>'), 'ATK <@ba.vup>+15%</>');
  assert.equal(remark('攻击间隔<@ba.vup>略微缩短</>', 'Attack Interval shortens slightly'), 'Attack Interval shortens slightly');
  assert.equal(remark('攻击力<@ba.vup>+15%</>', 'ATK increases'), 'ATK increases');
  assert.equal(remark('一行', 'two\nlines'), 'two\nlines');
});

test('a large number of the source (万, 亿) is the same number with K, M or B', () => {
  const { translate } = createTranslator({ messages: {} });
  assert.equal(translate('150万'), '1.5M');
  assert.equal(translate('12.3万'), '123K');
  assert.equal(translate('10万'), '100K');
  assert.equal(translate('1.5亿'), '150M');
  assert.equal(translate('25亿'), '2.5B');
  assert.equal(translate('-3.2万'), '-32K');
  assert.equal(translate('万'), null, 'not a number');
});

test('the sentences that the client puts together around a number are translated', () => {
  const { translate } = createTranslator(buildCatalogs().en);
  for (const text of [
    '目标生命值 28，结算时扣除 2 点', '目标生命值 28，联防中，结算时扣除至多 2 点',
    '目标生命值 28：本回合已有 2 个敌人进入蓝门，结算时扣除 2 点（每回合至多 10 点）',
    '目标生命值 28：本回合已有 10 个以上敌人进入蓝门，结算时扣除 10 点（每回合至多 10 点）',
    '目标生命值 28：联防中，队友正在迎战你漏过的敌人，结算时按联防后剩余的敌人扣除（至多 3 点）',
    '每位博士有 30 秒', '将 4 名干员的技能与模组恢复为默认配置？', ' · 3 阶', '之后还有 2 项', '7 个', '剩余12秒', '第 3 回合',
  ]) {
    const en = translate(text);
    assert.ok(en != null && !CJK.test(en), `${text} → ${en}`);
    for (const n of text.match(/\d+/g) || []) assert.ok(en.includes(n), `${text}: ${n} is in "${en}"`);
  }
});

test('place: each piece of a translation goes to the node of the page with the same place', () => {
  const P = { styled: false };
  const S = { styled: true };
  const B = { br: true };
  // the usual case: the same lines and the same styled pieces
  assert.deepEqual(place([P, S, P, S, P, B, S], 'ATK <@ba.vup>+80%</>, interval <@ba.vup>shorter</>, ranged first\n<@ba.rem>14 ammo</>'),
    ['ATK ', '+80%', ', interval ', 'shorter', ', ranged first', null, '14 ammo']);
  // text where the page has no plain node goes into the styled node beside it
  assert.deepEqual(place([S, P], 'ATK <@ba.vup>+80%</>'), ['ATK +80%', '']);
  assert.deepEqual(place([P, S], '<@ba.vup>+80%</> ATK'), ['', '+80% ATK']);
  assert.deepEqual(place([S], 'ATK <@ba.vup>+80%</> more'), ['ATK +80% more']);
  // the styled pieces do not agree: the line as plain text, in its first plain node
  assert.deepEqual(place([P, S, P], 'one plain sentence'), ['one plain sentence', '', '']);
  assert.deepEqual(place([S, P, S], '<@a.b>x</> and no second one'), ['', 'x and no second one', '']);
  assert.deepEqual(place([P, S, P], '<@a.b>x</> mid <@a.c>y</> end'), ['x mid y end', '', '']);
  // the lines do not agree: everything is one line
  assert.deepEqual(place([P, B, P], 'only one line'), ['only one line', null, '']);
  assert.deepEqual(place([P], 'two\nlines'), ['two lines']);
  // each slot gets a string, and nothing of the translation is lost
  for (const [slots, text] of [[[P, S, P, B, P, S], 'a <@x.y>b</> c\nd <@x.y>e</>'], [[S, S, P], '<@x.y>a</><@x.z>b</> c'], [[P, B, B, P], 'a\n\nb']]) {
    const out = place(slots, text);
    assert.equal(out.length, slots.length);
    assert.equal(out.filter((x) => x != null).join(''), plain(text).replace(/\n/g, ''));
  }
});

test('negotiate: the address, then the saved choice, then the default; the source language means no catalog', () => {
  const base = { available: ['en'], source: 'zh', fallback: 'en' };
  assert.equal(negotiate(base), 'en', 'a first visit shows English');
  assert.equal(negotiate({ ...base, saved: 'zh' }), 'zh');
  assert.equal(negotiate({ ...base, query: 'zh-CN', saved: 'en' }), 'zh', 'the address wins');
  assert.equal(negotiate({ ...base, query: 'en-US' }), 'en');
  assert.equal(negotiate({ ...base, query: 'fr', saved: 'zh' }), 'zh', 'an unknown locale is passed over');
  assert.equal(negotiate({ ...base, query: 'fr' }), 'en');
  assert.equal(negotiate({ available: [], source: 'zh', fallback: 'en' }), 'zh', 'no catalog: the source');
});

test('the English catalog covers the interface text of the original client', () => {
  const fragments = extractFragments();
  assert.ok(fragments.length > 500, `${fragments.length} fragments found`);
  const en = buildCatalogs().en;
  const c = coverage(en, fragments);
  // after a merge from the original project new text may appear: it stays Chinese on the page until it is translated,
  // and `node aldus/i18n/extract.mjs --missing` lists it
  assert.ok(c.translated / c.total >= 0.97, `${c.translated} of ${c.total}; missing: ${c.missing.slice(0, 8).map(([t]) => t).join(' | ')}`);
});

test('the English catalog covers the text of the game data', () => {
  const units = gameText();
  assert.ok(units.size > 3000, `${units.size} text units`);
  const en = buildCatalogs().en;
  const g = gameCoverage(en, units);
  // after an update of the game data new text may appear: `node aldus/i18n/extract.mjs --missing` lists it
  assert.ok(g.translated / g.total >= 0.99, `${g.translated} of ${g.total}; missing: ${g.missing.slice(0, 6).map(([t]) => JSON.stringify(t.slice(0, 30))).join(' | ')}`);
  // a field for a developer is not a unit
  for (const u of units.values()) for (const w of u.where) assert.ok(!NOT_DRAWN.has(w.split(':')[1]), w);
});

test('each entry of the game text is text of the game data: after a data update, no entry is left behind', () => {
  const units = gameText();
  const all = [...units.keys()].join('\n');
  for (const [name, file] of textFiles) {
    // an entry is a unit of the data, or a name that a unit has inside it (“炎佑” in the text of an Alliance)
    const stale = Object.keys(file.text).filter((k) => !units.has(k) && !units.has(k.trim()) && !(k.length <= 16 && all.includes(k)));
    assert.deepEqual(stale, [], `${name}: ${stale.length} entries are not in the game data`);
  }
  // official.json before game.json: the text translated here wins
  const merged = gameTextCatalog('en');
  const game = textFiles.find(([name]) => name === 'en/game.json')[1];
  for (const [k, v] of Object.entries(game.text)) assert.equal(merged[k.trim()], v.trim());
  // the catalog of the page has the quotation marks of the keyboard only (the fonts of the game draw the others wide)
  assert.equal(plainQuotes('“Echoes” and ‘x’'), '"Echoes" and \'x\'');
  const en = buildCatalogs().en;
  for (const v of [...Object.values(en.messages), ...Object.values(en.text), ...en.patterns.map(([, to]) => to)]) assert.doesNotMatch(v, /[\u201c\u201d\u2018\u2019]/);
});

test('a bond effect that the game fills with numbers is translated with the numbers it shows', () => {
  const { rich } = createTranslator(buildCatalogs().en);
  const bonds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bonds.json'), 'utf8'));
  const list = Object.values(bonds.bonds || bonds).filter((b) => b && typeof b === 'object' && b.effectDescRaw);
  assert.ok(list.length >= 20, `${list.length} bonds`);
  for (const b of list) {
    for (const layers of [0, 3]) {
      const drawn = plain(formatBondEffect(b, layers));
      const en = rich(drawn);
      assert.ok(en != null, `${b.name} at ${layers} stacks: ${drawn.slice(0, 40)}`);
      assert.ok(!CJK.test(en) && !/\{\d/.test(en), `${b.name}: ${en}`);
      // each number the game shows is in the translation
      for (const n of drawn.match(/\d+(?:\.\d+)?%/g) || []) assert.ok(plain(en).includes(n), `${b.name}: ${n} is in ${plain(en)}`);
    }
  }
});

test('a multi-round bounty card is translated in the form the server sends', () => {
  assert.equal(BOUNTY_BATTLES, MULTI_ROUND_BOUNTY_BATTLES, 'the battles of such a card, as the server has them');
  const units = gameText();
  const cards = [...units].filter(([, u]) => bountyText(u.raw, { multiRound: true }) !== u.raw);
  assert.ok(cards.length >= 5, `${cards.length} cards`);
  const { rich } = createTranslator(buildCatalogs().en);
  for (const [key, u] of cards) {
    const sent = bountyText(u.raw, { multiRound: true });
    // the second key is the text that the server makes, without its markup
    assert.equal(bountyVariant(key, '')[0], plain(sent), key);
    const en = rich(plain(sent));
    assert.ok(en != null, `the server's text has a translation: ${plain(sent).slice(0, 40)}`);
    assert.match(plain(en), new RegExp(`the next ${BOUNTY_BATTLES} battles`, 'i'), plain(en));
    assert.doesNotMatch(plain(en), /every battle after this/i);
    assert.match(plain(rich(key)), /in every battle after this/i, `the data's text keeps the phrase that is replaced: ${plain(rich(key))}`);
  }
});

test('the operator names come from the game data, and a catalog entry wins over them', () => {
  const names = operatorNames();
  assert.ok(Object.keys(names).length > 100);
  for (const [zh, latin] of Object.entries(names)) assert.ok(CJK.test(zh) && !CJK.test(latin), `${zh} → ${latin}`);
  const en = buildCatalogs().en;
  const [someName] = Object.keys(names);
  assert.equal(en.messages[someName], names[someName]);
  assert.equal(en.messages['开始'], 'Start');
});
