# Sauvegarde & restauration PostgreSQL

## Objectif

Retiko doit pouvoir survivre à une erreur humaine, une migration ratée ou une perte de la base de production sans dépendre d'un dump conservé en clair.

La base de production est hébergée sur Neon PostgreSQL 17. Le plan Neon actuel `free_v3` ne permet pas de créer un backup schedule natif et limite les snapshots manuels. Le projet utilise donc un backup logique quotidien indépendant du plan Neon.

## Politique actuelle

Le workflow `.github/workflows/database-backup.yml` s'exécute chaque jour à **03:17 UTC**, après le job de rétention de données.

Il effectue dans cet ordre :

1. GitHub Actions demande un jeton OIDC signé pour le workflow de backup sur `main` ;\n2. Retiko vérifie cryptographiquement le dépôt, le workflow, la branche, l'environnement et le type d'événement avant de remettre la connexion PostgreSQL au runner ;
2. empreinte agrégée de la source (`scripts/db-fingerprint.mjs`), `pg_dump` PostgreSQL 17 au format custom, puis seconde empreinte de la source ;
3. validation de l'archive avec `pg_restore --list` ;
4. restauration intégrale dans une PostgreSQL 17 jetable du runner ;
5. exécution de `npm run db:verify` sur la base restaurée ;
6. comparaison de l'empreinte de la base restaurée avec celle de la source ;
7. chiffrement de l'archive avec le certificat public Retiko ;
8. suppression du dump en clair ;
9. upload du backup chiffré comme artifact GitHub ;
10. échec explicite du job si l'étape 4, 5 ou 6 a échoué ;
11. conservation pendant **14 jours**.

Un backup est conservé dès que le dump est lisible (`pg_restore --list`).
Le résultat du restore drill est inscrit dans `manifest.txt` (`restore_test`,
`db_verify`, `fingerprint` : `success` ou `failure`) et un échec rend le job
rouge. Jusqu'au 2026-10-02, un échec de `db:verify` empêchait toute
conservation : un écart de schéma de production (migration 032 non appliquée)
a ainsi supprimé toute nouvelle sauvegarde à partir du 2026-09-27, alors que
les dumps étaient lisibles et restaurables. Avant de restaurer une archive,
lire son manifeste.

L'empreinte ne contient que des agrégats : nombre de lignes de chaque table du
schéma `public`, somme des soldes, cartes actives, transactions par type et
unité avec la somme des deltas, date de la dernière transaction, écarts
ledger/solde, programmes par mode, commerces par statut. Elle est lue dans une
transaction `repeatable read, read only`. Si la source change entre les deux
lectures (écriture pendant le dump), la comparaison stricte est impossible : le
job l'indique par un avertissement sans échouer.

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

Le sujet OIDC accepte le format historique GitHub et le format immuable introduit pour les dépôts récents, mais les IDs sont dans tous les cas revérifiés séparément. Toute PR, autre branche, autre dépôt ou autre workflow est rejeté. Le `DATABASE_URL` retourné est immédiatement masqué dans les logs du runner et n'est jamais enregistré comme secret GitHub.

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

Le script déchiffre dans un répertoire temporaire, valide l'archive, restaure sans `--clean`, puis supprime automatiquement le dump clair temporaire.

Après restauration :

```bash
DATABASE_URL='postgres://...' npm run db:verify
```

Puis vérifier `/api/health` avec l'application raccordée à la base restaurée avant toute remise en production.

## Règles de sécurité

- Ne jamais restaurer directement par-dessus la production pour un test.
- Toujours restaurer dans une base vide ou une infrastructure isolée.
- Ne jamais uploader un `.dump` non chiffré.
- Ne jamais écrire `DATABASE_URL` dans les logs.\n- Ne jamais élargir la politique OIDC à une PR, un fork ou un workflow différent sans revue de sécurité.
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
