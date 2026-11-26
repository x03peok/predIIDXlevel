"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "data-contribution.js"), "utf8");
const windowStub = { CpiNextDataContributionConfig: { endpoint: "" }, location: { search: "" } };
const context = {
  window: windowStub,
  document: { body: { dataset: { page: "test" } } },
  Intl,
  Date,
  Set,
  Map,
  Object,
  Array,
  String,
  Number,
  JSON,
  URLSearchParams,
};
vm.runInNewContext(source, context, { filename: "data-contribution.js" });
const api = windowStub.cpiDataContribution;

function rows(count, status, firstId = 1) {
  return Array.from({ length: count }, (_, index) => ({ chartId: String(firstId + index), status }));
}

test("eligibility requires a ready My Target on at least one platform and 50 EASY+ records combined", () => {
  const qualified = {
    ac: [...rows(3, "clear", 1), ...rows(3, "failed", 10), ...rows(4, "easy", 20)],
    inf: [...rows(43, "hard", 100)],
  };
  const result = api.evaluateEligibility(qualified);
  assert.equal(result.eligible, true);
  assert.equal(result.targetUnlocked, true);
  assert.equal(result.easyOrBetterCount, 50);
  assert.equal(result.platformStats.ac.targetUnlocked, true);
  assert.equal(result.platformStats.inf.targetUnlocked, false);
});

test("50th EASY+ record meets the threshold and 49 do not", () => {
  const targetReady = [...rows(3, "clear", 1), ...rows(3, "failed", 10)];
  const fortySevenMore = [...targetReady, ...rows(47, "easy", 20)];
  const fortySixMore = [...targetReady, ...rows(46, "easy", 20)];
  assert.equal(api.evaluateEligibility({ ac: fortySevenMore, inf: [] }).eligible, true);
  assert.equal(api.evaluateEligibility({ ac: fortySixMore, inf: [] }).eligible, false);
});

test("Target unlock threshold is not met when either required outcome group has fewer than three", () => {
  const result = api.evaluateEligibility({
    ac: [...rows(2, "clear", 1), ...rows(2, "failed", 10), ...rows(46, "easy", 20)],
    inf: [],
  });
  assert.equal(result.easyOrBetterCount, 48);
  assert.equal(result.targetUnlocked, false);
  assert.equal(result.eligible, false);
});

test("duplicate IDs and unsupported statuses do not inflate eligibility counts", () => {
  const result = api.evaluateEligibility({
    ac: [
      ...rows(3, "clear", 1),
      ...rows(3, "failed", 10),
      ...rows(43, "easy", 20),
      { chartId: "20", status: "hard" },
      { chartId: "900", status: "unregistered" },
    ],
    inf: [],
  });
  assert.equal(result.easyOrBetterCount, 46);
  assert.equal(result.eligible, false);
});

test("visit-day counting uses JST calendar dates, the rolling seven-day window, and campaign start time", () => {
  const now = new Date("2026-11-25T03:00:00.000Z");
  assert.equal(api.jstDateKey(now), "2026-11-25");
  assert.deepEqual(Array.from(api.recentJstDateKeys(now)), [
    "2026-11-25", "2026-11-24", "2026-11-23", "2026-11-22", "2026-11-21", "2026-11-20", "2026-11-19",
  ]);
  const startAt = new Date("2026-11-24T14:00:00.000Z").getTime();
  const entries = [
    { date: "2026-11-24", at: startAt - 60000 },
    { date: "2026-11-24", at: startAt + 1 },
    { date: "2026-11-18", at: startAt + 2 },
    { date: "2026-11-25", at: now.getTime() + 1 },
  ];
  assert.equal(api.countEligibleVisits(entries, { startAt: new Date(startAt).toISOString() }, now), 1);
});

test("deployed GAS endpoint is configured without activating the campaign", () => {
  const config = fs.readFileSync(path.join(root, "data-contribution-config.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "mypage.html"), "utf8");
  assert.match(config, /endpoint:\s*"https:\/\/script\.google\.com\/macros\/s\/[^"\s]+\/exec"/);
  assert.match(config, /server still controls the campaign window/);
  assert.match(page, /dataContributionInvite[\s\S]*?dataContributionDialog/);
  assert.match(page, /data-contribution\.js\?/);
});

test("invitation uses one underlined prompt and a native consent checkbox", () => {
  const page = fs.readFileSync(path.join(root, "mypage.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "data-contribution.css"), "utf8");
  assert.match(page, /<button id="dataContributionOpen" class="data-contribution__prompt"[^>]*>Predの精度向上にご協力ください<\/button>/);
  assert.match(styles, /\.data-contribution__copy\s*\{[^}]*text-align:\s*center;/);
  assert.match(page, /<h2 id="dataContributionDialogTitle">クリアランプ情報提供のお願い<\/h2>/);
  assert.match(page, /class="data-contribution__lead">CPI:NextのPred精度向上のために、登録したクリアランプデータを提供していただける方を募集しています。/);
  assert.match(page, /<h3 id="dataContributionSentTitle">送信する情報<\/h3>[\s\S]*?匿名化された参加者ID、受付期間ID、受信日時も保存します。/);
  assert.match(page, /<h3 id="dataContributionNotSentTitle">送信しない情報<\/h3>[\s\S]*?適正Pred・得意譜面傾向・手動メモ・オプションメモ・更新履歴・今日の10曲は送信されません。/);
  assert.match(page, /<h3 id="dataContributionPurposeTitle">利用目的と保存先<\/h3>[\s\S]*?データは難易度推定の検証・改善にのみ利用し、管理者の非公開Google Driveに保存します。/);
  assert.doesNotMatch(page + styles, /dataContributionPreviewNote|data-contribution__preview-note|data-contribution__privacy|任意参加です。/);
  assert.doesNotMatch(page + styles + fs.readFileSync(path.join(root, "data-contribution.js"), "utf8"), /dataContributionManageLink|dataContributionDeletionLink|fillPrivacyContact|提供データの削除を依頼する|123譜面／INFINITAS 87譜面/);
  assert.match(page, /id="dataContributionDecline"[^>]*>同意しない<\/button>/);
  assert.match(styles, /\.data-contribution__prompt\s*\{[\s\S]*?text-decoration:\s*underline;/);
  assert.match(styles, /\.data-contribution__consent input\s*\{[\s\S]*?appearance:\s*auto;[\s\S]*?-webkit-appearance:\s*checkbox;/);
});

test("temporary design-review query allows a local completion preview without submitting data", () => {
  const previewWindow = {
    CpiNextDataContributionConfig: { endpoint: "" },
    location: { search: "?dataContributionPreview=1" },
  };
  const previewContext = { ...context, window: previewWindow };
  vm.runInNewContext(source, previewContext, { filename: "data-contribution.js" });
  assert.equal(previewWindow.cpiDataContribution.previewMode, true);
  assert.equal(previewWindow.CpiNextDataContributionConfig.endpoint, "");
  assert.match(source, /consent\.addEventListener\("change", \(\) => \{ submit\.disabled = !consent\.checked \|\| sending; \}\)/);
  assert.match(source, /プレビュー確認完了。実際のデータ提供は行われていません。/);
  const previewSubmit = source.match(/if \(previewMode\) \{([\s\S]*?)\n    \}\n    if \(!consent/);
  assert.ok(previewSubmit, "preview submission branch exists");
  assert.doesNotMatch(previewSubmit[1], /form\.submit\(|window\.open\(|validateEndpoint\(/);
});

test("declining is remembered per campaign and sent status uses the requested one-time notice", () => {
  assert.match(source, /const declinedPrefix = "cpi-next-data-contribution-declined-v1:"/);
  assert.match(source, /markDeclined\(currentCampaign\.campaignId\)/);
  assert.match(source, /hasDeclined\(baseState\.campaignId\) \|\| hasCompleted\(baseState\.campaignId\)/);
  assert.match(source, /クリアランプ情報が送信されました。ご協力ありがとうございます！/);
  assert.match(source, /pendingSuccessCampaignId = campaignId/);
  assert.match(source, /if \(successNoticeShown\) return/);
});

test("confirmed submissions close the receipt tab and update My Page without navigating the receipt tab back", () => {
  const gas = fs.readFileSync(path.join(root, "data-contribution-gas", "Code.gs"), "utf8");
  assert.match(source, /async function waitForSubmission\(participantId, campaignId, receiptWindow\)/);
  assert.match(source, /state\.alreadySubmitted[\s\S]*?state\.lastSubmittedCampaignId === campaignId/);
  assert.match(source, /receiptWindow\.close\(\)/);
  assert.match(source, /送信結果を確認しています…/);
  assert.match(gas, /受付完了を元のCPI:Next画面で確認できます/);
  assert.match(gas, /success\s*\?[\s\S]*?close-note/);
  assert.match(gas, /target="_top">CPI:Nextに戻る/);
});
