const DEFAULT_SETTINGS = { enabled: false, minDelay: 20, maxDelay: 30, errorRate: 15 };

document.addEventListener("DOMContentLoaded", () => {
  const enabledEl = document.getElementById("enabled");
  const minDelayEl = document.getElementById("minDelay");
  const maxDelayEl = document.getElementById("maxDelay");
  const errorRateEl = document.getElementById("errorRate");
  const saveBtn = document.getElementById("saveBtn");
  const statusEl = document.getElementById("status");

  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    enabledEl.checked = Boolean(settings.enabled);
    minDelayEl.value = settings.minDelay;
    maxDelayEl.value = settings.maxDelay;
    errorRateEl.value = settings.errorRate;
  });

  saveBtn.addEventListener("click", () => {
    let minDelay = parseInt(minDelayEl.value, 10);
    let maxDelay = parseInt(maxDelayEl.value, 10);
    let errorRate = parseInt(errorRateEl.value, 10);

    if (Number.isNaN(minDelay) || minDelay < 1) minDelay = 1;
    if (Number.isNaN(maxDelay) || maxDelay < minDelay) maxDelay = minDelay;
    if (Number.isNaN(errorRate)) errorRate = 0;
    errorRate = Math.max(0, Math.min(100, errorRate));

    minDelayEl.value = minDelay;
    maxDelayEl.value = maxDelay;
    errorRateEl.value = errorRate;

    chrome.storage.sync.set({ enabled: enabledEl.checked, minDelay, maxDelay, errorRate }, () => {
      statusEl.textContent = "Réglages enregistrés.";
      setTimeout(() => { statusEl.textContent = ""; }, 2000);
    });
  });
});
