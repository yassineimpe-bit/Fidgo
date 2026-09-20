# Sauvegarde & restauration PostgreSQL

## Objectif

Retiko doit pouvoir survivre à une erreur humaine, une migration ratée ou une perte de la base de production sans dépendre d'un dump conservé en clair.

La base de production est hébergée sur Neon PostgreSQL 17. Le plan Neon actuel `free_v3` ne permet pas de créer un backup schedule natif et limite les snapshots manuels. Le projet utilise donc un backup logique quotidien indépendant du plan Neon.

## Politique actuelle

Le workflow `.github/workflows/database-backup.yml` s'exécute chaque jour à **03:17 UTC**, après le job de rétention de données.

Il effectue dans cet ordre :

1. connexion à la base de production via le secret GitHub Environment `production / DATABASE_URL` ;
2. `pg_dump` PostgreSQL 17 au format custom ;
3. validation de l'archive avec `pg_restore --list` ;
4. restauration intégrale dans une PostgreSQL 17 jetable du runner ;
5. exécution de `npm run db:verify` sur la base restaurée ;
6. chiffrement de l'archive avec le certificat public Retiko ;
7. suppression du dump en clair ;
8. upload du backup chiffré comme artifact GitHub ;
9. conservation pendant **14 jours**.

Un backup n'est donc conservé que si le dump est lisible, restaurable et si les contrôles d'intégrité Retiko passent.

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
- Ne jamais écrire `DATABASE_URL` dans les logs.
- Ne jamais stocker la clé privée dans le dépôt.
- Une rotation de la clé publique nécessite de conserver les anciennes clés privées tant que les artifacts correspondants existent.

## Limites connues

Le plan Neon actuel conserve l'historique point-in-time seulement quelques heures et n'autorise pas le planning natif des snapshots. Le backup logique GitHub est donc la protection principale à moyen terme.

Si Retiko passe sur un plan Neon avec snapshots planifiés, conserver ce workflow comme **copie indépendante**.
