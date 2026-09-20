import { LegalPage } from "@/components/legal-page";
import { CGV_VERSION } from "@/lib/legal";

export const metadata = { title: "Conditions générales de vente" };

export default function CgvPage() {
  return (
    <LegalPage title="Conditions générales de vente (CGV) — professionnels" version={CGV_VERSION}>
      <p><strong>Retiko est commercialisé à des clients professionnels.</strong> Les informations d’identification de l’entreprise éditrice seront complétées avant la première facturation.</p>

      <h2>1. Prestataire</h2>
      <p>Prestataire : [RAISON SOCIALE], [FORME JURIDIQUE], [CAPITAL LE CAS ÉCHÉANT], siège [ADRESSE], SIREN [À COMPLÉTER], TVA intracommunautaire [À COMPLÉTER], contact [EMAIL].</p>

      <h2>2. Service</h2>
      <p>Retiko fournit un abonnement SaaS de fidélité digitale. Les fonctionnalités comprises sont celles décrites dans l’offre souscrite et dans l’interface au jour de la commande. Les services tiers optionnels peuvent dépendre de leurs propres disponibilités.</p>

      <h2>3. Offres de référence</h2>
      <p>À la date de cette version : Retiko Flex à 24,99 € HT/mois sans engagement, Retiko 12 à 19,99 € HT/mois avec engagement initial de 12 mois, et offre annuelle à 210 € HT/an. Toute proposition commerciale ou page de commande plus récente prévaut sur cette grille.</p>

      <h2>4. Essai pilote</h2>
      <p>Une période pilote gratuite de 30 jours peut être proposée. Sauf indication explicite lors de la souscription, elle n’entraîne pas de facturation automatique avant qu’une offre payante ne soit effectivement choisie ou activée.</p>

      <h2>5. Commande et acceptation</h2>
      <p>La souscription résulte de la validation de l’offre et de l’acceptation des CGV en vigueur. Retiko conserve la version acceptée et la date d’acceptation associées au compte professionnel.</p>

      <h2>6. Prix, taxes et facturation</h2>
      <p>Les prix sont exprimés hors taxes. Les taxes applicables sont ajoutées selon la réglementation en vigueur. Les factures sont mises à disposition ou adressées par voie électronique.</p>

      <h2>7. Paiement</h2>
      <p>Sauf condition particulière indiquée sur la commande ou la facture, les sommes dues sont payables à la date indiquée sur la facture. Aucun escompte n’est accordé pour paiement anticipé, sauf accord écrit contraire.</p>

      <h2>8. Retard de paiement</h2>
      <p>Tout retard de paiement entraîne, de plein droit et sans rappel préalable lorsque la loi le permet, l’application de pénalités calculées au taux de refinancement de la Banque centrale européenne applicable au semestre concerné majoré de 10 points, ainsi que l’indemnité forfaitaire légale de 40 € pour frais de recouvrement. Une indemnisation complémentaire peut être demandée sur justificatifs lorsque les frais exposés dépassent ce montant.</p>

      <h2>9. Durée et résiliation</h2>
      <p>L’offre Flex peut être résiliée pour la prochaine période de facturation selon les modalités affichées dans le compte. L’offre Retiko 12 comporte un engagement initial de 12 mois. L’offre annuelle couvre la période annuelle payée. Les conditions particulières de la commande prévalent en cas de différence.</p>

      <h2>10. Droit de rétractation des professionnels</h2>
      <p>Les règles de rétractation réservées aux consommateurs ne s’appliquent pas en principe aux contrats conclus pour les besoins professionnels. Lorsqu’un texte accorde exceptionnellement un droit de rétractation à un professionnel dans une situation déterminée, ce droit demeure applicable dans les conditions prévues par ce texte.</p>

      <h2>11. Données et fin de contrat</h2>
      <p>La restitution, l’export, la suppression ou la pseudonymisation des données suivent le contrat, l’annexe RGPD et la politique de cycle de vie applicable. Les sauvegardes résiduelles suivent leur cycle technique normal de rétention.</p>

      <h2>12. Responsabilité</h2>
      <p>Chaque partie répond des dommages directs causés par ses manquements prouvés. Retiko ne répond pas des décisions commerciales du client, des récompenses promises par celui-ci, d’un usage frauduleux imputable au client ou d’une indisponibilité d’un service tiers hors de son contrôle raisonnable. Toute limitation de responsabilité devra être validée juridiquement avant mise en production contractuelle.</p>

      <h2>13. Force majeure</h2>
      <p>Aucune partie n’est responsable d’un manquement causé par un événement de force majeure au sens du droit français, pendant la durée où cet événement empêche raisonnablement l’exécution de l’obligation concernée.</p>

      <h2>14. Droit applicable et litiges</h2>
      <p>Le contrat est soumis au droit français. Les parties chercheront d’abord une solution amiable. La clause attributive de juridiction définitive sera complétée après détermination du siège social de Retiko et validation juridique.</p>

      <p className="muted">Projet B2B à faire relire avant la première facture. Les mentions financières obligatoires ont été intégrées, mais l’identité du prestataire et la clause de juridiction restent à finaliser.</p>
    </LegalPage>
  );
}
