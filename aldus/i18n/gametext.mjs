// aldus/i18n/gametext.mjs — the text of the game data (data/*.json) that the page can draw.
//
// The interface text is in the client's source (extract.mjs reads it there). The names and the descriptions of the
// operators, the skills, the items, the enemies and the rest are in the game data, and the client draws them as they
// are. This module lists that text, one unit for each different string that a player can see.
//
// A unit is keyed by its plain text: the string without the markup of the official client, which is what the page
// shows and so what the runtime looks up (translator.js). `raw` is the same string with the markup. Many records
// have a field in the two forms (`desc` and `descRaw`): they are one unit.
//
// The data also has fields for a developer and not for a player (the notes of docs/research, the formulas of an
// implementation). NOT_DRAWN names them: they are not units.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain, CJK } from './translator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

/** Files of data/ with no text of the game: the asset manifest and the art of a local client. */
const NOT_GAME_DATA = new Set(['assets.json', 'local-assets.json']);

/** Fields that the client never draws. */
export const NOT_DRAWN = new Set(['assumed', 'notes', 'note', 'algorithm', 'implFormula', 'formula', 'meaning', '_why', 'howToPlay',
  'layerGain', 'effect', 'need', 'helperOrder', 'cards', 'shopExcludedBy', 'source', 'sources']);

/**
 * Walk a value of the game data and give each string with Chinese text to `visit(raw, field)`. A field that has a
 * `…Raw` sibling is passed over when the sibling is the same text with markup: the sibling stands for the two.
 */
export function eachText(value, visit, key = '', parent = null) {
  if (typeof value === 'string') {
    if (!CJK.test(value) || NOT_DRAWN.has(key)) return;
    const sibling = !key.endsWith('Raw') && parent ? parent[`${key}Raw`] : null;
    if (typeof sibling === 'string' && plain(sibling) === value) return;
    visit(value, key.replace(/Raw$/, ''));
    return;
  }
  if (Array.isArray(value)) { for (const v of value) eachText(v, visit, key, null); return; }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) eachText(v, visit, /^\d+$/.test(k) ? key : k, value);
}

/**
 * The text units of the game data.
 * @param {string} [dir] the folder of the data files (default: data/ of the repository)
 * @returns {Map<string, { raw: string, where: string[] }>} plain text → the string with its markup, and `file:field`
 * of each place that has it
 */
export function gameText(dir = path.join(ROOT, 'data')) {
  const units = new Map();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !NOT_GAME_DATA.has(n)).sort()) {
    const file = f.replace(/\.json$/, '');
    eachText(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), (raw, field) => {
      const key = plain(raw);
      const where = `${file}:${field}`;
      const unit = units.get(key);
      if (!unit) units.set(key, { raw, where: [where] });
      else {
        if (raw.length > unit.raw.length) unit.raw = raw;   // the form with the markup
        if (!unit.where.includes(where)) unit.where.push(where);
      }
    });
  }
  return units;
}
