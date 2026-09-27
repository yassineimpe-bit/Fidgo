-- Voile sombre sur le visuel de carte : choix explicite du commerçant.
-- Activé par défaut pour garder le rendu actuel des cartes déjà personnalisées ;
-- le commerçant peut le retirer depuis ses réglages. Additive et rejouable ;
-- le code lit la colonne via to_jsonb(e) et fonctionne sans elle (voile actif).

alter table establishments add column if not exists card_image_overlay boolean not null default true;
