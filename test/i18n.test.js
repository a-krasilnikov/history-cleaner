// Consistency checks for the message catalogues in _locales/.
//
// Nothing here runs extension code — it reads the JSON, options.html and
// options.js as text. The point is to catch the three ways localization rots:
// a translation missing a key or a plural form, a $PLACEHOLDER$ dropped in
// translation, and the English fallback text in options.html drifting away
// from _locales/en/messages.json.
//
// Run: npm test   (or: node --test)

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "_locales");
const DEFAULT_LOCALE = "en";

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const readJson = (file) => JSON.parse(read(file));

const LOCALES = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const CATALOGUE = Object.fromEntries(
  LOCALES.map((locale) => [locale, readJson(`_locales/${locale}/messages.json`)])
);
const EN = CATALOGUE[DEFAULT_LOCALE];

const MANIFEST = read("manifest.json");
const HTML = read("options.html");
const JS = read("options.js");

// tn() in options.js builds "<base>_<category>" at runtime, so a plural message
// is referenced in code by its base name only.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKey = (key) => key.replace(PLURAL_SUFFIX, "");
const pluralBases = (messages) =>
  new Set(Object.keys(messages).filter((k) => PLURAL_SUFFIX.test(k)).map(baseKey));

/** The $NAME$ slots used inside a message, lowercased. */
const slotsIn = (message) =>
  new Set((message.match(/\$([A-Za-z0-9_]+)\$/g) || []).map((s) => s.slice(1, -1).toLowerCase()));

/** Reads an attribute out of a raw tag string. The leading \s keeps `title`
 *  from matching `data-i18n-title`. */
function attr(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : null;
}

const TAGS = HTML.match(/<[a-z][a-z0-9]*\b[^>]*>/gi) || [];

describe("locale catalogues", () => {
  it("has a default locale that matches the manifest", () => {
    assert.equal(readJson("manifest.json").default_locale, DEFAULT_LOCALE);
    assert.ok(LOCALES.includes(DEFAULT_LOCALE));
  });

  it("defines every message the manifest asks for", () => {
    for (const [, key] of MANIFEST.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) {
      assert.ok(EN[key], `manifest uses __MSG_${key}__, missing from ${DEFAULT_LOCALE}`);
    }
  });

  for (const locale of LOCALES) {
    const messages = CATALOGUE[locale];

    it(`${locale}: every entry is a well-formed message`, () => {
      for (const [key, entry] of Object.entries(messages)) {
        assert.equal(typeof entry.message, "string", `${key} has no message`);
        assert.ok(entry.message.length > 0, `${key} is empty`);

        const declared = new Set(Object.keys(entry.placeholders || {}).map((p) => p.toLowerCase()));
        for (const slot of slotsIn(entry.message)) {
          assert.ok(declared.has(slot), `${key} uses $${slot.toUpperCase()}$ but never declares it`);
        }
        for (const [name, spec] of Object.entries(entry.placeholders || {})) {
          assert.match(spec.content, /^\$[1-9]$/, `${key}.${name} must map to $1…$9`);
        }
      }
    });

    if (locale === DEFAULT_LOCALE) continue;

    it(`${locale}: translates every message`, () => {
      const missing = Object.keys(EN).filter(
        (key) => !PLURAL_SUFFIX.test(key) && !messages[key]
      );
      assert.deepEqual(missing, [], `untranslated keys in ${locale}`);

      const extra = Object.keys(messages).filter(
        (key) => !EN[key] && !pluralBases(EN).has(baseKey(key))
      );
      assert.deepEqual(extra, [], `keys in ${locale} with no ${DEFAULT_LOCALE} original`);
    });

    it(`${locale}: covers every plural form the language needs`, () => {
      // Russian needs one/few/many where English needs one/other; tn() falls
      // back to _other, but a missing category would silently read wrong.
      const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      for (const base of pluralBases(EN)) {
        for (const category of categories) {
          assert.ok(
            messages[`${base}_${category}`],
            `${locale} is missing ${base}_${category}`
          );
        }
      }
    });

    it(`${locale}: keeps the placeholders of each message`, () => {
      for (const [key, entry] of Object.entries(messages)) {
        const original = EN[key] || EN[`${baseKey(key)}_other`];
        if (!original) continue;
        assert.deepEqual(
          [...slotsIn(entry.message)].sort(),
          [...slotsIn(original.message)].sort(),
          `${locale}/${key} does not use the same placeholders as ${DEFAULT_LOCALE}`
        );
      }
    });
  }

  it("has no message that nothing references", () => {
    const code = HTML + JS + MANIFEST;
    const orphans = Object.keys(EN).filter((key) => !code.includes(baseKey(key)));
    assert.deepEqual(orphans, [], "dead messages (or a key misspelled in the code)");
  });
});

describe("options.html fallbacks", () => {
  it("matches the English catalogue", () => {
    for (const [, key, text] of HTML.matchAll(
      /<[a-z][a-z0-9]*\b[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)</gi
    )) {
      assert.ok(EN[key], `options.html references unknown message "${key}"`);
      assert.equal(text, EN[key].message, `fallback text for "${key}" is stale`);
    }

    for (const [dataAttr, htmlAttr] of [
      ["data-i18n-placeholder", "placeholder"],
      ["data-i18n-title", "title"]
    ]) {
      for (const tag of TAGS) {
        const key = attr(tag, dataAttr);
        if (!key) continue;
        assert.ok(EN[key], `options.html references unknown message "${key}"`);
        assert.equal(
          attr(tag, htmlAttr),
          EN[key].message,
          `fallback ${htmlAttr} for "${key}" is stale`
        );
      }
    }
  });

  it("leaves no attribute copy unlocalized", () => {
    for (const tag of TAGS) {
      if (attr(tag, "placeholder")) {
        assert.ok(attr(tag, "data-i18n-placeholder"), `hard-coded placeholder: ${tag}`);
      }
      if (attr(tag, "title")) {
        assert.ok(attr(tag, "data-i18n-title"), `hard-coded title: ${tag}`);
      }
    }
  });
});
