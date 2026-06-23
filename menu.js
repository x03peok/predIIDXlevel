document.addEventListener("DOMContentLoaded", () => {
  const menuRoot = document.getElementById("menuRoot");
  const menuButton = document.getElementById("menuButton");
  const siteMenu = document.getElementById("siteMenu");

  if (!menuRoot || !menuButton || !siteMenu) {
    return;
  }

  const currentPage = document.body.dataset.page || "";
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
