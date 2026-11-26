"use strict";

const SITE_RETURN_URL = "https://cpi-next.com/mypage.html";
const CATALOG_URL = "https://cpi-next.com/data/v1/latest.json";
const STATUS_VALUES = new Set(["unowned", "no-play", "failed", "assisted", "easy", "clear", "hard"]);
const PARTICIPANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_PAYLOAD_LENGTH = 500000;
const MAX_RECORDS_PER_PLATFORM = 5000;
const MAX_TOTAL_RECORDS = 10000;

function doGet(event) {
  if (event && event.parameter && event.parameter.action === "state") {
    const callback = event.parameter.callback || "";
    if (callback !== "cpiNextDataContributionStateCallback") {
      return ContentService.createTextOutput("Invalid callback").setMimeType(ContentService.MimeType.TEXT);
    }
    const state = getCampaignState_();
    const participantId = String(event.parameter.participantId || "");
    const response = {
      active: state.active,
      campaignId: state.campaignId,
      startAt: state.startAt,
      endAt: state.endAt,
      lastSubmittedCampaignId: PARTICIPANT_ID_PATTERN.test(participantId)
        ? getLastSubmittedCampaignId_(participantId)
        : "",
    };
    response.alreadySubmitted = Boolean(response.campaignId && response.lastSubmittedCampaignId === response.campaignId);
    return ContentService.createTextOutput(callback + "(" + JSON.stringify(response) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return HtmlService.createHtmlOutput("CPI:Next data contribution endpoint");
}

function doPost(event) {
  const parameters = event && event.parameter ? event.parameter : {};
  const payloadText = String(parameters.payload || "");
  let campaignId = "";
  try {
    if (parameters.action !== "submit" || !payloadText || payloadText.length > MAX_PAYLOAD_LENGTH) {
      throw new Error("Invalid request");
    }
    const payload = JSON.parse(payloadText);
    campaignId = String(payload.campaignId || "");
    const state = getCampaignState_();
    if (!state.active || !CAMPAIGN_ID_PATTERN.test(campaignId) || campaignId !== state.campaignId) {
      throw new Error("Collection is not active");
    }
    const sanitized = validatePayload_(payload, state.campaignId);

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (getLastSubmittedCampaignId_(payload.participantId) === state.campaignId) {
        return resultPage_(true, "すでに受付済みです", "この受付期間のデータ提供は完了しています。", state.campaignId);
      }
      const folderId = PropertiesService.getScriptProperties().getProperty("DRIVE_FOLDER_ID");
      if (!folderId) throw new Error("Storage is not configured");
      const folder = DriveApp.getFolderById(folderId);
      const filename = payload.participantId + ".json";
      const files = folder.getFilesByName(filename);
      const saved = {
        schemaVersion: 1,
        campaignId: state.campaignId,
        participantId: payload.participantId,
        receivedAt: new Date().toISOString(),
        consentVersion: 1,
        platforms: sanitized.platforms,
      };
      const content = JSON.stringify(saved);
      if (files.hasNext()) {
        files.next().setContent(content);
      } else {
        folder.createFile(filename, content, "application/json");
      }
      const excludedNote = sanitized.ignoredCount
        ? " 現在の譜面データにない" + sanitized.ignoredCount + "譜面分の記録は対象から除外しました。"
        : "";
      return resultPage_(true, "データ提供を受け付けました", "ご協力ありがとうございます。提供データは難易度推定の検証・改善に利用します。" + excludedNote, state.campaignId);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return resultPage_(false, "データ提供を完了できませんでした", "受付期間、送信内容、または保存先を確認できませんでした。CPI:Nextに戻り、受付期間中であることを確認してから再度お試しください。", campaignId);
  }
}

function getCampaignState_() {
  const properties = PropertiesService.getScriptProperties();
  const activeSetting = properties.getProperty("COLLECTION_ACTIVE") === "true";
  const storageConfigured = Boolean(properties.getProperty("DRIVE_FOLDER_ID"));
  const campaignId = String(properties.getProperty("CAMPAIGN_ID") || "");
  const start = new Date(String(properties.getProperty("COLLECTION_START_AT") || ""));
  const end = new Date(String(properties.getProperty("COLLECTION_END_AT") || ""));
  const now = new Date();
  const hasValidWindow = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start < end;
  return {
    active: activeSetting && storageConfigured && hasValidWindow && CAMPAIGN_ID_PATTERN.test(campaignId)
      && now >= start && now < end,
    campaignId: CAMPAIGN_ID_PATTERN.test(campaignId) ? campaignId : "",
    startAt: hasValidWindow ? start.toISOString() : "",
    endAt: hasValidWindow ? end.toISOString() : "",
  };
}

function validatePayload_(payload, campaignId) {
  if (!payload || payload.schemaVersion !== 1 || payload.consent !== true
    || payload.campaignId !== campaignId
    || !PARTICIPANT_ID_PATTERN.test(String(payload.participantId || ""))) {
    throw new Error("Invalid payload metadata");
  }
  const platforms = payload.platforms;
  if (!platforms || !Array.isArray(platforms.ac) || !Array.isArray(platforms.inf)
    || platforms.ac.length > MAX_RECORDS_PER_PLATFORM || platforms.inf.length > MAX_RECORDS_PER_PLATFORM
    || platforms.ac.length + platforms.inf.length > MAX_TOTAL_RECORDS
    || platforms.ac.length + platforms.inf.length === 0) {
    throw new Error("Invalid platform records");
  }
  const chartIds = getCurrentChartIds_();
  const sanitized = { ac: [], inf: [] };
  let ignoredCount = 0;
  for (const platform of ["ac", "inf"]) {
    const seen = new Set();
    for (const record of platforms[platform]) {
      const chartId = String(record && record.chartId || "");
      const status = String(record && record.status || "");
      if (!/^\d{1,10}$/.test(chartId) || !STATUS_VALUES.has(status) || seen.has(chartId)) {
        throw new Error("Invalid chart record");
      }
      seen.add(chartId);
      if (!chartIds.has(chartId)) {
        ignoredCount += 1;
        continue;
      }
      sanitized[platform].push({ chartId: chartId, status: status });
    }
  }
  if (sanitized.ac.length + sanitized.inf.length === 0) throw new Error("No current chart records");
  return { platforms: sanitized, ignoredCount: ignoredCount };
}

function getCurrentChartIds_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = "cpi-next-chart-ids-v1";
  const cached = cache.get(cacheKey);
  if (cached) return new Set(JSON.parse(cached));
  const response = UrlFetchApp.fetch(CATALOG_URL, { muteHttpExceptions: true, followRedirects: true });
  if (response.getResponseCode() !== 200) throw new Error("Could not load the chart catalog");
  const catalog = JSON.parse(response.getContentText("UTF-8"));
  if (!Array.isArray(catalog.charts) || catalog.charts.length === 0) throw new Error("Invalid chart catalog");
  const ids = catalog.charts.map(chart => String(chart && chart.id || "")).filter(id => /^\d{1,10}$/.test(id));
  if (ids.length !== catalog.charts.length) throw new Error("Invalid chart IDs in catalog");
  cache.put(cacheKey, JSON.stringify(ids), 21600);
  return new Set(ids);
}

function getLastSubmittedCampaignId_(participantId) {
  const folderId = PropertiesService.getScriptProperties().getProperty("DRIVE_FOLDER_ID");
  if (!folderId || !PARTICIPANT_ID_PATTERN.test(String(participantId || ""))) return "";
  const files = DriveApp.getFolderById(folderId).getFilesByName(participantId + ".json");
  if (!files.hasNext()) return "";
  try {
    const saved = JSON.parse(files.next().getBlob().getDataAsString("UTF-8"));
    return saved.participantId === participantId && CAMPAIGN_ID_PATTERN.test(String(saved.campaignId || ""))
      ? saved.campaignId
      : "";
  } catch (error) {
    console.error(error);
    return false;
  }
}

function resultPage_(success, title, message, campaignId) {
  const url = new URLBuilder_(SITE_RETURN_URL)
    .add("contribution", success ? "sent" : "error")
    .add("campaign", CAMPAIGN_ID_PATTERN.test(String(campaignId || "")) ? campaignId : "")
    .toString();
  const html = '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + escapeHtml_(title) + '｜CPI:Next</title>'
    + '<style>body{margin:0;padding:24px;background:#f3f6fb;color:#243247;font:16px/1.7 system-ui,sans-serif}.card{max-width:560px;margin:8vh auto;padding:24px;border:1px solid #cbd7e6;border-radius:18px;background:#fff;box-shadow:0 12px 36px #18345b18}h1{margin:0 0 10px;color:' + (success ? '#2458aa' : '#a33b32') + ';font-size:1.35rem}p{margin:0 0 18px}a{display:inline-block;padding:10px 16px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700}</style>'
    + '<main class="card"><h1>' + escapeHtml_(title) + '</h1><p>' + escapeHtml_(message) + '</p><a href="' + escapeHtml_(url) + '">CPI:Nextに戻る</a></main></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title);
}

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function URLBuilder_(base) {
  this.base = base;
  this.parameters = [];
  this.add = function (key, value) {
    if (value) this.parameters.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
    return this;
  };
  this.toString = function () {
    return this.base + (this.parameters.length ? "?" + this.parameters.join("&") : "");
  };
}
