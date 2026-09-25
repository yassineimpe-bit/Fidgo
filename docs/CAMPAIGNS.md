# Campagnes e-mail

Le commerce écrit à ses clients depuis **Campagnes** (`/dashboard/campaigns`).
Les envois partent par Resend, au nom « *Commerce* via Retiko », avec la
réponse dirigée vers `EMAIL_REPLY_TO`.

## Qui reçoit

Un client n'est destinataire que si **toutes** ces conditions sont réunies :

- il a lui-même accepté les offres du commerce, à l'inscription ou depuis sa
  carte (le commerce peut retirer ce consentement, jamais le donner) ;
- une adresse e-mail est connue, le client n'est pas effacé ;
- sa carte est active et non expirée ;
- il n'a reçu aucun e-mail de campagne de ce commerce depuis 7 jours.

Le consentement est relu au moment de chaque envoi : un client qui se
désabonne après la création de la campagne est ignoré (`skipped`,
`CONSENT_WITHDRAWN`).

## Ciblage

| Ciblage | Définition |
| --- | --- |
| Tous les clients abonnés | tous les clients joignables |
| Clients actifs | au moins un crédit (`earn`) dans les 30 derniers jours |
| Récompense disponible | solde ≥ seuil de récompense du programme |
| Relance des inactifs | carte créée depuis plus de 30/60/90 jours, sans crédit sur cette période |

Le nombre de destinataires est affiché avant l'envoi (`POST /api/campaigns/preview`), sans jamais exposer d'adresse.

## Anti-spam

- au plus **2 campagnes par période de 7 jours glissants** par commerce, vérifié sous verrou (deux créations simultanées ne peuvent pas dépasser la limite) ;
- un client reçoit au plus **un e-mail tous les 7 jours** ;
- au plus **2 000 destinataires** par campagne pendant le pilote ;
- limites de débit : 10 créations/h, 60 aperçus/min, 240 lots/h par membre du staff.

## Envoi

1. `POST /api/campaigns` fige la liste des destinataires dans la même transaction que la campagne. Une clé d'idempotence évite une double création en cas de double clic ou de nouvel essai. Sans destinataire, rien n'est créé.
2. Le navigateur appelle `POST /api/campaigns/<id>/send` jusqu'à ce qu'il ne reste plus de destinataires en attente, par lots de 25. Chaque appel reste ainsi sous le délai d'une fonction serverless.
3. Chaque destinataire est réservé pour 2 minutes avant l'appel à Resend. L'appel porte la clé d'idempotence `campaign-<campagne>-<client>` : si un lot interrompu est repris, Resend ne renvoie pas l'e-mail.
4. Une campagne interrompue (onglet fermé, réseau) reste « Envoi en cours ». Le bouton **Reprendre l'envoi** de l'historique la termine.

Chaque e-mail contient :

- le nom du commerce et son adresse (si renseignée) ;
- la raison de l'envoi ;
- un lien de désabonnement ;
- les en-têtes `List-Unsubscribe` et `List-Unsubscribe-Post` (RFC 8058, désabonnement en un clic depuis la messagerie).

## Rôles et audit

- OWNER et MANAGER créent et envoient (`CAMPAIGN_WRITE`) ; VIEWER consulte l'historique ; EMPLOYEE n'a pas accès.
- Audit `CAMPAIGN_CREATED` (type, ciblage, nombre de destinataires) et `CAMPAIGN_SENT` (envoyés, échecs, ignorés) ; aucun contenu ni adresse dans les métadonnées.
- `campaign_recipients` ne stocke que l'identifiant du client et l'état de livraison ; les lignes sont supprimées à l'effacement du client.

## Déploiement

La migration `027_email_campaigns.sql` complète les tables `campaigns` / `campaign_recipients` du schéma initial. Tant qu'elle n'est pas appliquée, la page affiche « pas encore disponible » et l'API répond `503 CAMPAIGNS_UNAVAILABLE`. Sans `RESEND_API_KEY`, `EMAIL_FROM` et `EMAIL_REPLY_TO`, la création répond `503 EMAIL_NOT_CONFIGURED`.

`CAMPAIGN_EMAIL_TEST_MODE=true` simule les envois (aucun appel à Resend) pour les tests E2E ; ce mode est ignoré lorsque `NODE_ENV=production`.

## Limites connues

- Pas d'envoi programmé ; l'envoi se fait tant que la page reste ouverte, avec reprise manuelle.
- Pas de statistiques d'ouverture ni de clic : aucun pixel de suivi n'est ajouté.
- Les rebonds et plaintes remontés par Resend ne sont pas encore exploités (pas de webhook).
- Durée de conservation des campagnes : à décider (voir `DATA_LIFECYCLE.md`).
