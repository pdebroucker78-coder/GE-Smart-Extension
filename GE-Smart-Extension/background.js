const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest"
];

function cleanBlankAnswer(raw) {
  let s = (raw || "").trim();
  s = s.split("\n")[0].trim();
  s = s.replace(/\s*\(.*?\)\s*/g, " ").trim();
  s = s.split(/\s+or\s+|\s*\/\s*|\s*,\s*/i)[0].trim();
  s = s.replace(/^["'«»*•\-–—]+|["'«»*•.,!?;:]+$/g, "").trim();
  return s;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "SOLVE_QUESTION") return;

  chrome.storage.sync.get({ apiKey: "" }, async ({ apiKey }) => {
    const cleanKey = (apiKey || "").trim();
    if (!cleanKey) {
      sendResponse({ ok: false, error: "Clé API manquante" });
      return;
    }

    const isFillBlank = msg.mode === "fill_blank" || !(msg.optionsText && msg.optionsText.length);

    const prompt = isFillBlank
      ? [
          "Tu es un assistant pour exercices d'anglais (remplir les blancs).",
          "Donne UNE SEULE réponse courte (1 à 3 mots maximum), sans parenthèses, sans alternatives ('or' / '/') et sans explication.",
          msg.forceError
            ? "Consigne : donne délibérément un mot incorrect qui ne convient pas au contexte."
            : "Consigne : donne UNIQUEMENT le mot ou l'expression manquante la plus naturelle.",
          "",
          "Contexte / phrase :",
          (msg.contextText || "").slice(0, 3500)
        ].join("\n")
      : [
          "Tu es un assistant d'analyse pour QCM d'anglais (Listening / Reading).",
          "Analyse le contexte et les options ci-dessous.",
          msg.forceError
            ? "Consigne : choisis délibérément une option INCORRECTE parmi celles proposées."
            : "Consigne : choisis la MEILLEURE réponse possible selon le texte, la grammaire et le sens.",
          "Réponds UNIQUEMENT par le numéro de l'option (ex: 1, 2, 3 ou 4), sans autre texte.",
          "",
          "Contexte visible :",
          (msg.contextText || "").slice(0, 3500),
          "",
          "Options :",
          (msg.optionsText || []).map((opt, i) => `${i + 1}. ${opt}`).join("\n")
        ].join("\n");

    let lastError = "Aucun modèle disponible";

    for (const model of MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": cleanKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: msg.forceError ? 0.8 : 0.1 }
          })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          lastError = `${model}: HTTP ${res.status} - ${data?.error?.message || ""}`;
          if (res.status === 503 || res.status === 429 || res.status === 404) continue;
          sendResponse({ ok: false, error: lastError });
          return;
        }

        const raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();

        if (isFillBlank) {
          const answerText = cleanBlankAnswer(raw);
          if (answerText) {
            sendResponse({ ok: true, mode: "fill_blank", answerText, raw, model });
            return;
          }
          lastError = `${model}: réponse vide`;
        } else {
          const match = raw.match(/\b([1-9])\b/);
          const choiceIndex = match ? Number(match[1]) - 1 : -1;
          if (choiceIndex >= 0) {
            sendResponse({ ok: true, mode: "mcq", choiceIndex, raw, model });
            return;
          }
          lastError = `${model}: réponse hors format (${raw})`;
        }
      } catch (err) {
        lastError = `${model}: ${String(err)}`;
      }
    }

    sendResponse({ ok: false, error: lastError });
  });

  return true;
});
