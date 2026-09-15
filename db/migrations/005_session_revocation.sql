alter table staff_users
  add column if not exists token_version integer not null default 0 check (token_version >= 0);
