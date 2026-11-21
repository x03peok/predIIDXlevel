"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildCharts } = require("./generate_public_data.js");
const { loadRows, readChartPlatforms } = require("./generate_chart_pages.js");

function readCsv(text) {
  const records = [];
  let row = [], cell = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some(value => value !== "")) records.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (cell || row.length) { row.push(cell); records.push(row); }
  const headers = records.shift();
  if (!headers?.length || new Set(headers).size !== headers.length) throw new Error("Invalid CSV header.");
  return records.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Invalid CSV row ${index + 2}.`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
}

function hasFeatureMetrics(row) {
  return Object.keys(row).some(key => /^(easy|normal|hard)_.+_(amount|impact)_sd$/.test(key));
}

function normalizeSourceTitle(title, chartId) {
  // Restore the known song title when spreadsheet software converts it to a date.
  return ["6042", "6043"].includes(String(chartId)) && title === "9月1日" ? "9-1" : title;
}

function normalizeRows(source, existingPlatforms = new Map()) {
  const rows = source.map(row => {
    const match = String(row.bpm ?? "").trim().match(/^(\d+(?:\.\d+)?)(?:[~\uFF5E\u301C-](\d+(?:\.\d+)?))?$/);
    if (row.bpm && !match) throw new Error(`Invalid BPM for chart ${row.chart_id}.`);
    if (match && Number(match[1]) > Number(match[2] ?? match[1])) throw new Error(`Reversed BPM for chart ${row.chart_id}.`);
    return {
      chart_id: row.chart_id,
      title: normalizeSourceTitle(row.title, row.chart_id),
      difficulty: row.diff_label_from_query,
      original_level: row.level_from_query,
      easy_pred_skill: row.EASY_Pred,
      calibrated_pred_skill: row.CLEAR_Pred,
      hard_pred_skill: row.HARD_Pred,
      features: row["1SD\u4ee5\u4e0a\u306e\u8981\u7d20"] ?? (hasFeatureMetrics(row) ? "" : undefined),
      bpm_min: match?.[1] ?? "",
      bpm_max: match ? match[2] ?? match[1] : "",
      official_title: normalizeSourceTitle(row.official_title, row.chart_id),
      official_version: row.official_version,
      url: row.url,
      platforms: readChartPlatforms(
        row.platform ?? row.platforms ?? existingPlatforms.get(String(row.chart_id).trim()),
        row.chart_id,
      ).join("|"),
    };
  });
  if (!rows.length || rows.some(row => Object.values(row).some(value => value === undefined))) {
    throw new Error("Missing chart data or required source columns.");
  }
  if (rows.some(row => !row.official_version.trim())) throw new Error("Missing official_version.");
  buildCharts(rows);
  return rows;
}

function buildStageRows(courses, charts, existing) {
  const byId = new Map(charts.map(row => [row.chart_id, row]));
  const versions = new Set(courses.map(row => row.version));
  const seen = new Set();
  if (!courses.length) throw new Error("Missing stage data.");
  const stages = courses.flatMap(course => {
    const key = `${course.version}:${course.course}`;
    if (!course.version || !course.course || seen.has(key)) throw new Error(`Invalid course: ${key}`);
    seen.add(key);
    return [1, 2, 3, 4].map(stage => {
      const chart = byId.get(course[`stage_${stage}_chart_id`]);
      const pred = course[`skill_after_${stage}`];
      if (!chart || !pred?.trim() || !Number.isFinite(Number(pred)) || Number(pred) <= 0) {
        throw new Error(`Invalid stage ${stage} of ${key}.`);
      }
      return { version: course.version, class: course.course,
        stage: ["1st", "2nd", "3rd", "FINAL"][stage - 1],
        title: chart.title, difficulty: chart.difficulty, level: chart.original_level,
        chart_id: chart.chart_id, pred };
    });
  });
  return [...existing.filter(row => !versions.has(row.version)), ...stages];
}

function serializeCsv(rows) {
  const headers = Object.keys(rows[0]);
  const escape = value => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  return [headers.join(","), ...rows.map(row => headers.map(key => escape(row[key])).join(","))].join("\r\n") + "\r\n";
}

function importDataset(directory, root = __dirname, elementsPath) {
  const source = readCsv(fs.readFileSync(path.join(directory, "data.csv"), "utf8"));
  const dataPath = path.join(root, "data.js");
  const existingPlatforms = new Map();
  if (source.length && !Object.hasOwn(source[0], "platform") && !Object.hasOwn(source[0], "platforms") && fs.existsSync(dataPath)) {
    const existingData = fs.readFileSync(dataPath, "utf8");
    if (existingData.includes("__CSV_BUNDLE__")) {
      for (const row of loadRows(dataPath, existingData)) {
        existingPlatforms.set(row.chart_id, row.platforms.join("|"));
      }
    }
  }
  let charts = normalizeRows(source, existingPlatforms);
  const courses = readCsv(fs.readFileSync(path.join(directory, "stage_skills.csv"), "utf8"));
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "danilabo-data.js"), "utf8"), context, { timeout: 5000 });
  const stages = buildStageRows(courses, charts, context.window.__DANILABO_ROWS__);
  let bundles = null;
  const legacyElementsPath = path.join(directory, "chart_elements_48.csv");
  const elements = elementsPath !== undefined
    ? readCsv(fs.readFileSync(elementsPath, "utf8"))
    : source.some(hasFeatureMetrics)
      ? source
      : fs.existsSync(legacyElementsPath)
        ? readCsv(fs.readFileSync(legacyElementsPath, "utf8"))
        : null;
  if (elements) {
    const { buildFeatureDataset, serializeFeatureBundles } = require("./generate_feature_data.js");
    const result = buildFeatureDataset(charts, elements);
    charts = result.charts;
    bundles = serializeFeatureBundles(result);
  } else if (fs.existsSync(path.join(root, "feature-data.js"))) {
    throw new Error("Continuous Feature data requires embedded metrics, chart_elements_48.csv, or an explicit metrics CSV argument. No files were changed.");
  }
  // Validate both sources before replacing either runtime bundle.
  fs.writeFileSync(dataPath, bundles?.charts ?? `window.__CSV_BUNDLE__ = ${JSON.stringify(serializeCsv(charts))};\n`);
  if (bundles) fs.writeFileSync(path.join(root, "feature-data.js"), bundles.corrections);
  fs.writeFileSync(path.join(root, "danilabo-data.js"), `window.__DANILABO_ROWS__ = ${JSON.stringify(stages)};\n`);
  console.log(`Imported ${charts.length} charts and ${courses.length} courses (${stages.length} stages including retained versions).`);
}

module.exports = { readCsv, normalizeRows, buildStageRows, serializeCsv, importDataset };
if (require.main === module) {
  if (!process.argv[2]) throw new Error("Usage: node import_dataset.js <source-directory> [private-chart-elements-csv]");
  importDataset(path.resolve(process.argv[2]), __dirname, process.argv[3] ? path.resolve(process.argv[3]) : undefined);
}
