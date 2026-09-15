# Tests d'acceptation sensibles

À exécuter sur une base de test avant pilote.

1. Même `idempotencyKey` envoyé deux fois sur `/api/credit` : une seule transaction `earn`, un seul delta, le replay renvoie `duplicate=true`.
2. Deux requêtes **concurrentes avec la même `idempotencyKey`** sur `/api/credit` : une seule transaction `earn`, un seul delta, la seconde réponse renvoie `duplicate=true` et ne tombe pas sur `COOLDOWN`.
3. Deux requêtes concurrentes avec deux clés différentes sur la même carte : le verrou sérialise ; la seconde doit tomber sur `COOLDOWN` si cooldown > 0.
4. Même `idempotencyKey` envoyé deux fois, y compris concurremment, sur `/api/redeem` : une seule transaction `redeem`, un seul débit, le replay renvoie `duplicate=true`.
5. Une session du restaurant B scanne/crédite une carte du restaurant A : `CARD_NOT_FOUND`, aucun write.
6. `/api/credit` sans cookie : `401`.
7. `/api/redeem` sous le seuil : `409 INSUFFICIENT_BALANCE`.
8. Pour chaque carte : `sum(transactions.delta) = cards.balance`.
9. Un reversal qui rendrait le solde négatif est refusé.
10. Deux inscriptions avec le même email dans le même établissement renvoient la même carte.
11. Le même email peut exister dans deux établissements différents.
12. Consentement marketing non coché : `marketing_consent=false` et `marketing_consent_at=null`.
13. 30 scans réels iPhone + Android : p95 affiché dans `/s/stats` < 2 500 ms.
14. Couper le réseau après clic crédit puis réessayer : la même idempotency key doit être réutilisée par l'UI.
