-- Logos importés par les commerces (retour terrain du 25/09/2026).
--
-- Le fichier est stocké dans PostgreSQL, déjà utilisé et sauvegardé, pour ne
-- pas introduire de nouveau prestataire : chaque logo est ré-encodé côté
-- serveur en WebP 512 × 512 (quelques dizaines de Ko), sans métadonnées.
-- La table peut être remplacée plus tard par un stockage objet sans toucher
-- aux pages, qui ne connaissent que l'URL /api/logos/<id>.
--
-- Idempotente et purement additive : l'application tourne sans elle (l'upload
-- répond alors 503) ; l'appliquer en production avant le déploiement.

create table if not exists establishment_logos (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id),
  content bytea not null,
  content_type text not null check (content_type = 'image/webp'),
  width integer not null check (width between 64 and 1024),
  height integer not null check (height between 64 and 1024),
  byte_size integer not null check (byte_size between 1 and 524288),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint establishment_logos_size_matches check (octet_length(content) = byte_size)
);

create index if not exists establishment_logos_establishment_idx
  on establishment_logos (establishment_id);

-- logo_url accepte désormais aussi le chemin relatif d'un logo importé.
-- Même nom de contrainte que la migration 014, qui ne la recrée donc pas
-- lorsqu'elle est rejouée ; remplacée une seule fois (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'establishments'::regclass
      and conname = 'establishments_logo_url_https_check'
      and pg_get_constraintdef(oid) like '%/api/logos/%'
  ) then
    alter table establishments drop constraint if exists establishments_logo_url_https_check;
    alter table establishments
      add constraint establishments_logo_url_https_check
      check (
        logo_url is null
        or logo_url ~* '^https://'
        or logo_url ~ '^/api/logos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      );
  end if;
end
$$;
