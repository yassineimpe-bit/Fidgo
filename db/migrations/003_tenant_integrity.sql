-- Defense in depth: a row must not be able to reference another tenant even if
-- an application query accidentally forgets an establishment_id predicate.

do $$ begin
  alter table customers add constraint customers_id_establishment_key unique (id, establishment_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table staff_users add constraint staff_users_id_establishment_key unique (id, establishment_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table cards add constraint cards_id_establishment_key unique (id, establishment_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table cards add constraint cards_customer_same_tenant_fk
    foreign key (customer_id, establishment_id)
    references customers(id, establishment_id)
    on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table transactions add constraint transactions_card_same_tenant_fk
    foreign key (card_id, establishment_id)
    references cards(id, establishment_id)
    on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table transactions add constraint transactions_staff_same_tenant_fk
    foreign key (staff_user_id, establishment_id)
    references staff_users(id, establishment_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table wallet_passes add constraint wallet_passes_card_same_tenant_fk
    foreign key (card_id, establishment_id)
    references cards(id, establishment_id)
    on delete cascade;
exception when duplicate_object then null; end $$;
