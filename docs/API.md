# API MVP Retiko

Lorsque Stripe est activé et entièrement configuré, les routes opérationnelles
`/api/scan`, `/api/lookup`, `/api/credit` et `/api/redeem` renvoient
`402 { "error": "BILLING_REQUIRED" }` si l'essai est expiré ou si l'abonnement
n'est plus actif. `/api/enroll` renvoie alors `403 { "error":
"PROGRAM_UNAVAILABLE" }`. La connexion et les lectures du dashboard restent
accessibles afin que le commerce puisse consulter ses données et se réabonner.

## Public

### `POST /api/auth/signup`
Crée un établissement, un programme par défaut, un owner et une souscription trial locale. Limité par IP.

### `POST /api/auth/login`
Crée une session commerçant httpOnly de 12 h. Protection anti-bruteforce par couple IP/email.

### `POST /api/enroll`
Entrée : `slug`, `firstName?`, `email`, `phone?`, `marketingConsent`.
Retour : `token`, `short_code`, `balance`. L'email est obligatoire depuis la V0 (récupération de carte) ; prénom et téléphone restent facultatifs.

### `POST /api/recovery/request`
Entrée : `slug`, `email`. La réponse publique est volontairement identique qu'une carte existe ou non. Un email n'est réellement envoyé que si une carte active correspond à l'adresse.

### `POST /api/events`
Enregistre `JOIN_PAGE_VIEW` sur la surface publique. Pour un membre du staff authentifié, le pipeline scanner émet `CAMERA_START`, `CAMERA_READY`, `CAMERA_FAILED`, `QR_DETECTED`, `SCAN_SENT`, `SCAN_SUCCESS` et `SCAN_FAILED`. Ces événements acceptent `durationMs` et `source`, sans token brut ni donnée de contact.

### `GET /api/card/[token]`
Retourne uniquement les données nécessaires à l'affichage public de la carte, sans email ni téléphone. Réponse `no-store`.

### `POST /api/card/status`
Lecture légère dédiée au rafraîchissement de la carte : entrée `{ token }` en JSON (jamais dans l'URL, pour ne pas l'exposer dans les journaux d'accès), retour `balance`, `threshold`, `rewardAvailable`, `updatedAt`. Elle possède un rate limiter distinct, compatible avec un polling toutes les trois secondes pendant cinq minutes.

## Commerçant authentifié

La session est revérifiée en base à chaque requête protégée afin qu'un employé désactivé perde réellement l'accès. Les mutations refusent une origine web différente.

### `POST /api/scan`
Valide le QR dans le tenant courant et retourne la fiche minimale avant action.

### `POST /api/credit`
Entrée : `token`, `idempotencyKey`, `purchaseAmountCents?`, `overrideReason?`.
- tampons : le serveur applique strictement `stamps_per_visit` ;
- points `PER_PURCHASE` : le serveur applique strictement `points_per_purchase` ;
- points `PER_EURO` : un montant d'achat positif est obligatoire.

Applique aussi cooldown, limite quotidienne, verrou `FOR UPDATE` et idempotence.
Un OWNER/MANAGER peut dépasser le cooldown avec `overrideReason`. Le motif est obligatoire et produit un audit `CARD_ADJUSTED`.

### `POST /api/redeem`
Consomme exactement le seuil de récompense configuré. **Staff-only** : une session staff authentifiée avec droit de scan est obligatoire. La carte publique `/c/{token}` affiche qu'une récompense est disponible mais ne peut jamais la consommer.

### `POST /api/transactions/reverse`
OWNER/MANAGER seulement. Crée une transaction inverse. Une transaction de type `reversal` ne peut pas être inversée à nouveau.

### `GET /api/history?limit=20`
Dernières transactions du tenant.

### `GET /api/lookup?q=`
Fallback caisse par code court ou email.

### `GET|PATCH /api/program`
Lecture/configuration du programme. PATCH réservé OWNER/MANAGER.

### `GET|PATCH /api/restaurant`
Profil commerce. PATCH réservé OWNER/MANAGER.

### `GET /api/dashboard`
KPI simples du restaurant.

### `GET|POST /api/employees`
Liste l'équipe ou crée un accès `EMPLOYEE`/`VIEWER`.

### `PATCH /api/employees/[id]`
Désactive/réactive un employé non privilégié. Une session existante devient alors inutilisable à la requête suivante.

### `GET /api/customers/[id]/export`
OWNER/MANAGER. Exporte en JSON versionné les données rattachées au client : profil, carte sans token d'accès, transactions, états Wallet sans credential, historique des liens de récupération sans hash, événements produit et audits associés. La ressource doit appartenir au tenant courant et ne doit pas être supprimée ; sinon la route répond `404`. Réponse `no-store`.

### `DELETE /api/customers/[id]`
OWNER/MANAGER. Sous verrou transactionnel, efface prénom/email/téléphone/consentement, marque le client supprimé, révoque et renouvelle les identifiants de carte, invalide les liens de récupération, révoque les Wallets et détache les données techniques superflues. Le ledger et ses UUID restent pseudonymisés pour préserver l'intégrité comptable et anti-fraude. Une suppression répétée répond `404`.

### `POST /api/customers/[id]/adjust`
OWNER/MANAGER. Entrée : `newBalance`, `reason`, `idempotencyKey`. Verrouille la carte, ajoute une transaction `adjust` et un audit `CARD_ADJUSTED`, puis synchronise les Wallets activés.

### `POST /api/restaurant/suspend`
OWNER seulement. Suspension conservatrice de l'établissement, protégée par same-origin, rate limit et confirmation exacte du slug avec la phrase `SUSPENDRE`. Désactive immédiatement le staff et invalide ses sessions, révoque les cartes, liens de récupération et Wallets, puis conserve clients, transactions et configuration pour le ledger et une éventuelle procédure contrôlée. Cette route ne réalise aucune suppression définitive.

## Facturation Stripe optionnelle

Ces routes sont inactives lorsque `STRIPE_ENABLED` n'est pas `true`. Leur indisponibilité ne bloque aucune route de fidélité.

### `POST /api/billing/checkout`
OWNER seulement. Entrée : `{ plan: "FLEX" | "RETIKO_12" | "ANNUAL" }`. Tout Price ID envoyé par le navigateur est rejeté; le serveur choisit la variable d'environnement correspondant à l'offre. Retourne uniquement l'URL de la Checkout Session Stripe hébergée.

### `POST /api/billing/portal`
OWNER seulement. Ouvre le Customer Portal du client Stripe déjà rattaché au commerce courant. L'identifiant client est toujours relu dans le tenant de la session.

### `POST /api/billing/webhook`
Endpoint Stripe sans session web. Exige une signature `stripe-signature` valide sur le corps brut. Les événements sont traités de façon idempotente et ne peuvent pas réaffecter un customer ou un abonnement Stripe à un autre établissement.

## Erreurs sensibles

- `401 UNAUTHORIZED` : session absente/invalide.
- `403 FORBIDDEN` : rôle insuffisant, mauvais tenant ou origine refusée.
- `404 CARD_NOT_FOUND` : carte inconnue du tenant courant.
- `409 COOLDOWN` : crédit trop rapproché.
- `409 DAILY_LIMIT` : limite quotidienne atteinte.
- `409 INSUFFICIENT_BALANCE` : récompense impossible.
- `410 CARD_EXPIRED` : carte expirée.
- `429 RATE_LIMITED` : limite anti-abus atteinte.
