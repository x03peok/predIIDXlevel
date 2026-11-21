"use strict";

(() => {
  const sourceUrl = document.currentScript.src;
  const url = new URL(window.location.href);
  const decisionKey = "cpi-next-platform-migration-v1";
  const platformKey = "cpi-next-record-platform";
  const stores = ["chart-statuses", "manual-targets", "daily-targets", "status-update-events"];
  let decision = "";
  let storageLoad;

  function getDecision() {
    try { return localStorage.getItem(decisionKey) || decision; } catch { return decision; }
  }

  function saveDecision(value) {
    decision = value;
    try {
      if (value !== "empty") localStorage.setItem(platformKey, value);
      localStorage.setItem(decisionKey, value);
    } catch { /* Data remains in IndexedDB even when preferences cannot be persisted. */ }
  }

  function openStorage() {
    if (window.cpiStorage) return Promise.resolve();
    if (!storageLoad) storageLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("storage.js?v=20261121-1", sourceUrl).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error("保存データを開けませんでした。"));
      document.head.append(script);
    });
    return storageLoad;
  }

  function accessStores(database, mode, callback = () => {}) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(stores, mode);
      const results = [];
      let failure;
      let pending = stores.length;
      tx.oncomplete = () => resolve(results);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("保存データを処理できませんでした。"));
      stores.forEach((name, index) => {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => {
          results[index] = request.result;
          if (--pending !== 0) return;
          try { callback(results, tx); } catch (error) { failure = error; tx.abort(); }
        };
      });
    });
  }

  const sameData = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const hasClearRecords = (rows) => rows.some(row => row.status && row.status !== "unregistered" && /^\d+$/.test(String(row.chartId)));

  async function migrate(platform) {
    const otherTab = getDecision();
    if (otherTab) return otherTab;
    if (platform === "inf") {
      const [source, destination] = await Promise.all([window.cpiStorage.open("ac"), window.cpiStorage.open("inf")]);
      const original = await accessStores(source, "readonly");
      if (!hasClearRecords(original[0])) throw new Error("移行できるクリアランプが見つかりませんでした。");
      await accessStores(destination, "readwrite", (existing, tx) => {
        if (existing.some(rows => rows.length)) {
          // An interrupted move can be retried if its complete copy is still intact.
          if (!sameData(existing, original)) throw new Error("INF側に別のデータがあるため移行できません。どちらのデータも変更していません。");
          return;
        }
        stores.forEach((name, index) => {
          const store = tx.objectStore(name);
          for (const row of original[index]) store.add(row);
        });
      });
      await accessStores(source, "readwrite", (current, tx) => {
        if (!sameData(current, original)) {
          throw new Error("移行中に元のデータが変更されたため、AC側のデータを残しました。設定から両方のデータを確認してください。");
        }
        for (const name of stores) tx.objectStore(name).clear();
      });
    }
    saveDecision(platform);
    return platform;
  }

  function show() {
    const dialog = document.createElement("dialog");
    dialog.className = "platform-migration";
    dialog.setAttribute("aria-labelledby", "platformMigrationTitle");
    dialog.innerHTML = '<p><strong id="platformMigrationTitle">ACとINFINITASのクリアランプを分けて保存できるようになりました。</strong><br>現在の登録データの保存先を選んでください。</p>'
      + '<div class="platform-migration__choices"><button type="button" value="ac">AC</button><button type="button" value="inf">INFINITAS</button></div>'
      + '<p class="platform-migration__note">※このメッセージは初回のみ表示されます</p>'
      + '<p class="platform-migration__note platform-migration__note--mixed">※すでにACとINFINITASのクリアランプが混在して登録されている場合、自動的に区別して保存することはできません。いったん適当な保存先を選択し、改めてバージョンごとのクリアランプ登録をお願いします</p>'
      + '<p class="platform-migration__error" role="status" hidden></p>';
    const buttons = dialog.querySelectorAll("button");
    const status = dialog.querySelector('[role="status"]');
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL("platform-migration.css?v=20261121-1", sourceUrl).href;
    document.head.append(stylesheet);
    document.body.append(dialog);
    dialog.addEventListener("cancel", event => event.preventDefault());
    for (const button of buttons) button.addEventListener("click", async () => {
      for (const choice of buttons) choice.disabled = true;
      status.hidden = true;
      try {
        const apply = () => migrate(button.value);
        const selected = navigator.locks
          ? await navigator.locks.request(decisionKey, apply)
          : await apply();
        dialog.close();
        if (["record", "mypage", "target", "settings", "chart"].includes(document.body.dataset.page)) {
          if (selected === "ac" || selected === "inf") url.searchParams.set("platform", selected);
          window.location.replace(url.href);
        }
      } catch (error) {
        status.textContent = error.message || "移行できませんでした。";
        status.hidden = false;
        for (const choice of buttons) choice.disabled = false;
      }
    });
    dialog.showModal();
  }

  async function initialize() {
    if (getDecision() || !window.indexedDB) return;
    if (!window.cpiStorage && typeof indexedDB.databases === "function") {
      try {
        const databases = await indexedDB.databases();
        if (!databases.some(database => database.name === "cpi-next-clear-status")) {
          saveDecision("empty");
          return;
        }
      } catch { /* Check the actual store if database listing is unavailable. */ }
    }
    await openStorage();
    const ac = await window.cpiStorage.open("ac");
    const records = await new Promise((resolve, reject) => {
      const request = ac.transaction("chart-statuses").objectStore("chart-statuses").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (getDecision()) return;
    if (hasClearRecords(records)) show();
    else saveDecision("empty");
  }
  document.addEventListener("DOMContentLoaded", () => { void initialize().catch(error => console.warn(error)); });
})();
