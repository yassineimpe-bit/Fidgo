# RGPD - périmètre MVP Retiko

## Données et principes

- email obligatoire en V0 afin de permettre une récupération sécurisée de la carte ;
- prénom et téléphone facultatifs ;
- consentement marketing séparé, explicite et non précoché ;
- aucune donnée de contact dans le QR client ;
- token de carte absent des URLs de polling ;
- isolation par `establishment_id` ;
- carte publique limitée aux données nécessaires ;
- journal d'audit ;
- export client JSON ;
- effacement des données personnelles avec désactivation de carte ;
- conservation du ledger pseudonymisé pour intégrité et antifraude.

## Répartition des rôles pour le programme fidélité

Pour les données des consommateurs traitées dans le cadre du programme de fidélité :

- le **commerce** détermine la finalité et les règles du programme et agit comme responsable du traitement ;
- **Retiko** fournit l'infrastructure et traite les données pour le compte du commerce en qualité de sous-traitant.

Retiko reste responsable de ses propres traitements nécessaires à la relation SaaS avec le commerçant, par exemple comptes administrateurs, support, sécurité et facturation.

Cette répartition doit être reflétée dans l'accord pilote et son annexe de sous-traitance.

Modèles de travail présents dans le dépôt :

- `PILOT_AGREEMENT_TEMPLATE.md` pour l'accord pilote ;
- `DPA_TEMPLATE.md` pour l'annexe de sous-traitance ;
- `RGPD_PROCEDURES.md` pour l'exercice des droits, les violations de données et la fin de relation ;
- `PRIVACY_POLICY_TEMPLATE.md` pour la politique de confidentialité publique ;
- `MENTIONS_LEGALES_TEMPLATE.md` pour les mentions légales.

## Sous-traitants techniques

Documenter uniquement les fournisseurs réellement activés. Pour le pilote, la liste attendue comprend au minimum :

- Vercel pour l'hébergement applicatif ;
- Neon pour PostgreSQL ;
- Resend pour les emails transactionnels de récupération, une fois activé ;
- l'outil d'observabilité retenu, s'il traite des données pour Retiko.

Éviter toute donnée personnelle inutile dans les logs et outils de monitoring. Les secrets, JWT, tokens de carte et liens magiques ne doivent pas être journalisés.

## Exercice des droits

Le commerce reste responsable de la réponse aux demandes de ses clients. Retiko doit l'assister techniquement lorsqu'une demande concerne des données traitées pour son compte.

En principe, la personne concernée doit recevoir une réponse dans les meilleurs délais et au plus tard dans un délai d'un mois à compter de la réception de la demande. Une prolongation de deux mois peut être possible en cas de demande complexe ou nombreuse, sous réserve d'en informer la personne dans le premier mois.

## Violations de données

Retiko documente les incidents et informe sans délai indu tout commerce dont les données sont affectées.

Pour le responsable du traitement, une violation présentant un risque pour les droits et libertés doit être notifiée à la CNIL dans les meilleurs délais et, si possible, au plus tard dans les 72 heures après en avoir pris connaissance. Une violation présentant un risque élevé peut également imposer d'informer les personnes concernées dans les meilleurs délais.

La procédure détaillée figure dans `RGPD_PROCEDURES.md`.

## Avant le premier pilote réel

Finaliser :

- politique de confidentialité ;
- mentions légales ;
- identité juridique Retiko et contacts à insérer dans les modèles ;
- accord pilote ;
- annexe de sous-traitance ;
- durées de conservation ;
- procédure de violation de données ;
- procédure d'exercice des droits ;
- liste des sous-traitants effectivement activés et leurs localisations/transferts.

Les campagnes marketing restent désactivées tant que consentement, désinscription et plafonds anti-spam ne sont pas implémentés de bout en bout.
