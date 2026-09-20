-- Note interne facultative, strictement limitée et effacée avec le client.
-- Rejouable par db:setup ; aucune transaction ni carte n'est modifiée.
alter table customers add column if not exists internal_note text;

update customers set internal_note=null
where deleted_at is not null and internal_note is not null;

do $$ begin
  alter table customers add constraint customers_internal_note_check check (
    (internal_note is null or (char_length(internal_note) <= 500 and internal_note !~ '[<>]'))
    and (deleted_at is null or internal_note is null)
  );
exception when duplicate_object then null; end $$;
