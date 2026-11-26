# Migrations 024 à 033 — état, analyse et plan d'application en production

Préparé le 2026-11-26. **Aucune migration n'a été appliquée en production.** Ce document prépare la décision ; chaque étape sur Neon est une action humaine.

## 1. État réel en production

| Migration | État au 2026-11-25 | Preuve |
|---|---|---|
| 024 logos | **absente** | `db:verify` du restore drill : table `establishment_logos` absente |
| 025 2FA | **absente** | la répétition des migrations sur la copie restaurée crée `staff_two_factor` et `staff_two_factor_recovery_codes` |
| 026 libellé d'unité | probablement absente | aucune table créée ; non contrôlée par `db:verify` |
| 027 campagnes | **absente** | colonnes `campaigns.recipient_count`… absentes |
| 028 notification récompense | **absente** | table `reward_notifications` absente |
| 029 grilles tarifaires | probablement absente | contrainte modifiée seulement ; non contrôlée |
| 030 couleur secondaire | probablement absente | colonnes seulement ; non contrôlée |
| 031 visuel de carte | **absente** | table `establishment_card_images` absente |
| 032 intégrité recovery | **absente (trigger)** | garde `customer_card_recovery_revoke_on_email_change` absente ; l'index unique partiel, créé par 012, est présent |
| 033 voile du visuel | probablement absente | colonne seulement ; non contrôlée |

La production compte 22 tables, exactement l'état « `schema.sql` + migrations ≤ 023 » reconstruit à partir du commit `4b5b1db`.

Pour trancher 026, 029, 030 et 033 sans rien écrire :

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f ops/migrations/check-024-033.sql
```

Le script force la session en lecture seule et se termine par `rollback`. Il liste chaque objet attendu (`present`), les préconditions (toutes doivent valoir 0) et la volumétrie des tables touchées. Validé localement sur l'état ≤ 023 (tout `f` sauf l'index de 032) et sur l'état complet (tout `t`).

## 2. Comment `db:setup` applique les migrations

- Il rejoue `db/schema.sql`, puis **toutes** les migrations (002 → 033) dans l'ordre. Aucune table ne suit les migrations appliquées : il n'existe aucun « delta ». Toutes les migrations doivent donc rester rejouables. Les CI de #154 à #159 et la répétition quotidienne de `database-backup` (#264) le vérifient.
- Chaque fichier est envoyé comme une seule requête multi-instructions : **un fichier est atomique**. Vérifié : un fichier qui échoue à sa deuxième instruction ne laisse pas sa première table. L'ensemble ne l'est pas : un échec au fichier N laisse les fichiers 1 à N-1 appliqués. Comme tout est rejouable, la reprise consiste à corriger la cause puis à relancer `db:setup`.
- Il ne fixe ni `lock_timeout` ni `statement_timeout`. Ces paramètres passent par l'URL : `?lock_timeout=5s&statement_timeout=120s` (vérifié avec le pilote `postgres`). Utiliser l'endpoint Neon **direct**, pas le pooler : le pooler peut refuser ces paramètres de démarrage, ce qui reste à vérifier sur la branche temporaire.

## 3. Analyse par migration

| # | Instructions | Données modifiées | Verrous | Idempotence | Dépend de | Risque de perte |
|---|---|---|---|---|---|---|
| 024 | `create table if not exists establishment_logos` (FK `establishments`), index ; remplace `establishments_logo_url_https_check` par une contrainte plus large | aucune | `ACCESS EXCLUSIVE` bref sur `establishments` (drop/add check + balayage de validation) ; `SHARE ROW EXCLUSIVE` pour la FK | oui (`if not exists`, remplacement gardé par `pg_get_constraintdef`) | 014 | aucun ; la nouvelle contrainte accepte tout ce qu'acceptait l'ancienne (précondition contrôlée) |
| 025 | 2 tables, 2 FK composites vers `staff_users`, index partiel | aucune | `SHARE ROW EXCLUSIVE` sur `staff_users` (FK) | oui | 003 (clé `staff_users_id_establishment_key`) | aucun |
| 026 | 2 colonnes nullables sur `loyalty_programs`, check | aucune | `ACCESS EXCLUSIVE` bref sur `loyalty_programs` | oui | — | aucun |
| 027 | 10 colonnes (`not null default 0` : défaut rapide PG ≥ 11, sans réécriture), check, 4 index, fonction et trigger tenant | aucune (tables `campaigns`/`campaign_recipients` vides en production, jamais utilisées avant 027) | `ACCESS EXCLUSIVE` bref sur `campaigns`, `campaign_recipients` ; index non `concurrently` (tables vides) | oui (`drop trigger if exists` + `create`) | `schema.sql` | aucun |
| 028 | colonne `reward_email_enabled not null default false`, table `reward_notifications` (FK cartes, transactions) | aucune | `ACCESS EXCLUSIVE` bref sur `loyalty_programs` ; `SHARE ROW EXCLUSIVE` sur `cards`, `transactions` | oui | — | aucun ; les `on delete cascade` ne jouent que sur un hard-delete, interdit par 012 |
| 029 | remplace 2 checks de `subscriptions` par des listes plus larges, dans un bloc `do` | aucune | `ACCESS EXCLUSIVE` bref sur `subscriptions` | oui (garde sur la définition) | 013 | aucun si toutes les offres existantes sont dans la nouvelle liste (précondition contrôlée) |
| 030 | colonnes `secondary_color`, `card_background not null default 'solid'`, check | aucune | `ACCESS EXCLUSIVE` bref sur `establishments` | oui | — | aucun |
| 031 | table `establishment_card_images`, colonne FK `establishments.card_image_id`, remplace le check de 030 | aucune | `ACCESS EXCLUSIVE` bref sur `establishments` | oui | **030** (colonnes et contrainte) | aucun |
| 032 | `UPDATE` des liens recovery actifs en double, index unique partiel, fonction, trigger `after update of email` sur `customers` | **potentiellement** (voir ci-dessous) | `ROW EXCLUSIVE` sur `card_recovery_tokens` ; `SHARE ROW EXCLUSIVE` sur `customers` (trigger) | oui | 012, 004 | aucune ligne supprimée |
| 033 | colonne `card_image_overlay not null default true` | aucune | `ACCESS EXCLUSIVE` bref sur `establishments` | oui | 031 (sens fonctionnel) | aucun |

Volumes : la production ne contient que des données de pilote (dump d'environ 110 Ko). Chaque verrou dure quelques millisecondes ; c'est l'attente d'un verrou derrière une longue transaction qui bloquerait les requêtes de l'application, d'où le `lock_timeout`.

### L'`UPDATE` de 032

Il marque `used_at = now()` sur chaque lien de récupération actif d'une carte qui en a plusieurs, sauf le plus récent. Il ne supprime rien et n'agit pas sur le ledger.

En production, il **ne peut rien modifier** : l'index unique partiel `card_recovery_tokens_one_active_per_card` existe déjà (créé par 012, `unicité=true` dans `db:verify`), donc deux liens actifs pour une même carte sont impossibles. `db:verify` le confirme : « Cartes avec plusieurs tokens recovery actifs : 0 ». La précondition `032 liens recovery actifs en double` doit valoir 0 avant l'application.

Le nouveau trigger révoque les liens actifs à chaque changement d'e-mail d'un client, y compris par une écriture SQL hors API. C'est le comportement voulu par #163.

## 4. Répétition

### 4.1 Automatique, sur la copie restaurée de la veille (#264)

Après le merge de #264, chaque run de `database-backup` sur `main` applique `db:setup` sur la copie restaurée de la production. Il vérifie que les tables existantes gardent leurs lignes, que les soldes et le ledger sont identiques, puis lance `db:verify`. Le manifeste porte `migration_rehearsal` et `db_verify_after_migrations`. **Prérequis : ces deux champs à `success` sur un run de moins de 24 h.** Le même contrôle a été fait localement sur une réplique de l'état ≤ 023 : 22 tables inchangées, 5 tables ajoutées, `db:verify` vert.

### 4.2 Sur une branche Neon temporaire (humain)

1. Créer une branche Neon depuis la production, à l'instant présent. Récupérer l'URL de son endpoint **direct**, saisie sans écho :
   ```bash
   read -rs BRANCH_URL && export BRANCH_URL
   ```
2. Constat initial :
   ```bash
   psql "$BRANCH_URL" -X -v ON_ERROR_STOP=1 -f ops/migrations/check-024-033.sql
   DATABASE_URL="$BRANCH_URL" node scripts/db-fingerprint.mjs > avant.json
   DATABASE_URL="$BRANCH_URL" npm run db:verify   # attendu : échec sur la garde 032
   ```
3. Application, chronométrée :
   ```bash
   time DATABASE_URL="$BRANCH_URL?sslmode=require&lock_timeout=5s&statement_timeout=120s" npm run db:setup
   ```
   Si l'endpoint refuse les paramètres de démarrage, relancer sans `lock_timeout` et le noter.
4. Contrôles après :
   ```bash
   psql "$BRANCH_URL" -X -v ON_ERROR_STOP=1 -f ops/migrations/check-024-033.sql      # tout à t
   DATABASE_URL="$BRANCH_URL" node scripts/db-fingerprint.mjs > apres.json
   node scripts/db-fingerprint.mjs --compare-upgrade avant.json apres.json            # sans perte
   DATABASE_URL="$BRANCH_URL" npm run db:verify                                       # vert
   DATABASE_URL="$BRANCH_URL" npm run db:setup                                        # rejouable : 2e passage OK
   ```
5. Facultatif : déployer une preview Vercel sur la branche Neon et lancer `production-smoke` contre elle.
6. Supprimer la branche Neon temporaire.

### 4.3 En production (humain, après 4.1 et 4.2 verts)

1. Prérequis :
   - backup du jour vert (`backup-restore`) ;
   - fenêtre Neon PITR disponible (vérifier sa durée réelle, #41) ;
   - pas de commerçant en rush (le pilote est peu actif) ;
   - même SHA de `main` que celui répété.
2. Constat, application avec `lock_timeout`, puis contrôles après : mêmes commandes qu'en 4.2, avec l'URL directe de la production.
3. `/api/health` : `schema: up`. Lancer `production-smoke` et `production-monitor`.
4. Relancer `database-backup` (`workflow_dispatch`) : `production-schema` doit passer au vert.
5. Inscrire dans #88 : SHA, empreintes avant/après (agrégats seulement), durée mesurée, sortie de `check-024-033.sql`.

Aucun redéploiement n'est nécessaire : le code de `main`, déjà en production, détecte ces objets et active les fonctions dès leur présence.

## 5. Retour arrière

Il n'existe pas de migration descendante. Les migrations sont additives : le retour normal est **vers l'avant** (corriger, puis relancer `db:setup`).

En cas de dégât réel :

- moins de 6 h et dans la fenêtre PITR : restaurer la production via une branche Neon au point précédant l'application ;
- au-delà : restaurer le backup chiffré de la veille dans une base vide (`scripts/restore-backup.sh`, clé privée hors ligne), puis `db:setup` et `db:verify`.

Les deux options perdent les écritures faites depuis le point de restauration. La décision est humaine.

## 6. Points restant à vérifier par un humain

- L'état exact de 026, 029, 030 et 033 (`check-024-033.sql`).
- L'acceptation des paramètres `lock_timeout` et `statement_timeout` par l'endpoint direct Neon.
- La durée réelle de la fenêtre PITR (#41).
- La mise à jour des cases de #88 après application.
