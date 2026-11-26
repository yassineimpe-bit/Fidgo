#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/restore-backup.sh <encrypted-backup.dump.cms> <private-key.pem> <target-database-url>

The target database must already exist and should be EMPTY.
This script does not use --clean and will fail rather than overwrite an existing Retiko schema.

Optional environment:
  RETIKO_BACKUP_PUBLIC_CERT  recipient certificate (default: ops/backup/retiko-backup-public.crt)
  RETIKO_PG_IMAGE            PostgreSQL client image (default: the digest pinned by database-backup)
EOF
}

if [ "$#" -ne 3 ]; then
  usage
  exit 2
fi

encrypted_backup="$1"
private_key="$2"
target_database_url="$3"
public_cert="${RETIKO_BACKUP_PUBLIC_CERT:-ops/backup/retiko-backup-public.crt}"
# Même image, épinglée par digest, que le pg_dump de database-backup (#206).
pg_image="${RETIKO_PG_IMAGE:-postgres:17.12@sha256:87c8b42f423b45d5247e6aa8fdb2e7762fec164c68a50fe3eb07e7bfcaf4dbcf}"

for path in "$encrypted_backup" "$private_key" "$public_cert"; do
  if [ ! -f "$path" ]; then
    echo "Fichier introuvable: $path" >&2
    exit 1
  fi
done

if [ -z "$target_database_url" ]; then
  echo "La DATABASE_URL cible est vide." >&2
  exit 1
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
plain_dump="$tmpdir/retiko.dump"

openssl cms -decrypt   -binary   -inform DER   -in "$encrypted_backup"   -recip "$public_cert"   -inkey "$private_key"   -out "$plain_dump"

test -s "$plain_dump"

docker run --rm   -v "$tmpdir:/backup:ro"   "$pg_image"   pg_restore --list /backup/retiko.dump >/dev/null

docker run --rm --network host   -v "$tmpdir:/backup:ro"   -e TARGET_DATABASE_URL="$target_database_url"   "$pg_image"   sh -ceu 'pg_restore     --exit-on-error     --no-owner     --no-privileges     --dbname "$TARGET_DATABASE_URL"     /backup/retiko.dump'

echo "Restauration PostgreSQL terminée. Ensuite, sur la cible uniquement :"
echo "  DATABASE_URL=<cible> npm run db:setup   # amène le schéma au niveau du dépôt (migrations rejouables)"
echo "  DATABASE_URL=<cible> npm run db:verify  # intégrité, tenants, ledger"
