# Audit Data Lifecycle Retiko

MAIN AUDITÉ = `72d2ba5697228ea70cf5a32ecbf6d6234d98c596`  
DATE = 2026-09-27 21:56 CEST

PRs ouvertes inspectées : aucune PR ouverte ne touche le workflow `data-lifecycle`, le script de purge, les durées, `audit_logs`, `product_events` ou les tokens. PR #220 = docs cooldown/URLs seulement. Branche orpheline `audit/data-lifecycle-rgpd` (17/09, sans PR ouverte) ignorée. Issues ouvertes : aucune issue dédiée DATABASE_URL / DATA_LIFECYCLE_EXECUTE.

## État exécutif

MAIN: `72d2ba5697228ea70cf5a32ecbf6d6234d98c596` (2026-09-27T19:51:37Z)  
Workflow: `.github/workflows/data-lifecycle.yml` actif, cron `41 2 * * *` (02:41 UTC), environment GitHub `production`, concurrency `retiko-data-lifecycle`.  
Dernier run: [#8](https://github.com/yassineimpe-bit/Fidgo/actions/runs/36289514218) schedule 2026-09-27T02:47:05Z, conclusion `failure`, durée ~21 s.  
Dry-run: exécuté, **échec** (`DATABASE_URL est requis.`).  
Execute: **skipped** (jamais observé en succès sur les 8 runs).  
Verdict: la politique de rétention est **écrite et gated**, mais **n’est pas appliquée en production**. Ce n’est pas un workflow « vert qui skippe Apply » : il est **rouge tous les soirs** avant même le dry-run SQL. Aucun hard-delete RGPD n’a eu lieu. Le ledger est hors du script et protégé par trigger. Pas de bug de prédicat dry-run vs execute. Pas de P0.

---

## 1. Preuves des runs GitHub

Huit runs, tous `event=schedule`, tous `failure`. Aucun `workflow_dispatch`.

| Run | Date UTC | SHA | Dry-run | Apply | Durée |
|---|---|---|---|---|---|
| [#8](https://github.com/yassineimpe-bit/Fidgo/actions/runs/36289514218) | 2026-09-27 02:47 | `7b9004d` | failure | skipped | 21 s |
| [#7](https://github.com/yassineimpe-bit/Fidgo/actions/runs/36212720784) | 2026-09-26 02:46 | `6d678cb` | failure | skipped | 21 s |
| [#6](https://github.com/yassineimpe-bit/Fidgo/actions/runs/36087634917) | 2026-09-25 02:46 | `596bd9a` | failure | skipped | ~29 s |
| #5–#1 | 24 → 20/09 | — | failure | skipped | ~20–30 s |

Job #8, étapes observées :

1. checkout / setup-node / `npm ci` → success  
2. **Dry-run retention report** → failure (02:47:23, instantané)  
3. **Apply retention** → skipped  

Le script sort immédiatement si `process.env.DATABASE_URL` est absent (`DATABASE_URL est requis.`). Les docs `DATA_LIFECYCLE.md` (constat 25/09) décrivent déjà cette erreur. Le run du 27/09 la **reproduit**.

Les backups (`database-backup.yml`) n’utilisent **pas** `secrets.DATABASE_URL` : accès via broker OIDC `POST /api/internal/backup-credentials`. Deux chemins distincts. CONFIRMÉ.

Cron Vercel `GET /api/cron/purge` (23 3 * * *) est un autre mécanisme : uniquement `rate_limits` via `purgeStaleRateLimits(48)` + `CRON_SECRET`. Pas de confusion fonctionnelle avec le lifecycle GitHub, hormis un recouvrement volontaire de `rate_limits` à 2 jours / 48 h.

## 2. DATA_LIFECYCLE_EXECUTE

Valeur de `vars.DATA_LIFECYCLE_EXECUTE` dans l’environment GitHub `production` : **NON VÉRIFIABLE** (l’outil ne lit pas les valeurs des variables d’environment).

Déductions :

- PROUVÉ : aucun run schedule n’a exécuté l’étape Apply jusqu’au bout. Aucune ligne n’a été supprimée par ce workflow.
- DÉDUIT : même si la variable valait `true`, Apply n’aurait pas pu réussir tant que Dry-run échoue sur `DATABASE_URL` (step Apply après un step failed ; l’`if` custom ne contient pas `always()`).
- On **ne peut pas** conclure « variable absente » uniquement depuis les skips : le skip actuel est d’abord la conséquence de l’échec Dry-run.
- Le gate code est réel : `(schedule && vars.DATA_LIFECYCLE_EXECUTE == 'true') || (workflow_dispatch && inputs.execute)`.

Footgun documenté, non modifié : `workflow_dispatch.inputs.execute` a **`default: true`**. Dès que `DATABASE_URL` existera, un clic « Run workflow » sans décocher appliquera les DELETE. DURCISSEMENT.

## 3. Tables et règles de purge

Source unique lue : `scripts/purge-data-lifecycle.mjs` (pas les docs).

| Donnée | Table | Condition de purge | Rétention | Batch | Action | Risque |
|---|---|---|---|---|---|---|
| Télémétrie produit | `product_events` | `created_at < now() - 180d` | 180 j | 5 000 / run | hard DELETE | Faible. Index `product_events_retention_idx`. |
| Journal technique | `audit_logs` | `created_at < now() - 730d` | 730 j | 5 000 | hard DELETE | Faible. Index `audit_logs_retention_idx`. Ne touche pas `transactions`. |
| Liens récupération carte | `card_recovery_tokens` | `expires_at < now()-30d OR used_at < now()-30d` | 30 j après usage ou expiration | 5 000 | hard DELETE | Faible. `used_at IS NULL` n’est pas éligible. |
| Reset mot de passe staff | `password_reset_tokens` | idem | 30 j | 5 000 | hard DELETE | Faible. Supprimer le token ne touche pas le staff. |
| Vérification e-mail | `email_verification_tokens` | idem | 30 j | 5 000 | hard DELETE | Faible. |
| Push Apple de passes révoqués | `apple_wallet_registrations` | join `wallet_passes` `status='revoked' AND wp.updated_at < now()-30d` | 30 j via `updated_at` du pass | 5 000 | hard DELETE registrations seulement | Faible. Ne delete pas `wallet_passes`. |
| Anti-abus | `rate_limits` | `window_started_at < now()-2d` | 2 j | 5 000 | hard DELETE | Faible. Doublon volontaire avec cron Vercel 48 h. |

Hors script (CONFIRMÉ) : `transactions`, `cards`, `customers`, `establishments`, `staff_users`, `loyalty_programs`, `subscriptions`, `stripe_webhook_events`, `campaigns`, `campaign_recipients`, `reward_notifications`, `push_subscriptions`, `legal_acceptances`, `platform_admin_audit`, `wallet_passes`, `staff_two_factor` / `staff_two_factor_recovery_codes`.

## 4. Dry-run vs execute

Même objet `retention`, mêmes intervalles, même `now()` Postgres.

Différence volontaire : dry-run compte toutes les lignes éligibles ; execute delete au plus 5 000 lignes par table, une passe, une transaction. Idempotent. Pas d’écart de prédicat.

## 5. Advisory lock

`pg_try_advisory_lock(hashtext('retiko-data-lifecycle'))` session-level, client `{ max: 1 }`, libération via `sql.end()` dans `finally`. CORRECT avec la config actuelle. FRAGILE si `max` passait au-dessus de 1 (lock et DML pourraient diverger de session). Pas de `pg_advisory_unlock` explicite. Concurrency GitHub `retiko-data-lifecycle` en plus.

## 6. Batching / reprise après erreur

Une passe `ORDER BY <ts> LIMIT 5000` par table, pas de boucle. Crash → rollback de toute la transaction. Rejouable. Rattrapage multi-nuits si volume > 5 000.

## 7. FK / cascades / ledger

`transactions` : trigger `transactions_ledger_immutable` refuse DELETE. Triggers 012 interdisent le hard-delete de `establishments` / `customers` / `cards` et cassent les anciennes cascades vers le ledger. Le script ne cible aucune de ces tables. Jointure Apple uniquement sur `wallet_pass_id`. Purge globale par âge, pas de mélange multi-tenant dans le SQL.

## 8. Rétention docs vs code

Durées 180 / 730 / 30 / 2 alignées. Statut « prévue, non active » toujours vrai au 27/09. Écart : phrase docs « 4 tables de tokens » vs 3 tables dans le script. Prédicat `< now() - N days` (pas `<=`) : écart < 1 jour.

## 9. Observabilité

JSON `mode` / `eligible` ou `deleted` si le script atteint SQL. Aujourd’hui le seul signal est le workflow rouge. Une fois `DATABASE_URL` posé et execute resté off, un run vert + Apply skipped ne criera pas si personne ne lit les logs.

## 10. Tests

`tests/data-lifecycle.test.ts` = contrat fichier (flag, batch, exclusion ledger, triggers). Pas d’intégration Postgres. Un test de contrat dry-run/execute (7 tables, constantes, `max: 1`, `sql.end`) est ajouté dans cette PR.

Tests manquants restants à forte valeur : intégration seed + `--execute` avec ledger intact ; second process concurrent sur le lock.

## 11. Constats classés

| ID | Constat | Classe | Priorité |
|---|---|---|---|
| C1 | 8/8 runs schedule en failure sur `DATABASE_URL` absent de l’env GitHub `production` | CONFIRMÉ | P2 |
| C2 | Aucune suppression RGPD planifiée n’a tourné | CONFIRMÉ | — |
| C3 | Valeur exacte de `DATA_LIFECYCLE_EXECUTE` | NON VÉRIFIABLE | — |
| C4 | Prédicats dry-run = execute | CONFIRMÉ | — |
| C5 | Lock correct avec `max: 1` ; unlock implicite | CONFIRMÉ / FRAGILE | P3 |
| C6 | Ledger hors script + triggers | CONFIRMÉ | — |
| C7 | `workflow_dispatch` default `execute: true` | CONFIRMÉ | P2 |
| C8 | « 4 tables de tokens » vs 3 dans le script | CONFIRMÉ | P3 |
| C9 | Codes 2FA recovery non purgés | CONFIRMÉ | P3 APRÈS PILOTE |
| C10 | `rate_limits` aussi dans cron Vercel | CONFIRMÉ | — |
| C11 | Backup 14 j peut conserver des lignes déjà purgées | CONFIRMÉ | — |
| C12 | Bug de suppression excessive / oubli SQL | FAUX POSITIF | — |

P0 = 0. P1 = 0.

## 12. Actions minimales recommandées

Sans validation humaine : ne pas activer `DATA_LIFECYCLE_EXECUTE`, ne pas lancer `--execute` prod, ne pas changer durées / schéma / ledger / backup.

Fait ici : ce rapport, correction factuelle de `docs/DATA_LIFECYCLE.md`, test de contrat source.

Prochaine action humaine unique : poser le secret GitHub `DATABASE_URL` sur l’environment `production` **seulement pour débloquer le dry-run**, vérifier un run schedule vert avec Apply skipped, garder execute inactif.
