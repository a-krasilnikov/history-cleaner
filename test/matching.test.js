// Unit tests for the core matching logic in background.js.
//
// background.js is a classic MV3 service worker: no exports, and it touches
// chrome.* at load time. So we load its source into a vm sandbox with a mocked
// `chrome` global. Top-level `function` declarations become properties of the
// sandbox, which lets us call the real production functions directly.
//
// Run: npm test   (or: node --test)

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

/** Loads background.js in a fresh sandbox with `sites` already in storage. */
function load(sites = []) {
  const state = { sites };
  const noop = () => {};
  const evt = () => ({ addListener: noop });
  const chrome = {
    storage: {
      sync: { get: (_d, cb) => cb({ sites: state.sites }), set: noop },
      local: { get: (d, cb) => cb(d), set: noop },
      onChanged: evt()
    },
    alarms: { get: (_n, cb) => cb(undefined), create: noop, onAlarm: evt() },
    runtime: { onInstalled: evt(), onStartup: evt(), onMessage: evt(), openOptionsPage: noop },
    history: { onVisited: evt(), deleteUrl: noop, search: async () => [] },
    action: { onClicked: evt() }
  };
  const sandbox = { chrome, URL, console };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return sandbox;
}

/** Would the extension delete `url` from history given `sites`? */
function removes(sites, url) {
  return load(sites).shouldRemove(url);
}

// Objects returned from the vm realm carry that realm's prototypes, which trips
// deepStrictEqual's reference check. Normalize to plain main-realm objects.
const plain = (v) => JSON.parse(JSON.stringify(v));

const bg = load(); // stateless helpers don't depend on the rule list

// --- Input normalization -------------------------------------------------

describe("normalizeDomain", () => {
  it("lowercases and strips protocol + www", () => {
    assert.equal(bg.normalizeDomain("HTTPS://WWW.Example.com"), "example.com");
  });
  it("trims surrounding whitespace", () => {
    assert.equal(bg.normalizeDomain("  example.com  "), "example.com");
  });
  it("leaves a real subdomain intact", () => {
    assert.equal(bg.normalizeDomain("sub.example.com"), "sub.example.com");
  });
});

describe("normalizePath", () => {
  it("empty or '/' becomes '/'", () => {
    assert.equal(bg.normalizePath(""), "/");
    assert.equal(bg.normalizePath("/"), "/");
  });
  it("adds leading and trailing slashes", () => {
    assert.equal(bg.normalizePath("forum"), "/forum/");
    assert.equal(bg.normalizePath("/forum"), "/forum/");
    assert.equal(bg.normalizePath("forum/"), "/forum/");
  });
});

describe("parseSiteInput", () => {
  it("treats a bare domain as the whole site", () => {
    assert.deepEqual(plain(bg.parseSiteInput("example.com")), { domain: "example.com", path: "/" });
  });
  it("strips protocol/www/query/hash and scopes the path (PRD edge case)", () => {
    assert.deepEqual(
      plain(bg.parseSiteInput("https://www.example.com/p/abc?utm_source=x")),
      { domain: "example.com", path: "/p/abc/" }
    );
  });
  it("lowercases the whole input", () => {
    assert.deepEqual(plain(bg.parseSiteInput("EXAMPLE.com/Forum")), {
      domain: "example.com",
      path: "/forum/"
    });
  });
});

describe("toSiteConfigs", () => {
  it("normalizes legacy string entries", () => {
    assert.deepEqual(plain(bg.toSiteConfigs(["example.com", "example.com/forum/"])), [
      { domain: "example.com", path: "/", keepHomepage: false },
      { domain: "example.com", path: "/forum/", keepHomepage: false }
    ]);
  });
  it("normalizes object entries and coerces keepHomepage to boolean", () => {
    assert.deepEqual(
      plain(bg.toSiteConfigs([{ domain: "EXAMPLE.com", path: "forum", keepHomepage: 1 }])),
      [{ domain: "example.com", path: "/forum/", keepHomepage: true }]
    );
  });
  it("drops null/invalid entries", () => {
    assert.deepEqual(plain(bg.toSiteConfigs([null, undefined, {}, { path: "/x/" }])), []);
  });
});

// --- Domain matching -----------------------------------------------------

describe("domain matching", () => {
  const rule = [{ domain: "example.com", path: "/", keepHomepage: false }];

  it("matches the domain itself", () => {
    assert.equal(removes(rule, "https://example.com/anything"), true);
  });
  it("matches www and any subdomain", () => {
    assert.equal(removes(rule, "https://www.example.com/x"), true);
    assert.equal(removes(rule, "https://deep.sub.example.com/x"), true);
  });
  it("is case-insensitive on the host", () => {
    assert.equal(removes(rule, "https://EXAMPLE.com/x"), true);
  });
  it("does not match look-alike domains", () => {
    assert.equal(removes(rule, "https://notexample.com/x"), false);
    assert.equal(removes(rule, "https://myexample.com/"), false);
    assert.equal(removes(rule, "https://example.com.evil.com/x"), false);
  });
});

// --- Path scoping --------------------------------------------------------

describe("path scoping", () => {
  const rule = [{ domain: "example.com", path: "/forum/", keepHomepage: false }];

  it("removes the section root and anything deeper", () => {
    assert.equal(removes(rule, "https://example.com/forum/"), true);
    assert.equal(removes(rule, "https://example.com/forum/some-post"), true);
  });
  it("keeps pages outside the section", () => {
    assert.equal(removes(rule, "https://example.com/"), false);
    assert.equal(removes(rule, "https://example.com/about"), false);
  });
  it("respects the '/' boundary — /forums is not in /forum/", () => {
    assert.equal(removes(rule, "https://example.com/forums"), false);
  });
  it("applies path scoping across subdomains", () => {
    assert.equal(removes(rule, "https://sub.example.com/forum/some-post"), true);
  });
});

// --- Specificity: the longer path wins -----------------------------------

describe("specificity (longest path wins)", () => {
  const rules = [
    { domain: "example.com", path: "/", keepHomepage: false },
    { domain: "example.com", path: "/forum/", keepHomepage: true }
  ];

  it("the more specific rule governs a URL that matches both", () => {
    // /forum/ rule wins and keepHomepage keeps its root...
    assert.equal(removes(rules, "https://example.com/forum/"), false);
    // ...but pages deeper than that root are still removed.
    assert.equal(removes(rules, "https://example.com/forum/post"), true);
  });
  it("falls back to the domain rule elsewhere", () => {
    assert.equal(removes(rules, "https://example.com/about"), true);
  });
  it("findMatch returns the most specific rule object", () => {
    assert.equal(load(rules).findMatch("example.com", "/forum/post").path, "/forum/");
  });
});

// --- keep-root toggle ----------------------------------------------------

describe("keep-root toggle (path rule)", () => {
  const rule = [{ domain: "example.com", path: "/forum/", keepHomepage: true }];

  it("keeps the section root, with or without a trailing slash", () => {
    assert.equal(removes(rule, "https://example.com/forum/"), false);
    assert.equal(removes(rule, "https://example.com/forum"), false);
  });
  it("removes anything nested under the root", () => {
    assert.equal(removes(rule, "https://example.com/forum/some-post"), true);
    assert.equal(removes(rule, "https://example.com/forum/subforum/thread"), true);
  });
});

describe("keep-root toggle (bare domain = keep homepage)", () => {
  const rule = [{ domain: "example.com", path: "/", keepHomepage: true }];

  it("keeps the homepage", () => {
    assert.equal(removes(rule, "https://example.com/"), false);
    assert.equal(removes(rule, "https://example.com"), false); // pathname is "/"
  });
  it("removes inner pages", () => {
    assert.equal(removes(rule, "https://example.com/p/abc123"), true);
  });
});

// --- No match / malformed input ------------------------------------------

describe("non-matches and bad input", () => {
  const rule = [{ domain: "example.com", path: "/", keepHomepage: false }];

  it("ignores URLs with no matching rule", () => {
    assert.equal(removes(rule, "https://other.com/"), false);
  });
  it("returns false for an unparseable URL", () => {
    assert.equal(removes(rule, "not a url"), false);
  });
  it("returns false when the rule list is empty", () => {
    assert.equal(removes([], "https://example.com/"), false);
  });
});

// --- Case-insensitivity ---------------------------------------------------
// Rules are stored lowercase (normalizePath lowercases) and shouldRemove
// lowercases the URL pathname before matching, so /Forum/post and /forum/post
// are the same place. URL paths are case-sensitive by spec; we deliberately
// ignore that — see docs/PRD.md.

describe("case-insensitive path matching", () => {
  const rule = [{ domain: "example.com", path: "/forum/", keepHomepage: false }];

  it("a rule matches mixed-case URL paths", () => {
    assert.equal(removes(rule, "https://example.com/Forum/post"), true);
    assert.equal(removes(rule, "https://example.com/FORUM/"), true);
  });
  it("keep-root recognizes the section root in any case", () => {
    const keep = [{ domain: "example.com", path: "/forum/", keepHomepage: true }];
    assert.equal(removes(keep, "https://example.com/Forum/"), false);
    assert.equal(removes(keep, "https://example.com/Forum/post"), true);
  });
  it("normalizePath lowercases rule paths", () => {
    assert.equal(bg.normalizePath("/Forum"), "/forum/");
  });
  it("toSiteConfigs lowercases mixed-case object paths (import route)", () => {
    assert.deepEqual(plain(bg.toSiteConfigs([{ domain: "example.com", path: "/Forum/" }])), [
      { domain: "example.com", path: "/forum/", keepHomepage: false }
    ]);
  });
});
