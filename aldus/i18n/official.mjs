#!/usr/bin/env node
// aldus/i18n/official.mjs — the official English text of the game data, for locales/en/official.json.
//
//   node aldus/i18n/official.mjs            use the tables in .cache, download the ones that are missing
//   node aldus/i18n/official.mjs --refresh  download each table again
//
// The game data of this project (data/*.json) is built by tools/build-data.mjs from the Chinese tables of the official
// client. The English client (Yostar) has the same tables with the same ids, for everything it released: the names and
// the descriptions of operators, skills, talents, modules and enemies. It does not have this season of the mode, so
// the text of the mode itself (the items, the Alliances, the strategies) is not there: locales/en/game.json has that.
//
// How the English text is found, with no table of ids kept here:
//   1. tools/build-data.mjs builds the data from the Chinese tables, into a folder of .cache. The result must be the
//      committed data, file for file: the tables are then the ones the data came from.
//   2. A copy of the Chinese tables gets the English strings: where the two tables have a string at the same path, and
//      the Chinese one has Chinese text, the English one goes in. Numbers, ids and structure stay Chinese.
//   3. tools/build-data.mjs builds the data again from that copy (--force: its checks that read Chinese names fail).
//   4. A string of build 1 and the string at the same path of build 3 are a pair. One Chinese string with two English
//      strings takes the more frequent one.
// The result has one entry for each text unit of the data (gametext.mjs) that has a pair: the plain Chinese text, and
// the English text with the markup of the official client.
//
// The tables are © Hypergryph / Yostar, as the game data itself (NOTICE.md). .cache/ is not in git.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gameText, eachText, ROOT } from './gametext.mjs';
import { segments, plain, isStyled, CJK } from './translator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EN_URL = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData_YoStar/main/en_US/gamedata/';
/** The tables that have text and that the English client has too. */
const TEXT_TABLES = ['excel/character_table.json', 'excel/skill_table.json', 'excel/uniequip_table.json', 'excel/battle_equip_table.json', 'excel/enemy_handbook_table.json'];
const ENEMY_DATABASE = 'levels/enemydata/enemy_database.json';
const OUT = path.join(HERE, 'locales', 'en', 'official.json');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const log = (line) => console.log(line);

/** `cn` with the English strings of `en` at the same paths. */
export function overlay(cn, en) {
  if (typeof cn === 'string') return typeof en === 'string' && en && CJK.test(cn) && !CJK.test(en) ? en : cn;
  if (Array.isArray(cn)) return cn.map((v, i) => overlay(v, Array.isArray(en) ? en[i] : undefined));
  if (cn && typeof cn === 'object') {
    const src = en && typeof en === 'object' && !Array.isArray(en) ? en : {};
    return Object.fromEntries(Object.entries(cn).map(([k, v]) => [k, overlay(v, src[k])]));
  }
  return cn;
}

/**
 * A text of the official client with each tag closed. A few of its texts leave the last tag open, or close one tag two
 * times: the client draws them all the same, but a stray closer would show as text on this page.
 */
export function balanced(text) {
  let open = 0;
  const out = text.replace(/<[@$][A-Za-z0-9_.\-]{1,48}>|<\/>/g, (tag) => {
    if (tag !== '</>') { open += 1; return tag; }
    if (open === 0) return '';
    open -= 1;
    return tag;
  });
  return out + '</>'.repeat(open);
}

/**
 * An English text with the styled pieces of its source, where the official client does not style it the same way. The
 * page puts a styled piece of a translation into the styled piece that it drew (translator.js place), so a line with
 * another number of styled pieces loses its colours. Most styled pieces are values ("+15%", "60"): when each value of
 * a source line is in the English line, in the same order, the value gets the tag of the source. A line with a styled
 * piece of words stays as the official client has it.
 * @param {string} raw the source text with its markup
 * @param {string} en the English text
 * @returns {string}
 */
export function remark(raw, en) {
  const styledIn = (line) => segments(line).filter(isStyled);
  const rawLines = raw.replace(/\\n/g, '\n').split('\n');
  const enLines = en.replace(/\\n/g, '\n').split('\n');
  if (rawLines.length !== enLines.length) return en;
  return enLines.map((line, n) => {
    const want = styledIn(rawLines[n]);
    if (!want.length || want.length === styledIn(line).length) return line;
    const text = plain(line);
    let out = '';
    let at = 0;
    for (const seg of want) {
      const value = seg.text.trim();
      const found = value && !CJK.test(value) ? text.indexOf(value, at) : -1;
      if (found < 0) return line;
      const open = seg.cls.map((c, i) => `<${seg.term && i === seg.cls.length - 1 ? '$' : '@'}${c}>`).join('');
      out += `${text.slice(at, found)}${open}${value}${'</>'.repeat(seg.cls.length)}`;
      at = found + value.length;
    }
    return out + text.slice(at);
  }).join('\n');
}

/** The pairs of two builds of the data: Chinese string → the English string at the same path (the most frequent). */
export function pairs(cnDir, enDir) {
  const seen = new Map();
  const walk = (cn, en) => {
    if (typeof cn === 'string') {
      if (typeof en !== 'string' || en === cn || !CJK.test(cn) || CJK.test(en)) return;
      if (!seen.has(cn)) seen.set(cn, new Map());
      seen.get(cn).set(en, (seen.get(cn).get(en) || 0) + 1);
    } else if (Array.isArray(cn)) cn.forEach((v, i) => walk(v, Array.isArray(en) ? en[i] : undefined));
    else if (cn && typeof cn === 'object') for (const [k, v] of Object.entries(cn)) walk(v, en && typeof en === 'object' ? en[k] : undefined);
  };
  for (const f of fs.readdirSync(cnDir).filter((n) => n.endsWith('.json')).sort()) {
    if (fs.existsSync(path.join(enDir, f))) walk(readJson(path.join(cnDir, f)), readJson(path.join(enDir, f)));
  }
  const out = new Map();
  for (const [cn, m] of seen) out.set(cn, [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]);
  return out;
}

function buildData(args) {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-data.mjs'), '--quiet', ...args], { cwd: ROOT, encoding: 'utf8' });
  return res;
}

async function download(rel, dir, refresh) {
  const file = path.join(dir, rel);
  if (!refresh && fs.existsSync(file)) return;
  log(`  download ${rel}`);
  const res = await fetch(EN_URL + rel);
  if (!res.ok) throw new Error(`${EN_URL}${rel}: ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const cache = path.join(ROOT, '.cache');
  const cnTables = path.join(cache, 'gamedata');
  const enTables = path.join(cache, 'gamedata-en');
  const mixTables = path.join(cache, 'gamedata-en-overlay');
  const cnOut = path.join(cache, 'i18n-data-zh');
  const enOut = path.join(cache, 'i18n-data-en');

  log('1. the data from the Chinese tables');
  const first = buildData(['--cache', cnTables, '--out', cnOut, '--report', path.join(cache, 'i18n-report-zh.json'), ...(refresh ? ['--refresh'] : [])]);
  if (first.status !== 0) throw new Error(`tools/build-data.mjs failed:\n${first.stdout}${first.stderr}`);
  const differ = fs.readdirSync(cnOut).filter((f) => f.endsWith('.json') && fs.readFileSync(path.join(cnOut, f), 'utf8') !== fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
  if (differ.length) throw new Error(`the tables of today do not build the committed data (${differ.join(', ')}): run npm run build-data first, or the pairs are not the text of data/`);

  log('2. the English tables');
  for (const rel of [...TEXT_TABLES, ENEMY_DATABASE]) await download(rel, enTables, refresh);
  fs.rmSync(mixTables, { recursive: true, force: true });
  fs.cpSync(cnTables, mixTables, { recursive: true });
  for (const rel of TEXT_TABLES) fs.writeFileSync(path.join(mixTables, rel), JSON.stringify(overlay(readJson(path.join(cnTables, rel)), readJson(path.join(enTables, rel)))));
  { // a list of { Key, Value }: paired by Key
    const cn = readJson(path.join(cnTables, ENEMY_DATABASE));
    const byKey = new Map((readJson(path.join(enTables, ENEMY_DATABASE)).enemies || []).map((e) => [e.Key, e.Value]));
    cn.enemies = cn.enemies.map((e) => ({ Key: e.Key, Value: overlay(e.Value, byKey.get(e.Key)) }));
    fs.writeFileSync(path.join(mixTables, ENEMY_DATABASE), JSON.stringify(cn));
  }

  log('3. the data from the tables with the English text');
  fs.rmSync(enOut, { recursive: true, force: true });
  buildData(['--offline', '--force', '--cache', mixTables, '--out', enOut, '--report', path.join(cache, 'i18n-report-en.json')]);
  if (!fs.existsSync(path.join(enOut, 'chess.json'))) throw new Error('tools/build-data.mjs wrote no data from the tables with the English text');

  log('4. the pairs');
  const official = pairs(cnOut, enOut);
  const units = gameText();
  const text = {};
  for (const key of [...units.keys()].sort()) {
    const en = official.get(units.get(key).raw) ?? official.get(key);
    if (en != null) text[key] = remark(units.get(key).raw, balanced(en));
  }
  // the units of the data with the English text are the same units, so their count is a check of step 3
  let englishUnits = 0;
  for (const f of fs.readdirSync(enOut).filter((n) => n.endsWith('.json'))) eachText(readJson(path.join(enOut, f)), () => { englishUnits += 1; });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify({ source: `${EN_URL} (the official English client, © Hypergryph / Yostar); made by aldus/i18n/official.mjs, not by hand`, text }, null, 1)}\n`);
  const shapeOf = (t) => segments(t).map((x) => (x.br ? 'B' : isStyled(x) ? 'S' : 'P')).join('').split('B').map((l) => l.replace(/P/g, '').length).join();
  const plainLines = Object.keys(text).filter((k) => shapeOf(units.get(k).raw) !== shapeOf(text[k])).length;
  log(`${plainLines} of them have a line that the page shows with no colour: its styled pieces are not the ones of the source`);
  log(`${Object.keys(text).length} of ${units.size} text units have official English → ${path.relative(ROOT, OUT)}`);
  log(`${units.size - Object.keys(text).length} units have none: the text of this season of the mode, and what the English client did not release (${englishUnits} strings of the second build are still Chinese)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
}
