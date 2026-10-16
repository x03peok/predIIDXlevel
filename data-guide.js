"use strict";

(async () => {
  const status = document.getElementById("dataVersionStatus");
  const list = document.getElementById("dataVersionList");
  try {
    const response = await fetch("data/v1/manifest.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Manifest request failed.");
    const manifest = await response.json();
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.versions)) throw new Error("Invalid manifest.");
    const latest = manifest.versions.find(entry => entry.dataVersion === manifest.latest);
    if (!latest) throw new Error("Missing latest version.");
    const fragment = document.createDocumentFragment();
    for (const entry of manifest.versions) {
      if (!/^\d{8}-[a-f0-9]{12}$/.test(entry.dataVersion)) throw new Error("Invalid version ID.");
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `data/v1/versions/${entry.dataVersion}.json`;
      link.textContent = entry.dataVersion;
      const date = new Date(entry.updatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      item.append(link, ` / ${Number(entry.chartCount).toLocaleString("ja-JP")}譜面 / ${date} JST${entry.dataVersion === manifest.latest ? "（最新版）" : ""}`);
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    status.textContent = `最新版：${latest.dataVersion} / ${Number(latest.chartCount).toLocaleString("ja-JP")}譜面`;
  } catch (error) {
    status.textContent = "バージョン一覧を表示できませんでした。上のJSONリンクから確認してください。";
  }
})();
