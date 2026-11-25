## GE Smart Timer & Error Control — Extension Chrome pour GlobalExam

Cette extension Chrome automatise la résolution des exercices sur GlobalExam (QCM, phrases à trous et exercices Listening avec transcription) en s'appuyant sur l'API Google Gemini. Elle intègre un délai de réponse aléatoire et un taux d'erreur réglable pour simuler un rythme naturel.

### Installation dans Google Chrome
1. Télécharge le projet en cliquant sur **Code → Download ZIP** puis extrais le dossier sur ton ordinateur.
2. Ouvre Google Chrome et va à l'adresse `chrome://extensions`.
3. Active le **Mode développeur** (interrupteur en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et sélectionne le dossier `GE-Smart-Extension` extrait.

### Configuration de ta clé API Gemini (obligatoire)
Chaque utilisateur doit utiliser sa propre clé API gratuite :
1. Rends-toi sur [Google AI Studio](https://aistudio.google.com/apikey) et génère une clé API.
2. Retourne sur `chrome://extensions`, repère **GE Smart Timer & Error Control** et clique sur le lien **service worker** (sous « Examiner les vues »).
3. Dans l'onglet **Console** qui s'ouvre, colle cette commande avec ta clé et appuie sur **Entrée** :
   ```js
   chrome.storage.sync.set({ apiKey: "TA_CLE_API" }, () => console.log("Clé enregistrée"));
