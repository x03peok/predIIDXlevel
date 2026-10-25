"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadRows } = require("../generate_chart_pages.js");
const root = path.resolve(__dirname, "..");

test("generated chart pages contain complete cards without running JavaScript", () => {
  const rows = new Map(loadRows().map(row => [row.chart_id, row]));
  for (const id of ["1", "3155", "6144"]) {
    const source = fs.readFileSync(path.join(root, "chart-pages", id + ".html"), "utf8");
    const head = source.slice(0, source.indexOf("</head>"));
    const metas = new Map();
    for (const [, key, content] of head.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)">/g)) {
      assert(!metas.has(key), id + ": duplicate " + key);
      metas.set(key, content);
    }
    const url = "https://cpi-next.com/chart-pages/" + id + ".html";
    assert(head.includes('<link rel="canonical" href="' + url + '">'));
    assert.equal(metas.get("og:url"), url);
    assert.equal(metas.get("twitter:card"), "summary");
    assert(metas.get("twitter:title").includes(rows.get(id).title));
    assert.equal(metas.get("og:title"), metas.get("twitter:title"));
    assert.equal(metas.get("og:description"), metas.get("twitter:description"));
    for (const label of ["イージーPred", "ノマゲPred", "ハードPred"]) {
      assert(metas.get("twitter:description").includes(label));
      if (id === "6144") assert(metas.get("twitter:description").includes(label + " —"));
    }
    for (const key of ["og:image", "og:image:secure_url", "twitter:image"]) {
      assert.equal(metas.get(key), "https://cpi-next.com/site-icon.jpg");
    }
    assert.equal(metas.get("og:image:type"), "image/jpeg");
    assert(!/noindex|nofollow/.test(metas.get("robots")));
    assert(!head.includes("utm_"));
  }
});
