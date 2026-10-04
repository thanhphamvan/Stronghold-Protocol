// aldus/i18n/translator.js — the text side of the i18n layer: a catalog and a source string in, the localized string out.
//
// The client of the original project has its interface text in its source, in Chinese, and this fork does not change
// that source. So the source text itself is the message id (the gettext convention): a catalog maps each source string
// to its translation, and a string without one stays as it is. Pure code, no DOM: runtime.js applies it to the page,
// i18n.test.js runs it under Node.
//
// A catalog (aldus/build.mjs buildCatalogs puts it together from locales/):
//   messages   { "<source string>": "<translation>" }      the interface text and the operator names
//   text       { "<source string>": "<translation>" }      the text of the game data (names, descriptions)
//   patterns   [ ["<regular expression>", "<replacement>"] ] for a string with a value in it ("第 3 回合" → "Round 3")
// A message wins over a text with the same key.
//
// The game data has descriptions with the markup of the official client (public/js/ui/richText.js):
//   <@ba.vup>+15%</>   a styled piece        <$ba.stun>晕眩</>   a term        \n   a line break
// The key of such a message is the description without the markup, which is what the page shows. Its translation
// keeps the markup, so the page can keep the styled pieces (runtime.js). `segments` is that markup, piece by piece.
//
// A key can also hold the placeholders of the official text, `{0}` or `{0:0%}`: the game puts a value there before it
// draws the text ("攻击力+{0:0%}" is drawn as "攻击力+15%"). Such a message is a template: it matches the drawn text
// with any value, and the value goes to the same placeholder of the translation.
//
// translate(text) tries, in this order:
//   1. the whole string in `messages`;
//   2. a template;
//   3. the first pattern that matches (names inside the match are then looked up too);
//   4. the string cut into known messages: every Chinese part must be a message, or nothing is changed. A sentence that
//      is half translated reads worse than the original, so it is all or nothing;
//   5. for one character alone: the first letter of the name that starts with it. The game draws the first character
//      of a name as a badge when it has no picture (an Alliance, an operator), and a badge has no other translation.
// A large number that the game writes with 万 (10^4) or 亿 (10^8) becomes the same number with K, M or B.
// Leading and trailing white space is kept. A string with Chinese text and no translation is recorded in `missing`.
// translate gives text without markup; rich(text) gives the translation with its markup.

/** Chinese text (CJK ideographs). */
export const CJK = /[㐀-鿿]/;

/** Full-width punctuation the source uses, as the translation writes it. */
const PUNCTUATION = [['，', ', '], ['。', '. '], ['：', ': '], ['；', '; '], ['（', ' ('], ['）', ') '], ['「', '“'], ['」', '”'], ['！', '! '], ['？', '? '], ['、', ', '], ['【', '['], ['】', ']']];

/** A text of the game data longer than this is a sentence: it is matched as a whole, never as a part of a longer string. */
const PART_MAX = 14;

/** A placeholder of the official text: `{0}`, `{1:0%}`. */
const PLACEHOLDER = /\{(\d{1,2})(?::[^{}]{1,12})?\}/g;

/** A number with a unit of the source: "150万" is 1,500,000. */
const BIG_NUMBER = /^(-?\d+(?:\.\d+)?)(万|亿)$/;
/** 1500000 → "1.5M". */
function compact(value) {
  const abs = Math.abs(value);
  const [div, unit] = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  return `${Number((value / div).toFixed(abs / div >= 100 ? 0 : 1))}${unit}`;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Punctuation and spacing of a string that was put together from parts. */
export function tidy(text) {
  let out = text;
  for (const [from, to] of PUNCTUATION) out = out.split(from).join(to);
  return out.replace(/[ \t]{2,}/g, ' ').replace(/ ([,.;:!?)\]”])/g, '$1').replace(/([([“]) /g, '$1').trim();
}

const TAG_OPEN = /^<([@$])([A-Za-z0-9_.\-]{1,48})>/;
const TAG_CLOSE = '</>';

/**
 * The pieces of a string with the official markup, as parseRichText of public/js/ui/richText.js makes them (i18n.test.js
 * holds the two equal): neighbours with the same styles are one piece, and anything that only looks like a tag is text.
 * @param {any} src
 * @returns {Array<{ text: string, cls: string[], term: boolean } | { br: true }>}
 */
export function segments(src) {
  if (src == null) return [];
  const s = String(src).replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
  const stack = [];
  const out = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const cls = stack.map((t) => t.cls);
    const term = stack.some((t) => t.term);
    const prev = out[out.length - 1];
    if (prev && !prev.br && prev.term === term && prev.cls.length === cls.length && prev.cls.every((c, i) => c === cls[i])) prev.text += buf;
    else out.push({ text: buf, cls, term });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\n') { flush(); out.push({ br: true }); i += 1; continue; }
    if (ch === '<') {
      if (s.startsWith(TAG_CLOSE, i)) {
        if (stack.length) { flush(); stack.pop(); } else buf += TAG_CLOSE;
        i += TAG_CLOSE.length;
        continue;
      }
      const m = TAG_OPEN.exec(s.slice(i, i + 52));
      if (m) { flush(); stack.push({ cls: m[2], term: m[1] === '$' }); i += m[0].length; continue; }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/** A piece that the page draws inside a styled element (public/js/ui/gameComponents.js RichText). */
export const isStyled = (seg) => !seg.br && (seg.cls.length > 0 || seg.term);

/** A string without its markup: what the page shows, line breaks kept. */
export const plain = (src) => segments(src).map((seg) => (seg.br ? '\n' : seg.text)).join('');

/** The locales a tag may mean, most specific first: "en-US" → ["en-us", "en"]. */
const candidates = (tag) => { const t = String(tag || '').toLowerCase(); return t.includes('-') ? [t, t.split('-')[0]] : [t]; };

/**
 * Which locale to show. The order is: the `lang` parameter of the address, the saved choice, the default.
 * @param {{ query?: string|null, saved?: string|null, available: string[], source: string, fallback: string }} o
 * `available`: the locales that have a catalog; `source`: the language of the source text; `fallback`: the default.
 * @returns {string} `source`, or a locale of `available`
 */
export function negotiate({ query = null, saved = null, available, source, fallback }) {
  const resolve = (tag) => {
    for (const c of candidates(tag)) {
      if (c === source || c === source.split('-')[0]) return source;
      if (available.includes(c)) return c;
    }
    return null;
  };
  return resolve(query) || resolve(saved) || resolve(fallback) || source;
}

/**
 * A message whose key has placeholders, as a regular expression for the drawn text.
 * @returns {{ re: RegExp, groups: number[], to: string } | null} null when one placeholder is there two times
 */
function template(key, to) {
  const groups = [];
  let last = 0;
  let src = '^';
  for (const m of key.matchAll(PLACEHOLDER)) {
    const index = Number(m[1]);
    if (groups.includes(index)) return null;
    groups.push(index);
    src += `${escapeRe(key.slice(last, m.index))}([\\s\\S]+?)`;
    last = m.index + m[0].length;
  }
  return { re: new RegExp(`${src}${escapeRe(key.slice(last))}$`), groups, to };
}

/**
 * @param {{ messages?: Record<string, string>, text?: Record<string, string>, patterns?: Array<[string, string]> }} catalog
 * @returns {{ translate: (text: string) => string|null, rich: (text: string) => string|null, sentence: (text: string) => string|null, missing: Set<string>, size: number }}
 */
export function createTranslator(catalog) {
  // one map for the two kinds of entries; a message wins
  const messages = { ...((catalog && catalog.text) || {}), ...((catalog && catalog.messages) || {}) };
  const own = (catalog && catalog.messages) || {};
  const patterns = ((catalog && catalog.patterns) || []).map(([re, to]) => [new RegExp(re), to]);
  const keys = Object.keys(messages);
  const templates = keys.filter((k) => k.search(PLACEHOLDER) >= 0).map((k) => template(k, messages[k])).filter(Boolean);
  // the parts a string may be cut into: a message of two characters or more (one character is a word only when it
  // stands alone), and a short text of the game data (a name; a sentence of the data is matched as a whole)
  const parts = keys.filter((k) => CJK.test(k) && [...k].length >= 2 && (Object.hasOwn(own, k) || ([...k].length <= PART_MAX && !/[\n{<]/.test(k)))).sort((a, b) => b.length - a.length);
  const cut = parts.length ? new RegExp(parts.map(escapeRe).join('|'), 'g') : null;
  // the badge of a name (step 5): a message decides (the Alliances are messages), else the most frequent first letter
  // of the names of the game data that start with the character
  const badges = new Map();
  const votes = new Map();
  for (const k of keys) {
    const chars = [...k];
    const letter = /[A-Za-z\u00c0-\u024f]/.exec(plain(messages[k]));
    if (chars.length < 2 || chars.length > PART_MAX || !CJK.test(chars[0]) || /[\n{<]/.test(k) || !letter) continue;
    const l = letter[0].toUpperCase();
    if (Object.hasOwn(own, k)) { if (!badges.has(chars[0])) badges.set(chars[0], l); continue; }
    if (!votes.has(chars[0])) votes.set(chars[0], new Map());
    votes.get(chars[0]).set(l, (votes.get(chars[0]).get(l) || 0) + 1);
  }
  for (const [ch, m] of votes) if (!badges.has(ch)) badges.set(ch, [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]);
  const cache = new Map();
  const missing = new Set();
  // each part becomes a word of its own: the source writes its words with no space between them
  const known = (s) => (cut ? s.replace(cut, (k) => ` ${plain(messages[k])} `) : s);

  /** The translation of `text` as a whole (steps 1 and 2), with its markup, or null. */
  function whole(text) {
    if (Object.hasOwn(messages, text)) return messages[text];
    for (const t of templates) {
      const m = t.re.exec(text);
      if (m) return t.to.replace(PLACEHOLDER, (all, index) => { const g = t.groups.indexOf(Number(index)); return g < 0 ? all : m[g + 1]; });
    }
    return null;
  }

  /** The translation of `text` with its markup, or null. */
  function core(text) {
    const exact = whole(text);
    if (exact != null) return exact;
    for (const [re, to] of patterns) if (re.test(text)) return tidy(known(text.replace(re, to)));
    const big = BIG_NUMBER.exec(text);
    if (big) return compact(Number(big[1]) * (big[2] === '万' ? 1e4 : 1e8));
    if ([...text].length === 1) return badges.get(text) ?? null;
    const out = known(text);
    return CJK.test(out) ? null : tidy(out);
  }

  function lookup(text) {
    if (typeof text !== 'string' || !CJK.test(text)) return null;
    if (cache.has(text)) return cache.get(text);
    const lead = /^\s*/.exec(text)[0];
    const body = text.slice(lead.length).replace(/\s+$/, '');
    const trail = text.slice(lead.length + body.length);
    const out = core(body);
    if (out == null) missing.add(body);
    const res = out == null ? null : lead + out + trail;
    cache.set(text, res);
    return res;
  }

  /** The translation of `text` with its markup, or null when it has none (or no Chinese text at all). */
  const rich = (text) => lookup(text);
  /** As `rich`, but only for a text that the catalog has as a whole: no pattern, no cut. */
  const sentence = (text) => (typeof text === 'string' && CJK.test(text) ? whole(text.trim()) : null);
  /** The translation of `text` as plain text, or null. */
  const translate = (text) => { const out = lookup(text); return out != null && out.includes(TAG_CLOSE) ? plain(out) : out; };

  return { translate, rich, sentence, missing, size: keys.length };
}

/**
 * Where the pieces of a translation go in a rich text that the page already drew. `slots` is the drawn text, piece by
 * piece: `{ styled }` for a text node (inside a styled element or not) and `{ br: true }` for a line break. The result
 * has one string for each slot (null for a break). The page keeps its elements, so a styled piece of the translation
 * goes into a styled slot, in the same order. A line of the translation whose styled pieces do not agree with the
 * line of the page goes into the first plain slot of that line as plain text.
 * @param {Array<{ styled?: boolean, br?: boolean }>} slots
 * @param {string} translation with markup
 * @returns {Array<string|null>}
 */
export function place(slots, translation) {
  const out = slots.map((s) => (s.br ? null : ''));
  const lines = (list) => { const res = [[]]; list.forEach((x, i) => { if (x.br) res.push([]); else res[res.length - 1].push([x, i]); }); return res; };
  const segs = segments(translation);
  let pageLines = lines(slots);
  let textLines = lines(segs);
  if (pageLines.length !== textLines.length) {
    // the lines do not agree: one line, with a space for each break of the translation
    pageLines = [pageLines.flat()];
    textLines = [segs.map((s, i) => [s.br ? { text: ' ', cls: [], term: false } : s, i])];
  }
  pageLines.forEach((page, n) => {
    const text = textLines[n].map(([s]) => s);
    if (!page.length) return;
    const styledSlots = page.filter(([s]) => s.styled);
    const styledText = text.filter(isStyled);
    if (styledSlots.length !== styledText.length) {
      const [, first] = page.find(([s]) => !s.styled) || page[0];
      out[first] = text.map((s) => s.text).join('');
      return;
    }
    // the styled pieces are the anchors; the plain text between two anchors goes to the plain slot between them
    let p = 0;
    let pending = '';      // plain text that waits for a slot
    let lastIndex = -1;    // the last slot that got text
    for (const seg of text) {
      if (isStyled(seg)) {
        while (p < page.length && !page[p][0].styled) {   // the plain slots before this anchor
          if (pending) { out[page[p][1]] += pending; pending = ''; }
          lastIndex = page[p][1];
          p += 1;
        }
        // no plain slot here: the waiting text goes in front of the styled piece
        out[page[p][1]] = pending + seg.text;
        pending = '';
        lastIndex = page[p][1];
        p += 1;
      } else {
        pending += seg.text;
      }
    }
    while (p < page.length) {                               // the plain slots after the last anchor
      if (pending) { out[page[p][1]] += pending; pending = ''; }
      lastIndex = page[p][1];
      p += 1;
    }
    if (pending) out[lastIndex >= 0 ? lastIndex : page[0][1]] += pending;
  });
  return out;
}
