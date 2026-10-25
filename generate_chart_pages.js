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
    AElig: "Æ",
    Oslash: "Ø",
    Uuml: "Ü",
    aelig: "æ",
    atilde: "ã",
    auml: "ä",
    eacute: "é",
    ecirc: "ê",
    hearts: "♥",
    iexcl: "¡",
    ouml: "ö",
  };

  return String(value ?? "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, token) => {
    const lowerToken = token.toLowerCase();
    if (lowerToken.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lowerToken.slice(2), 16));
    }
    if (lowerToken.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(lowerToken.slice(1), 10));
    }
    return namedEntities[token] ?? namedEntities[lowerToken] ?? match;
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
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? (Math.round(numeric * 100) / 100).toFixed(2) : String(value ?? "");
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

function loadRows(sourcePath = dataPath, sourceText = fs.readFileSync(sourcePath, "utf8")) {
  const context = { window: {} };
  vm.runInNewContext(sourceText, context, { filename: sourcePath, timeout: 5000 });
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
    "easy_pred_skill",
    "calibrated_pred_skill",
    "hard_pred_skill",
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
  const pageTitle = `${displayTitle}｜${siteTitle}`;
  const description = `${displayTitle}。ノマゲPred ${pred} / BPM ${bpm} / Feature ${feature}`;
  const canonicalUrl = `${publicBaseUrl}chart-pages/${encodeURIComponent(chartId)}.html`;
  const metadata = [
    `  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    `  <meta name="robots" content="index,follow">`,
    `  <meta property="og:type" content="article">`,
    `  <meta property="og:site_name" content="${escapeHtml(siteTitle)}">`,
    `  <meta property="og:title" content="${escapeHtml(pageTitle)}">`,
    `  <meta property="og:description" content="${escapeHtml(description)}">`,
    `  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">`,
    `  <meta property="og:locale" content="ja_JP">`,
    `  <meta name="twitter:card" content="summary">`,
    `  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">`,
    `  <meta name="twitter:description" content="${escapeHtml(description)}">`,
  ].join("\n");

  let page = template;
  page = page.replace(/  <title>[\s\S]*?<\/title>/, `  <title>${escapeHtml(pageTitle)}</title>`);
  page = page.replace(/  <meta name="description"[^>]*>/, `  <meta name="description" content="${escapeHtml(description)}">`);
  page = replaceOnce(page, "  <!-- Google Analytics -->", `${metadata}\n  <!-- Google Analytics -->`, "OGP");
  page = page.replace('<body data-page="chart">', `<body data-page="chart" data-static-chart-page="true" data-chart-id="${escapeHtml(chartId)}">`);
  page = page.replace('href="styles.css?', 'href="../styles.css?');
  page = page.replace('href="menu.css?v=20260904-2"', 'href="../menu.css?v=20260904-2"');
  page = page.replace('src="menu.js?', 'src="../menu.js?');
  page = page.replace('src="analytics.js?', 'src="../analytics.js?');
  page = page.replace('src="data.js?', 'src="../data.js?');
  page = page.replace('src="chart-similar-data.js?', 'src="../chart-similar-data.js?');
  page = page.replace('src="chart.js?', 'src="../chart.js?');
  page = page.replace('src="chart-options.js?', 'src="../chart-options.js?');
  page = page.replace('src="share-text.js?', 'src="../share-text.js?');
  page = page.replace('src="storage.js?', 'src="../storage.js?');
  page = page.replace('src="update-history.js?', 'src="../update-history.js?');
  page = page.replace('data-href="pred.html"', 'data-href="../pred.html"');
  page = page.replace('data-href="about.html"', 'data-href="../about.html"');
  page = page.replace('data-href="diagnosis.html"', 'data-href="../diagnosis.html"');
  page = page.replace('href="pred.html"', 'href="../pred.html"');
  page = page.replaceAll('href="site-icon.jpg"', 'href="../site-icon.jpg"');
  return page;
}

function updateChartSitemap(rows) {
  const sitemapPath = path.join(rootDir, "sitemap.xml");
  const existing = fs.readFileSync(sitemapPath, "utf8");
  const withoutCharts = existing.replace(/^[ \t]*<url><loc>https:\/\/cpi-next\.com\/chart-pages\/\d+\.html<\/loc><\/url>\r?\n/gm, "");
  const entries = rows.map(row => `  <url><loc>${publicBaseUrl}chart-pages/${row.chart_id}.html</loc></url>`).join("\n");
  fs.writeFileSync(sitemapPath, withoutCharts.replace("</urlset>", `${entries}\n</urlset>`), "utf8");
}

module.exports = { loadRows, normalizeTitle };

if (require.main === module) {
  require("./generate_public_data.js").generatePublicData(rootDir);
  const template = fs.readFileSync(templatePath, "utf8");
  const requestedIds = process.argv.find(argument => argument.startsWith("--ids="));
  const selectedIds = requestedIds ? new Set(requestedIds.slice(6).split(",")) : null;
  const rows = loadRows().filter(row => !selectedIds || selectedIds.has(String(row.chart_id)));
  fs.mkdirSync(outputDir, { recursive: true });
  for (const row of rows) {
    const chartId = String(row.chart_id).trim();
    fs.writeFileSync(path.join(outputDir, `${chartId}.html`), createPage(template, row), "utf8");
  }
  if (!selectedIds) updateChartSitemap(rows);
  console.log(`Generated ${rows.length} chart pages in ${path.relative(rootDir, outputDir)}.`);
}
