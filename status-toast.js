(function () {
  "use strict";

  const defaultDuration = 5000;
  let toast = null;
  let message = null;
  let undoButton = null;
  let undoHandler = null;
  let hideTimer = 0;

  function ensureToast() {
    if (toast) {
      return;
    }

    toast = document.createElement("div");
    toast.className = "status-toast status-toast--visibility-refresh";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("aria-hidden", "true");

    message = document.createElement("span");
    message.className = "status-toast__message";
    undoButton = document.createElement("button");
    undoButton.type = "button";
    undoButton.className = "status-toast__undo";
    undoButton.textContent = "元に戻す";
    undoButton.addEventListener("click", async () => {
      const handler = undoHandler;
      if (typeof handler !== "function") {
        return;
      }

      undoButton.disabled = true;
      try {
        await handler();
        hideToast();
      } catch (error) {
        undoHandler = null;
        message.textContent = error?.message || "元に戻せませんでした。";
        undoButton.hidden = true;
        scheduleHide(defaultDuration);
      } finally {
        undoButton.disabled = false;
      }
    });

    toast.append(message, undoButton);
    document.body.append(toast);
  }

  function scheduleHide(duration) {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideToast, duration);
  }

  function hideToast() {
    window.clearTimeout(hideTimer);
    hideTimer = 0;
    undoHandler = null;
    if (!toast) {
      return;
    }
    toast.classList.remove("is-visible");
    toast.setAttribute("aria-hidden", "true");
  }

  function showToast(options = {}) {
    ensureToast();
    undoHandler = typeof options.onUndo === "function" ? options.onUndo : null;
    message.textContent = options.message || "Statusを変更しました";
    undoButton.hidden = !undoHandler;
    undoButton.disabled = false;
    toast.setAttribute("aria-hidden", "false");
    toast.classList.add("is-visible");
    scheduleHide(Number.isFinite(options.duration) ? options.duration : defaultDuration);
  }

  window.cpiStatusToast = {
    show: showToast,
    hide: hideToast,
  };
}());
