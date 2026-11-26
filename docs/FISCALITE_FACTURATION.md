# Fiscalité et facturation — validation avant ouverture de Stripe

Revue du 26 novembre 2026. **BLOQUÉ PAR UNE ACTION HUMAINE** pour le régime
fiscal effectif et le modèle final de facture. L’immatriculation INPI déclarée
ne constitue pas une preuve de franchise de TVA. Aucun paiement LIVE autorisé.

## Régime et pièces nécessaires

La PR #243 contient l’identité de l’EI Yassine Roussiere / RETIKO, SIREN
130 906 787, SIRET 130 906 787 00010, APE 6201Z. Ces informations ont été
recoupées avec la synthèse INPI définitive de création validée du 01/10/2026,
fournie par l’exploitant (pages 1, 4 et 5). La page 7 indique la franchise en
base TVA, « Micro BIC » et l’option de versement libératoire ; la page 5
qualifie l’activité de libérale non réglementée. Faire confirmer cette
articulation au SIE et conserver les justificatifs hors du dépôt. Le code APE ne détermine pas à lui seul le régime fiscal.

Obtenir le mémento fiscal ou une confirmation du SIE indiquant le régime réel,
une éventuelle option TVA, les obligations déclaratives et le numéro
intracommunautaire si nécessaire. Pour une prestation de services relevant du
cas général, les seuils publiés pour 2026 sont 37 500 € pour l’année précédente
et 41 250 € en cours d’année ; vérifier aussi les règles de création en cours
d’année, le chiffre d’affaires et les activités mixtes. Ne pas confondre avec
les seuils du régime micro. [Service Public](https://entreprendre.service-public.gouv.fr/vosdroits/F21746),
[DGFiP](https://www.impots.gouv.fr/professionnel/les-regimes-dimposition-la-tva).

Si la franchise s’applique, aucune TVA n’est ajoutée et la facture porte
« TVA non applicable, article 293 B du CGI ». La référence est à recontrôler
pour les factures 2027 compte tenu de la recodification fiscale ; ne pas
modifier automatiquement les modèles sur la seule base d’un article ancien.
[CGI art. 293 B](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048826700),
[mentions de facture](https://www.service-public.gouv.fr/entreprendre/vosdroits/F31808).

## Achats de services étrangers

La franchise dispense de collecte sur les ventes éligibles, pas nécessairement
de la TVA sur les achats. Les prestations B2B relevant de la règle générale,
fournies par un prestataire non établi en France à un assujetti français,
peuvent imposer identification et autoliquidation en France. Vérifier chaque
facture Vercel, Neon/Databricks, Resend, Stripe et autres : entité contractante,
pays, nature du service et traitement déjà appliqué. Faire confirmer par le SIE
la déclaration, le paiement et l’absence de droit à déduction sous franchise ;
ne pas appliquer indistinctement ce traitement à tous les frais financiers.
[DGFiP — prestations entre assujettis](https://www.impots.gouv.fr/professionnel/prestations-entre-assujettis),
[BOFiP — redevable](https://bofip.impots.gouv.fr/bofip/3218-PGP.html/identifiant%3DBOI-TVA-DECLA-10-10-20-20251022).

## Modèle B2B à valider dans Stripe TEST

- Identité complète du vendeur avec « EI » ou « Entrepreneur individuel »,
  adresse, SIREN ; identité et adresse de facturation du client professionnel.
- Date d’émission, numéro unique selon une séquence chronologique continue,
  date/période de la prestation, référence de commande lorsqu’elle existe.
- Désignation précise de l’abonnement, quantité, prix unitaire, remises,
  totaux, monnaie, mention de TVA applicable et absence de TVA si franchise.
- Échéance, conditions de paiement, escompte (néant si aucun), taux de retard
  validé et indemnité forfaitaire de recouvrement de 40 € lorsque applicable.
- Mention de l’adresse de livraison différente et autres mentions nouvelles
  de facturation électronique selon leur champ d’application.

Préparer une facture mensuelle, une annuelle, une facture après essai et un
avoir référençant la facture initiale. Une facture finalisée ne se réécrit pas
pour masquer une erreur : utiliser l’avoir approprié et conserver la piste
d’audit. Choisir une numérotation cohérente avec toute facture hors Stripe ;
ni un numéro d’abonnement ni le ledger fidélité ne remplace une facture.
Archiver factures et pièces comptables pendant la durée légale applicable
(10 ans pour les pièces comptables), indépendamment de la rétention technique
des webhooks. Cette durée ne justifie pas de garder toutes les données fidélité.
[Facturation](https://www.service-public.gouv.fr/entreprendre/vosdroits/F23208),
[obligations comptables](https://entreprendre.service-public.gouv.fr/vosdroits/F23266).

## Facturation électronique

Au 26/11/2026, la capacité de réception est déjà exigée depuis le 01/09/2026
pour les entreprises concernées, y compris les micro-entrepreneurs en franchise.
L’émission et l’e-reporting applicables aux petites/micro-entreprises sont
prévus au 01/09/2027. Choisir une plateforme agréée et vérifier l’inscription
à l’annuaire. Un PDF envoyé par Stripe ne démontre pas ce raccordement.
Ne souscrire aucune offre payante sans décision de l’exploitant.
[Calendrier DGFiP](https://www.impots.gouv.fr/professionnel/questions/partir-de-quand-suis-je-concerne-par-la-reforme-de-la-facturation),
[micro-entrepreneurs](https://www.impots.gouv.fr/professionnel/questions/franchise-en-base-micro-entrepreneur-ou-auto-entrepreneur-suis-je-concerne).

## Décisions commerciales distinctes des obligations légales

Main propose la grille standard 25 €/mois et 250 €/an (commit ac9801d).
L’ancienne grille pilote reste à 24,99 €/mois, 19,99 €/mois avec engagement
commercial de 12 mois, 210 €/an. Aucun prix modifié dans cette mission.
Les Prices TEST existants ne couvrent que cette ancienne grille. La mention
HT ne doit pas entraîner une collecte de TVA si la franchise est confirmée.

Le taux de pénalités, le préavis d’impayé, les modalités de sortie Retiko 12,
la clause de juridiction, les éventuelles limitations de responsabilité et
l’offre Fondateurs exigent une validation distincte. La franchise n’autorise
pas à inventer ces conditions. `STRIPE_AUTOMATIC_TAX_ENABLED` reste désactivé.

Pour les très petits professionnels, L.221-3 vise les contrats **hors
établissement** sous ses conditions ; une vente à distance seule ne suffit
pas. Faire valider le parcours commercial et les documents de rétractation.
[Code de la consommation](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032226882/2026-05-13).
