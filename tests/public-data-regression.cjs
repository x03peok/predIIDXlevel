"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { buildCharts, generatePublicData } = require("../generate_public_data.js");

const row = overrides => ({ chart_id: "1", title: "A &amp; B", difficulty: "ANOTHER", original_level: "11",
  easy_pred_skill: "10.1", calibrated_pred_skill: "11.2", hard_pred_skill: "12.3",
  features: "皿複合+、チャージノート++", ...overrides });
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));

test("exports stable chart IDs, decoded titles, numeric Pred and feature strengths", () => {
  const charts = buildCharts([row({ chart_id: "2", title: "&AElig; &Oslash; &Uuml; &ecirc;", features: "", easy_pred_skill: "" }), row()]);
  assert.deepEqual(charts.map(chart => chart.id), ["1", "2"]);
  assert.equal(charts[0].title, "A & B");
  assert.deepEqual(charts[0].pred, { easy: 10.1, normal: 11.2, hard: 12.3 });
  assert.deepEqual(charts[0].features, [{ id: "scratch_complex", strength: 2 }, { id: "charge_note", strength: 3 }]);
  assert.equal(charts[1].title, "Æ Ø Ü ê");
  assert.equal(charts[1].pred.easy, null);
  assert.deepEqual(charts[1].features, []);
  for (const rows of [[row(), row()], [row({ calibrated_pred_skill: "NaN" })], [row({ features: "unknown" })], [row({ features: "物量+++" })]]) {
    assert.throws(() => buildCharts(rows));
  }
});

test("exports all missing Pred values as null without dropping chart metadata", () => {
  const [chart] = buildCharts([row({ easy_pred_skill: "", calibrated_pred_skill: "", hard_pred_skill: "" })]);
  assert.equal(chart.id, "1");
  assert.deepEqual(chart.pred, { easy: null, normal: null, hard: null });
});

test("versions are idempotent, immutable, verified and reused when reverting", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cpi-public-data-"));
  try {
    const root = path.join(directory, "data", "v1");
    const first = generatePublicData(directory, { rows: [row()], now: new Date("2026-10-15T16:00:00Z") });
    assert.match(first.dataVersion, /^20261016-/);
    const original = fs.readFileSync(path.join(root, first.url), "utf8");
    const repeat = generatePublicData(directory, { rows: [row({ features: "チャージノート++、皿複合+" })], now: new Date("2026-10-20T00:00:00Z") });
    assert.deepEqual(repeat, first);
    assert.equal(read(path.join(root, "manifest.json")).versions.length, 1);
    generatePublicData(directory, { rows: [row()], check: true });
    assert.throws(() => generatePublicData(directory, { rows: [row({ hard_pred_skill: "12.5" })], check: true }), /stale/);
    const second = generatePublicData(directory, { rows: [row({ hard_pred_skill: "12.5" })], now: new Date("2026-10-21T00:00:00Z") });
    assert.notEqual(second.dataVersion, first.dataVersion);
    assert.equal(fs.readFileSync(path.join(root, first.url), "utf8"), original);
    assert.equal(read(path.join(root, "latest.json")).usage.redistribution, false);
    generatePublicData(directory, { rows: [row()] });
    assert.equal(read(path.join(root, "manifest.json")).latest, first.dataVersion);
    assert.equal(read(path.join(root, "manifest.json")).versions.length, 2);
    generatePublicData(directory, { rows: [row()], check: true });
    fs.appendFileSync(path.join(root, second.url), " ");
    assert.throws(() => generatePublicData(directory, { rows: [row()], check: true }), /checksum mismatch/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the commit hook generates JSON from staged data, including partial staging", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cpi-public-hook-"));
  const sourceRoot = path.resolve(__dirname, "..");
  const git = args => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const csvBundle = level => {
    const item = row({ features: "", original_level: String(level) });
    const csv = Object.keys(item).concat("bpm_min", "bpm_max").join(",") + "\n" + Object.values(item).concat("120", "120").join(",") + "\n";
    return "window.__CSV_BUNDLE__ = " + JSON.stringify(csv) + ";\n";
  };
  try {
    git(["init"]);
    git(["config", "user.name", "Public Data Test"]);
    git(["config", "user.email", "test@example.invalid"]);
    git(["config", "core.hooksPath", ".githooks"]);
    fs.mkdirSync(path.join(directory, ".githooks"));
    for (const file of ["generate_public_data.js", "generate_chart_pages.js", ".githooks/pre-commit"]) {
      fs.copyFileSync(path.join(sourceRoot, file), path.join(directory, file));
    }
    fs.chmodSync(path.join(directory, ".githooks/pre-commit"), 0o755);
    fs.writeFileSync(path.join(directory, "data.js"), csvBundle(11));
    git(["add", "."]);
    fs.writeFileSync(path.join(directory, "data.js"), csvBundle(12));
    git(["-c", "commit.gpgsign=false", "commit", "-m", "Test automatic public data generation"]);
    const published = JSON.parse(git(["show", "HEAD:data/v1/latest.json"]));
    assert.equal(published.charts[0].level, 11);
    assert.equal(published.usage.commercialUse, false);
    assert.match(git(["status", "--short"]), / M data.js/);
    assert.equal(fs.existsSync(path.join(directory, "chart-pages")), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
