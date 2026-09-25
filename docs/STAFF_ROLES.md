# Rôles et permissions staff

Retiko applique les permissions côté interface **et** côté serveur. Le menu n'est jamais considéré comme une barrière de sécurité.

## Matrice

| Capacité | OWNER | MANAGER | EMPLOYEE | VIEWER |
| --- | --- | --- | --- | --- |
| Voir le back-office | Oui | Oui | Non | Oui |
| Scanner / créditer | Oui | Oui | Oui | Non |
| Modifier le programme | Oui | Oui | Non | Non |
| Gérer les clients | Oui | Oui | Non | Non |
| Gérer employés / viewers | Oui | Oui | Non | Non |
| Créer / modifier un manager | Oui | Non | Non | Non |
| Corriger / annuler une transaction | Oui | Oui | Non | Non |
| Modifier le commerce | Oui | Oui | Non | Non |
| Suspendre le commerce | Oui | Non | Non | Non |
| Billing | Oui | Non | Non | Non |
| Envoyer une campagne e-mail | Oui | Oui | Non | Non |

## Règles structurelles

- Un établissement possède un seul OWNER.
- Aucun endpoint staff ne permet de créer un second OWNER.
- Seul OWNER peut créer, promouvoir, rétrograder, désactiver ou réactiver un MANAGER.
- MANAGER peut gérer uniquement EMPLOYEE et VIEWER.
- Un utilisateur ne peut pas modifier son propre rôle ou désactiver sa propre session depuis l'API équipe.
- Chaque changement de rôle ou d'état incrémente `token_version`, ce qui révoque les anciennes sessions de la cible.
- EMPLOYEE est limité au scanner et à la sécurité de son propre compte.
- VIEWER est lecture seule et ne peut pas scanner.

## Audit

Les mutations staff sensibles écrivent dans `audit_logs`.

### Création

Action : `STAFF_CREATE`

Métadonnées :

- rôle attribué ;
- état initial actif.

### Modification

Action : `STAFF_UPDATE`

Métadonnées :

- ancien rôle ;
- nouveau rôle ;
- ancien état actif ;
- nouvel état actif ;
- indicateur changement de rôle ;
- indicateur changement d'état.

Le texte libre, mot de passe ou credential n'est jamais journalisé.

## Tests obligatoires

La CI couvre :

- matrice complète des capacités ;
- OWNER → création MANAGER ;
- MANAGER → création EMPLOYEE ;
- MANAGER → création/promotion MANAGER refusée ;
- MANAGER → modification OWNER refusée ;
- MANAGER → suspension commerce et billing refusés ;
- OWNER → rétrogradation MANAGER ;
- révocation de session après changement de rôle ;
- présence des événements d'audit STAFF_CREATE et STAFF_UPDATE ;
- garde DB contre plusieurs OWNER.
