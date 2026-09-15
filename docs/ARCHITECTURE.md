# Architecture MVP

## Principe

Un seul déploiement Next.js App Router contient les pages publiques, le dashboard commerçant et les routes API. PostgreSQL est l'unique source de vérité. Le navigateur ne reçoit jamais de credentials DB et ne peut jamais modifier un solde directement.

## Surfaces

- `/` : landing minimale.
- `/signup` et `/login` : création/connexion owner.
- `/j/[slug]` : inscription client.
- `/c/[token]` : carte fidélité web mobile, avec polling visible toutes les trois secondes puis arrêt après cinq minutes d'inactivité.
- `/s` : scanner caisse, optimisé rush.
- `/s/stats` : p50/p95 local de la latence.
- `/dashboard` : KPI simples.
- `/dashboard/program` : configuration points/tampons.
- `/dashboard/transactions` : ledger + annulation par écriture inverse.
- `/dashboard/clients` : recherche, ajustement audité, export et effacement RGPD.
- `/dashboard/employees` : accès caisse et lecture seule.
- `/dashboard/settings` : identité du commerce.
- `/dashboard/poster` : affiche A4 imprimable/PDF.

## Modèle multi-tenant

Chaque entité métier porte `establishment_id` directement ou via une FK. Toutes les routes privées récupèrent l'établissement depuis la session serveur et ne font jamais confiance à un `restaurantId` envoyé par le client.

## Ledger fidélité

`cards.balance` est un cache de lecture rapide. `transactions` est le ledger append-only et la source d'audit. Une annulation crée une transaction `reversal`; elle ne supprime pas la transaction originale.

Le crédit : vérifie session/rôle, idempotence, verrouille la carte `FOR UPDATE`, applique cooldown/expiration/limite quotidienne, calcule le delta serveur, écrit le ledger puis le cache de solde et l'audit log.

Le cooldown par défaut est de 120 secondes. Seuls OWNER et MANAGER peuvent le dépasser ; le motif obligatoire est conservé dans la transaction et dans l'audit `CARD_ADJUSTED`.

## Points et tampons

Le même moteur stocke des unités entières. Le programme choisit explicitement `PER_PURCHASE` ou `PER_EURO`. En `PER_EURO`, le serveur exige le montant et calcule les points ; un employé ne peut pas injecter arbitrairement le nombre d’unités. Le QR ne contient jamais le solde : uniquement `LOY1:<token aléatoire 128 bits>`.

## Auth et rôles

Email/mot de passe, bcrypt et JWT httpOnly de 12 h. La session JWT est revérifiée en base à chaque requête protégée afin de prendre en compte immédiatement une suspension d’établissement ou la désactivation d’un employé. Rôles : OWNER, MANAGER, EMPLOYEE, VIEWER.

## Wallet

Les tables `wallet_passes` et `apple_wallet_registrations` sont présentes dès le MVP, mais l'émission réelle Apple/Google est volontairement derrière la validation du cœur métier. Voir `docs/WALLETS.md`.

## Décision ORM

Le MVP utilise `postgres.js` et SQL explicite sur le chemin critique scan/crédit. Prisma pourra être introduit plus tard pour du CRUD sans retarder le pilote.
