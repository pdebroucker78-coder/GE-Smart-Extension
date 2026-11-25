(() => {
  const DEFAULT_SETTINGS = { enabled: false, minDelay: 20, maxDelay: 30, errorRate: 15, apiKey: "" };
  let settings = { ...DEFAULT_SETTINGS };
  let activeTimer = null;
  let isBusy = false;
  let answeredKeys = new Set();

  let errorBudget = 0;
  let totalAnswered = 0;
  let totalErrors = 0;
  let currentPath = window.location.pathname;

  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    settings = { ...DEFAULT_SETTINGS, ...stored };
    if (settings.enabled) tick();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    if (activeTimer) { clearTimeout(activeTimer); activeTimer = null; }
    isBusy = false;
    if (settings.enabled) tick();
  });

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" && !el.disabled;
  }

  function norm(str) {
    return (str || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function tokens(str) {
    return norm(str)
      .replace(/[^a-zàâäéèêëîïôöùûüç0-9\s']/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3);
  }

  function getRandomDelayMs() {
    const min = Math.max(1, Math.min(Number(settings.minDelay) || 20, Number(settings.maxDelay) || 30));
    const max = Math.max(min, Math.max(Number(settings.minDelay) || 20, Number(settings.maxDelay) || 30));
    return Math.round((min + Math.random() * (max - min)) * 1000);
  }

  function nextQuestionShouldError() {
    if (window.location.pathname !== currentPath) {
      currentPath = window.location.pathname;
      errorBudget = 0;
      totalAnswered = 0;
      totalErrors = 0;
      answeredKeys.clear();
    }

    const rate = Number(settings.errorRate);
    if (!Number.isFinite(rate) || rate <= 0) return false;
    if (rate >= 100) return true;

    errorBudget += rate / 100;
    if (errorBudget >= 1) {
      errorBudget -= 1;
      return true;
    }
    return false;
  }

  function realClick(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    ["pointerdown", "mousedown", "mouseup", "click"].forEach((evt) => {
      el.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
    });
  }

  function setNativeValue(el, value) {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();

    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      return;
    }

    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && typeof desc.set === "function") {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function getFieldValue(el) {
    if (!el) return "";
    return el.isContentEditable ? (el.textContent || "").trim() : (el.value || "").trim();
  }

  function extractAudioTranscript() {
    const snippets = [];
    const seen = new Set();

    const addText = (label, raw) => {
      const cleaned = (raw || "").replace(/\s+/g, " ").trim();
      if (!cleaned || cleaned.length < 4) return;
      const key = `${label}:${cleaned.slice(0, 120)}`;
      if (seen.has(key)) return;
      seen.add(key);
      snippets.push(`[${label}] ${cleaned.slice(0, 2200)}`);
    };

    const transcriptSelectors = [
      "[class*='transcript']",
      "[id*='transcript']",
      "[data-testid*='transcript']",
      "[class*='script']",
      "[id*='script']",
      "[class*='subtitle']",
      "[class*='caption']",
      "[class*='listening']",
      "[class*='audio']"
    ];

    document.querySelectorAll(transcriptSelectors.join(",")).forEach((el) => {
      const txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (txt && txt.length >= 10 && txt.length <= 4000) {
        addText("TRANSCRIPT/AUDIO", txt);
      }
    });

    document.querySelectorAll("audio, video").forEach((media) => {
      if (media.currentSrc) addText("MEDIA_SRC", media.currentSrc);
      media.querySelectorAll("track").forEach((tr) => {
        if (tr.label) addText("TRACK_LABEL", tr.label);
        if (tr.src) addText("TRACK_SRC", tr.src);
      });
    });

    return snippets.join(" | ").slice(0, 2600);
  }

  function extractTextWithBlanks(rootEl, targetInput) {
    if (!rootEl) return "";
    const parts = [];
    const walk = (node) => {
      if (!node) return;
      if (node === targetInput) {
        parts.push(" [BLANK_TO_FILL] ");
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName;
        if (tag === "SCRIPT" || tag === "STYLE") return;
        if (tag === "INPUT" || tag === "TEXTAREA") {
          const val = (node.value || "").trim();
          parts.push(val ? ` [${val}] ` : " _____ ");
          return;
        }
      }
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.nodeValue || "");
        return;
      }
      node.childNodes.forEach(walk);
    };
    walk(rootEl);
    return parts.join("").replace(/\s+/g, " ").trim();
  }

  function getSentenceContext(el) {
    let cur = el?.parentElement;
    while (cur && cur !== document.body) {
      const txt = (cur.innerText || "").replace(/\s+/g, " ").trim();
      if (txt.length >= 25 && txt.length <= 1200) {
        return extractTextWithBlanks(cur, el);
      }
      cur = cur.parentElement;
    }
    return extractTextWithBlanks(document.body, el).slice(0, 3500);
  }

  function buildFullContext(baseContext) {
    const transcript = extractAudioTranscript();
    const pageText = (document.body ? document.body.innerText : "").replace(/\s+/g, " ").trim().slice(0, 2200);
    const parts = [];
    if (transcript) parts.push(`Transcription / Zone audio : ${transcript}`);
    if (baseContext) parts.push(`Question / Contexte : ${baseContext}`);
    if (pageText && (!baseContext || !pageText.includes(baseContext.slice(0, 60)))) {
      parts.push(`Texte visible de la page : ${pageText}`);
    }
    return parts.join("\n\n").slice(0, 4200);
  }

  function getQuestionGroups() {
    const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(isVisible);
    if (radios.length >= 2) {
      const byName = new Map();
      radios.forEach((r, idx) => {
        const groupKey = r.name || r.closest("fieldset, form, [data-question]")?.dataset?.question || `g_${Math.floor(idx / 4)}`;
        const targetEl =
          r.closest("label") ||
          (r.id ? document.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null) ||
          r;
        if (!byName.has(groupKey)) byName.set(groupKey, []);
        byName.get(groupKey).push({ input: r, el: targetEl });
      });
      return Array.from(byName.entries()).map(([key, items]) => ({
        type: "mcq",
        key: `${window.location.pathname}::${key}::${items.map((x) => norm(x.el.innerText)).join("|")}`,
        items
      }));
    }

    const labels = Array.from(document.querySelectorAll("label")).filter(
      (l) => isVisible(l) && norm(l.innerText).length > 0 && norm(l.innerText).length < 250
    );
    if (labels.length >= 2) {
      return [
        {
          type: "mcq",
          key: `${window.location.pathname}::labels::${labels.map((l) => norm(l.innerText)).join("|")}`,
          items: labels.map((l) => ({ input: l.querySelector("input"), el: l }))
        }
      ];
    }

    const textInputs = Array.from(
      document.querySelectorAll('input[type="text"], input:not([type]), textarea, [contenteditable="true"]')
    ).filter((el) => {
      if (!isVisible(el) || el.readOnly) return false;
      const ph = norm(el.getAttribute("placeholder") || "");
      const aria = norm(el.getAttribute("aria-label") || "");
      return !ph.includes("search") && !ph.includes("recherch") && !aria.includes("search");
    });

    if (textInputs.length > 0) {
      return textInputs.map((el, idx) => {
        const ctx = getSentenceContext(el);
        return {
          type: "fill_blank",
          key: `${window.location.pathname}::blank::${idx}::${norm(ctx).slice(0, 140)}`,
          input: el
        };
      });
    }

    return [];
  }

  function fallbackKeywordIndex(options, forceError) {
    const bodyTokenSet = new Set(tokens(document.body ? document.body.innerText : ""));
    let bestIdx = 0;
    let bestScore = -Infinity;
    options.forEach((el, idx) => {
      const words = tokens(el.innerText);
      let s = 0;
      words.forEach((w) => { if (bodyTokenSet.has(w)) s += 1; });
      if (s > bestScore) { bestScore = s; bestIdx = idx; }
    });
    if (!forceError) return bestIdx;
    const wrongs = options.map((_, i) => i).filter((i) => i !== bestIdx);
    return wrongs.length ? wrongs[Math.floor(Math.random() * wrongs.length)] : 0;
  }

  function askRobot(payload, customContext) {
    return new Promise((resolve) => {
      const contextText = buildFullContext(customContext);
      chrome.runtime.sendMessage(
        { type: "SOLVE_QUESTION", contextText, ...payload },
        (resp) => resolve(resp || { ok: false })
      );
    });
  }

  function isGroupAnswered(group) {
    if (group.type === "fill_blank") {
      return getFieldValue(group.input).length > 0;
    }
    return group.items.some(({ input, el }) => {
      if (input && input.checked) return true;
      if (el && (el.getAttribute("aria-checked") === "true" || (el.className || "").toLowerCase().includes("selected") || (el.className || "").toLowerCase().includes("checked"))) {
        return true;
      }
      return false;
    });
  }

  function findNextButton() {
    const btns = Array.from(document.querySelectorAll("button, [role='button']")).filter((b) => {
      if (!isVisible(b) || b.disabled || b.getAttribute("aria-disabled") === "true") return false;
      const t = norm(b.innerText);
      return t.includes("valider") || t.includes("suivant") || t.includes("continuer") || t.includes("next");
    });
    return btns[0] || null;
  }

  function tick() {
    if (!settings.enabled || isBusy) return;

    const groups = getQuestionGroups();
    if (groups.length === 0) return;

    const pendingGroup = groups.find((g) => !isGroupAnswered(g) && !answeredKeys.has(g.key));

    if (!pendingGroup) {
      const allAnswered = groups.every((g) => isGroupAnswered(g) || answeredKeys.has(g.key));
      if (allAnswered) {
        const nextBtn = findNextButton();
        if (nextBtn) {
          isBusy = true;
          activeTimer = setTimeout(() => {
            activeTimer = null;
            try {
              const btnNow = findNextButton();
              if (btnNow && settings.enabled) realClick(btnNow);
            } finally {
              isBusy = false;
            }
          }, 1200);
        }
      }
      return;
    }

    isBusy = true;
    const delayMs = getRandomDelayMs();

    activeTimer = setTimeout(async () => {
      activeTimer = null;
      try {
        if (!settings.enabled) return;

        const currentGroups = getQuestionGroups();
        const targetGroup = currentGroups.find((g) => g.key === pendingGroup.key) || pendingGroup;
        const makeErr = nextQuestionShouldError();

        if (targetGroup.type === "fill_blank") {
          const targetedContext = getSentenceContext(targetGroup.input);
          const aiResp = await askRobot({ mode: "fill_blank", optionsText: [], forceError: makeErr }, targetedContext);
          const cleanAiAnswer = (aiResp && aiResp.ok && aiResp.answerText ? String(aiResp.answerText) : "").trim();
          const textToFill = cleanAiAnswer || "answer";
          const sourceLabel = cleanAiAnswer
            ? `${makeErr ? "IA-erreur" : "IA"}:${aiResp.model || "ok"}`
            : `ERR-IA:${aiResp?.error || "vide"}`;

          setNativeValue(targetGroup.input, textToFill);
          answeredKeys.add(targetGroup.key);

          totalAnswered += 1;
          if (makeErr) totalErrors += 1;
          const pct = ((totalErrors / totalAnswered) * 100).toFixed(1);

          console.log(
            `[GE Smart] Q${totalAnswered} -> texte "${textToFill}" (${sourceLabel}) | Bilan : ${totalErrors}/${totalAnswered} (${pct}%)`
          );
          return;
        }

        const options = targetGroup.items.map((x) => x.el).filter(Boolean);
        if (options.length >= 2) {
          const optionsText = options.map((el) => (el.innerText || "").replace(/\s+/g, " ").trim());
          const aiResp = await askRobot({ mode: "mcq", optionsText, forceError: makeErr });

          let chosenIdx;
          let sourceLabel;
          if (aiResp.ok && aiResp.choiceIndex >= 0 && aiResp.choiceIndex < options.length) {
            chosenIdx = aiResp.choiceIndex;
            sourceLabel = makeErr ? "IA-erreur" : "IA";
          } else {
            chosenIdx = fallbackKeywordIndex(options, makeErr);
            sourceLabel = makeErr ? "secours-erreur" : "secours-mots-clés";
          }

          realClick(options[chosenIdx]);
          answeredKeys.add(targetGroup.key);

          totalAnswered += 1;
          if (makeErr) totalErrors += 1;
          const pct = ((totalErrors / totalAnswered) * 100).toFixed(1);

          console.log(
            `[GE Smart] Q${totalAnswered} -> option #${chosenIdx + 1} (${sourceLabel}) | Bilan : ${totalErrors}/${totalAnswered} (${pct}%)`
          );
        }
      } finally {
        isBusy = false;
        if (settings.enabled) setTimeout(tick, 700);
      }
    }, delayMs);
  }

  const obs = new MutationObserver(() => { if (settings.enabled) tick(); });
  if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  setInterval(() => { if (settings.enabled) tick(); }, 1500);
})();
