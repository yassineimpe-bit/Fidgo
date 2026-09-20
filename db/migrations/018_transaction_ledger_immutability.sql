-- Ledger Retiko: les écritures financières sont append-only.
-- Une seule mutation reste autorisée : retirer les motifs libres reason /
-- overrideReason lors d'un effacement RGPD. Aucun autre champ métier ne peut
-- être modifié et aucune transaction ne peut être supprimée.

create or replace function protect_retiko_transaction_ledger()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Transactions are append-only; use a compensating transaction.'
      using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.establishment_id is distinct from old.establishment_id
    or new.card_id is distinct from old.card_id
    or new.staff_user_id is distinct from old.staff_user_id
    or new.type is distinct from old.type
    or new.delta is distinct from old.delta
    or new.balance_after is distinct from old.balance_after
    or new.unit is distinct from old.unit
    or new.idempotency_key is distinct from old.idempotency_key
    or new.reversed_transaction_id is distinct from old.reversed_transaction_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Transaction financial fields are immutable.'
      using errcode = '55000';
  end if;

  if new.metadata is distinct from old.metadata
    and new.metadata is distinct from (old.metadata - 'reason' - 'overrideReason')
  then
    raise exception 'Transaction metadata may only be privacy-redacted.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_ledger_immutable on transactions;
create trigger transactions_ledger_immutable
before update or delete on transactions
for each row execute function protect_retiko_transaction_ledger();
