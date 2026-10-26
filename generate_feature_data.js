"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");

const featureNames = ["同時押し", "単鍵ラッシュ", "物量", "連打", "連皿", "皿複合", "チャージノート", "BPM変化", "ラスト難"];
const modes = ["easy", "normal", "hard"];
const clip = value => Math.max(-4, Math.min(4, value));

function number(value, label) {
  if (value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Feature value: ${label}`);
  return parsed;
}

function buildFeatureDataset(charts, elements) {
  const byId = new Map();
  for (const element of elements) {
    const id = String(element.chart_id ?? "").trim();
    if (!/^[1-9]\d*$/.test(id) || byId.has(id)) throw new Error(`Invalid or duplicate Feature chart ID: ${id}`);
    byId.set(id, element);
  }
  if (!charts.length || byId.size !== charts.length) throw new Error("Feature/chart dataset coverage mismatch.");
  const corrections = {};
  const updatedCharts = charts.map(chart => {
    const id = String(chart.chart_id);
    const element = byId.get(id);
    if (!element || element.difficulty !== chart.difficulty
      || (String(element.level).trim() && Number(element.level) !== Number(chart.original_level))) {
      throw new Error(`Feature chart metadata mismatch: ${id}`);
    }
    const inputs = featureNames.map(feature => modes.map(mode => {
      const key = `${mode}_${feature}_amount_sd`;
      if (!Object.hasOwn(element, key)) throw new Error(`Missing Feature column: ${key}`);
      return { amount: number(element[key], `${id}:${key}`),
        impact: number(element[`${mode}_${feature}_impact_sd`], `${id}:${mode}:${feature}:impact`) };
    }));
    const empty = inputs.every(values => values.every(({ amount, impact }) => amount === null && impact === null));
    if (!empty && inputs.some(values => values.some(({ amount }) => amount === null))) {
      throw new Error(`Partially missing Feature amounts: ${id}`);
    }
    if (empty && [chart.easy_pred_skill, chart.calibrated_pred_skill, chart.hard_pred_skill]
      .some(value => String(value ?? "").trim() !== "")) {
      throw new Error(`Missing Feature values for a calculated chart: ${id}`);
    }
    corrections[id] = empty ? null : modes.map((_, modeIndex) => inputs.map(values => {
      const { amount, impact } = values[modeIndex];
      return clip(impact ?? amount);
    }));
    const tags = empty ? [] : inputs.flatMap((values, index) => {
      // Average unmodified SD values first; clipping each input would be method B.
      const numbers = values.flatMap(({ amount, impact }) => impact === null ? [amount] : [amount, impact]);
      const score = clip(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
      return score < 1 ? [] : [featureNames[index] + "+".repeat(score >= 3 ? 2 : score >= 2 ? 1 : 0)];
    });
    return { ...chart, features: tags.join("、") };
  });
  const id = crypto.createHash("sha256").update(JSON.stringify({ charts: updatedCharts, corrections })).digest("hex").slice(0, 16);
  return { charts: updatedCharts, data: { version: 1, id, features: featureNames, modes, charts: corrections } };
}

function serializeFeatureBundles(result) {
  const { serializeCsv } = require("./import_dataset.js");
  return {
    charts: `window.__CSV_BUNDLE__ = ${JSON.stringify(serializeCsv(result.charts))};\nwindow.__FEATURE_DATA_ID__ = ${JSON.stringify(result.data.id)};\n`,
    corrections: `window.__FEATURE_DATA__ = ${JSON.stringify(result.data)};\n`,
  };
}

function generateFeatureData(source, root = __dirname) {
  const { readCsv } = require("./import_dataset.js");
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "data.js"), "utf8"), context, { timeout: 5000 });
  const result = buildFeatureDataset(readCsv(context.window.__CSV_BUNDLE__), readCsv(fs.readFileSync(source, "utf8")));
  const bundles = serializeFeatureBundles(result);
  fs.writeFileSync(path.join(root, "data.js"), bundles.charts);
  fs.writeFileSync(path.join(root, "feature-data.js"), bundles.corrections);
  console.log(`Generated Feature tags and clipped gauge vectors for ${result.charts.length} charts (${result.data.id}).`);
  return result;
}

module.exports = { featureNames, modes, clip, buildFeatureDataset, serializeFeatureBundles, generateFeatureData };
if (require.main === module) {
  if (!process.argv[2]) throw new Error("Usage: node generate_feature_data.js <private-chart-elements-csv>");
  generateFeatureData(path.resolve(process.argv[2]));
}
