-- Libellé personnalisé de l'unité du programme (« café », « baguette »…).
-- Facultatif : NULL = « tampon(s) » / « point(s) » selon le mode.
-- Idempotente et additive ; le code lit ces colonnes via to_jsonb(p) et
-- fonctionne sans elles.

alter table loyalty_programs add column if not exists unit_label text;
alter table loyalty_programs add column if not exists unit_label_plural text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loyalty_programs_unit_label_check') then
    alter table loyalty_programs add constraint loyalty_programs_unit_label_check check (
      (unit_label is null or char_length(unit_label) between 1 and 24)
      and (unit_label_plural is null or (unit_label is not null and char_length(unit_label_plural) between 1 and 24))
    );
  end if;
end
$$;
