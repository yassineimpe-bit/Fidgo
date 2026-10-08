# État du socle légal et RGPD de Retiko

Point d'entrée unique : où se trouvent les documents, ce qui manque, ce qui
reste à décider. Mis à jour le 02/10/2026.

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

## Identité juridique de l'exploitant

Source unique : `LEGAL_ENTITY` et `HOSTING_PROVIDER` dans `lib/legal.ts`.

Les informations officielles issues de la formalité de création validée le
01/10/2026 sont désormais renseignées :

- exploitant : Yassine Roussiere ;
- nom commercial : RETIKO ;
- forme juridique : entrepreneur individuel, micro-entreprise ;
- SIREN : 130 906 787 ;
- SIRET : 130 906 787 00010 ;
- code APE : 6201Z ;
- immatriculation au RNE : 01/10/2026 ;
- adresse : 27 rue du Mas Rouge, 19200 Ussel, France ;
- régime de TVA : franchise en base, TVA non applicable — article 293 B du CGI ;
- téléphone : 07 80 42 62 67 ;
- e-mail public : `contact@retiko.fr`.

Les coordonnées publiques de l'hébergeur Vercel ont également été renseignées
depuis ses mentions officielles.

Restent volontairement à compléter ou à décider :

- contact dédié aux demandes relatives aux données personnelles ;
- DPO désigné ou non ;
- taux des pénalités de retard (CGV) ;
- tribunal compétent entre professionnels (CGV).

Tout champ encore `null` s'affiche « [À COMPLÉTER] » lorsqu'il est utilisé
dans une page publique et figure dans `missingLegalFields()`.

## Décisions juridiques ou métier encore ouvertes

1. **Petits professionnels** (≤ 5 salariés, contrat hors de l'activité
   principale, conclu à distance ou hors établissement) : application du droit
   de la consommation (rétractation, information précontractuelle, résiliation).
   Voir `PROSPECTION_HORS_ETABLISSEMENT.md`. **À valider juridiquement.**
2. Taux des pénalités de retard et clause de juridiction.
3. Limitation de responsabilité (aucune n'est rédigée ; pas d'exclusion générale).
4. Grille affichée dans les CGV : grille publique `standard` (25 € HT/mois
   sans engagement, 250 € HT/an payé d'avance) depuis la version 2026-09-27.
   Le régime de TVA est désormais précisé dans les CGV (§ 4) : franchise en base, TVA non applicable (article 293 B du CGI) ;
   l'offre Fondateurs (19 € HT/mois pendant 24 mois) n'y figure pas et passe
   par proposition commerciale écrite (voir `BILLING.md`). L'ancienne offre
   « Retiko 12 » (grille `pilot`) n'est plus proposée : ses conditions de
   sortie anticipée ne restent à trancher que si elle est réactivée.
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
