-- Personnalisation de la carte : couleur secondaire facultative et style de
-- fond (couleur unie ou dégradé principale → secondaire). Additive et
-- rejouable ; le code lit ces colonnes via to_jsonb(e) et fonctionne sans elles.

alter table establishments add column if not exists secondary_color text;
alter table establishments add column if not exists card_background text not null default 'solid';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'establishments_card_design_check') then
    alter table establishments add constraint establishments_card_design_check check (
      (secondary_color is null or secondary_color ~ '^#[0-9a-fA-F]{6}$')
      and card_background in ('solid', 'gradient')
      and (card_background <> 'gradient' or secondary_color is not null)
    );
  end if;
end
$$;
