# Cycle de vie technique des données Retiko

Ce document décrit les garanties techniques du pilote. Il ne constitue pas
une qualification juridique ni une durée de conservation imposée par la loi.
Les durées doivent être validées par le responsable de traitement avant
activation en production.

## Cartographie

| Table | Données concernées | Sensibilité / rôle | Cycle de vie technique |
|---|---|---|---|
| `establishments` | nom, adresse, téléphone, réseaux, site, horaires | coordonnées du commerce | conservé ; fermeture par `status=suspended`, jamais de hard-delete |
| `staff_users` | email, hash de mot de passe, rôle, activité, version de session | identité et credential dérivé | accès coupé par `active=false` et incrément de `token_version` |
| `customers` | email, téléphone, prénom, consentement et dates | identité/contact client | anonymisé sur effacement ; UUID et dates conservés comme pivot pseudonyme |
| `cards` | token/QR, code court, solde, activité, expiration | credential client et cache du ledger | désactivé et identifiants remplacés ; UUID/solde conservés pour le ledger |
| `transactions` | mouvements, solde après mouvement, staff, métadonnées, idempotence | ledger métier append-only | jamais purgé automatiquement ; motifs libres retirés lors de l'effacement client |
| `wallet_passes` | fournisseur, identifiant externe, hash d'auth Apple, statut, erreur | credential dérivé / état Wallet | marqué `revoked`, jamais exporté avec secrets |
| `apple_wallet_registrations` | identifiant appareil et push token | identifiant technique d'appareil | conservé le temps de délivrer le pass Apple `voided`, puis supprimé par Apple ou après 30 jours pour un pass révoqué |
| `card_recovery_tokens` | hash du lien, expiration, consommation | credential temporaire | invalidé immédiatement ; purge 30 jours après usage/expiration |
| `password_reset_tokens` | hash du lien de reset staff, expiration, consommation | credential temporaire | usage unique ; purge 30 jours après usage/expiration |
| `product_events` | type, durée, IDs carte/staff, métadonnées bornées | télémétrie pseudonymisée | lien carte retiré à l'effacement ; proposition de purge à 180 jours |
| `audit_logs` | acteur, action, entité, métadonnées | preuve technique et sécurité | pseudonymisé ; proposition de purge à 730 jours, sans toucher au ledger |
| `campaign_recipients` | lien campagne/client, état de livraison | historique marketing | supprimé avec l'effacement client |
| `push_subscriptions` | endpoint, clés `p256dh`/`auth` | credentials push | supprimé avec l'effacement client ou la fermeture du commerce |
| `campaigns` | contenu, canal, planification, créateur | données du commerce | conservé ; aucune purge pilote automatique |
| `loyalty_programs` | règles, libellés, valeur de récompense | configuration commerce | conservé avec le commerce |
| `subscriptions` | IDs fournisseur et état d'abonnement | données de facturation | hors périmètre de cette purge ; ne pas supprimer automatiquement |
| `rate_limits` | hash irréversible de clé/IP/email, compteur, fenêtre | donnée technique anti-abus | purge après 2 jours |

## Effacement client

`DELETE /api/customers/:id` est limité au tenant et aux rôles OWNER/MANAGER.
Dans une transaction, il verrouille la carte comme les opérations de crédit et
redemption, puis :

1. met à `NULL` email, téléphone et prénom ; retire le consentement ;
2. désactive la carte et remplace token QR et code court ;
3. invalide tous les liens de récupération ;
4. révoque les lignes Wallet et programme une notification Apple `voided` ;
5. supprime abonnements push et liens de campagne ;
6. détache la télémétrie de la carte ;
7. retire les motifs libres du ledger/audit ;
8. conserve transactions, soldes, UUID et audit d'effacement.

Les triggers de la migration `012_data_lifecycle.sql` interdisent les
hard-deletes de `establishments`, `customers` et `cards`. Ils empêchent ainsi
les anciennes cascades SQL de supprimer accidentellement les transactions.

La migration retire aussi les anciens champs libres `reason` et
`overrideReason`, dont le contenu historique ne peut pas être garanti exempt
de données personnelles, et efface les anciens détails d'erreur fournisseur.
Les nouvelles raisons sont filtrées avant écriture.

## Export client

`GET /api/customers/:id/export` produit un JSON versionné et `no-store`
contenant profil, carte sans token, transactions, états Wallet sans credential,
historique recovery sans hash, événements et audit associé. Un client effacé
ou appartenant à un autre tenant renvoie `404`.

L'export exclut notamment : token de carte complet, hash recovery, hash
d'authentification Apple, push token, password hash, clé API et credential.

## Fermeture d'un établissement

`POST /api/restaurant/suspend` est réservé au OWNER et exige le slug exact plus
la chaîne `SUSPENDRE`. L'opération :

- suspend l'établissement ;
- révoque immédiatement toutes les sessions staff ;
- désactive et renouvelle les identifiants publics des cartes ;
- invalide recovery, password reset et push web ;
- marque les Wallets révoqués et notifie Apple si configuré ;
- conserve clients, transactions, audits et configuration.

Il n'existe volontairement aucune route de suppression définitive ou de
réactivation automatique. Une reprise nécessite une intervention contrôlée et
une réémission des accès/cartes.

## Purge bornée

`npm run data:purge` est un dry-run. `npm run data:purge -- --execute` supprime
au maximum 5 000 lignes par table et par exécution, avec verrou consultatif :

- `product_events` : 180 jours ;
- `audit_logs` : 730 jours ;
- recovery tokens carte utilisés/expirés : 30 jours ;
- tokens de réinitialisation staff utilisés/expirés : 30 jours ;
- inscriptions Apple de passes révoqués : 30 jours ;
- rate limits : 2 jours.

Aucune transaction, carte ledger, client actif, staff, établissement,
configuration de programme ou donnée de facturation n'est supprimé par ce
script. Le workflow `.github/workflows/data-lifecycle.yml` exécute chaque jour
un dry-run sur l'environnement GitHub `production`, à condition que son secret
`DATABASE_URL` soit configuré. La suppression planifiée ne s'exécute que si la
variable GitHub d'environnement `DATA_LIFECYCLE_EXECUTE=true` est explicitement
activée ; un déclenchement manuel peut également demander l'exécution. Les
durées restent à valider juridiquement avant activation automatique et doivent
être réévaluées si la politique de conservation évolue.

## Limites opérationnelles connues

- Apple Wallet permet de pousser un pass marqué `voided`, mais un appareil
  hors ligne peut afficher l'ancien visuel jusqu'à sa prochaine synchronisation.
- Les objets Google Wallet distants ne sont pas modifiés par ce chantier ; la
  carte serveur et la ligne locale sont révoquées, mais une procédure provider
  dédiée reste nécessaire pour forcer l'état distant.
- La fermeture conserve les données personnelles du commerce et du staff ; une
  procédure ultérieure, validée avec les durées métier/fiscales applicables,
  devra traiter leur anonymisation définitive.
