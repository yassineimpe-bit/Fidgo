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

## Sous-traitants techniques

Documenter uniquement les fournisseurs réellement activés. Pour le pilote, la liste attendue comprend au minimum :

- Vercel pour l'hébergement applicatif ;
- Neon pour PostgreSQL ;
- Resend pour les emails transactionnels de récupération, une fois activé ;
- l'outil d'observabilité retenu, s'il traite des données pour Retiko.

Éviter toute donnée personnelle inutile dans les logs et outils de monitoring. Les secrets, JWT, tokens de carte et liens magiques ne doivent pas être journalisés.

## Avant le premier pilote réel

Finaliser :

- politique de confidentialité ;
- mentions légales ;
- accord pilote ;
- annexe de sous-traitance ;
- durées de conservation ;
- procédure de violation de données ;
- procédure d'exercice des droits ;
- liste des sous-traitants effectivement activés.

Les campagnes marketing restent désactivées tant que consentement, désinscription et plafonds anti-spam ne sont pas implémentés de bout en bout.
