# Sauvegarde & restauration PostgreSQL

## Objectif

Retiko doit pouvoir survivre à une erreur humaine, une migration ratée ou une perte de la base de production sans dépendre d'un dump conservé en clair.

La base de production est hébergée sur Neon PostgreSQL 17. Le plan Neon actuel `free_v3` ne permet pas de créer un backup schedule natif et limite les snapshots manuels. Le projet utilise donc un backup logique quotidien indépendant du plan Neon.

## Politique actuelle

Le workflow `.github/workflows/database-backup.yml` s'exécute chaque jour à **03:17 UTC** (GitHub retarde souvent les tâches planifiées : de 08:00 à 13:50 UTC observé en octobre–novembre 2026), à chaque `push` sur `main` qui touche la chaîne de backup, le schéma ou les migrations, et à la demande (`workflow_dispatch`).

Job `backup-restore`, dans cet ordre :

1. GitHub Actions demande un jeton OIDC signé pour le workflow de backup sur `main` ;
2. **un seul step** échange ce jeton contre la connexion PostgreSQL (Retiko vérifie dépôt, workflow, branche, environnement et type d'événement), lit l'empreinte agrégée de la source (`scripts/db-fingerprint.mjs`), lance `pg_dump` PostgreSQL 17, relit l'empreinte, puis oublie le credential (#206) : il n'est jamais écrit dans `GITHUB_ENV` ni `GITHUB_OUTPUT` et n'existe dans aucun step suivant ;
3. validation de l'archive avec `pg_restore --list` ;
4. restauration intégrale dans une PostgreSQL 17 jetable du runner ;
5. `npm run db:verify` sur la copie restaurée **telle quelle**, c'est-à-dire sur le schéma et les données de production au moment du dump ;
6. comparaison de l'empreinte de la copie avec celle de la source ;
7. **répétition des migrations** : `npm run db:setup` (schema.sql + toutes les migrations du dépôt) sur la copie jetable uniquement, puis contrôle qu'aucune table existante n'a perdu de ligne et que soldes et ledger agrégés sont identiques (`--compare-upgrade`) ;
8. `npm run db:verify` sur la copie migrée ;
9. chiffrement de l'archive avec le certificat public Retiko, puis suppression du dump en clair ;
10. upload du backup chiffré comme artifact GitHub, conservé **14 jours** ;
11. échec explicite du job si l'étape 4, 6, 7 ou 8 a échoué ;
12. suppression du dump en clair du runner en toutes circonstances (`if: always()`).

`pg_dump` et `pg_restore` s'exécutent depuis `postgres:17.12` épinglée par digest (`PG_IMAGE`) : c'est l'image qui reçoit le credential de production. Pour la mettre à jour, vérifier le digest de l'index multi-architecture sur Docker Hub, puis modifier `PG_IMAGE` et le défaut de `scripts/restore-backup.sh` ensemble (un test l'impose).

Un backup est conservé dès que le dump est lisible (`pg_restore --list`), même si la restauration, l'empreinte, les migrations ou l'intégrité échouent. Le résultat réel est inscrit dans `manifest.txt` :

| Champ | Sens |
|---|---|
| `restore_test` | restauration intégrale dans PostgreSQL 17 standard |
| `db_verify` | `db:verify` sur la copie telle que la production l'a produite |
| `fingerprint` | copie identique à la source au moment du dump |
| `migration_rehearsal` | migrations de `main` appliquées sur la copie sans perte |
| `db_verify_after_migrations` | intégrité de la copie amenée au schéma de `main` |
| `pg_client_image`, `source_sha` | image `pg_dump`/`pg_restore` et commit du workflow |

Avant de restaurer une archive, lire son manifeste.

## Lire les checks : `backup-restore` et `production-schema`

Deux questions distinctes, deux checks :

- **`backup-restore`** — *la sauvegarde permet-elle de reprendre le service ?* Vert si l'archive se restaure à l'identique et que la copie restaurée peut être amenée au schéma de `main` avec une intégrité vérifiée (tenants, ledger, soldes, gardes). Une incohérence de données en production le rend rouge, car elle subsiste après migration.
- **`production-schema`** — *la base de production elle-même est-elle conforme à `main` ?* Il reprend le résultat de l'étape 5. Rouge tant que des migrations de `main` ne sont pas appliquées en production, ou qu'une incohérence y existe. Il n'accède à aucune base.

Historique : du 2026-09-27 au 2026-11-26, `backup-restore` a été rouge chaque jour alors que les dumps étaient lisibles, restaurables et identiques à la source ; seul `db:verify` échouait, parce que les migrations postérieures à `023` ne sont pas appliquées en production : absence démontrée pour `024`, `025`, `027`, `028`, `031` et `032` (garde `customer_card_recovery_revoke_on_email_change`), probable pour `026`, `029`, `030` et `033`, qui ne créent pas de table. La production compte 22 tables, exactement l'état « migrations ≤ 023 ». Jusqu'au 2026-10-02, cet échec empêchait même la conservation : aucune sauvegarde n'a été gardée du 2026-09-27 au 2026-10-02.

Sur une PR, le job `restore-drill-selftest` répète la chaîne sans aucun accès à la production : source jetable (`db:setup` + démo), mêmes commandes de restauration, d'empreinte, de migration et de vérification que `backup-restore` (un test unitaire impose l'égalité), chiffrement avec une clé éphémère, restauration par `scripts/restore-backup.sh`, refus d'une archive corrompue. `backup-restore` et `production-schema` ne s'exécutent jamais sur une PR : seul un run sur `main` les valide.

## Appliquer les migrations en production

Action humaine, jamais automatique. Même procédure que pour la `023` (#134) :

1. vérifier sur le dernier run `database-backup` de `main` que `backup-restore` est vert et que le manifeste indique `migration_rehearsal=success` et `db_verify_after_migrations=success` : les migrations en attente ont été répétées sur une copie des données de production de la veille ;
2. créer une branche Neon temporaire depuis la production, y lancer `npm run db:setup` puis `npm run db:verify` ;
3. si tout est vert, lancer `npm run db:setup` puis `npm run db:verify` sur la production, avec l'URL saisie sans écho (par exemple `read -rs DATABASE_URL && export DATABASE_URL`), jamais dans l'historique du shell, un ticket ou un log ;
4. contrôler `/api/health` (`schema: up`) et lancer `production-smoke` ;
5. relancer `database-backup` (`workflow_dispatch`) : `production-schema` doit passer au vert.

`db:setup` rejoue `schema.sql` et toutes les migrations dans l'ordre ; elles sont rejouables. Aucune ne supprime de ligne. `032` marque comme utilisés les liens de récupération actifs en double (aucun en production au 2026-11-25 d'après `db:verify`).

## Exploitation et récupération

| Repère | Valeur au 2026-11-26 |
|---|---|
| Fréquence | 1 backup logique par jour (+ runs sur `push` et à la demande) |
| Rétention réelle | 14 jours glissants d'artifacts GitHub (14 archives du 2026-11-12 au 2026-11-25) |
| Historique Neon (PITR) | 6 h sur l'offre gratuite, constaté le 2026-09-17 (#41) ; non revérifié depuis |
| RPO | ≤ 6 h pour un incident détecté dans la fenêtre Neon (si elle est toujours de 6 h) ; sinon jusqu'à ~25 h (écart maximal observé entre deux backups planifiés du 2026-10-09 au 2026-11-25 : 25,4 h, moyenne 24,1 h) |
| RTO | non mesuré de bout en bout. Mesuré : restauration + migrations + vérification d'une archive de ~110 Ko en quelques secondes. Non mesuré : téléchargement, déchiffrement avec la clé hors ligne, création de la base cible, bascule `DATABASE_URL` sur Vercel, redéploiement |

Risques connus :

- **Clé privée** : le déchiffrement d'un artifact de production avec la vraie clé de récupération n'est jamais testé automatiquement (elle est hors ligne, c'est voulu). À faire par un humain, périodiquement, sur une base isolée.
- **Dépôt public** : tout compte GitHub connecté peut télécharger les artifacts. Ils sont chiffrés (CMS AES-256) ; la confidentialité repose entièrement sur la clé privée. Le manifeste en clair ne contient que des empreintes et des résultats.
- **Tâches planifiées** : GitHub désactive les workflows planifiés d'un dépôt public après 60 jours sans activité. Une pause de développement de plus de deux mois arrêterait les backups quotidiens sans alerte.
- **Fenêtre de rétention** : 14 jours d'artifacts ; une corruption découverte plus tard n'est pas récupérable par ce mécanisme.

## Authentification GitHub → Retiko

Aucun mot de passe PostgreSQL n'est stocké dans GitHub Actions.

Le job `backup-restore` possède uniquement la permission GitHub `id-token: write`. Il demande un jeton OIDC avec l'audience `retiko-backup`, puis appelle `POST /api/internal/backup-credentials`.

Retiko vérifie notamment :

- issuer GitHub Actions officiel ;
- audience exacte `retiko-backup` ;
- dépôt `yassineimpe-bit/Fidgo`, repository ID et owner ID ;
- branche `refs/heads/main` ;
- workflow exact `.github/workflows/database-backup.yml` sur `main` ;
- environnement GitHub `production` ;
- runner GitHub-hosted ;
- événements autorisés : `push`, `schedule`, `workflow_dispatch`.

Le workflow `data-lifecycle.yml` (rétention des données) utilise le même mécanisme avec une audience distincte, `retiko-lifecycle`, et son propre point d'échange `POST /api/internal/lifecycle-credentials` (#251) : un jeton émis pour l'un est refusé par l'autre.

Le sujet OIDC accepte le format historique GitHub et le format immuable introduit pour les dépôts récents, mais les IDs sont dans tous les cas revérifiés séparément. Toute PR, autre branche, autre dépôt ou autre workflow est rejeté. Le `DATABASE_URL` retourné est immédiatement masqué dans les logs du runner, reste local au step du `pg_dump` et n'est jamais enregistré comme secret GitHub. En cas d'échec de connexion, l'empreinte n'affiche que le code d'erreur (`ECONNREFUSED`, `28P01`…), jamais l'hôte.

## Chiffrement

Le dépôt contient uniquement :

`ops/backup/retiko-backup-public.crt`

Le certificat public peut chiffrer les backups mais ne peut pas les déchiffrer.

Empreinte SHA-256 attendue :

`9D:C6:75:2C:0D:38:1A:AD:36:8C:A5:63:BF:D6:29:0D:E8:06:E3:A8:47:00:9F:61:F8:1E:09:8C:7A:E4:A5:F8`

La clé privée de récupération **ne doit jamais être commitée, ajoutée à Vercel, placée dans un ticket ou copiée dans les logs**. Elle doit être conservée hors du dépôt, idéalement dans un gestionnaire de mots de passe et dans une seconde copie hors ligne.

## Contenu d'un artifact

Chaque artifact contient uniquement :

- `retiko-postgres-<timestamp>.dump.cms` : dump chiffré ;
- `manifest.txt` : timestamp, checksums, version PostgreSQL et résultat du restore test.

Le dump PostgreSQL en clair est supprimé avant l'étape d'upload.

## Restauration d'urgence

Pré-requis :

- Docker ;
- la clé privée de récupération Retiko ;
- le certificat public du dépôt ;
- une base PostgreSQL 17 cible **vide**.

Télécharger l'artifact souhaité depuis GitHub Actions, puis :

```bash
bash scripts/restore-backup.sh \
  retiko-postgres-YYYYMMDDTHHMMSSZ.dump.cms \
  /chemin/securise/retiko-backup-recovery-private.pem \
  'postgres://user:password@host:5432/database?sslmode=require'
```

Le script déchiffre dans un répertoire temporaire, valide l'archive, restaure sans `--clean`, puis supprime automatiquement le dump clair temporaire. Il utilise la même image épinglée que le workflow (`RETIKO_PG_IMAGE` pour la remplacer) ; `RETIKO_BACKUP_PUBLIC_CERT` désigne un autre certificat (utilisé par l'auto-test de PR avec une clé éphémère).

Après restauration, sur la base cible uniquement :

```bash
DATABASE_URL='postgres://...' npm run db:setup   # schéma amené au niveau de main
DATABASE_URL='postgres://...' npm run db:verify
```

Puis vérifier `/api/health` avec l'application raccordée à la base restaurée avant toute remise en production.

## Règles de sécurité

- Ne jamais restaurer directement par-dessus la production pour un test.
- Toujours restaurer dans une base vide ou une infrastructure isolée.
- Ne jamais uploader un `.dump` non chiffré.
- Ne jamais écrire `DATABASE_URL` dans les logs.
- Ne jamais élargir la politique OIDC à une PR, un fork ou un workflow différent sans revue de sécurité.
- Ne jamais stocker la clé privée dans le dépôt.
- Une rotation de la clé publique nécessite de conserver les anciennes clés privées tant que les artifacts correspondants existent.

## Limites connues

Le plan Neon actuel conserve l'historique point-in-time seulement quelques heures et n'autorise pas le planning natif des snapshots. Le backup logique GitHub est donc la protection principale à moyen terme.

Si Retiko passe sur un plan Neon avec snapshots planifiés, conserver ce workflow comme **copie indépendante**.


## Extension Neon gérée par la plateforme

La base de production contient `pg_session_jwt`, une extension Neon qui n'existe pas dans l'image PostgreSQL officielle utilisée pour le restore drill.

Le dump logique Retiko l'exclut volontairement avec :

```text
--exclude-extension=pg_session_jwt
```

Les données, tables, contraintes, index, séquences et autres extensions applicatives restent sauvegardés. `pg_session_jwt` est considéré comme une dépendance de plateforme à reprovisionner par Neon sur une cible Neon, et non comme une donnée métier Retiko.

Cette exclusion permet au restore drill de vérifier chaque jour que la sauvegarde Retiko est réellement restaurable dans PostgreSQL 17 standard, au lieu de produire un faux échec uniquement parce que l'image Docker ne contient pas une extension propriétaire du fournisseur.
