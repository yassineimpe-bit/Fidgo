-- Defense in depth for pilot telemetry and audit rows.
--
-- product_events was introduced after the original tenant-integrity migration,
-- so its card/staff references only checked that the referenced row existed.
-- An application bug could therefore attach an event from tenant A to a card
-- or employee from tenant B. The API already scopes its writes correctly; the
-- database now enforces the same invariant.

do $$ begin
  alter table product_events add constraint product_events_card_same_tenant_fk
    foreign key (card_id, establishment_id)
    references cards(id, establishment_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table product_events add constraint product_events_staff_same_tenant_fk
    foreign key (staff_user_id, establishment_id)
    references staff_users(id, establishment_id);
exception when duplicate_object then null; end $$;

-- An audit row carrying a staff_user_id must also carry its tenant. Rows without
-- a staff actor may keep establishment_id nullable for system-level events.
do $$ begin
  alter table audit_logs add constraint audit_logs_staff_requires_tenant_check
    check (staff_user_id is null or establishment_id is not null);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table audit_logs add constraint audit_logs_staff_same_tenant_fk
    foreign key (staff_user_id, establishment_id)
    references staff_users(id, establishment_id);
exception when duplicate_object then null; end $$;
