# The i18n layer

This folder gives the page a second locale. The source text of the game is Chinese. This layer shows the page in the
locale that the player chooses. It does not change a file of the original project.

Status: one locale, English. The page is in English on the first visit. The catalog has a translation for the
interface text and for the text of the game data. The text of the game data has the names and the descriptions of
these things:

- the operators
- the skills
- the items
- the Alliances
- the strategies
- the enemies

## 1. The parts

| File | Contents |
|---|---|
| `locales/en.json` | the English catalog of the interface text |
| `locales/en/official.json` | the text of the game data that the official English client has. A tool writes this file. |
| `locales/en/game.json` | the text of the game data that the official English client does not have. This fork wrote it. |
| `translator.js` | the function that gets the translation of one string |
| `runtime.js` | the module that changes the text on the page |
| `extract.mjs` | the tool that finds the interface text and shows the coverage |
| `gametext.mjs` | the list of the text of the game data that the page can show |
| `official.mjs` | the tool that writes `locales/en/official.json` |
| `i18n.test.js` | the tests |

`aldus/build.mjs` copies the layer into `dist/i18n/` and adds one module to the entry page. That module starts before
the module of the game.

## 2. The two kinds of text

**The interface text** is in the code of the client: the labels, the buttons, the messages. `extract.mjs` finds it.
`locales/en.json` has its translations.

**The text of the game data** is in `data/*.json`: the names and the descriptions. The client shows it as it is.
`gametext.mjs` lists it, one text unit for each different string. The two files of `locales/en/` have its
translations. `game.json` wins over `official.json`.

The simulation reads the Chinese text of the game data for its rules. Thus the files in `/data/` stay as they are,
and the layer changes only the text on the page.

## 3. The catalog

The source string is the message id. A catalog has three lists:

- `messages`: one translation for each string of the interface text.
- `text`: one translation for each text unit of the game data. `aldus/build.mjs` makes this list from the files of
  `locales/en/`.
- `patterns`: one regular expression and one replacement for a string that has a value in it. For example, the
  number of a round.

The translator does these steps for one string:

1. It looks for the full string in `messages`, then in `text`.
2. It tries each template (see below).
3. It tries each pattern.
4. It cuts the string into known messages and known names. If the translator does not know one part, it changes
   nothing.
5. For one character alone, it gives the first letter of the name that starts with that character. The game shows
   such a character as a badge when a picture is not there.

A string that has no translation stays in Chinese on the page.

### Descriptions with markup

A description of the game data has the markup of the official English client:

- `<@ba.vup>+15%</>` is a styled piece. The page shows it in a different color.
- `<$ba.stun>…</>` is a term.
- `\n` is a line break.

The message id of a description is its text without the markup. This is the text that the page shows. The
translation keeps the markup.

The game draws a description as one element with text pieces and styled pieces in it. The runtime translates that
element as one sentence. Then it puts each piece of the translation into the piece of the page that has the same
place. It does not add, move, or remove an element.

For this, a translation must have the same lines as its source text, and the same number of styled pieces in each
line. If a line does not agree, the runtime shows that line as plain text, with no color.

### Templates

Some descriptions have placeholders, for example `{0:0%}`. The game puts a number there before it shows the text.
The message id and the translation keep the placeholder. The translator then finds the text with each number, and it
puts the number into the translation.

## 4. The locale

The runtime chooses the locale in this order:

1. the parameter `lang` in the address (`?lang=zh` or `?lang=en`)
2. the choice that the browser kept
3. English

The title screen has a button that changes the locale.

## 5. Where the English text comes from

**The official English client.** `official.mjs` gets the tables of the official English client. It builds the game
data two times with `tools/build-data.mjs`. The first build uses the Chinese tables. The second build uses the same
tables with the English text. A string of the first build and the string at the same place of the second build are a
pair. The official English client has the names and the descriptions of the content that it released:

- the operators
- the skills
- the talents
- the enemies

**This fork.** The official English client does not have this season of the mode in its tables. Thus this fork
translated the text of the mode:

- the items
- the Alliances
- the strategies
- the events
- the Attributes of the operators
- the tips

The translation uses the terms of the official English client and of the Arknights wikis.

**The game data.** The names of the operators come from the game data (`appellation`). `aldus/build.mjs` adds them
to each catalog.

The text of the official English client is the property of Hypergryph and Yostar (`NOTICE.md`). The game data is
also their property.

## 6. What the layer does not translate

- **Text in the canvas.** The renderer draws some text into the canvas, for example a number above an operator. The
  layer changes only the text of the page.
- **The pictures of the guide.**
- **Text that a player typed:** a name, a team key.
- **A badge of an operator that has a name of one character.** The badge then shows the full English name.

## 7. How to add text or a locale

After a merge from the original project, or after a new build of the game data:

1. Run `node aldus/i18n/extract.mjs --missing`. It shows each string that has no translation.
2. Add each string of the interface text to `locales/en.json`.
3. Run `node aldus/i18n/official.mjs`. It writes `locales/en/official.json` again.
4. Add each text unit that still has no translation to `locales/en/game.json`. Keep the markup and the placeholders
   of the source text.
5. Run `node --test aldus/i18n/i18n.test.js`.

Add a locale:

1. Copy `locales/en.json` to `locales/<locale>.json`.
2. Copy the folder `locales/en/` to `locales/<locale>/`.
3. Change `locale`, `name`, and each translation.
4. Run `node aldus/build.mjs`. The button on the title screen then shows the new locale.

To find text that has no translation on the page, type `spI18n.missing()` in the browser console.

## 8. The terms

These English terms of the mode come from the Arknights wikis:

- Solo Simulation
- Rest Phase, Improv Phase, Unite Phase
- Dispatch Center
- Funds
- Alliances, stacks
- Attribute
- Elite
- Hidden Core
- LP
- OpFor
- the names of the Alliances, for example Durable, Marvel, Resilient, Swift, Aid, Agile
- the names of the difficulties: Standard, Perilous, Dire, and Ultimate Simulation

These terms of a battle come from the official English client:

- ATK, DEF, RES
- ASPD, SP
- Stun, Bind, Frozen
