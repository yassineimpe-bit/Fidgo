# État du socle légal et RGPD de Retiko

Point d'entrée unique : où se trouvent les documents, ce qui manque, ce qui
reste à décider. Mis à jour le 25/09/2026 (issue #131).

## Documents publics (source : le code)

| Document | Route | Source |
|---|---|---|
| CGU | `/legal/cgu` | `app/legal/cgu/page.tsx` |
| CGV | `/legal/cgv` | `app/legal/cgv/page.tsx` (prix et essai lus dans `lib/billing.ts`) |
| Mentions légales | `/legal/mentions-legales` | `app/legal/mentions-legales/page.tsx` |
| Politique de confidentialité | `/legal/confidentialite` | `app/legal/confidentialite/page.tsx` |
| Cookies et traceurs | `/legal/cookies` | `app/legal/cookies/page.tsx` |

Les pages remplacent les anciens modèles `PRIVACY_POLICY_TEMPLATE.md` et
`MENTIONS_LEGALES_TEMPLATE.md` : il n'existe plus qu'une version de chaque texte.
Chaque page affiche qu'elle n'a pas été validée juridiquement.

Liens légaux : pied de page de l'accueil, pages d'inscription et de connexion ;
mention d'information et lien « Données personnelles » sur la page d'inscription
client `/j/[commerce]`.

## Acceptation au signup

- Case CGU + CGV **obligatoire**, contrôlée côté serveur (`LEGAL_ACCEPTANCE_REQUIRED`),
  avec la version affichée (`LEGAL_VERSION` dans `lib/legal.ts`) : une version
  périmée est refusée.
- Case « nouveautés Retiko » **séparée, facultative, jamais pré-cochée**.
- Preuve : table `legal_acceptances` (document, version, date, source `signup`,
  commerce, compte) ; consentement dans `staff_users.marketing_consent[_at]`.
- Le flux de #127 est inchangé : 202 + vérification e-mail avant connexion. Une
  réinscription sur une adresse non vérifiée ajoute une nouvelle preuve et
  applique le dernier choix marketing.
- Changer substantiellement les CGU/CGV impose d'incrémenter `LEGAL_VERSION`.
  Les comptes existants ne sont pas encore invités à ré-accepter (aucun parcours
  de ré-acceptation) : **à décider** avant la première modification.

Migration : `db/migrations/022_legal_acceptance.sql` (additive, idempotente,
à appliquer en production **avant** le déploiement du code, sinon l'inscription
échoue et `/api/health` passe en 503).

## Informations à fournir par l'exploitant

Source unique : `LEGAL_ENTITY` et `HOSTING_PROVIDER` dans `lib/legal.ts`. Tout
champ `null` s'affiche « [À COMPLÉTER] » et figure dans `missingLegalFields()`.

- raison sociale ou nom de l'exploitant ;
- forme juridique ;
- capital social (si société) ;
- SIREN / SIRET ;
- immatriculation (RCS / RNE selon le statut) ;
- numéro de TVA intracommunautaire (si applicable) et régime de TVA ;
- adresse du siège ;
- directeur de la publication ;
- représentant légal ;
- téléphone de contact ;
- contact pour les demandes relatives aux données personnelles ;
- DPO désigné ou non ;
- taux des pénalités de retard (CGV) ;
- tribunal compétent entre professionnels (CGV) ;
- adresse et téléphone de l'hébergeur Vercel (à recopier depuis ses mentions).

`contact@retiko.fr` est utilisé comme e-mail de contact (adresse de réponse des
e-mails transactionnels) : **à confirmer** comme contact public.

## Décisions juridiques ou métier encore ouvertes

1. **Petits professionnels** (≤ 5 salariés, contrat hors de l'activité
   principale, conclu à distance ou hors établissement) : application du droit
   de la consommation (rétractation, information précontractuelle, résiliation).
   Voir `PROSPECTION_HORS_ETABLISSEMENT.md`. **À valider juridiquement.**
2. Taux des pénalités de retard et clause de juridiction.
3. Limitation de responsabilité (aucune n'est rédigée ; pas d'exclusion générale).
4. Offre « Retiko 12 » : conditions de sortie anticipée et mécanisme de
   résiliation dans le portail Stripe (voir `BILLING.md`).
5. Préavis de suspension pour impayé et de modification de prix.
6. Bases légales proposées dans le registre (toutes « à valider »).
7. Durées : clients inactifs, commerce clos, staff désactivé, preuves
   d'acceptation, facturation, journal super-admin, journaux Vercel.
8. Transferts hors UE : garanties par prestataire (Vercel, GitHub, Resend,
   Stripe, Google, Apple) et région Neon.
9. Parcours de ré-acceptation en cas de nouvelle version des CGU/CGV.

## Correctifs d'exploitation identifiés

- Workflow `data-lifecycle` en échec chaque nuit : secret `DATABASE_URL`
  absent de l'environnement GitHub `production`. Aucune purge n'est exécutée.
- `CRON_SECRET` : sa présence en production conditionne la purge quotidienne
  de `rate_limits` (non vérifiable depuis le dépôt).

## Documents RGPD internes

- `REGISTRE_TRAITEMENTS.md` — registre art. 30 et liste des sous-traitants ;
- `DATA_LIFECYCLE.md` — cycle de vie technique et état réel des durées ;
- `RGPD_PROCEDURES.md` — droits, violations, fin de relation ;
- `DPA_TEMPLATE.md` — annexe de sous-traitance ;
- `retiko_references_officielles_legal_rgpd.md` — sources officielles utilisées.
