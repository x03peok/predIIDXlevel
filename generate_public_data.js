"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { loadRows, normalizeTitle } = require("./generate_chart_pages.js");

const featureDefinitions = [
  { id: "chord", label: "同時押し" },
  { id: "single_note_rush", label: "単鍵ラッシュ" },
  { id: "density", label: "物量" },
  { id: "repeated_note", label: "連打" },
  { id: "scratch_chain", label: "連皿" },
  { id: "scratch_complex", label: "皿複合" },
  { id: "charge_note", label: "チャージノート" },
  { id: "bpm_change", label: "BPM変化" },
  { id: "hard_ending", label: "ラスト難" },
];
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const serialize = value => JSON.stringify(value) + "\n";

function buildCharts(rows) {
  const ids = new Set();
  const difficulties = new Set(["NORMAL", "HYPER", "ANOTHER", "LEGGENDARIA"]);
  const featuresByLabel = new Map(featureDefinitions.map(item => [item.label, item.id]));
  const charts = rows.map(row => {
    const id = String(row.chart_id).trim();
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || ids.has(id)) {
      throw new Error(`Invalid or duplicate chart ID: ${id}`);
    }
    ids.add(id);
    const title = normalizeTitle(row.title).trim();
    const difficulty = String(row.difficulty).toUpperCase();
    const level = Number(row.original_level);
    if (!title || !difficulties.has(difficulty) || !Number.isInteger(level) || level < 1 || level > 12) {
      throw new Error(`Invalid chart metadata: ${id}`);
    }
    const pred = {};
    for (const [mode, column] of [["easy", "easy_pred_skill"], ["normal", "calibrated_pred_skill"], ["hard", "hard_pred_skill"]]) {
      const raw = String(row[column] ?? "").trim();
      const value = raw === "" ? null : Number(raw);
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`Invalid ${mode} Pred for chart ${id}: ${raw}`);
      }
      pred[mode] = value;
    }
    const strengths = new Map();
    for (const token of String(row.features ?? "").split(/[、,]/).map(value => value.trim()).filter(Boolean)) {
      if (token === "特徴なし") continue;
      const match = /^(.*?)(\+{0,2})$/.exec(token);
      const featureId = match && featuresByLabel.get(match[1]);
      if (!featureId || strengths.has(featureId)) throw new Error(`Invalid feature for chart ${id}: ${token}`);
      strengths.set(featureId, match[2].length + 1);
    }
    const features = featureDefinitions.filter(item => strengths.has(item.id))
      .map(item => ({ id: item.id, strength: strengths.get(item.id) }));
    return { id, title, difficulty, level, pred, features };
  });
  if (!charts.length) throw new Error("Refusing to publish an empty dataset.");
  return charts.sort((a, b) => Number(a.id) - Number(b.id));
}

function buildContent(rows) {
  return {
    schemaVersion: 1,
    documentation: "https://cpi-next.com/data-guide.html",
    usage: { commercialUse: false, redistribution: false, attributionRequired: true },
    featureDefinitions,
    charts: buildCharts(rows),
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeChanged(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, "utf8");
  fs.renameSync(temporary, file);
}

function generatePublicData(rootDir = __dirname, options = {}) {
  const rows = options.rows ?? loadRows(path.join(rootDir, "data.js"), options.sourceText);
  const content = buildContent(rows);
  const contentSha256 = sha256(serialize(content));
  const directory = path.join(rootDir, "data", "v1");
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : { schemaVersion: 1, latest: null, versions: [] };
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.versions)) throw new Error("Invalid public data manifest.");
  for (const entry of manifest.versions) {
    if (!/^\d{8}-[a-f0-9]{12}$/.test(entry.dataVersion) || entry.url !== `versions/${entry.dataVersion}.json`) {
      throw new Error("Invalid public data version entry.");
    }
  }

  let entry = manifest.versions.find(item => item.contentSha256 === contentSha256);
  let snapshotText;
  if (entry) {
    snapshotText = fs.readFileSync(path.join(directory, entry.url), "utf8");
    if (sha256(snapshotText) !== entry.sha256) throw new Error(`Snapshot checksum mismatch: ${entry.dataVersion}`);
    const snapshot = JSON.parse(snapshotText);
    const { dataVersion, updatedAt, chartCount, ...storedContent } = snapshot;
    if (dataVersion !== entry.dataVersion || chartCount !== content.charts.length || sha256(serialize(storedContent)) !== contentSha256) {
      throw new Error(`Snapshot contents mismatch: ${entry.dataVersion}`);
    }
  } else {
    if (options.check) throw new Error("Public JSON is stale. Run node generate_public_data.js.");
    const now = options.now ?? new Date();
    const date = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
    const dataVersion = `${date}-${contentSha256.slice(0, 12)}`;
    const updatedAt = now.toISOString();
    snapshotText = serialize({ dataVersion, updatedAt, chartCount: content.charts.length, ...content });
    entry = { dataVersion, updatedAt, chartCount: content.charts.length,
      url: `versions/${dataVersion}.json`, sha256: sha256(snapshotText), contentSha256 };
    const archivePath = path.join(directory, entry.url);
    if (fs.existsSync(archivePath)) throw new Error(`Refusing to overwrite snapshot: ${dataVersion}`);
    writeChanged(archivePath, snapshotText);
    manifest.versions.unshift(entry);
  }

  const latestPath = path.join(directory, "latest.json");
  manifest.latest = entry.dataVersion;
  if (options.check) {
    if (fs.readFileSync(latestPath, "utf8") !== snapshotText || fs.readFileSync(manifestPath, "utf8") !== serialize(manifest)) {
      throw new Error("Public data latest/manifest is stale.");
    }
    for (const version of manifest.versions) {
      if (sha256(fs.readFileSync(path.join(directory, version.url))) !== version.sha256) {
        throw new Error(`Snapshot checksum mismatch: ${version.dataVersion}`);
      }
    }
  } else {
    writeChanged(latestPath, snapshotText);
    writeChanged(manifestPath, serialize(manifest));
  }
  console.log(`Public data: ${entry.dataVersion} (${entry.chartCount} charts).`);
  return entry;
}

function runPreCommit(rootDir = __dirname) {
  const git = args => execFileSync("git", args, { cwd: rootDir, encoding: "utf8" });
  const stagedFiles = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).split(/\r?\n/);
  if (!stagedFiles.some(file => ["data.js", "generate_public_data.js", "generate_chart_pages.js"].includes(file))) return;
  // Read the index so a partially staged data.js exports exactly the committed dataset.
  const sourceText = git(["show", ":data.js"]);
  generatePublicData(rootDir, { sourceText });
  git(["add", "--", "data/v1"]);
}

module.exports = { buildCharts, buildContent, generatePublicData, runPreCommit };
if (require.main === module) {
  try {
    if (process.argv.includes("--staged")) runPreCommit();
    else generatePublicData(__dirname, { check: process.argv.includes("--check") });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
