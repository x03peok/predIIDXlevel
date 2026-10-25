"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.TEST_BROWSER || "msedge", headless: true });
    const context = await browser.newContext();
    const base = "http://127.0.0.1:" + server.address().port;
    await context.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/" + (process.env.PRED_TEST_PAGE || "pred.html"));
    await page.waitForSelector("#tableBody tr", { state: "attached" });
    await page.locator("#predSummaryTab").click();
    assert.deepEqual(await page.locator('input[name="predSummaryLevel"]:checked').evaluateAll(inputs => inputs.map(input => input.value)), ["8"]);
    assert.equal(await page.locator('input[name="predSummaryLamp"]:checked').inputValue(), "normal");
    const verifyGroups = async (levels, mode) => {
      const result = await page.evaluate(({ levels, mode }) => {
        const key = { easy: "easy_pred_skill", normal: "calibrated_pred_skill", hard: "hard_pred_skill" }[mode];
        const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
        const groups = [...document.querySelectorAll(".pred-summary__group")];
        const headings = groups.map(group => group.querySelector("h2").textContent);
        const selected = new Map(state.rows.map(row => [String(row.chart_id), row]));
        const rendered = groups.flatMap(group => [...group.querySelectorAll("a")].map(link => ({
          row: selected.get(link.dataset.chartId), heading: group.querySelector("h2").textContent,
        })));
        return {
          count: rendered.length,
          expectedCount: state.rows.filter(row => levels.includes(Number(row.original_level))).length,
          binsCorrect: rendered.every(({ row, heading }) => {
            const bin = predSummaryGetBin(row[key]);
            return heading === (bin === null ? "\u672a\u7b97\u51fa" : (bin / 10).toFixed(1));
          }),
          namesSorted: [...document.querySelectorAll(".pred-summary__songs")].every(list => {
            const names = [...list.querySelectorAll("a")].map(link => link.textContent);
            return names.every((name, index) => !index || collator.compare(names[index - 1], name) <= 0);
          }),
          levelGroupsCorrect: levels.length === 1
            ? document.querySelectorAll(".pred-summary__level-group").length === 0
            : groups.every(group => {
              const sections = [...group.querySelectorAll(".pred-summary__level-group")];
              return sections.length > 0 && sections.every((section, index) => {
                const level = Number(section.dataset.level);
                return (!index || Number(sections[index - 1].dataset.level) < level)
                  && [...section.querySelectorAll("a")].every(link => Number(selected.get(link.dataset.chartId).original_level) === level);
              });
            }),
          headingsSorted: headings.every((heading, index) => !index || heading === "\u672a\u7b97\u51fa" || Number(headings[index - 1]) <= Number(heading)),
        };
      }, { levels, mode });
      assert.equal(result.count, result.expectedCount);
      assert.equal(result.binsCorrect && result.namesSorted && result.headingsSorted && result.levelGroupsCorrect, true);
    };
    await verifyGroups([8], "normal");
    await page.locator('input[name="predSummaryLevel"][value="10"]').check();
    await verifyGroups([8, 10], "normal");
    for (const mode of ["easy", "hard", "normal"]) {
      await page.locator('input[name="predSummaryLamp"][value="' + mode + '"]').check();
      assert.equal(await page.locator('input[name="predSummaryLamp"]:checked').count(), 1);
      await verifyGroups([8, 10], mode);
    }
    const beforeSort = await page.locator(".pred-summary__group").evaluateAll(groups => groups.map(group => ({
      heading: group.querySelector("h2").textContent,
      ids: [...group.querySelectorAll("a")].map(link => link.dataset.chartId),
    })));
    await page.locator("#predSummarySort").click();
    assert.equal(await page.locator("#predSummarySort").getAttribute("aria-pressed"), "true");
    assert.deepEqual(await page.locator(".pred-summary__group").evaluateAll(groups => groups.map(group => ({
      heading: group.querySelector("h2").textContent,
      ids: [...group.querySelectorAll("a")].map(link => link.dataset.chartId),
    }))), [
      ...beforeSort.filter(group => group.heading !== "\u672a\u7b97\u51fa").reverse(),
      ...beforeSort.filter(group => group.heading === "\u672a\u7b97\u51fa"),
    ]);
    await page.locator("#predSummarySort").click();
    await verifyGroups([8, 10], "normal");
    assert.deepEqual(await page.evaluate(() => {
      const charts = [
        { chart_id: "1", title: "Z", difficulty: "ANOTHER", original_level: 10, calibrated_pred_skill: "10.31" },
        { chart_id: "2", title: "A", difficulty: "HYPER", original_level: 10, calibrated_pred_skill: "10.39" },
        { chart_id: "3", title: "Missing", difficulty: "NORMAL", original_level: 10, calibrated_pred_skill: "" },
      ];
      return {
        boundaries: ["8.2", "8.29", "10.30", "10.39", "10.40", "", null].map(predSummaryGetBin),
        groups: predSummaryBuildGroups(charts, new Set([10]), "normal").map(group => ({ bin: group.bin, ids: group.charts.map(row => row.chart_id) })),
        descending: predSummaryBuildGroups([...charts, { ...charts[0], chart_id: "4", calibrated_pred_skill: "10.40" }], new Set([10]), "normal", "desc").map(group => group.bin),
      };
    }), {
      boundaries: [82, 82, 103, 103, 104, null, null],
      groups: [{ bin: 103, ids: ["2", "1"] }, { bin: null, ids: ["3"] }],
      descending: [104, 103, null],
    });
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Overflow at " + width);
    }
    await page.locator('input[name="predSummaryLevel"][value="8"]').uncheck();
    await page.locator('input[name="predSummaryLevel"][value="10"]').uncheck();
    assert.equal(await page.locator(".pred-summary__group").count(), 0);
    assert.equal(await page.locator("#predSummaryEmpty").isVisible(), true);
    await page.locator("#predDetailTab").click();
    await page.locator(".filter-group > summary").click();
    await page.locator("#searchInput").fill("ADAMANT");
    await page.waitForFunction(() => state.query === "ADAMANT");
    await page.locator("#predSummaryTab").click();
    await page.locator('input[name="predSummaryLevel"][value="8"]').check();
    await verifyGroups([8], "normal");
    await page.locator("#predDetailTab").click();
    assert.equal(await page.locator("#searchInput").inputValue(), "ADAMANT");
    await page.locator("#predSummaryTab").click();
    await page.locator('input[name="predSummaryLevel"][value="10"]').check();
    await page.locator('input[name="predSummaryLamp"][value="hard"]').check();
    await page.reload();
    await page.waitForSelector(".pred-summary__group");
    assert.equal(await page.locator("#predSummaryTab").textContent(), "\u96e3\u6613\u5ea6\u8868");
    assert.equal(await page.locator("#predDetailTab").textContent(), "\u8a73\u7d30\u4e00\u89a7");
    assert.deepEqual(await page.locator('input[name="predSummaryLevel"]:checked').evaluateAll(inputs => inputs.map(input => input.value)), ["8", "10"]);
    assert.equal(await page.locator('input[name="predSummaryLamp"]:checked').inputValue(), "hard");
    await verifyGroups([8, 10], "hard");
    await page.locator('input[name="predSummaryLevel"][value="8"]').uncheck();
    await page.locator('input[name="predSummaryLevel"][value="10"]').uncheck();
    await page.reload();
    assert.equal(await page.locator('input[name="predSummaryLevel"]:checked').count(), 0);
    assert.equal(await page.locator("#predSummaryEmpty").isVisible(), true);
    await page.evaluate(() => localStorage.setItem(predSummarySelectionStorageKey, '{"version":1,"levels":[99],"lamp":"invalid"}'));
    await page.reload();
    assert.deepEqual(await page.locator('input[name="predSummaryLevel"]:checked').evaluateAll(inputs => inputs.map(input => input.value)), ["8"]);
    assert.equal(await page.locator('input[name="predSummaryLamp"]:checked').inputValue(), "normal");
    await page.locator("#predSummarySettingsButton").click();
    assert.equal(await page.locator("#predSummarySettings").isVisible(), true);
    assert.equal(await page.locator("#predSummarySettings input[data-pred-difficulty]").count(), 4);
    assert.equal(await page.locator("#predSummarySettings input[data-pred-feature]").count(), 20);
    const featureAll = page.locator('input[data-pred-feature-all]');
    assert.equal(await featureAll.isChecked(), true);
    await featureAll.uncheck();
    assert.equal(await page.locator('input[data-pred-feature]:checked').count(), 0);
    await featureAll.check();
    assert.equal(await page.locator('input[data-pred-feature]:checked').count(), 20);
    for (const code of ["N", "H", "L"]) await page.locator('input[data-pred-difficulty="' + code + '"]').uncheck();
    await page.locator('input[data-pred-feature="BPM\u5909\u5316"][data-feature-mode="include"]').uncheck();
    assert.equal(await featureAll.evaluate(input => input.indeterminate), true);
    await page.locator("#predSummarySettings [data-settings-save]").click();
    const verifySettings = async () => {
      const result = await page.evaluate(() => {
        const expected = state.rows.filter(row => Number(row.original_level) === 8
          && normalizeDifficulty(row.difficulty) === "ANOTHER"
          && !getRowFeatures(row).includes("BPM\u5909\u5316"));
        return {
          actual: [...document.querySelectorAll("#predSummaryGroups a")].map(link => link.dataset.chartId).sort(),
          expected: expected.map(row => String(row.chart_id)).sort(),
          count: document.getElementById("predSummaryCount").textContent,
          expectedCount: expected.length.toLocaleString() + "\u4ef6\u8868\u793a / "
            + state.rows.filter(row => Number(row.original_level) === 8).length.toLocaleString() + "\u4ef6\u4e2d",
        };
      });
      assert.deepEqual(result.actual, result.expected);
      assert.equal(result.count, result.expectedCount);
    };
    await verifySettings();
    await page.reload();
    await page.waitForSelector("#predSummarySettingsButton");
    await verifySettings();
    await page.locator("#predSummarySettingsButton").click();
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.locator("#predSummarySettings").evaluate(dialog => {
        const rect = dialog.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0
          && rect.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth;
      }), true);
    }
    await page.locator("#predSummarySettings [data-settings-reset]").click();
    await page.keyboard.press("Escape");
    await verifySettings();
    await page.locator("#predSummarySettingsButton").click();
    await page.locator("#predSummarySettings [data-settings-reset]").click();
    await page.locator("#predSummarySettings [data-settings-save]").click();
    await verifyGroups([8], "normal");
    await page.locator("#predSummarySettingsButton").click();
    for (const code of ["N", "H", "A", "L"]) await page.locator('input[data-pred-difficulty="' + code + '"]').uncheck();
    await page.locator("#predSummarySettings [data-settings-save]").click();
    assert.equal(await page.locator("#predSummaryGroups a").count(), 0);
    assert.equal(await page.locator("#predSummaryEmpty").isVisible(), true);
    await page.locator("#predSummarySettingsButton").click();
    await page.locator("#predSummarySettings [data-settings-reset]").click();
    await page.locator("#predSummarySettings [data-settings-save]").click();
    await verifyGroups([8], "normal");
    assert.deepEqual(errors, []);
    console.log("PASS: default level/lamp, multi-level selection, single lamp, truncation boundaries, title ordering, missing Pred, responsive layout and independent detail filters.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
