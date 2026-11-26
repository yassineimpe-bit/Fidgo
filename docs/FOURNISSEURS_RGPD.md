# Fournisseurs et garanties RGPD — dossier de validation

Revue du 26 novembre 2026. **PARTIELLEMENT TERMINÉ** : contrats publics
identifiés, acceptation par le compte Retiko et paramètres effectifs à
confirmer. Une région européenne de calcul ne prouve pas l’absence de
transferts internationaux (support, télémétrie, sous-traitants).

| Fournisseur | Preuve technique | Contrat public consulté | Vérification restante |
|---|---|---|---|
| Vercel | Variables de production présentes, santé HTTP 200 ; région fra1 dans le dépôt | [DPA](https://vercel.com/legal/dpa), clauses types selon rôles en annexe 3 | Entité, version acceptée, sous-traitants, rétention des logs, transferts et mesures complémentaires |
| Neon / Databricks | PostgreSQL utilisé par le code ; santé DB up | [Conditions Neon](https://neon.com/platform-terms), mises à jour 14/10/2026 ; ancien lien /dpa redirigé | DPA applicable au compte, région exacte, accès support et transferts ; ne pas supposer l’ancien contrat inchangé |
| Resend | Variables sensibles présentes ; vérification e-mail et campagnes implémentées | [DPA](https://resend.com/legal/dpa), clauses types incorporées | Version acceptée, région effective, rétention des événements et destinataires, sous-traitants |
| GitHub Actions | CI, artefacts et workflows existants | [Politiques de confidentialité](https://docs.github.com/en/site-policy/privacy-policies) ; ancien lien DPA redirigé | Obtenir le DPA applicable au plan ; localisation runners/artefacts, accès, rétention avec mission exploitation |
| Stripe | Compte TEST, trois Prices pilotes et webhook présents ; aucune variable prod | [DPA](https://stripe.com/legal/dpa), version publique 28/09/2026 | Entité France/EEE réellement contractante, DPA et Data Transfer Addendum acceptés, rôle par traitement, rétention comptable |
| Google Wallet | Variables et flag de production présents, code émission/synchronisation/révocation | [Conditions API Wallet](https://developers.google.com/wallet/retail/loyalty-cards/resources/terms-of-service) | Conditions acceptées, statut Issuer, finalités propres Google, transferts, données de QR et liens porteurs d’accès |
| Apple Wallet/APNs | Configuration détectée par santé prod, code émission/APNs | [Accords développeur](https://developer.apple.com/support/terms/) | Accord applicable accepté, rôles Apple et gestion push tokens, tests physiques |

Pour chaque fournisseur, conserver hors dépôt une preuve datée : compte et
entité Retiko, service, version du contrat accepté, DPA applicable, liste des
sous-traitants, pays, mécanisme de transfert (adéquation/DPF si applicable ou
clauses types et analyse complémentaire), mesures techniques et prochaine
revue. Le simple lien vers une politique publique n’est pas une validation.
Aucune certification DPF ni signature contractuelle n’a été vérifiée ici.

## Annexe DPA commerçant à finaliser

Le modèle `DPA_TEMPLATE.md` est présent. Avant signature : renseigner les
parties et contacts, l’objet/durée, les instructions, les catégories de
personnes/données, la liste autorisée des sous-traitants effectifs, les
modalités d’information et d’objection, les mesures de sécurité, les droits,
les incidents, les transferts et les modalités de restitution/effacement.
La pseudonymisation du ledger n’est pas une anonymisation irréversible et ne
justifie pas une conservation illimitée. Fixer séparément les durées des
comptes clos, employés, clients inactifs, preuves, logs, factures et Wallet.

Le produit sait exporter/effacer un client et révoquer sa carte ; il ne sait
pas produire un export global complet du commerçant ni anonymiser
irréversiblement tout un commerce fermé. Les extractions manuelles doivent
être autorisées, limitées au tenant et tracées. Décrire ces limites au client.

## Procédure incident et droits

`RGPD_PROCEDURES.md` contient les procédures. Retiko informe sans délai indu
le commerce pour un incident sur ses données ; le responsable apprécie le
risque et notifie la CNIL si requis, si possible sous 72 h. Pour ses propres
traitements, Retiko prend cette décision. Tenir un registre de tous les
incidents, y compris ceux sans notification, et un suivi des demandes de
droits (réception, vérification proportionnée, action, réponse, clôture).
[CNIL — violations](https://www.cnil.fr/fr/violations-de-donnees-personnelles-les-regles-suivre),
[RGPD art. 28 à 33](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4).

## Cookies et ressources tierces

La page `/legal/cookies` existe. Auditer séparément les traceurs réellement
chargés et tout logo/image distant choisi par un commerce : le chargement
d’une ressource externe peut transmettre IP et user-agent à son hébergeur.
Ne pas déclarer une absence de tiers sur la seule absence de Google Analytics.
L’utilisation d’un cookie strictement nécessaire à la session ne rend pas
un éventuel traceur marketing exempté de consentement.
