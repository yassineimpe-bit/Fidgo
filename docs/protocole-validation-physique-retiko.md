# Protocole de Validation Physique - Retiko (Pré-Pilote)

**Objectif :** Valider les conditions réelles d'utilisation (Gate Pilote §23) et fermer les sections §6, §7, §10, §11 en s'assurant que l'application est prête pour un usage intensif en commerce.  

> **Complément UX :** l'autonomie, la compréhension et les frictions humaines du premier commerce pilote sont évaluées séparément dans [`docs/protocole-ux-pilote-retiko.md`](./protocole-ux-pilote-retiko.md). Ce protocole UX ne remplace aucun test physique, mesure p95 ou audit du ledger ci-dessous.
**Ressources :** 1 testeur, 2 smartphones (1 iPhone récent, 1 Android récent), 1 Mac avec le dépôt Retiko (`npm ci`) pour l'analyse.

> **Ce qui est automatisé :** uniquement la collecte et le calcul des mesures (export `/s/stats`, `npm run pilot:field-report`) et le rapprochement en lecture seule avec le ledger (`npm run pilot:ledger-audit`).
> **Ce qui reste humain :** les scans physiques, la caméra, la lumière, l'UX rush, Safari iOS, Chrome Android et les Wallets. Aucun test automatisé (Playwright ou autre) ne coche une case de ce protocole.

## 1. Préparation & Matériel

### Matériel requis

- **Appareil A (iPhone) :** iPhone récent (iOS à jour), navigateur Safari principal.
- **Appareil B (Android) :** Smartphone Android récent, navigateur Chrome principal.
- **Règle de test :** Un appareil ne pouvant scanner son propre écran, l'iPhone scanne toujours l'Android, et l'Android scanne toujours l'iPhone.
- **Réseau :** Connexion 4G/5G standard. Prévoir un moyen de brider ou couper temporairement la connexion pour les tests adverses.

### Configuration Wallets (Production)

**Apple Wallet (§10)**

- [ ] Certificats Apple Wallet de production générés et valides.
- [ ] Serveur configuré pour signer les pass avec les certificats de production.

**Google Wallet (§11)**

- [ ] Compte Google Wallet / Issuer de production approuvé.
- [ ] Service Account configuré côté backend.
- [ ] Credentials de production chargés côté serveur uniquement.

## 2. Parcours Initial : Création de Zéro

*À réaliser avant de démarrer les scans physiques.*

- [ ] Inscription (Signup) d'un nouveau commerce.
- [ ] Vérification de l'e-mail.
- [ ] Onboarding complété.
- [ ] Configuration d'un programme de fidélité basique.
- [ ] Création d'un premier compte Employé.
- [ ] Génération et affichage du QR Code d'inscription du commerce.
- [ ] Scan du QR d'inscription par le client.
- [ ] Inscription client réussie.
- [ ] PWA installée sur iPhone via Safari.
- [ ] PWA installée sur Android via Chrome.
- [ ] Apple Wallet installé et pass Retiko ajouté sur iPhone.
- [ ] Google Wallet installé et objet Retiko ajouté sur Android.

---

## 3. Matrice des 30 Scans Physiques Nominaux

**Objectif :** Réaliser 30 vrais scans physiques réussis en conditions normales de caisse.  
Ces 30 mesures servent au calcul des performances et à la validation de la case §23 « 30 scans physiques réels ».

Répartition :

- **15 scans avec iPhone comme scanner** et Android comme client.
- **15 scans avec Android comme scanner** et iPhone comme client.
- Les supports client alternent entre PWA et Wallet compatible.

### Procédure de collecte

Les temps officiels ne se chronomètrent pas à la main : chaque téléphone scanner enregistre localement, pour chaque scan, la durée **QR détecté → action fidélité validée**. Les deux exports sont ensuite combinés sur le Mac.

Toujours ouvrir `/s/stats` depuis le bouton **Stats** du scanner, dans la même application que celle qui scanne : sur iPhone, la PWA installée et Safari ne partagent pas leurs données, et un `/s/stats` ouvert dans l'autre application afficherait (et exporterait) zéro mesure.

**Avant la série**

1. Sur l'iPhone, ouvrir le scanner `https://retiko.fr/s` (compte Employé scanner), toucher **Stats** et vérifier que « Ce téléphone scanne en tant que » indique **iPhone**.
2. Toucher **Effacer les mesures** et confirmer.
3. Sur l'Android, ouvrir `/s` → **Stats** et vérifier **Android**.
4. Toucher **Effacer les mesures** et confirmer.

**Pendant la série**

5. Effectuer les 15 scans avec l'iPhone comme scanner (lignes 1 à 15).
6. Sur l'iPhone, toucher **Stats** : le compteur doit indiquer **15 / 15** et aucun échec. Toucher **Exporter les mesures** → `iphone.json` (feuille de partage : AirDrop vers le Mac ou « Enregistrer dans Fichiers »).
7. Effectuer les 15 scans avec l'Android comme scanner (lignes 16 à 30).
8. Sur l'Android, **Stats** → **Exporter les mesures** → `android.json` (dossier Téléchargements).

**Analyse**

9. Copier `iphone.json` et `android.json` sur le Mac (AirDrop, e-mail à soi-même, Google Drive ou câble), sans les ouvrir dans un éditeur.
10. Depuis le dépôt Retiko, lancer :

```bash
npm run pilot:field-report -- \
  --iphone iphone.json \
  --android android.json \
  --markdown-output pilot-result.md
```

11. Reporter p50, p90, p95, max et le verdict dans la section 5, puis archiver `iphone.json`, `android.json` et `pilot-result.md` avec ce protocole.

**Règles qui conditionnent la validité des mesures**

- **Cooldown :** un programme créé depuis le 25/09/2026 refuse un second crédit sur la même carte pendant **10 min** (600 s) ; un programme plus ancien garde sa valeur (120 s auparavant). La valeur réelle se lit dans **Programme**. Pendant ce délai, le scanner affiche « Crédit récent détecté » avec un compte à rebours, et un crédit tenté est refusé (`COOLDOWN`) : il compte comme action échouée. Une série scanne en général la même carte cliente 15 fois ; avant de la commencer, choisir et noter en §8 soit une rotation de cartes clientes assez large pour qu'aucune ne revienne avant la fin du délai, soit un délai temporairement réduit sur le commerce de test (préréglage 2 min) en espaçant d'autant les scans d'une même carte, valeur d'origine rétablie avant les scénarios A1–A12.
- **Jamais de dépassement du délai pendant la série :** « Nouvel achat : autoriser un nouveau crédit » (OWNER/MANAGER, après confirmation) est un override du cooldown, audité `CARD_ADJUSTED` avec le motif `NEW_PURCHASE_CONFIRMED`. Il relève des scénarios A11/A12, pas d'un scan nominal : la série se fait avec le compte Employé, qui n'a pas ce bouton, et `pilot:ledger-audit` signale tout override survenu pendant une série.
- **QR uniquement :** une carte ouverte par saisie manuelle (code court, e-mail, téléphone) est exclue du calcul et signalée à part.
- **Échec pendant la série :** le protocole exige 30/30 scans réussis et le rapport refuse de conclure s'il trouve un échec. Documenter l'incident en §8, conserver l'export en l'état (le renommer, ex. `iphone-essai-1.json`), puis effacer les mesures de cet appareil et refaire ses 15 scans.
- **Scénarios adverses A1–A12 :** uniquement **après** les deux exports, sinon ils polluent les mesures nominales.
- **Fichiers intouchables :** l'export est validé strictement (format, version, champs) ; toute retouche est rejetée ou constitue une falsification de preuve.
- **Si l'export ne s'ouvre pas :** « Copier le JSON » place le fichier dans le presse-papiers ; en dernier recours le JSON s'affiche pour une copie manuelle dans un fichier `iphone.json` / `android.json`.

L'export ne contient que des durées (`totalMs`, `networkMs`, `serverMs`), le résultat (`ok`, code d'erreur technique), la phase (`lookup` / `action`), l'origine (`qr` / `manual`) et l'horodatage de chaque mesure : aucun QR, aucun token, aucune donnée client, aucun identifiant d'appareil. Seul le libellé `iphone` / `android` choisi par le testeur identifie le fichier.

| N° | Scanner | Client (Support) | Scénario nominal | Temps Total (ms)* | Résultat (OK/KO) | Notes |
|---|---|---|---|---:|---|---|
| 1 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 2 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 3 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 4 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 5 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 6 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 7 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 8 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 9 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 10 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 11 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 12 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 13 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 14 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 15 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 16 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 17 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 18 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 19 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 20 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 21 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 22 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 23 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 24 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 25 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 26 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 27 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 28 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 29 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 30 | Android | iPhone (PWA Safari) | Scan standard | | | |

*\* Temps Total = Détection QR → confirmation serveur affichée. Colonne facultative : les valeurs officielles sont celles du tableau « Valeurs retenues, triées » de `pilot-result.md` (appareil et horodatage de chaque scan).*

### Validation des 30 scans nominaux

- [ ] 30/30 scans physiques réellement exécutés.
- [ ] 30/30 scans réussis.
- [ ] Aucun double crédit.
- [ ] Aucun scan silencieusement perdu.
- [ ] Aucun écart de solde observé entre les supports.

---

## 4. Scénarios Adverses et Edge Cases

**Objectif :** Tester la robustesse fonctionnelle en plus des 30 scans nominaux.  
Ces scénarios ne sont **pas inclus** dans les calculs médiane / p90 / p95 : les exécuter **après** les deux exports de la section 3, jamais entre les deux séries.

Les erreurs attendues ne sont pas considérées comme des échecs si Retiko réagit conformément au comportement attendu.

| ID | Scanner | Client (Support) | Scénario adverse | Résultat attendu | Résultat (OK/KO) | Notes |
|---|---|---|---|---|---|---|
| A1 | iPhone | Android (PWA Chrome) | **Réseau lent** sur le scanner | Succès ou attente contrôlée, aucun crash, aucun double crédit | | |
| A2 | Android | iPhone (PWA Safari) | **Perte réseau temporaire pendant requête** | Erreur claire, reprise possible, aucun double crédit | | |
| A3 | Android | iPhone (Apple Wallet) | **Double lecture rapide** du même QR | Un seul crédit effectif | | |
| A4 | iPhone | Android (Google Wallet) | **Double lecture rapide** du même QR | Un seul crédit effectif | | |
| A5 | iPhone | QR externe sur écran PC | **QR invalide** | Message clair « QR non reconnu », aucune transaction | | |
| A6 | Android | iPhone (PWA Safari) | **Carte inactive / suspendue** | Refus propre, aucune transaction | | |
| A7 | Android | iPhone (Apple Wallet) | **Première consommation récompense** | Succès, récompense consommée, ledger cohérent | | |
| A8 | Android | iPhone (Apple Wallet) | **Deuxième tentative sur la même récompense** | Refus, aucun double débit, ledger inchangé | | |
| A9 | iPhone | Android (Google Wallet) | **Première consommation récompense** | Succès, récompense consommée, ledger cohérent | | |
| A10 | iPhone | Android (Google Wallet) | **Deuxième tentative sur la même récompense** | Refus, aucun double débit, ledger inchangé | | |
| A11 | iPhone | Android (PWA Chrome) | **Manager : override manuel** (« Nouvel achat : autoriser un nouveau crédit ») | Succès, solde ajusté correctement, historique correct | | |
| A12 | Android | iPhone (PWA Safari) | **Manager : override manuel** (« Nouvel achat : autoriser un nouveau crédit ») | Succès, solde ajusté correctement, historique correct | | |

### Validation des scénarios adverses

- [ ] Aucune erreur provoquée ne crée de transaction fantôme.
- [ ] Aucune perte réseau ne crée de double crédit lors de la reprise.
- [ ] Les QR invalides sont refusés proprement.
- [ ] Une récompense déjà consommée ne peut pas être rejouée.
- [ ] Les actions manager sont correctement attribuées dans l'historique.

---

## 5. Mesures de Performances & p95

Les calculs sont réalisés **uniquement sur les 30 scans nominaux réussis**, par `npm run pilot:field-report` (section 3, étape 10).

**Critère officiel :** QR détecté → action fidélité validée, soit les mesures `phase = action`, `ok = true`, `source = qr`, champ `totalMs`. Le temps QR → fiche client (`lookup`), le réseau et le serveur sont affichés à titre de diagnostic et ne servent jamais au p95 officiel. Les actions échouées sont comptées à part et exclues des percentiles.

### Méthode statistique

Utiliser la méthode **Nearest-rank** :

1. Trier les 30 temps du plus rapide au plus lent.
2. Calculer le rang :

`R = ceil(percentile × N)`

Avec `N = 30` :

- **Médiane (p50) :** rang `ceil(0,50 × 30) = 15`
- **p90 :** rang `ceil(0,90 × 30) = 27`
- **p95 :** rang `ceil(0,95 × 30) = 29`
- **Maximum :** rang 30

Le rapport calcule le rang en arithmétique entière (pas d'erreur d'arrondi flottant) et liste les 30 valeurs triées avec leur rang, ce qui permet de vérifier le calcul à la main.

### Verdicts du rapport

Le rapport n'affiche **GO** que si toutes les conditions vérifiables sur les exports sont remplies. Code de sortie : 0 pour GO, 1 sinon, 2 si un fichier est invalide.

| Verdict | Signification |
|---|---|
| **GO** | 15 actions QR réussies par téléphone (30 au total), aucun échec, aucune mesure d'origine inconnue ou perdue, p95 conforme à **tous** les seuils candidats (voir ci-dessous) |
| **NO-GO / INCOMPLET** | export manquant, ou moins de 30 actions QR réussies : aucune conclusion possible |
| **NO-GO / NON CONFORME** | données hors protocole : répartition différente de 15/15, échec pendant la série, mesures d'une ancienne version du scanner, stockage local saturé |
| **DÉCISION PRODUIT REQUISE** | p95 conforme au seuil historique mais pas au seuil renforcé |
| **NO-GO** | p95 au-delà des deux seuils candidats |

Un JSON invalide, une version d'export inconnue, un champ inattendu, une durée négative ou non finie, ou des fichiers iPhone/Android inversés sont rejetés sans produire de rapport. Aucune mesure n'est complétée ni inventée.

### Résultats (à recopier depuis `pilot-result.md`)

- **N (actions QR réussies) :** ______ (iPhone ____ / Android ____)
- **Échecs pendant la série :** ______
- **Médiane (p50) :** ______ ms
- **p90 :** ______ ms
- **p95 :** ______ ms
- **Maximum :** ______ ms
- **Verdict du rapport :** ____________________

### Seuils de référence

Les trois seuils vivent dans une source unique, `lib/pilot-gate.mjs`, lue à la fois par `/s/stats` et par le rapport. Tant que la décision n'est pas prise, le rapport affiche le résultat contre chacun d'eux séparément :

| Seuil | Règle | Origine |
|---|---|---|
| Cible interne d'optimisation | p95 ≤ 1 500 ms | ce protocole (PR #121, 24/09/2026) |
| Seuil renforcé | p95 ≤ 2 000 ms | ce protocole (PR #121, 24/09/2026) |
| Seuil historique | p95 < 2 500 ms | issue #2, `SPEC-V0.md`, `README.md`, `docs/PILOT.md`, écran `/s/stats` (depuis l'import du MVP, 15/09/2026) |

**DÉCISION PRODUIT ENCORE REQUISE : seuil officiel final = 2 000 ou 2 500 ms.**

Audit de la divergence : le seuil de 2,5 s figure dans le cahier des charges et dans l'écran `/s/stats` depuis l'import du MVP (commits `b4b2244` et `414caf6` du 15/09/2026), puis dans l'issue #2 (décision « < 2,5 s : GO pilote commerçant »), `docs/DEPLOYMENT.md`, `docs/INSTALLATION.md` et l'issue #64 (19/09/2026). Ce protocole (PR #121, commit `a9b19b7` du 24/09/2026) a introduit « p95 ≤ 2 000 ms » comme seuil officiel sans justification écrite, sans revue et sans mettre à jour les autres sources ; l'issue #88 ne chiffre pas l'objectif (« p95 parcours complet < objectif pilote »). Aucune décision postérieure et explicite ne tranche : le rapport ne choisit donc pas. Un p95 ≤ 2 000 ms satisfait les deux seuils candidats (GO) ; un p95 strictement supérieur à 2 000 ms et inférieur à 2 500 ms exige la décision ; un p95 ≥ 2 500 ms est NO-GO dans les deux cas.

Pour enregistrer la décision : mettre à jour `PILOT_THRESHOLD_DECISION` dans `lib/pilot-gate.mjs` (le rapport n'utilisera plus que le seuil retenu), cette section, puis les issues #2 et #88.

---

## 6. Preuves du gate : performance client et intégrité serveur

Les deux preuves sont indépendantes et ne se remplacent pas : les métriques navigateur ne disent rien du ledger, et le ledger ne dit rien de la vitesse perçue en caisse.

### A. Preuve client / performance

- **Source :** les exports `/s/stats` des deux téléphones scanners (`iphone.json`, `android.json`).
- **Outil :** `npm run pilot:field-report` (section 3, étape 10) ; lit uniquement les deux fichiers, n'accède à aucune base.
- **Prouve :** N, répartition 15/15, échecs, p50 / p90 / p95 / max de QR détecté → action validée, diagnostic réseau / serveur / lookup, statut face à chaque seuil.
- **Ne prouve pas :** l'absence de double crédit, la cohérence du ledger, la synchronisation des Wallets. Le rapport l'écrit lui-même : *« Ce rapport prouve les mesures client/performance. Il ne prouve pas à lui seul l'intégrité du ledger serveur. »*
- **À archiver :** `iphone.json`, `android.json`, `pilot-result.md` (et `--json-output pilot-result.json` si utile).

### B. Preuve serveur / intégrité

Obtenue séparément, jamais à partir des métriques navigateur :

1. **Rapprochement des 30 actions avec le ledger** (lecture seule) :

   ```bash
   DATABASE_URL="<url de lecture, fournie par l'environnement>" npm run pilot:ledger-audit -- \
     --establishment <slug-du-commerce-de-test> \
     --iphone iphone.json \
     --android android.json \
     --markdown-output ledger-result.md
   ```

   Pour chaque série, sur la fenêtre horaire de ses actions (horloge du téléphone, ± 1 min par défaut, `--margin-minutes` pour ajuster) : exactement une transaction `earn` par crédit réussi et une `redeem` par récompense réussie, aucun ajustement, aucune annulation, aucun override de cooldown ; sur toutes les cartes du commerce, ledger = solde et aucun solde négatif. Code 0 = COHÉRENT, 1 = À ANALYSER, 2 = erreur. Le slug du commerce figure dans son lien d'inscription `/j/<slug>`. Ne réaliser aucune autre opération sur le commerce de test pendant les séries.

   Garanties : uniquement des `SELECT`, dans une transaction `BEGIN READ ONLY` dont le script vérifie `transaction_read_only = on` avant toute lecture (PostgreSQL refuse alors toute écriture) ; `statement_timeout` de 20 s ; `DATABASE_URL` lu seulement depuis l'environnement, jamais en argument ni dans le dépôt. Utilisable sur la production ou sur une restauration de sauvegarde.

2. **Intégrité globale :** `npm run db:verify` (requêtes `SELECT` uniquement) — 0 solde négatif, 0 écart ledger/cache, 0 annulation multiple, contraintes tenant et gardes hard-delete présentes. De préférence via le workflow quotidien `database-backup`, qui l'exécute sur une restauration de la production (voir `docs/BACKUP_RESTORE.md`), sinon avec une URL de lecture fournie par l'environnement.

3. **Tests automatisés anti-double crédit existants**, verts en CI sur le commit testé : `fraud-concurrency.spec.ts` (requêtes concurrentes, idempotence), `pilot-rush.spec.ts` (30 crédits, ledger exact), `ledger-immutability.spec.ts` (ledger append-only), `database-tenant-integrity.spec.ts`. Ils sécurisent la logique ; ils ne remplacent ni le rapprochement ci-dessus ni les tests physiques.

4. **Contrôles de cohérence manuels**, à la fin des 30 scans nominaux et des scénarios adverses, sur les deux appareils et côté données :

- [ ] Le solde PWA correspond exactement au solde réel / ledger.
- [ ] Le solde Apple Wallet correspond au solde PWA iPhone après synchronisation.
- [ ] Le solde Google Wallet correspond au solde PWA Android après synchronisation.
- [ ] Aucun scan réussi n'est absent de l'historique.
- [ ] Aucune transaction n'est perdue après refresh PWA.
- [ ] Aucun double crédit silencieux après les tests A3 / A4.
- [ ] Les récompenses consommées en A7 / A9 ne sont pas rejouables en A8 / A10.
- [ ] Les actions manager sont correctement attribuées au staff dans l'historique.
- [ ] La session commerçant reste valide après une longue série de scans.
- [ ] Aucun décalage inexpliqué entre PWA, Wallet et ledger.

**Toute divergence inexpliquée entraîne un NO-GO.**

---

## 7. Checklists de Validation Spécifiques

### Checklist PWA (§6)

**Safari iOS**

- [ ] Installation PWA via écran d'accueil fonctionnelle.
- [ ] Navigation fluide en mode PWA.
- [ ] Affichage QR correct.
- [ ] Aucun débordement ou élément inaccessible.
- [ ] Refresh / réouverture conserve un état cohérent.

**Chrome Android**

- [ ] Installation PWA / écran d'accueil fonctionnelle.
- [ ] Navigation fluide.
- [ ] Affichage QR correct.
- [ ] Aucun débordement ou élément inaccessible.
- [ ] Refresh / réouverture conserve un état cohérent.

### Checklist UX Rush Commerçant (§7)

- [ ] Ouverture caméra rapide, sans délai bloquant.
- [ ] Pas besoin de viser précisément.
- [ ] QR détectable avec luminosité client réduite.
- [ ] Fonctionnement correct sous lumière moyenne / faible.
- [ ] Utilisable à une main.
- [ ] Boutons suffisamment grands.
- [ ] Feedback succès / erreur visible immédiatement.
- [ ] Temps de retour prêt au scan suivant quasi immédiat.
- [ ] Aucune action secondaire nécessaire entre deux clients.
- [ ] Aucun scroll inutile pendant le flux de scan.
- [ ] Aucun clavier virtuel intempestif.
- [ ] Verrou anti-double action pendant l'appel réseau.
- [ ] Une erreur réseau permet une reprise claire sans double crédit.
- [ ] Ouverture caméra : noter la valeur « ouverture caméra » affichée dans `/s/stats` (dernière, médiane, max sur l'appareil).
- [ ] Bouton « Torche » : présent seulement si le téléphone la pilote (souvent absent sur iPhone). Si présent, il allume et éteint réellement le flash.
- [ ] Son coupé par défaut ; le bouton « Son » l'active pour ce téléphone seulement. Vibration seulement si le téléphone la gère.
- [ ] Chaque état (validé, récompense, délai, carte inconnue, QR non reconnu, réseau, session) se comprend sans la couleur : icône et titre distincts.

### Checklist Apple Wallet (§10)

*Sur iPhone uniquement.*

- [ ] Certificat production valide.
- [ ] Création et téléchargement du pass réussis.
- [ ] Installation réelle dans Apple Wallet.
- [ ] Design / logo / données corrects.
- [ ] QR lisible par le scanner Android.
- [ ] Mise à jour après crédit.
- [ ] Délai observé de mise à jour : ______ s.
- [ ] Mise à jour après consommation de récompense.
- [ ] Données cohérentes avec PWA et ledger après synchronisation.

### Checklist Google Wallet (§11)

*Sur Android uniquement.*

- [ ] Issuer production actif.
- [ ] Service Account configuré côté backend.
- [ ] Création de l'objet réelle.
- [ ] Installation réelle dans Google Wallet.
- [ ] Design / logo / données corrects.
- [ ] QR lisible par le scanner iPhone.
- [ ] Mise à jour après crédit.
- [ ] Délai observé de mise à jour : ______ s.
- [ ] Mise à jour après consommation de récompense.
- [ ] Données cohérentes avec PWA et ledger après synchronisation.

---

## 8. Suivi des Bugs

| Gravité | Description | Étapes pour reproduire | Appareil / Support | Statut |
|---|---|---|---|---|
| P0 / P1 / P2 / P3 | | | | |

### Classification

- **P0 :** perte de données, double crédit, faille critique, système inutilisable.
- **P1 :** bug majeur bloquant le pilote ou le flux de caisse.
- **P2 :** gêne réelle avec contournement possible.
- **P3 :** cosmétique / amélioration non bloquante.

---

## 9. Conditions GO / NO-GO Pilote

La Gate Pilote (§23) est **GO** uniquement si toutes les conditions suivantes sont remplies :

- [ ] Signup → vérification e-mail → onboarding complet fonctionnent sur le commerce de test.
- [ ] Les **30 scans physiques nominaux** ont tous été réellement exécutés.
- [ ] **30/30 scans nominaux réussis.**
- [ ] **p95 nominal conforme au seuil officiel** : verdict GO de `npm run pilot:field-report` (seuil officiel 2 000 ou 2 500 ms : décision produit encore requise, voir section 5).
- [ ] Preuve serveur : `npm run pilot:ledger-audit` COHÉRENT et `npm run db:verify` vert.
- [ ] Aucun double crédit silencieux.
- [ ] Aucun scan nominal perdu.
- [ ] Aucun écart inexpliqué entre PWA, Wallets et ledger.
- [ ] Apple Wallet validé sur un vrai iPhone.
- [ ] Google Wallet validé sur un vrai Android.
- [ ] Safari iOS validé.
- [ ] Chrome Android validé.
- [ ] Les scénarios adverses A1 à A12 ont tous été exécutés.
- [ ] Les comportements d'erreur correspondent aux résultats attendus.
- [ ] Zéro bug P0.
- [ ] Zéro bug P1.
- [ ] UX rush commerçant jugée utilisable.
- [ ] Scanner utilisable sans manipulation secondaire entre deux clients.

### Décision finale

- **GO pilote :** [ ]
- **NO-GO pilote :** [ ]

**Date :** ____________________  
**Testeur :** ____________________  
**Version / commit Retiko testé :** ____________________  
**iPhone / version iOS :** ____________________  
**Android / version Android :** ____________________  
**Réseau principal utilisé :** ____________________

---

## 10. Résumé de Validation

| Domaine | Statut |
|---|---|
| PWA Safari iOS | ⬜ |
| PWA Chrome Android | ⬜ |
| Scanner iPhone | ⬜ |
| Scanner Android | ⬜ |
| Apple Wallet | ⬜ |
| Google Wallet | ⬜ |
| 30 scans physiques | ⬜ |
| p95 conforme au seuil officiel (2 000 ou 2 500 ms : décision requise) | ⬜ |
| Anti-double crédit | ⬜ |
| Intégrité ledger | ⬜ |
| UX Rush | ⬜ |
| Gate Pilote §23 | ⬜ |
