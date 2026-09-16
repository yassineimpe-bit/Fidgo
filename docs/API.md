# API MVP Retiko

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
OWNER/MANAGER. Exporte les données client, carte et transactions en JSON pour traitement RGPD.

### `DELETE /api/customers/[id]`
OWNER/MANAGER. Efface prénom/email/téléphone/consentement, marque le client supprimé et désactive la carte. Le ledger reste pseudonymisé pour préserver l'intégrité comptable/fraude.

### `POST /api/customers/[id]/adjust`
OWNER/MANAGER. Entrée : `newBalance`, `reason`, `idempotencyKey`. Verrouille la carte, ajoute une transaction `adjust` et un audit `CARD_ADJUSTED`, puis synchronise les Wallets activés.

## Erreurs sensibles

- `401 UNAUTHORIZED` : session absente/invalide.
- `403 FORBIDDEN` : rôle insuffisant, mauvais tenant ou origine refusée.
- `404 CARD_NOT_FOUND` : carte inconnue du tenant courant.
- `409 COOLDOWN` : crédit trop rapproché.
- `409 DAILY_LIMIT` : limite quotidienne atteinte.
- `409 INSUFFICIENT_BALANCE` : récompense impossible.
- `410 CARD_EXPIRED` : carte expirée.
- `429 RATE_LIMITED` : limite anti-abus atteinte.
