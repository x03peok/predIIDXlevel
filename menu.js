document.addEventListener("DOMContentLoaded", () => {
  const menuRoot = document.getElementById("menuRoot");
  const menuButton = document.getElementById("menuButton");
  const siteMenu = document.getElementById("siteMenu");

  if (!menuRoot || !menuButton || !siteMenu) {
    return;
  }

  const currentPage = document.body.dataset.page || "";
  const staticPrefix = document.body.dataset.staticChartPage === "true" ? "../" : "";
  const menuDefinitions = [
    { page: "main", label: "Pred難易度表", href: staticPrefix + "index.html" },
    { page: "record", label: "クリアランプ登録", href: staticPrefix + "record.html" },
    { page: "mypage", label: "マイページ", href: staticPrefix + "mypage.html" },
    { page: "settings", label: "設定", href: staticPrefix + "settings.html" },
    { page: "diagnosis", label: "適正診断", href: staticPrefix + "diagnosis.html" },
    { page: "about", label: "About", href: staticPrefix + "about.html" },
    { page: "history", label: "サイト更新履歴", href: staticPrefix + "history.html" },
  ];

  for (const definition of menuDefinitions) {
    const selector = '[data-page="' + definition.page + '"]';
    const matchingItems = Array.from(siteMenu.querySelectorAll(selector));
    const item = matchingItems.shift() || document.createElement("button");
    for (const duplicate of matchingItems) {
      duplicate.remove();
    }
    item.type = "button";
    item.className = "menu-item";
    item.dataset.page = definition.page;
    item.dataset.href = definition.href;
    item.textContent = definition.label;
    siteMenu.append(item);
  }

  const menuItems = Array.from(siteMenu.querySelectorAll(".menu-item"));

  function setMenuOpen(open) {
    siteMenu.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
  }

  for (const item of menuItems) {
    item.classList.toggle("is-active", item.dataset.page === currentPage);
    item.addEventListener("click", () => {
      setMenuOpen(false);

      const href = item.dataset.href;
      if (!href) {
        return;
      }

      const targetUrl = new URL(href, window.location.href).href;
      if (targetUrl !== window.location.href) {
        window.location.href = targetUrl;
      }
    });
  }

  menuButton.addEventListener("click", () => {
    setMenuOpen(siteMenu.hidden);
  });

  document.addEventListener("click", (event) => {
    if (!menuRoot.contains(event.target)) {
      setMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMenuOpen(false);
    }
  });
});
