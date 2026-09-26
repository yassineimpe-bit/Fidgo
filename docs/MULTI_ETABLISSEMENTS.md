# Multi-établissements — état actuel et conception

Cahier des charges #88, section 15. Ce document prépare le chantier : il décrit ce que le code fait aujourd'hui, les décisions produit à prendre avant de coder, puis un découpage en PR. **Aucune de ces évolutions n'est implémentée.**

## Ce qui existe déjà

- **Staff rattaché à un établissement** : `staff_users.establishment_id`, non nul.
- **Programme indépendant par établissement** : `loyalty_programs.establishment_id`, unique.
- **Isolation tenant** : chaque table métier porte `establishment_id`, directement ou par clé étrangère. Des contraintes PostgreSQL interdisent les références d'un commerce à l'autre, et `db:verify` les contrôle.
- **Session** : le JWT porte `establishmentId`. `getSession()` le revalide en base (compte actif, commerce actif, `token_version`). Aucune route privée ne fait confiance à un identifiant de commerce envoyé par le navigateur.

## Ce qui bloque aujourd'hui plusieurs établissements par propriétaire

| Point | Emplacement | Effet |
| --- | --- | --- |
| Adresse e-mail staff unique sur toute la plateforme | `staff_users_email_key` (`lower(email)`) | Un propriétaire ne peut pas ouvrir un second commerce avec la même adresse. |
| Un compte staff = un commerce | `staff_users.establishment_id` | Pas d'accès à plusieurs commerces depuis un seul compte. |
| Un seul OWNER par commerce | `staff_users_one_owner_per_establishment` | Pas bloquant ; reste valable par commerce. |
| Session liée à un commerce | `lib/auth.ts` (`establishmentId` dans le JWT) | Il faut un changement de commerce explicite. |
| Abonnement par commerce | `subscriptions.establishment_id`, unique | La facturation est par commerce ; un modèle « organisation » demande une décision. |
| Clients et cartes par commerce | `customers.establishment_id`, `cards_customer_key` | Une carte n'est valable que dans un commerce ; pas de programme partagé. |

## Décisions produit à prendre avant de coder

1. **Facturation**
   - Option A : un abonnement par établissement, soit la grille actuelle multipliée par le nombre de commerces.
   - Option B : un abonnement par organisation, avec un prix par établissement supplémentaire.
   - Les CGV et les Prices Stripe dépendent de ce choix.
2. **Données clients**
   - Un client inscrit dans le commerce A est-il connu du commerce B du même propriétaire ?
   - Si oui, l'organisation devient responsable de traitement pour ces données. Il faut alors mettre à jour le registre, la politique de confidentialité et le texte de consentement à l'inscription. Le consentement marketing doit préciser son périmètre : un commerce ou l'organisation.
3. **Programme partagé**
   - Une même carte peut-elle cumuler dans plusieurs commerces ?
   - Si oui : quel établissement porte le ledger, comment s'applique le cooldown entre commerces, où se consomme la récompense ?
4. **Droits du staff**
   - Un MANAGER ou EMPLOYEE peut-il travailler dans plusieurs commerces ?
   - Faut-il un rôle d'organisation (propriétaire de l'organisation) distinct du rôle par commerce ?
5. **Calendrier**
   - Le GO pilote vise 1 à 3 commerces indépendants ; cette section n'est pas requise pour lui.
   - À programmer avant ou après le pilote.

## Architecture proposée (additive, sans casser l'existant)

Elle suppose les choix suivants, à confirmer : facturation par établissement (option A), données clients et programme **non partagés** au départ, accès multi-commerces réservé au propriétaire.

1. **Migration « organisations »** :
   - table `organizations` (id, nom, date de création) ;
   - `establishments.organization_id`, rempli pour chaque commerce existant par une organisation créée à l'identique ;
   - table `organization_members` (organisation, compte, rôle `ORG_OWNER`), remplie depuis les OWNER actuels.
   - Rejouable, sans changement de comportement.
2. **Accès multi-commerces** :
   - un OWNER d'organisation obtient une ligne `staff_users` par commerce, reliée à une identité de connexion unique ;
   - alternative : une table d'appartenance staff ↔ commerce, qui oblige à retirer l'unicité globale de l'e-mail au profit d'une table d'identités ;
   - le choix se fait à l'implémentation, avec tests d'escalade de privilèges.
3. **Changement de commerce en session** :
   - route `POST /api/session/establishment` : vérifie l'appartenance en base, émet un nouveau JWT et audite l'opération ;
   - contrôle d'origine et limite de débit ;
   - E2E cross-tenant : un membre ne peut jamais basculer vers un commerce hors de son organisation.
4. **Création d'un établissement supplémentaire** par l'ORG_OWNER :
   - onboarding réutilisé ;
   - abonnement créé en essai ou rattaché selon la décision de facturation.
5. **Dashboard multi-établissements** :
   - agrégats par commerce (scans, nouveaux clients, récompenses) ;
   - lecture seule, calculés commerce par commerce avec la même isolation que le dashboard actuel.
6. **Programme partagé** : seulement si la décision 3 le demande. C'est un chantier séparé : ledger, cooldown et RGPD sont concernés.

Chaque étape est une PR distincte : migration rejouable, `db:verify` étendu, tests d'isolation et d'escalade, E2E.

## Cases #88 concernées

- « Organisation propriétaire » : étapes 1 et 2.
- « Plusieurs établissements » : étapes 3 et 4.
- « Dashboard multi-établissements » : étape 5.
- « Architecture compatible programme partagé » : étape 1 (le modèle organisation) et décision 3. Le programme partagé lui-même est l'étape 6.
