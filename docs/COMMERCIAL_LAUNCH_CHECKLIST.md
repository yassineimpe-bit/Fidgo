# Retiko — Checklist avant prospection

## Production

- [ ] `retiko.fr` opérationnel
- [ ] création de compte fonctionnelle
- [ ] connexion / déconnexion fonctionnelles
- [ ] `/api/health` vert
- [ ] Neon production relié
- [ ] récupération email fonctionnelle

## Produit

- [ ] programme fidélité configurable
- [ ] QR commerce fonctionnel
- [ ] inscription client fonctionnelle
- [ ] carte client fonctionnelle
- [ ] scanner fonctionnel
- [ ] code court fonctionnel
- [ ] crédit fonctionnel
- [ ] récompense fonctionnelle
- [ ] test iPhone réel
- [ ] test Android réel

## Commercial

- [ ] promesse commerciale claire
- [ ] démo en moins de 5 minutes
- [ ] Retiko Flex à 24,99 € HT/mois sans engagement prêt
- [ ] Retiko 12 à 19,99 € HT/mois avec engagement 12 mois prêt
- [ ] offre annuelle à 210 € HT/an prête
- [ ] pilote 30 jours gratuit prêt
- [ ] fiche / support commercial prêt
- [ ] 50 prospects qualifiés
- [ ] tableau de suivi prospects prêt

## Juridique / exploitation

Les pages `/legal/*` existent en version de travail (voir `LEGAL_STATUS.md`) ;
une case ne se coche qu'une fois l'identité renseignée et le texte validé.

- [ ] identité juridique renseignée dans `lib/legal.ts`
- [ ] politique de confidentialité
- [ ] mentions légales
- [ ] CGU
- [ ] CGV (dont régime des petits professionnels, pénalités, juridiction)
- [ ] politique cookies
- [ ] migration `022_legal_acceptance.sql` appliquée en production
- [ ] accord pilote
- [ ] annexe sous-traitance RGPD
- [ ] procédure incident

## Paiement

Stripe n'est pas bloquant pour le premier pilote gratuit, mais doit être prêt avant la première conversion payante.
