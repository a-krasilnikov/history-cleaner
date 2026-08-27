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

/**
 * Loads background.js in a fresh sandbox with `sites` already in storage.
 * `opts.gate`: a promise the mocked storage read waits for — lets a test
 * reproduce a cold start where the waking event beats the rules load.
 * Deleted URLs are recorded on `sandbox.__deleted`.
 */
function load(sites = [], opts = {}) {
  const noop = () => {};
  const evt = () => {
    const listeners = [];
    return {
      addListener: (fn) => listeners.push(fn),
      fire: (...args) => listeners.map((fn) => fn(...args))
    };
  };
  const deleted = [];
  const menus = [];
  const localData = {};
  const opened = [];
  const chrome = {
    storage: {
      // Promise-form, as background.js uses (safe at minimum_chrome_version 111).
      sync: {
        get: async (_defaults) => {
          if (opts.gate) await opts.gate;
          return { sites };
        },
        set: noop
      },
      local: { get: async (d) => d, set: (items) => Object.assign(localData, items) },
      onChanged: evt()
    },
    alarms: { get: (_n, cb) => cb(undefined), create: noop, onAlarm: evt() },
    runtime: {
      onInstalled: evt(),
      onStartup: evt(),
      onMessage: evt(),
      openOptionsPage: () => opened.push(true)
    },
    history: { onVisited: evt(), deleteUrl: (arg) => deleted.push(arg.url), search: async () => [] },
    action: { onClicked: evt() },
    contextMenus: {
      removeAll: async () => menus.splice(0, menus.length),
      create: (props) => menus.push(props),
      onClicked: evt()
    },
    i18n: { getMessage: (key) => `<${key}>` }
  };
  const sandbox = {
    chrome,
    URL,
    console,
    __deleted: deleted,
    __menus: menus,
    __local: localData,
    __opened: opened
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return sandbox;
}

/** Lets pending storage reads (and the awaits gated on them) settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Would the extension delete `url` from history given `sites`? */
async function removes(sites, url) {
  const sandbox = load(sites);
  await flush(); // the initial rules load is async — let it land
  return sandbox.shouldRemove(url);
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

  it("matches the domain itself", async () => {
    assert.equal(await removes(rule, "https://example.com/anything"), true);
  });
  it("matches www and any subdomain", async () => {
    assert.equal(await removes(rule, "https://www.example.com/x"), true);
    assert.equal(await removes(rule, "https://deep.sub.example.com/x"), true);
  });
  it("is case-insensitive on the host", async () => {
    assert.equal(await removes(rule, "https://EXAMPLE.com/x"), true);
  });
  it("does not match look-alike domains", async () => {
    assert.equal(await removes(rule, "https://notexample.com/x"), false);
    assert.equal(await removes(rule, "https://myexample.com/"), false);
    assert.equal(await removes(rule, "https://example.com.evil.com/x"), false);
  });
});

// --- Path scoping --------------------------------------------------------

describe("path scoping", () => {
  const rule = [{ domain: "example.com", path: "/forum/", keepHomepage: false }];

  it("removes the section root and anything deeper", async () => {
    assert.equal(await removes(rule, "https://example.com/forum/"), true);
    assert.equal(await removes(rule, "https://example.com/forum/some-post"), true);
  });
  it("keeps pages outside the section", async () => {
    assert.equal(await removes(rule, "https://example.com/"), false);
    assert.equal(await removes(rule, "https://example.com/about"), false);
  });
  it("respects the '/' boundary — /forums is not in /forum/", async () => {
    assert.equal(await removes(rule, "https://example.com/forums"), false);
  });
  it("applies path scoping across subdomains", async () => {
    assert.equal(await removes(rule, "https://sub.example.com/forum/some-post"), true);
  });
});

// --- Specificity: the longer path wins -----------------------------------

describe("specificity (longest path wins)", () => {
  const rules = [
    { domain: "example.com", path: "/", keepHomepage: false },
    { domain: "example.com", path: "/forum/", keepHomepage: true }
  ];

  it("the more specific rule governs a URL that matches both", async () => {
    // /forum/ rule wins and keepHomepage keeps its root...
    assert.equal(await removes(rules, "https://example.com/forum/"), false);
    // ...but pages deeper than that root are still removed.
    assert.equal(await removes(rules, "https://example.com/forum/post"), true);
  });
  it("falls back to the domain rule elsewhere", async () => {
    assert.equal(await removes(rules, "https://example.com/about"), true);
  });
  it("findMatch returns the most specific rule object", async () => {
    const sandbox = load(rules);
    await flush();
    assert.equal(sandbox.findMatch("example.com", "/forum/post").path, "/forum/");
  });
});

// --- keep-root toggle ----------------------------------------------------

describe("keep-root toggle (path rule)", () => {
  const rule = [{ domain: "example.com", path: "/forum/", keepHomepage: true }];

  it("keeps the section root, with or without a trailing slash", async () => {
    assert.equal(await removes(rule, "https://example.com/forum/"), false);
    assert.equal(await removes(rule, "https://example.com/forum"), false);
  });
  it("removes anything nested under the root", async () => {
    assert.equal(await removes(rule, "https://example.com/forum/some-post"), true);
    assert.equal(await removes(rule, "https://example.com/forum/subforum/thread"), true);
  });
});

describe("keep-root toggle (bare domain = keep homepage)", () => {
  const rule = [{ domain: "example.com", path: "/", keepHomepage: true }];

  it("keeps the homepage", async () => {
    assert.equal(await removes(rule, "https://example.com/"), false);
    assert.equal(await removes(rule, "https://example.com"), false); // pathname is "/"
  });
  it("removes inner pages", async () => {
    assert.equal(await removes(rule, "https://example.com/p/abc123"), true);
  });
});

// --- No match / malformed input ------------------------------------------

describe("non-matches and bad input", () => {
  const rule = [{ domain: "example.com", path: "/", keepHomepage: false }];

  it("ignores URLs with no matching rule", async () => {
    assert.equal(await removes(rule, "https://other.com/"), false);
  });
  it("returns false for an unparseable URL", async () => {
    assert.equal(await removes(rule, "not a url"), false);
  });
  it("returns false when the rule list is empty", async () => {
    assert.equal(await removes([], "https://example.com/"), false);
  });
});

// --- Case-insensitivity ---------------------------------------------------
// Rules are stored lowercase (normalizePath lowercases) and shouldRemove
// lowercases the URL pathname before matching, so /Forum/post and /forum/post
// are the same place. URL paths are case-sensitive by spec; we deliberately
// ignore that — see docs/PRD.md.

describe("case-insensitive path matching", () => {
  const rule = [{ domain: "example.com", path: "/forum/", keepHomepage: false }];

  it("a rule matches mixed-case URL paths", async () => {
    assert.equal(await removes(rule, "https://example.com/Forum/post"), true);
    assert.equal(await removes(rule, "https://example.com/FORUM/"), true);
  });
  it("keep-root recognizes the section root in any case", async () => {
    const keep = [{ domain: "example.com", path: "/forum/", keepHomepage: true }];
    assert.equal(await removes(keep, "https://example.com/Forum/"), false);
    assert.equal(await removes(keep, "https://example.com/Forum/post"), true);
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

// --- Cold start (MV3 service worker wake) ----------------------------------
// A fresh worker starts with an empty rule list and loads it asynchronously,
// while Chrome delivers the event that woke the worker as soon as the
// top-level script finishes. The onVisited handler awaits the initial load,
// so the waking visit itself must still get deleted.

describe("cold start: waking visit races the rules load", () => {
  it("deletes the visit that woke the worker once rules finish loading", async () => {
    let releaseStorage;
    const gate = new Promise((resolve) => { releaseStorage = resolve; });
    const sandbox = load([{ domain: "example.com", path: "/", keepHomepage: false }], { gate });

    // The waking event arrives before the storage read has resolved.
    const handlers = sandbox.chrome.history.onVisited.fire({ url: "https://example.com/feed" });
    assert.deepEqual(sandbox.__deleted, []); // rules still loading — nothing deleted yet

    releaseStorage();
    await Promise.all(handlers);
    assert.deepEqual(sandbox.__deleted, ["https://example.com/feed"]);
  });
});

// --- "Add this site" from the page context menu ----------------------------
// The click handler is the only place that turns a page URL into a rule
// candidate. It must reduce the URL exactly like typing the domain by hand
// would, and refuse anything that can't be a rule.

describe("context menu: add the current site", () => {
  const CLICK = { menuItemId: "addSiteFromPage" };

  /** Fires a menu click on `pageUrl` in a fresh worker and settles it. */
  async function click(pageUrl, item = CLICK) {
    const sandbox = load();
    await Promise.all(
      sandbox.chrome.contextMenus.onClicked.fire({ ...item, pageUrl })
    );
    return sandbox;
  }

  it("registers one menu item, limited to http(s) pages", async () => {
    const sandbox = load();
    await Promise.all(sandbox.chrome.runtime.onInstalled.fire());
    await flush();
    assert.equal(sandbox.__menus.length, 1);
    // Spread first: arrays built inside the vm sandbox are cross-realm, so
    // deepEqual would reject them against plain host arrays.
    assert.deepEqual([...sandbox.__menus[0].documentUrlPatterns], ["http://*/*", "https://*/*"]);
    assert.deepEqual([...sandbox.__menus[0].contexts], ["page"]);
  });

  it("hands the bare domain to the settings page and opens it", async () => {
    const sandbox = await click("https://www.Reddit.com/r/news?sort=new#top");
    assert.equal(sandbox.__local.pendingSite, "reddit.com");
    assert.equal(sandbox.__opened.length, 1);
  });

  it("keeps subdomains — the rule the user sees is the host they were on", async () => {
    const sandbox = await click("https://news.example.co.uk/story/1");
    assert.equal(sandbox.__local.pendingSite, "news.example.co.uk");
  });

  it("ignores URLs that can't become a rule", async () => {
    for (const url of ["chrome://settings", "file:///c:/tmp/page.html", "not a url", ""]) {
      const sandbox = await click(url);
      assert.equal(sandbox.__local.pendingSite, undefined, url);
      assert.deepEqual(sandbox.__opened, [], url);
    }
  });

  it("ignores clicks on some other extension's menu item", async () => {
    const sandbox = await click("https://example.com/", { menuItemId: "somethingElse" });
    assert.equal(sandbox.__local.pendingSite, undefined);
    assert.deepEqual(sandbox.__opened, []);
  });
});
