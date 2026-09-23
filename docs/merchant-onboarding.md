# Onboarding commerçant — partie 3 de l’issue #88

Après inscription, le propriétaire arrive sur `/onboarding` :

1. Nom, logo HTTPS, couleur principale, adresse et coordonnées, avec aperçu immédiat. Logo et coordonnées restent facultatifs.
2. Tampons ou points (par achat ou par euro), objectif et récompense, avec aperçu immédiat.
3. Création du premier compte EMPLOYEE, ou choix explicite de continuer seul.
4. QR d’inscription client, lien vers l’affiche imprimable, aide PWA et premier test ; validation puis arrivée sur le dashboard.

Les formulaires réutilisent les API de réglages et leurs validations. Le QR utilise le domaine canonique défini par `getAppUrl()` et conduit au vrai parcours `/j/[slug]`.

## Progression et accès

`establishments.onboarding_step` suit les étapes 1 à 4, puis 5 pour une configuration terminée. L’inscription initialise 1 dans la même transaction que le compte OWNER, le programme et l’essai.

L’identité et le programme avancent uniquement après une sauvegarde valide et dans la même transaction. Le propriétaire peut revenir aux étapes précédentes sans faire reculer sa progression. Quitter la page conserve les étapes déjà enregistrées ; les champs non enregistrés ne sont pas conservés. Le dashboard propose de reprendre une configuration inachevée.

L’API de progression accepte uniquement les actions équipe/fin. Elle exige une session OWNER, vérifie l’origine, limite les requêtes, verrouille l’établissement pendant la transition et audite chaque transition effectivement réalisée. Un identifiant d’établissement envoyé dans le corps ne peut pas changer le tenant. La validation de l’équipe vérifie un EMPLOYEE actif, sauf choix explicite de continuer seul.

Les commerces existants gardent `NULL` et ne sont pas forcés à refaire leur configuration. Le rôle MANAGER conserve ses permissions de réglage, mais ne peut pas faire avancer l’onboarding du propriétaire.

## Migration et livraison

Appliquer `db/migrations/019_merchant_onboarding.sql` **avant** de servir le nouveau code. La migration est additive et rejouable ; `/api/health` signale un schéma incomplet si la colonne manque. `npm run db:setup` applique également cette migration sur un environnement de test.

Cette livraison ne déploie pas la migration en production et ne prétend pas valider l’installation PWA ou le scan sur appareil physique. Le logo reste une URL HTTPS, sans upload de fichier. La sélection automatique d’un modèle selon le métier relève du chantier distinct SPEC-V0 §14.

## Vérification

`tests/e2e/guided-onboarding.spec.ts` couvre les parcours tampons/points, la persistance de l’identité, l’aperçu, la création et la connexion employé, le choix sans employé, l’inscription client depuis le QR, la reprise, les erreurs, l’absence de débordement mobile, l’isolation tenant, la finalisation concurrente, les rôles et les commerces historiques.

Les suites `onboarding`, `establishment-signup`, `merchant-branding` et `auth-roles` restent les tests de régression associés. `tests/health-schema.test.ts` couvre la détection de migration manquante.
