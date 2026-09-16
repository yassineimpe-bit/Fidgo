# Procédure interne — export et suppression de données personnelles

Procédure opérationnelle pour traiter une demande d'un client final (via le commerce) ou du commerce lui-même.

## Export

1. Le commerce se connecte à son tableau de bord Retiko.
2. Dashboard → Clients → rechercher le client concerné (nom, code court ou email).
3. Cliquer sur « Exporter » : appelle `GET /api/customers/[id]/export`, réservé OWNER/MANAGER.
4. Le fichier JSON téléchargé contient : identité du client, carte, historique complet des transactions.
5. Transmettre le fichier au client par le canal de son choix. Aucune donnée n'est stockée par Retiko au-delà de ce téléchargement.

Un export ne modifie aucune donnée et peut être répété autant que nécessaire.

## Suppression (droit à l'effacement)

1. Dashboard → Clients → rechercher le client concerné.
2. Déclencher la suppression : appelle `DELETE /api/customers/[id]`, réservé OWNER/MANAGER.
3. Effet immédiat :
   - prénom, email, téléphone et consentement marketing sont effacés (mis à `null`) ;
   - la carte associée est désactivée (`active=false`) ;
   - un enregistrement d'audit `CUSTOMER_ERASE` est créé.
4. **Ce qui n'est pas effacé** : l'historique des transactions (`transactions`) reste en base, mais devient pseudonymisé puisque le client associé n'a plus d'identité. Cette conservation est nécessaire à l'intégrité comptable et à la lutte antifraude (voir `docs/RGPD.md`).
5. Informer le demandeur que la suppression est effective et irréversible, et que l'historique de transactions reste conservé sous forme pseudonymisée.

## Délai de traitement cible

Traiter toute demande sous 30 jours maximum (délai légal RGPD), idéalement sous 5 jours ouvrés compte tenu de la simplicité du geste (un clic dans le tableau de bord).

## Cas particulier : demande directement adressée à Retiko

Si un client final contacte directement Retiko (plutôt que le commerce), rediriger vers le commerce concerné, responsable de traitement pour ces données. Retiko peut assister le commerce techniquement mais n'agit pas de sa propre initiative sur les données d'un commerce tiers.
