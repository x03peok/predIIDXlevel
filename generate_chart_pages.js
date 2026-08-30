"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = __dirname;
const templatePath = path.join(rootDir, "chart.html");
const dataPath = path.join(rootDir, "data.js");
const outputDir = path.join(rootDir, "chart-pages");
const publicBaseUrl = "https://cpi-next.com/";
const siteTitle = "CPI:Next";
const difficultyLabels = {
  NORMAL: "N",
  HYPER: "H",
  ANOTHER: "A",
  LEGGENDARIA: "L",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === "\"" && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else if (character === "\"") {
        inQuotes = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === "\"") {
      inQuotes = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  rows.push(row);
  if (rows.at(-1)?.length === 1 && rows.at(-1)[0] === "") {
    rows.pop();
  }
  return rows;
}

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  return String(value ?? "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, token) => {
    const lowerToken = token.toLowerCase();
    if (lowerToken.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lowerToken.slice(2), 16));
    }
    if (lowerToken.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(lowerToken.slice(1), 10));
    }
    return namedEntities[lowerToken] ?? match;
  });
}

function normalizeTitle(value) {
  const decoded = decodeHtmlEntities(value);
  const stripped = decoded.replace(/<\/?[A-Za-z][^>]*>/g, "");
  return decodeHtmlEntities(stripped);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatPred(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? (Math.round(numeric * 10) / 10).toFixed(1) : String(value ?? "");
}

function formatBpm(row) {
  const min = String(row.bpm_min ?? "").trim();
  const max = String(row.bpm_max ?? "").trim();
  return min && min === max ? min : `${min}~${max}`;
}

function replaceOnce(source, search, replacement, label) {
  const firstIndex = source.indexOf(search);
  if (firstIndex < 0 || firstIndex !== source.lastIndexOf(search)) {
    throw new Error(`Expected exactly one ${label} marker.`);
  }
  return source.slice(0, firstIndex) + replacement + source.slice(firstIndex + search.length);
}

function loadRows() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(dataPath, "utf8"), context, { filename: dataPath });
  const csvText = context.window.__CSV_BUNDLE__;
  if (typeof csvText !== "string") {
    throw new Error("data.js does not contain the CSV bundle.");
  }

  const parsed = parseCsv(csvText);
  const headers = parsed.shift().map((header) => header.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const requiredHeaders = [
    "chart_id",
    "title",
    "difficulty",
    "original_level",
    "calibrated_pred_skill",
    "features",
    "bpm_min",
    "bpm_max",
  ];
  for (const header of requiredHeaders) {
    if (!headerIndex.has(header)) {
      throw new Error(`Missing required column: ${header}`);
    }
  }

  return parsed.map((cells) => Object.fromEntries(requiredHeaders.map((header) => [
    header,
    (cells[headerIndex.get(header)] ?? "").trim(),
  ])));
}

function createPage(template, row) {
  const chartId = String(row.chart_id).trim();
  if (!/^\d+$/.test(chartId)) {
    throw new Error(`Invalid chart_id: ${chartId}`);
  }

  const title = normalizeTitle(row.title);
  const level = `\u2606${row.original_level}`;
  const difficulty = difficultyLabels[String(row.difficulty).trim().toUpperCase()] ?? "";
  const pred = formatPred(row.calibrated_pred_skill);
  const bpm = formatBpm(row);
  const feature = String(row.features ?? "").trim() || "\u7279\u5fb4\u306a\u3057";
  const displayTitle = `${level} ${title}${difficulty ? ` [${difficulty}]` : ""}`;
  const pageTitle = `${displayTitle} | ${siteTitle}`;
  const description = `${displayTitle}。Pred ${pred} / BPM ${bpm} / Feature ${feature}`;
  const canonicalUrl = `${publicBaseUrl}chart-pages/${encodeURIComponent(chartId)}.html`;
  const metadata = [
    `  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    `  <meta name="robots" content="index,follow">`,
    `  <meta property="og:type" content="article">`,
    `  <meta property="og:site_name" content="${escapeHtml(siteTitle)}">`,
    `  <meta property="og:title" content="${escapeHtml(displayTitle)}">`,
    `  <meta property="og:description" content="${escapeHtml(description)}">`,
    `  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">`,
    `  <meta property="og:locale" content="ja_JP">`,
    `  <meta name="twitter:card" content="summary">`,
    `  <meta name="twitter:title" content="${escapeHtml(displayTitle)}">`,
    `  <meta name="twitter:description" content="${escapeHtml(description)}">`,
  ].join("\n");

  let page = template;
  page = page.replace(/  <title>[\s\S]*?<\/title>/, `  <title>${escapeHtml(pageTitle)}</title>`);
  page = page.replace(/  <meta name="description"[^>]*>/, `  <meta name="description" content="${escapeHtml(description)}">`);
  page = replaceOnce(page, "  <!-- Google Analytics -->", `${metadata}\n  <!-- Google Analytics -->`, "OGP");
  page = page.replace('<body data-page="chart">', `<body data-page="chart" data-static-chart-page="true" data-chart-id="${escapeHtml(chartId)}">`);
  page = page.replace('href="styles.css?', 'href="../styles.css?');
  page = page.replace('href="menu.css"', 'href="../menu.css"');
  page = page.replace('src="menu.js"', 'src="../menu.js"');
  page = page.replace('src="analytics.js?', 'src="../analytics.js?');
  page = page.replace('src="data.js?', 'src="../data.js?');
  page = page.replace('src="chart.js?', 'src="../chart.js?');
  page = page.replace('data-href="index.html"', 'data-href="../index.html"');
  page = page.replace('data-href="about.html"', 'data-href="../about.html"');
  page = page.replace('data-href="diagnosis.html"', 'data-href="../diagnosis.html"');
  page = page.replace('data-href="history.html"', 'data-href="../history.html"');
  page = page.replace('href="index.html"', 'href="../index.html"');
  return page;
}

const template = fs.readFileSync(templatePath, "utf8");
const rows = loadRows();
fs.mkdirSync(outputDir, { recursive: true });
for (const row of rows) {
  const chartId = String(row.chart_id).trim();
  fs.writeFileSync(path.join(outputDir, `${chartId}.html`), createPage(template, row), "utf8");
}
console.log(`Generated ${rows.length} chart pages in ${path.relative(rootDir, outputDir)}.`);
