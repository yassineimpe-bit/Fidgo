# Mise à niveau du schéma PostgreSQL de production (pré-pilote)

Runbook préparé le 2026-10-02 sur `main` `4819d5d`. **Aucune étape d'écriture
n'est exécutée sans validation humaine explicite.** Les phases 1 et 2 ne
touchent pas la production ; la phase 3 est l'unique écriture.

## 1. Comment Retiko applique ses migrations

- **Aucune table de suivi.** Retiko ne sait pas quelles migrations ont été
  appliquées : `npm run db:setup` (`scripts/db-setup.mjs`) rejoue
  `db/schema.sql` puis **tous** les fichiers `db/migrations/*.sql` dans l'ordre
  lexicographique, à chaque exécution.
- **Idempotence.** Chaque fichier utilise `if not exists`, `create or replace`,
  `drop … if exists` puis `create`, ou des blocs `do $$ … if not exists … $$`.
  La CI rejoue `db:setup` deux fois sur une base neuve (« Replay database
  setup (idempotency) »). La répétition ci-dessous rejoue aussi 024 → 033
  sur une base déjà à jour : aucune erreur.
- **Atomicité.** `db:setup` envoie chaque fichier en une seule requête simple :
  PostgreSQL l'exécute dans une transaction implicite. Un fichier échoue donc
  en entier, jamais à moitié. Exception : `014_brand_hardening.sql` contient
  son propre `begin; … commit;`. Entre deux fichiers, rien n'est atomique : un
  échec au fichier N laisse les fichiers précédents appliqués.
- **Ordre strict.** Exemple : 031 redéfinit la contrainte créée par 030 et
  utilise ses colonnes. Il faut respecter l'ordre des numéros.
- **Numérotation.** 001 n'existe pas (le socle est `db/schema.sql`), 008 non
  plus.
- **`schema.sql` a évolué.** Il contient déjà des objets de migrations
  ultérieures, par exemple la grille `STANDARD_MONTHLY` de 029. Une base créée
  aujourd'hui n'a donc pas le même historique que la production, créée plus
  tôt. On ne peut pas déduire l'état de la production en relisant le dépôt.
- **Intervention manuelle.** Aucune migration de 024 à 033 n'exige d'action
  manuelle. 032 **modifie des données** : elle révoque les liens recovery actifs
  en double. Mais l'index unique `card_recovery_tokens_one_active_per_card`
  existe depuis 012, donc aucun doublon n'est possible et la mise à jour ne
  touche aucune ligne.
- **`db:verify`** (`scripts/verify-db-integrity.mjs`) tolère l'absence des
  tables 024, 027, 028 et 031 : il affiche « table absente ». En revanche, il
  **échoue** si le trigger de 032 manque.

### Migrations du dépôt

```text
schema.sql
002 hardening                     018 transaction_ledger_immutability
003 tenant_integrity              019 platform_super_admin
004 card_recovery                 020 merchant_onboarding
005 session_revocation            021 email_verification
006 pilot_v0                      022 legal_acceptance
007 product_events                023 email_verification_integrity
009 event_tenant_integrity        024 establishment_logos
010 scanner_telemetry             025 staff_two_factor
011 transaction_reversal_integrity 026 program_unit_label
012 data_lifecycle                027 email_campaigns
013 stripe_billing_v2             028 reward_notifications
014 brand_hardening               029 billing_price_grids
015 password_reset                030 card_design
016 customer_internal_notes       031 card_visuals
017 staff_role_integrity          032 card_recovery_integrity
                                  033 card_image_overlay
```

## 2. État connu de la production

Source : dump de production du 2026-10-02 03:33 UTC, restauré dans la CI
(`database-backup`, run 36960688221). Le broker
`/api/internal/backup-credentials` renvoie le `DATABASE_URL` de l'application
elle-même : le dump est bien celui de la base servie par Vercel.

| Migration | État | Preuve |
|---|---|---|
| ≤ 023 | appliquées pour l'essentiel | `/api/health` répond `schema: up`, ce qui exige 012, 013 (si Stripe actif), 015, 020, 021, 022 et 023. `db:verify` sur le dump : contraintes tenant 10/10, gardes e-mail 2/2, gardes hard-delete 3/3, table `legal_acceptances` présente |
| 024 | **absente** | `db:verify` : « table absente (migration 024) » |
| 025 | **non démontré** | — |
| 026 | **non démontré** | — |
| 027 | **absente** | « colonnes absentes (migration 027) » |
| 028 | **absente** | « table absente (migration 028) » |
| 029 | **non démontré** | — |
| 030 | **non démontré** | — |
| 031 | **absente** | « table absente (migration 031) » |
| 032 | **absente** (trigger) | « gardes recovery manquantes : customer_card_recovery_revoke_on_email_change » |
| 033 | **non démontré** | — |

L'état exact de 025, 026, 029, 030 et 033 doit être mesuré : c'est le rôle de
la phase 1.

### Conséquence sur les backups

`database-backup` exécute `db:verify` **avant** le chiffrement et l'upload. Tant
que 032 manque, aucun backup n'est conservé. Dernier backup réussi :
**2026-09-26 03:29 UTC** (run 36214939055). Son artifact expire après 14 jours,
vers le **2026-10-10**. Les dumps des nuits suivantes ont été créés et restaurés
correctement, mais jamais téléversés.

### Comportement de l'application pendant et après

Le code tolère le schéma en retard :

- lectures via `to_jsonb(...)->>'colonne'` ;
- détection de colonne à **chaque requête** (pas de cache) ;
- réponses 503 explicites pour le logo, le visuel de carte, le libellé
  d'unité et la notification de récompense ;
- connexions configurées avec `prepare: false`, donc pas d'erreur de plan en
  cache après un `alter table`.

Les nouvelles fonctions deviennent disponibles dès que la migration est validée
(commit), sans redéploiement. Aucun code n'exige une migration de 024 à 033 pour
le parcours principal (inscription, scan, crédit, récompense).

## 3. Outil : `scripts/db-schema-status.mjs` (lecture seule)

```bash
# Rapport par migration + pré-contrôles de données
DATABASE_URL='<url>' node scripts/db-schema-status.mjs

# Snapshot structurel (aucune ligne métier, aucun secret)
DATABASE_URL='<url>' node scripts/db-schema-status.mjs --snapshot cible.json

# Comparaison avec une base de référence créée par `npm run db:setup`
node scripts/db-schema-status.mjs --diff reference.json cible.json
```

- Tout s'exécute dans `begin read only` avec `lock_timeout=2s` et
  `statement_timeout=20s`. Le script s'arrête si la transaction n'est pas en
  lecture seule.
- Chaque objet est attribué à la **première** migration qui le crée. Ce que
  `schema.sql` contient aussi reste attribué à la migration.
- Les versions de contraintes testées par les migrations
  (`pg_get_constraintdef(...) like '%…%'` dans 024, 029 et 031) sont
  vérifiées.
- Statuts : `APPLIQUÉE`, `ABSENTE`, `PARTIELLE` (signe d'une intervention
  manuelle), `INDÉTERMINABLE`. Ce dernier ne concerne que 006, qui ne change
  qu'une valeur par défaut.
- Pré-contrôles affichés pour les migrations restantes, avec 0 attendu :
  - logos incompatibles (024) ;
  - prérequis de clé étrangère (025) ;
  - campagnes `email` existantes et destinataires d'un autre commerce (027) ;
  - plans hors grille (029) ;
  - liens recovery en double (032).

## 4. Répétition effectuée (PostgreSQL 16 local)

1. **Base « à jour »** (`db:setup` neuf) : toutes les migrations `APPLIQUÉE`
   (006 `INDÉTERMINABLE`). C'est la référence : 580 objets.
2. **Base de l'époque de la production**, reconstruite depuis le dépôt à
   `4b5b1db`, avec des données de démonstration de l'époque, un lien recovery
   actif et une campagne `web_push` :
   - le rapport détecte exactement 025 → 033 `ABSENTE` (029 compris) ;
   - tous les pré-contrôles sont à 0.
3. **Application ciblée** de 025 → 033 avec `psql -1 -v ON_ERROR_STOP=1` :
   - chaque fichier OK, 64 à 89 ms ;
   - rapport « À appliquer : aucune » ;
   - `db:verify` : « Intégrité DB OK » ;
   - changement d'e-mail client : le lien recovery actif est bien révoqué
     (trigger 032) ;
   - `--diff` avec la référence : **0 différence**.
4. **Rejeu complet** de `db:setup`, puis rejeu de 024 → 033 : aucune erreur,
   toujours 0 différence.
5. **Base sans 024** (schema.sql actuel + 002 → 023) : 024 → 033 appliquées
   puis rejouées sans erreur.

Limite : la répétition n'a pas porté sur une copie des données réelles. Ce sera
le rôle de la branche Neon en phase 2.

## 5. Procédure

### Phase 0 — Préalables (humain)

- [ ] Validation explicite de l'opération et du créneau (trafic faible, aucun
      déploiement en parallèle).
- [ ] `psql` disponible localement, `DATABASE_URL` copié depuis la console
      Neon dans une variable de shell. Ne jamais le coller dans un ticket, un
      chat ou un commit.
- [ ] Ne **pas** lancer `npm run db:setup` contre la production : il
      rejouerait aussi `schema.sql` et les migrations 002 → 023 sur la base
      vivante. C'est inutile, et cela prend des verrous `ACCESS EXCLUSIVE` sur
      les tables principales.

### Phase 1 — Mesurer l'état exact (aucune écriture)

1. Identifier la source, sans copier aucun secret :
   - Vercel → projet Retiko → Settings → Environment Variables →
     `DATABASE_URL` (Production) : relever **uniquement** l'identifiant
     d'endpoint `ep-…` contenu dans l'hôte ;
   - Neon → projet → Branches : la branche dont l'endpoint de calcul porte ce
     même `ep-…` est la branche de production. Relever le project ID, la
     région, le nom et l'ID de branche, ainsi que « Last active ».
2. Console Neon : créer une branche **depuis cette branche de production, à
   l'instant présent** (option *Head*), nommée
   `pre-pilot-schema-audit-2026-10-XX`. Elle sert à la fois de point de
   restauration et de terrain de répétition. Relever l'ID de branche, le
   parent, la date de création et le LSN parent si la console l'affiche.
3. Sur la **branche** :
   ```bash
   export BRANCH_URL='<url de la branche>'
   DATABASE_URL="$BRANCH_URL" node scripts/db-schema-status.mjs | tee status-before.txt
   DATABASE_URL="$BRANCH_URL" node scripts/db-schema-status.mjs --snapshot prod-before.json
   ```
   La ligne `Empreinte` (nombre de commerces, de cartes et de transactions,
   date de la dernière transaction : aucune donnée personnelle) doit
   correspondre à la production au moment de la création de la branche.
   Option : exécuter la même commande directement sur la production. Elle est
   en lecture seule, verrouillée par `read only`.
4. Arrêt obligatoire si :
   - une migration ≤ 023 n'est pas `APPLIQUÉE` ;
   - une migration est `PARTIELLE` ;
   - un pré-contrôle n'est pas à 0.

   Dans ces cas, analyser avant d'aller plus loin. La liste « À appliquer »
   devient la **liste exacte** des fichiers des phases 2 et 3.

### Phase 2 — Répéter sur la branche Neon

```bash
for f in <liste exacte, dans l'ordre>; do
  PGOPTIONS="-c lock_timeout=5s -c statement_timeout=60s" \
    psql "$BRANCH_URL" -X -1 -v ON_ERROR_STOP=1 -f "db/migrations/$f" || break
done
DATABASE_URL="$BRANCH_URL" node scripts/db-schema-status.mjs     # attendu : « À appliquer : aucune »
DATABASE_URL="$BRANCH_URL" npm run db:verify                      # attendu : « Intégrité DB OK. »
```

Créer une base de référence (`npm run db:setup` sur une base locale vide), en
prendre un snapshot `reference.json`, puis :

> Créer la référence avec PostgreSQL 17, comme Neon : le texte de
> `pg_get_constraintdef` / `pg_get_indexdef` peut varier entre versions
> majeures. Une différence purement textuelle n'est pas un écart de schéma.

`node scripts/db-schema-status.mjs --diff reference.json branche-after.json`.
Attendu : 0 différence.

### Phase 3 — Production (après validation explicite séparée)

1. Recréer, si plus d'une heure s'est écoulée, une branche Neon
   `pre-schema-024-033-…` juste avant d'écrire : c'est le point de retour.
2. Mêmes commandes que la phase 2, avec `DATABASE_URL` de production :
   - une migration par transaction (`-1`) ;
   - arrêt à la première erreur (`ON_ERROR_STOP`, `|| break`) ;
   - `lock_timeout=5s` : une migration qui attend un verrou échoue
     proprement, sans bloquer le trafic derrière elle.

### Phase 4 — Vérifications

```bash
DATABASE_URL="$PROD_URL" node scripts/db-schema-status.mjs   # « À appliquer : aucune »
DATABASE_URL="$PROD_URL" npm run db:verify                    # « Intégrité DB OK. »
```

- `/api/health` : `200`, `schema: up`.
- Smoke métier : connexion, scan, crédit sur la carte démo, page carte client.
- GitHub Actions → `database-backup` → *Run workflow* (`workflow_dispatch`) :
  le job doit être **vert** et téléverser un artifact chiffré.
- Nettoyer : `unset PROD_URL BRANCH_URL`, puis supprimer les fichiers locaux
  `status-*.txt` / `*.json` (ils ne contiennent aucune donnée métier).

### Rollback

- **Une migration échoue :** sa transaction est annulée, rien n'en reste. Les
  migrations précédentes restent appliquées. Elles sont additives et le code
  les tolère, donc aucun rollback n'est nécessaire. Arrêter et analyser.
- **Corruption avérée** (improbable : les migrations sont additives) : restaurer
  la production depuis la branche Neon de la phase 3, avec la procédure de
  `docs/BACKUP_RESTORE.md`. Cette restauration perd les écritures faites
  depuis la création de la branche. Elle exige donc une décision explicite.
- Ne jamais supprimer de colonne ou de table « pour revenir en arrière ».

### Ce que cette opération ne fait pas

Elle ne fait rien de ce qui suit :
- aucune purge ;
- aucun changement de `DATA_LIFECYCLE_EXECUTE` ;
- aucune modification de secret ;
- aucune activation de Stripe ni d'Apple Wallet.
