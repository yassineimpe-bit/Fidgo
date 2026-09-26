-- Visuel de la carte : bannière 1200 × 600 ré-encodée en WebP, stockée dans
-- PostgreSQL comme les logos (aucun prestataire supplémentaire). Utilisable
-- comme fond de carte (card_background = 'image') et affichée en tête de la
-- page d'inscription. Additive et rejouable.

create table if not exists establishment_card_images (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  content bytea not null,
  content_type text not null check (content_type = 'image/webp'),
  width integer not null check (width = 1200),
  height integer not null check (height = 600),
  byte_size integer not null check (byte_size between 1 and 1048576),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint establishment_card_images_size_matches check (octet_length(content) = byte_size)
);
create index if not exists establishment_card_images_establishment_idx on establishment_card_images (establishment_id);

alter table establishments add column if not exists card_image_id uuid references establishment_card_images(id) on delete set null;

-- Le fond « image » exige un visuel. Remplace la contrainte de 030 une seule fois.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'establishments'::regclass and conname = 'establishments_card_design_check'
      and pg_get_constraintdef(oid) like '%card_image_id%'
  ) then
    alter table establishments drop constraint if exists establishments_card_design_check;
    alter table establishments add constraint establishments_card_design_check check (
      (secondary_color is null or secondary_color ~ '^#[0-9a-fA-F]{6}$')
      and card_background in ('solid', 'gradient', 'image')
      and (card_background <> 'gradient' or secondary_color is not null)
      and (card_background <> 'image' or card_image_id is not null)
    );
  end if;
end
$$;
