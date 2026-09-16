-- A reversal belongs to the same tenant as the transaction it cancels, and a
-- transaction can be reversed at most once. Application locks already enforce
-- this during normal API traffic; these constraints protect the ledger from
-- alternate writers and future regressions.

do $$ begin
  alter table transactions add constraint transactions_id_establishment_key
    unique (id, establishment_id);
exception when duplicate_object or duplicate_table then null; end $$;

do $$ begin
  alter table transactions add constraint transactions_reversal_same_tenant_fk
    foreign key (reversed_transaction_id, establishment_id)
    references transactions(id, establishment_id);
exception when duplicate_object then null; end $$;

create unique index if not exists transactions_reversed_once_key
  on transactions (reversed_transaction_id)
  where reversed_transaction_id is not null;
