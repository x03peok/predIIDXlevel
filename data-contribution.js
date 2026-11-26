"use strict";

(() => {
  const config = window.CpiNextDataContributionConfig ?? {};
  const participantIdKey = "cpi-next-data-contribution-participant-id-v1";
  const visitDatesKey = "cpi-next-data-contribution-mypage-visits-v1";
  const completedPrefix = "cpi-next-data-contribution-completed-v1:";
  const declinedPrefix = "cpi-next-data-contribution-declined-v1:";
  const recentVisitLimit = 60;
  const statuses = new Set(["unowned", "no-play", "failed", "assisted", "easy", "clear", "hard"]);
  const clearStatuses = new Set(["clear", "hard"]);
  const notClearStatuses = new Set(["failed", "assisted", "easy"]);
  const easyOrBetterStatuses = new Set(["easy", "clear", "hard"]);
  const platformLabels = { ac: "AC", inf: "INFINITAS" };
  // Temporary design-review switch. Remove after the invitation is approved.
  const previewMode = new URLSearchParams(window.location.search).get("dataContributionPreview") === "1";
  let currentCampaign = null;
  let refreshTimer = 0;
  let sending = false;
  let pendingSuccessCampaignId = "";
  let successNoticeShown = false;
  let previewDeclined = false;

  function evaluateEligibility(recordsByPlatform) {
    const platformStats = {};
    let easyOrBetterCount = 0;
    for (const platform of ["ac", "inf"]) {
      const records = Array.isArray(recordsByPlatform?.[platform]) ? recordsByPlatform[platform] : [];
      const ids = new Set();
      let clearCount = 0;
      let notClearCount = 0;
      let easyOrBetterPlatformCount = 0;
      for (const record of records) {
        const chartId = String(record?.chartId ?? record?.chart_id ?? "").trim();
        const status = String(record?.status ?? record?.clearType ?? "").trim().toLowerCase();
        if (!/^\d+$/.test(chartId) || !statuses.has(status) || ids.has(chartId)) continue;
        ids.add(chartId);
        if (clearStatuses.has(status)) clearCount += 1;
        if (notClearStatuses.has(status)) notClearCount += 1;
        if (easyOrBetterStatuses.has(status)) {
          easyOrBetterCount += 1;
          easyOrBetterPlatformCount += 1;
        }
      }
      platformStats[platform] = {
        observationCount: clearCount + notClearCount,
        clearCount,
        notClearCount,
        targetUnlocked: clearCount + notClearCount >= 10 && clearCount >= 3 && notClearCount >= 3,
        easyOrBetterCount: easyOrBetterPlatformCount,
      };
    }
    return {
      eligible: Object.values(platformStats).some(({ targetUnlocked }) => targetUnlocked)
        && easyOrBetterCount >= 50,
      targetUnlocked: Object.values(platformStats).some(({ targetUnlocked }) => targetUnlocked),
      easyOrBetterCount,
      platformStats,
    };
  }

  function jstDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return values.year + "-" + values.month + "-" + values.day;
  }

  function recentJstDateKeys(today = new Date()) {
    const todayKey = jstDateKey(today);
    const [year, month, day] = todayKey.split("-").map(Number);
    return Array.from({ length: 7 }, (_, offset) =>
      new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0, 10),
    );
  }

  function readVisitDates() {
    try {
      const value = JSON.parse(window.localStorage.getItem(visitDatesKey) || "[]");
      if (!Array.isArray(value)) return [];
      const byDate = new Map();
      for (const entry of value) {
        if (entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(entry.at)) {
          byDate.set(entry.date, entry.at);
        }
      }
      return [...byDate].map(([date, at]) => ({ date, at })).sort((left, right) => left.date.localeCompare(right.date));
    } catch {
      return null;
    }
  }

  function recordMyPageVisit() {
    const entries = readVisitDates();
    if (!entries) return false;
    const today = jstDateKey();
    const now = Date.now();
    const byDate = new Map(entries.map(entry => [entry.date, entry.at]));
    byDate.set(today, now);
    try {
      const recent = [...byDate].sort(([left], [right]) => left.localeCompare(right)).slice(-recentVisitLimit)
        .map(([date, at]) => ({ date, at }));
      window.localStorage.setItem(visitDatesKey, JSON.stringify(recent));
      return true;
    } catch {
      return false;
    }
  }

  function countEligibleVisits(entries, campaign, now = new Date()) {
    if (!Array.isArray(entries) || !campaign?.startAt) return 0;
    const startAt = new Date(campaign.startAt).getTime();
    if (!Number.isFinite(startAt)) return 0;
    const allowedDates = new Set(recentJstDateKeys(now));
    return entries.filter(({ date, at }) => allowedDates.has(date) && at >= startAt && at <= now.getTime()).length;
  }

  function getEligibleVisitCount(campaign) {
    return countEligibleVisits(readVisitDates(), campaign);
  }

  function getParticipantId(createIfMissing = false) {
    try {
      const existing = window.localStorage.getItem(participantIdKey);
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing || "")) return existing;
      if (!createIfMissing) return "";
      let id = window.crypto?.randomUUID?.() || "";
      if (!id && typeof window.crypto?.getRandomValues === "function") {
        const bytes = window.crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
        id = hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
      }
      if (!id) return "";
      window.localStorage.setItem(participantIdKey, id);
      return id;
    } catch {
      return "";
    }
  }

  function validateEndpoint() {
    try {
      const endpoint = new URL(String(config.endpoint || ""));
      if (endpoint.protocol !== "https:" || endpoint.hostname !== "script.google.com"
        || !/^\/macros\/s\/[^/]+\/exec$/.test(endpoint.pathname)) return "";
      return endpoint.href;
    } catch {
      return "";
    }
  }

  function readRemoteState(participantId = "") {
    const endpoint = validateEndpoint();
    if (!endpoint) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const callbackName = "cpiNextDataContributionStateCallback";
      const script = document.createElement("script");
      let finished = false;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        script.remove();
        try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("受付状況を確認できませんでした。"));
      }, 10000);
      window[callbackName] = (state) => {
        cleanup();
        if (!state || typeof state.active !== "boolean") {
          reject(new Error("受付状況を確認できませんでした。"));
          return;
        }
        resolve(state);
      };
      const url = new URL(endpoint);
      url.searchParams.set("action", "state");
      url.searchParams.set("callback", callbackName);
      url.searchParams.set("nonce", window.crypto?.randomUUID?.() || String(Date.now()));
      if (participantId) url.searchParams.set("participantId", participantId);
      script.async = true;
      script.src = url.href;
      script.onerror = () => {
        cleanup();
        reject(new Error("受付状況を確認できませんでした。"));
      };
      document.head.append(script);
    });
  }

  function readAllRecords(platform) {
    return window.cpiStorage.open(platform).then(database => new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = database.transaction("chart-statuses", "readonly");
        const request = transaction.objectStore("chart-statuses").getAll();
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error ?? new Error(platformLabels[platform] + "の記録を読み込めませんでした。"));
        transaction.onabort = () => reject(transaction.error ?? new Error(platformLabels[platform] + "の記録を読み込めませんでした。"));
      } catch (error) {
        reject(error);
      }
    }));
  }

  async function readBothPlatforms() {
    const [ac, inf] = await Promise.all([readAllRecords("ac"), readAllRecords("inf")]);
    return { ac: normalizeRecords(ac), inf: normalizeRecords(inf) };
  }

  function normalizeRecords(records) {
    const byId = new Map();
    for (const record of records) {
      const chartId = String(record?.chartId ?? record?.chart_id ?? "").trim();
      const status = String(record?.status ?? record?.clearType ?? "").trim().toLowerCase();
      if (/^\d+$/.test(chartId) && statuses.has(status)) byId.set(chartId, { chartId, status });
    }
    return [...byId.values()];
  }

  function markCompleted(campaignId) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(campaignId || ""))) return;
    try { window.localStorage.setItem(completedPrefix + campaignId, "1"); } catch { /* The server remains the authoritative duplicate check. */ }
  }

  function hasCompleted(campaignId) {
    try { return window.localStorage.getItem(completedPrefix + campaignId) === "1"; } catch { return false; }
  }

  function markDeclined(campaignId) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(campaignId || ""))) return;
    try { window.localStorage.setItem(declinedPrefix + campaignId, "1"); } catch { /* Keep the dismissal for this page if storage is unavailable. */ }
  }

  function hasDeclined(campaignId) {
    try { return window.localStorage.getItem(declinedPrefix + campaignId) === "1"; } catch { return false; }
  }

  function processReturnStatus() {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("contribution");
    const campaignId = url.searchParams.get("campaign") || "";
    if (result === "sent" && /^[A-Za-z0-9._-]{1,64}$/.test(campaignId)) {
      markCompleted(campaignId);
      pendingSuccessCampaignId = campaignId;
    }
    if (result === "error") {
      try { window.sessionStorage.setItem("cpi-next-data-contribution-error", "送信を完了できませんでした。受付画面の案内を確認して、もう一度お試しください。"); } catch { /* Optional status message. */ }
    }
    if (result) {
      url.searchParams.delete("contribution");
      url.searchParams.delete("campaign");
      window.history.replaceState(null, "", url.href);
    }
  }

  function setInviteStatus(message) {
    const status = document.getElementById("dataContributionStatus");
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  }

  function hideInvite() {
    const invite = document.getElementById("dataContributionInvite");
    const dialog = document.getElementById("dataContributionDialog");
    if (invite) invite.hidden = true;
    if (dialog?.open) dialog.close();
    currentCampaign = null;
  }

  function showInvite(stats, campaign, options = {}) {
    const invite = document.getElementById("dataContributionInvite");
    const open = document.getElementById("dataContributionOpen");
    const completed = document.getElementById("dataContributionCompleted");
    const counts = document.getElementById("dataContributionCounts");
    const error = document.getElementById("dataContributionError");
    if (!invite || !counts || !open || !completed) return;
    open.hidden = false;
    open.disabled = false;
    open.textContent = "Predの精度向上にご協力ください";
    completed.hidden = true;
    completed.textContent = "";
    counts.hidden = !!options.preview;
    counts.textContent = options.preview
      ? ""
      : "現在の登録数：AC " + stats.platformStats.ac.easyOrBetterCount.toLocaleString()
        + "譜面／INFINITAS " + stats.platformStats.inf.easyOrBetterCount.toLocaleString()
        + "譜面（EASY以上 合計 " + stats.easyOrBetterCount.toLocaleString() + "譜面）";
    if (options.preview && error) {
      error.textContent = "";
      error.hidden = true;
    }
    currentCampaign = campaign;
    setInviteStatus("");
    invite.hidden = false;
    if (error && !options.preview) {
      try {
        const message = window.sessionStorage.getItem("cpi-next-data-contribution-error");
        if (message) {
          error.textContent = message;
          error.hidden = false;
          window.sessionStorage.removeItem("cpi-next-data-contribution-error");
        }
      } catch { /* Optional status message. */ }
    }
  }

  function showSubmittedNotice() {
    const invite = document.getElementById("dataContributionInvite");
    const open = document.getElementById("dataContributionOpen");
    const completed = document.getElementById("dataContributionCompleted");
    if (!invite || !open || !completed) return;
    open.hidden = true;
    completed.textContent = "クリアランプ情報が送信されました。ご協力ありがとうございます！";
    completed.hidden = false;
    currentCampaign = null;
    successNoticeShown = true;
    setInviteStatus("");
    invite.hidden = false;
  }

  async function waitForSubmission(participantId, campaignId, receiptWindow) {
    const deadline = Date.now() + 45_000;
    let delayMs = 1_000;
    while (Date.now() < deadline) {
      try {
        const state = await readRemoteState(participantId);
        if (state?.campaignId === campaignId && state.alreadySubmitted
          && state.lastSubmittedCampaignId === campaignId) {
          markCompleted(campaignId);
          try { if (receiptWindow && !receiptWindow.closed) receiptWindow.close(); } catch { /* Best-effort tab close. */ }
          const consent = document.getElementById("dataContributionConsent");
          const submit = document.getElementById("dataContributionSubmit");
          if (consent) consent.checked = false;
          if (submit) submit.disabled = true;
          showSubmittedNotice();
          return;
        }
      } catch { /* Retry transient read failures while the receipt is being saved. */ }
      if (Date.now() >= deadline) break;
      await new Promise(resolve => window.setTimeout(resolve, delayMs));
      delayMs = Math.min(5_000, Math.round(delayMs * 1.5));
    }
    if (!successNoticeShown) {
      const open = document.getElementById("dataContributionOpen");
      if (open) {
        open.disabled = false;
        open.textContent = "Predの精度向上にご協力ください";
      }
      setInviteStatus("送信結果を確認できませんでした。受付画面をご確認ください。");
    }
  }

  function showPreview() {
    if (previewDeclined) { hideInvite(); return; }
    showInvite(null, { campaignId: "preview", startAt: new Date().toISOString() }, { preview: true });
  }

  async function evaluateAndDisplay() {
    if (successNoticeShown) return;
    if (previewMode && document.body?.dataset.page === "mypage") {
      showPreview();
      return;
    }
    const endpoint = validateEndpoint();
    if (document.body?.dataset.page !== "mypage") return;
    if (!endpoint) { hideInvite(); return; }
    if (pendingSuccessCampaignId) {
      pendingSuccessCampaignId = "";
      showSubmittedNotice();
      return;
    }
    recordMyPageVisit();
    const baseState = await readRemoteState();
    if (!baseState?.campaignId) { hideInvite(); return; }
    if (hasDeclined(baseState.campaignId) || hasCompleted(baseState.campaignId)) {
      hideInvite();
      return;
    }
    const participantId = getParticipantId();
    const remoteState = participantId ? await readRemoteState(participantId) : baseState;
    if (remoteState?.lastSubmittedCampaignId === baseState.campaignId || remoteState?.alreadySubmitted) {
      markCompleted(baseState.campaignId);
      hideInvite();
      return;
    }
    if (!baseState.active || !baseState.startAt || getEligibleVisitCount(baseState) < 2) {
      hideInvite();
      return;
    }
    if (remoteState?.campaignId !== baseState.campaignId) { hideInvite(); return; }

    const recordsByPlatform = await readBothPlatforms();
    const stats = evaluateEligibility(recordsByPlatform);
    if (!stats.eligible) {
      hideInvite();
      return;
    }
    if (hasDeclined(baseState.campaignId) || hasCompleted(baseState.campaignId)) {
      hideInvite();
      return;
    }
    showInvite(stats, baseState);
  }

  async function startSubmission() {
    if (sending || !currentCampaign) return;
    const consent = document.getElementById("dataContributionConsent");
    const submit = document.getElementById("dataContributionSubmit");
    const error = document.getElementById("dataContributionError");
    if (previewMode) {
      if (!consent?.checked || !submit) return;
      document.getElementById("dataContributionDialog").close();
      document.getElementById("dataContributionOpen").hidden = true;
      const completed = document.getElementById("dataContributionCompleted");
      completed.textContent = "プレビュー確認完了。実際のデータ提供は行われていません。";
      completed.hidden = false;
      consent.checked = false;
      submit.disabled = true;
      currentCampaign = null;
      successNoticeShown = true;
      setInviteStatus("");
      return;
    }
    if (!consent?.checked || !submit) return;
    const participantId = getParticipantId(true);
    const endpoint = validateEndpoint();
    if (!participantId || !endpoint) return;
    const invite = document.getElementById("dataContributionInvite");
    sending = true;
    submit.disabled = true;
    error.hidden = true;
    let receiptWindow = null;
    try {
      const targetName = "cpiContributionReceipt_" + participantId.replace(/-/g, "");
      receiptWindow = window.open("about:blank", targetName);
      if (!receiptWindow) throw new Error("送信結果を表示するウィンドウを開けませんでした。ポップアップを許可してから再度お試しください。");
      receiptWindow.document.title = "CPI:Next データ提供";
      receiptWindow.document.body.textContent = "送信内容を確認しています…";

      const remoteState = await readRemoteState(participantId);
      if (!remoteState?.active || remoteState.campaignId !== currentCampaign.campaignId) {
        throw new Error("受付期間が終了したか、受付状態が変わりました。ページを再読み込みしてください。");
      }
      if (remoteState.alreadySubmitted) {
        markCompleted(remoteState.campaignId);
        receiptWindow?.close();
        document.getElementById("dataContributionDialog").close();
        showSubmittedNotice();
        return;
      }
      if (getEligibleVisitCount(remoteState) < 2) {
        throw new Error("訪問条件を確認できませんでした。ページを再読み込みしてください。");
      }

      const platforms = await readBothPlatforms();
      const stats = evaluateEligibility(platforms);
      if (!stats.eligible) throw new Error("現在の登録内容が提供条件を満たさなくなりました。");
      const payload = {
        schemaVersion: 1,
        campaignId: remoteState.campaignId,
        participantId,
        consent: true,
        platforms,
      };
      const form = document.createElement("form");
      form.method = "post";
      form.action = endpoint;
      form.target = targetName;
      form.hidden = true;
      for (const [name, value] of [["action", "submit"], ["payload", JSON.stringify(payload)]]) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
      window.setTimeout(() => form.remove(), 1000);
      document.getElementById("dataContributionDialog").close();
      const openButton = document.getElementById("dataContributionOpen");
      openButton.disabled = true;
      openButton.textContent = "送信確認中";
      consent.checked = false;
      setInviteStatus("送信結果を確認しています…");
      void waitForSubmission(participantId, remoteState.campaignId, receiptWindow);
    } catch (cause) {
      receiptWindow?.close();
      error.textContent = cause.message || "送信できませんでした。";
      error.hidden = false;
      consent.checked = false;
      submit.disabled = true;
    } finally {
      sending = false;
    }
  }

  function bindUi() {
    const invite = document.getElementById("dataContributionInvite");
    const dialog = document.getElementById("dataContributionDialog");
    const open = document.getElementById("dataContributionOpen");
    const close = document.getElementById("dataContributionClose");
    const consent = document.getElementById("dataContributionConsent");
    const submit = document.getElementById("dataContributionSubmit");
    const decline = document.getElementById("dataContributionDecline");
    if (!invite || !dialog || !open || !close || !consent || !submit || !decline) return;
    open.addEventListener("click", () => dialog.showModal());
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
    consent.addEventListener("change", () => { submit.disabled = !consent.checked || sending; });
    decline.addEventListener("click", () => {
      if (previewMode) previewDeclined = true;
      else if (currentCampaign?.campaignId) markDeclined(currentCampaign.campaignId);
      consent.checked = false;
      submit.disabled = true;
      hideInvite();
    });
    submit.addEventListener("click", () => { void startSubmission(); });
  }

  function scheduleRefresh() {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      void evaluateAndDisplay().catch(error => console.warn("Data contribution invitation unavailable:", error));
    }, 800);
  }

  window.cpiDataContribution = Object.freeze({ evaluateEligibility, jstDateKey, recentJstDateKeys, countEligibleVisits, previewMode });

  if (document.body?.dataset.page === "mypage") {
    processReturnStatus();
    document.addEventListener("DOMContentLoaded", () => {
      bindUi();
      void evaluateAndDisplay().catch(error => console.warn("Data contribution invitation unavailable:", error));
      for (const eventName of ["cpi:status-changed", "cpi:storage-changed", "cpi:storage-changed-inf"]) {
        window.addEventListener(eventName, scheduleRefresh);
      }
      window.addEventListener("pageshow", scheduleRefresh);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") scheduleRefresh();
      });
    }, { once: true });
  }
})();
