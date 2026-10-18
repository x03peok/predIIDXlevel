"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const context = vm.createContext({
  window: { addEventListener() {}, dispatchEvent() {} },
  document: { createElement: () => ({}), addEventListener() {} },
});
vm.runInContext(read("share-text.js"), context);
const formatter = context.window.cpiShareText.formatTitle;
for (const [before, after] of [
  ["BLACK.by X-Cross Fade", "BLACK. by X-Cross Fade"],
  ["D.C.fish", "D.C. fish"], ["D.C.Fish", "D.C. Fish"],
  ["BLACK. by X-Cross Fade", "BLACK. by X-Cross Fade"],
  ["D.C. fish", "D.C. fish"], ["ADAMANT", "ADAMANT"], [null, ""],
]) {
  assert.equal(formatter(before), after);
  assert.equal(formatter(formatter(before)), after);
}

const extract = (source, name) => {
  const start = source.indexOf("function " + name + "(");
  assert(start >= 0);
  const end = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, end < 0 ? source.length : end);
};
for (const name of ["mypageBuildShareText", "mypageBuildUpdateHistoryShareText"]) {
  vm.runInContext(extract(read("mypage.js"), name), context);
}
context.mypageGetFeatureShareTendencies = () => ({ strong: [], weak: [] });
context.mypagePredModes = {};
context.mypageDifficultyLabels = { ANOTHER: "A" };
context.mypageGetHistoryDifficulty = () => "A";
context.mypageGetHistoryShareMarker = () => "HARD";
context.mypageGetHistoryEventPred = event => event.pred;
context.mypageCompareUpdateHistoryEvents = (a, b) => b.pred - a.pred;
const url = "https://cpi-next.com/share-overview.html?t=o&v=1&d=test&h=test";
for (const title of ["BLACK.by X-Cross Fade", "D.C.fish", "D.C.Fish"]) {
  context.mypageGetHighPredCandidates = () => [{ row: { title, difficulty: "ANOTHER" }, status: "hard", pred: 12 }];
  const overview = context.mypageBuildShareText({ range: "11.0-11.5" }, [], {}, url);
  const history = context.mypageBuildUpdateHistoryShareText("2026-10-18", [{ title, afterStatus: "hard", pred: 12 }], null, url);
  for (const text of [overview, history]) {
    assert(text.includes(formatter(title)));
    assert(!/BLACK\.by|D\.C\.fish/i.test(text));
    assert(text.includes(url.replace("https://", "")));
  }
}

vm.runInContext(read("daily-target.js"), context);
vm.runInContext(`
  const titles = ['BLACK.by X-Cross Fade', 'D.C.fish', 'D.C.Fish'];
  dailyState.rowsById = new Map(titles.map((title, index) => [String(index + 1), { chartId: String(index + 1), title, difficulty: 'A' }]));
  dailyState.today = { charts: titles.map((_, index) => ({ chartId: String(index + 1), targetStatus: 'easy' })) };
`, context);
const daily = vm.runInContext("dailyBuildShareText({shareUrl: 'https://cpi-next.com/share-daily.html'})", context);
assert(daily.includes("BLACK. by X-Cross Fade"));
assert(daily.includes("D.C. fish"));
assert(daily.includes("D.C. Fish"));
assert.equal(vm.runInContext("dailyGetShareLengthForLimit(dailyBuildShareText({shareUrl: 'https://cpi-next.com/share-daily.html'}), 'https://cpi-next.com/share-daily.html') <= dailyShareWeightedLimit", context), true);
console.log("PASS: shared title spacing, case variants, idempotence, overview/history/daily output and daily text length.");
