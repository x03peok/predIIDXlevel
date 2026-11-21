"use strict";

(() => {
  const databaseNames = new Map([
    ["ac", "cpi-next-clear-status"],
    ["inf", "cpi-next-clear-status-inf"],
  ]);
  const stores = ["chart-statuses", "manual-targets", "daily-targets", "status-update-events", "chart-option-memos"];
  const openings = new Map();
  const channels = new Map();
  function getChannel(suffix) {
    if (channels.has(suffix)) return channels.get(suffix);
    let channel = null;
    try {
      if (typeof window.BroadcastChannel === "function") {
        channel = new window.BroadcastChannel("cpi-next-storage" + suffix);
        channel.onmessage = () => window.dispatchEvent(new Event("cpi:storage-changed" + suffix));
      }
    } catch { /* Focus/pageshow refresh remains available. */ }
    channels.set(suffix, channel);
    return channel;
  }
  function watch(database, channel) {
    const transact = database.transaction.bind(database);
    database.transaction = (...args) => {
      const transaction = transact(...args);
      if (transaction.mode === "readwrite" && ["chart-statuses", "manual-targets", "daily-targets", "chart-option-memos"].some(name => transaction.objectStoreNames.contains(name))) {
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
  function open(platform = "ac") {
    const name = databaseNames.get(platform);
    if (!name) return Promise.reject(new RangeError("Unknown storage platform: " + platform));
    if (openings.has(platform)) return openings.get(platform);
    const suffix = platform === "ac" ? "" : "-inf";
    const channel = getChannel(suffix);
    function release() {
      if (openings.get(platform) === opening) openings.delete(platform);
    }
    const opening = new Promise((resolve, reject) => {
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
            release();
            window.dispatchEvent(new Event("cpi:storage-versionchange" + suffix));
          };
          database.onclose = release;
          if (!complete(database)) {
            const next = Math.max(5, database.version + 1);
            database.close();
            attempt(next);
            return;
          }
          watch(database, channel);
          settled = true;
          resolve(database);
        };
      }
      attempt();
    }).catch(error => { release(); throw error; });
    openings.set(platform, opening);
    return opening;
  }
  window.cpiStorage = Object.freeze({ open });
})();
