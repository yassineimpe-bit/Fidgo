-- La validation des donnees de marque (safeHttpsUrl, normalizeHexColor) a ete
-- ajoutee sur le chemin d'ECRITURE uniquement. Les lignes creees avant ce
-- durcissement n'ont jamais ete nettoyees et sont toujours servies telles
-- quelles sur les pages publiques /j/{slug} et /c/{token}.
--
-- Rejouable : db-setup applique ce fichier a chaque execution.

begin;

-- 1. Nettoyage des valeurs heritees.
update establishments
set primary_color = '#111111'
where primary_color is null or primary_color !~ '^#[0-9a-fA-F]{6}$';

update establishments
set logo_url = null
where logo_url is not null and logo_url !~* '^https://';

update establishments
set website = null
where website is not null and website !~* '^https://';

-- 2. La base devient la derniere ligne de defense, comme pour status/mode/role.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname = 'establishments_primary_color_check'
  ) then
    alter table establishments
      add constraint establishments_primary_color_check
      check (primary_color ~ '^#[0-9a-fA-F]{6}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname = 'establishments_logo_url_https_check'
  ) then
    alter table establishments
      add constraint establishments_logo_url_https_check
      check (logo_url is null or logo_url ~* '^https://');
  end if;

  if not exists (
    select 1 from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname = 'establishments_website_https_check'
  ) then
    alter table establishments
      add constraint establishments_website_https_check
      check (website is null or website ~* '^https://');
  end if;
end $$;

commit;

