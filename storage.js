"use strict";

(() => {
  const name = "cpi-next-clear-status";
  const stores = ["chart-statuses", "manual-targets", "daily-targets", "status-update-events"];
  let opening = null;
  let channel = null;
  try {
    if (typeof window.BroadcastChannel === "function") {
      channel = new window.BroadcastChannel("cpi-next-storage");
      channel.onmessage = () => window.dispatchEvent(new Event("cpi:storage-changed"));
    }
  } catch { /* Focus/pageshow refresh remains available. */ }
  function watch(database) {
    const transact = database.transaction.bind(database);
    database.transaction = (...args) => {
      const transaction = transact(...args);
      if (transaction.mode === "readwrite" && ["chart-statuses", "manual-targets", "daily-targets"].some(name => transaction.objectStoreNames.contains(name))) {
        transaction.addEventListener("complete", () => {
          try { channel?.postMessage("changed"); } catch { /* Optional notification. */ }
        });
      }
      return transaction;
    };
  }
  function ensure(database, transaction) {
    for (const storeName of stores) {
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, storeName === "status-update-events"
          ? { keyPath: "id", autoIncrement: true }
          : { keyPath: storeName === "daily-targets" ? "date" : "chartId" });
      }
    }
    const history = transaction.objectStore("status-update-events");
    for (const key of ["cycleKey", "changedAt"]) {
      if (!history.indexNames.contains(key)) history.createIndex(key, key, { unique: false });
    }
  }
  function complete(database) {
    if (!stores.every(key => database.objectStoreNames.contains(key))) return false;
    const history = database.transaction("status-update-events").objectStore("status-update-events");
    return ["cycleKey", "changedAt"].every(key => history.indexNames.contains(key));
  }
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("このブラウザではローカル保存を利用できません。"));
        return;
      }
      let settled = false;
      function attempt(version) {
        const request = version === undefined ? window.indexedDB.open(name) : window.indexedDB.open(name, version);
        request.onupgradeneeded = () => ensure(request.result, request.transaction);
        request.onerror = () => {
          if (!settled && request.error?.name === "VersionError") { attempt(); return; }
          settled = true;
          reject(request.error ?? new Error("ローカル保存を開けませんでした。"));
        };
        request.onblocked = () => {
          settled = true;
          reject(new Error("別のタブが古い保存形式を使用中です。他のCPI:Nextのタブを閉じて再読み込みしてください。"));
        };
        request.onsuccess = () => {
          const database = request.result;
          if (settled) { database.close(); return; }
          database.onversionchange = () => {
            database.close();
            opening = null;
            window.dispatchEvent(new Event("cpi:storage-versionchange"));
          };
          database.onclose = () => { opening = null; };
          if (!complete(database)) {
            const next = Math.max(5, database.version + 1);
            database.close();
            attempt(next);
            return;
          }
          watch(database);
          settled = true;
          resolve(database);
        };
      }
      attempt();
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  window.cpiStorage = Object.freeze({ open });
})();
