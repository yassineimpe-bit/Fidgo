-- Notification « récompense disponible » par e-mail.
-- Désactivée par défaut, réglage du programme. Une ligne par transaction qui
-- fait franchir le seuil : la clé unique rend l'envoi idempotent.
-- Additive et rejouable ; le code fonctionne sans elle (aucun envoi).

alter table loyalty_programs add column if not exists reward_email_enabled boolean not null default false;

create table if not exists reward_notifications (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  transaction_id uuid not null unique references transactions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text check (error is null or char_length(error) <= 60),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists reward_notifications_card_idx on reward_notifications (card_id, created_at desc);
