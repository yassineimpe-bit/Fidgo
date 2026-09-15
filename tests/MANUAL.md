# Tests d'acceptation sensibles

À exécuter sur une base de test avant pilote.

1. Même `idempotencyKey` envoyé deux fois sur `/api/credit` : une seule transaction `earn`, un seul delta, le replay renvoie `duplicate=true`.
2. Deux requêtes **concurrentes avec la même `idempotencyKey`** sur la même carte : une seule transaction `earn`, un seul delta, la seconde réponse renvoie `duplicate=true` et ne tombe pas sur `COOLDOWN`.
3. Deux requêtes concurrentes avec deux clés différentes sur la même carte : le verrou sérialise ; la seconde doit tomber sur `COOLDOWN` si cooldown > 0.
4. Une session du restaurant B scanne/crédite une carte du restaurant A : `CARD_NOT_FOUND`, aucun write.
5. `/api/credit` sans cookie : `401`.
6. `/api/redeem` sous le seuil : `409 INSUFFICIENT_BALANCE`.
7. Pour chaque carte : `sum(transactions.delta) = cards.balance` si le solde initial est zéro.
8. Un reversal qui rendrait le solde négatif est refusé.
9. Deux inscriptions avec le même email dans le même établissement renvoient la même carte.
10. Le même email peut exister dans deux établissements différents.
11. Consentement marketing non coché : `marketing_consent=false` et `marketing_consent_at=null`.
12. 30 scans réels iPhone + Android : p95 affiché dans `/s/stats` < 2 500 ms.
13. Couper le réseau après clic crédit puis réessayer : la même idempotency key doit être réutilisée par l'UI.
