import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { BILLING_PLANS, BILLING_TRIAL_DAYS, offeredPlans } from "@/lib/billing";
import { LEGAL_ENTITY, LEGAL_LINKS, LEGAL_VERSION, legalValue } from "@/lib/legal";

export const metadata: Metadata = { title: "Conditions générales de vente | Retiko" };

export default function CgvPage() {
  const e = LEGAL_ENTITY;
  return <LegalPage title="Conditions générales de vente (CGV)" version={LEGAL_VERSION}>
    <p>Les présentes CGV encadrent la relation commerciale entre l’éditeur de Retiko et le professionnel qui
      souscrit au service. L’utilisation quotidienne de la plateforme est régie par les{" "}
      <Link href={LEGAL_LINKS.cgu}>conditions générales d’utilisation</Link>.</p>

    <h2>1. Prestataire</h2>
    <p>{legalValue(e.companyName)}, {legalValue(e.legalForm)}, capital {legalValue(e.shareCapital)},
      SIREN {legalValue(e.siren)}, {legalValue(e.registration)}, siège : {legalValue(e.headOffice)},
      TVA : {legalValue(e.vatNumber)}, contact : {legalValue(e.contactEmail)}.</p>

    <h2>2. Clients concernés</h2>
    <p>Retiko est proposé exclusivement à des professionnels (commerces, restaurants, points de vente) pour
      les besoins de leur activité.</p>
    <p><strong>À valider juridiquement avant commercialisation :</strong> un professionnel employant au plus
      cinq salariés, qui conclut à distance ou hors établissement un contrat n’entrant pas dans le champ de son
      activité principale, peut bénéficier de certaines règles du droit de la consommation (information
      précontractuelle, droit de rétractation, modalités de résiliation). L’application de ce régime aux
      clients de Retiko n’est pas encore tranchée ; lorsqu’il s’applique, les règles légales prévalent sur les
      présentes CGV.</p>

    <h2>3. Service fourni</h2>
    <p>Abonnement en ligne (SaaS) à un outil de fidélité : programme à tampons ou à points, inscription des
      clients par QR code, carte web, scanner commerçant, gestion d’équipe, historique et export des
      opérations, et, lorsqu’ils sont activés, cartes Apple Wallet et Google Wallet. Le service est fourni tel
      qu’il existe dans l’interface au jour de la souscription.</p>

    <h2>4. Offres et prix</h2>
    <div className="table-scroll"><table>
      <thead><tr><th>Offre</th><th>Prix</th><th>Engagement</th></tr></thead>
      <tbody>{offeredPlans().map((key) => BILLING_PLANS[key]).map((plan) => <tr key={plan.label}>
        <td>{plan.label}</td><td>{plan.priceLabel}</td><td>{plan.commitment}</td>
      </tr>)}</tbody>
    </table></div>
    <p>Les prix sont exprimés hors taxes ; les taxes applicables s’ajoutent selon la réglementation en vigueur
      (<strong>régime de TVA de l’éditeur à compléter</strong>). Une proposition commerciale écrite et acceptée
      prévaut sur cette grille pour le client concerné.</p>

    <h2>5. Période pilote</h2>
    <p>Chaque commerce inscrit bénéficie d’une période pilote gratuite d’environ {BILLING_TRIAL_DAYS} jours.
      Aucun moyen de paiement n’est demandé à l’inscription et aucune facturation n’intervient
      automatiquement à la fin de cette période : une offre payante n’est due qu’après avoir été choisie et
      validée par le client. À la date de ce document, le paiement en ligne n’est pas encore ouvert.</p>

    <h2>6. Commande et acceptation</h2>
    <p>La création du compte vaut acceptation des CGU et des présentes CGV dans leur version affichée. Retiko
      conserve pour chaque compte la version acceptée, la date et le contexte de l’acceptation. La souscription
      d’une offre payante résulte de sa validation par le client.</p>

    <h2>7. Facturation et paiement</h2>
    <p>Lorsque le paiement en ligne sera ouvert, il sera traité par le prestataire de paiement Stripe via une
      page de paiement hébergée par celui-ci ; Retiko ne stocke aucun numéro de carte. Les factures sont
      émises par voie électronique. Sauf mention contraire sur la facture, les sommes sont payables à la date
      d’échéance indiquée ; aucun escompte n’est accordé pour paiement anticipé.</p>

    <h2>8. Retard de paiement</h2>
    <p>Conformément au Code de commerce, tout retard de paiement entre professionnels donne lieu de plein droit
      à des pénalités de retard au taux de {legalValue(e.latePaymentRate)} — ce taux ne peut être inférieur à
      trois fois le taux d’intérêt légal et doit être vérifié à la date de publication — ainsi qu’à une
      indemnité forfaitaire de 40 € pour frais de recouvrement.</p>
    <p>Un impayé n’interrompt pas automatiquement le programme de fidélité ni l’accès des clients finaux à
      leurs cartes. Une éventuelle suspension ne pourrait intervenir qu’après une relance restée sans effet et
      un préavis raisonnable (<strong>délai à fixer et à valider juridiquement</strong>).</p>

    <h2>9. Durée et résiliation</h2>
    <p>Offre sans engagement : résiliable pour la fin de la période de facturation en cours. Offre avec
      engagement de 12 mois : l’engagement court à compter de la souscription de l’offre payante. Offre
      annuelle : la période payée reste acquise jusqu’à son terme. La résiliation se fait depuis l’espace de
      facturation lorsqu’il est disponible, ou par écrit à {legalValue(e.contactEmail)} ; elle ne peut être
      rendue plus difficile que la souscription.</p>
    <p><strong>À valider juridiquement :</strong> conditions de sortie anticipée de l’offre avec engagement et
      mécanisme de résiliation retenu dans le portail de paiement.</p>

    <h2>10. Fin de contrat et données</h2>
    <p>Le client peut exporter ses données avant la fin du contrat (export des opérations et, client par
      client, des données personnelles). À la clôture, les accès et cartes sont désactivés ; la durée de
      conservation des données après clôture est décrite dans la{" "}
      <Link href={LEGAL_LINKS.privacy}>politique de confidentialité</Link> et reste à arrêter.</p>

    <h2>11. Responsabilité</h2>
    <p>Chaque partie répond des dommages directs résultant de ses manquements prouvés. Le client reste
      responsable des règles de son programme de fidélité et des avantages qu’il promet à ses clients.
      <strong> Toute limitation ou plafonnement de responsabilité reste à rédiger et à valider juridiquement
      ; aucune exclusion générale de responsabilité n’est prévue.</strong></p>

    <h2>12. Modification des CGV</h2>
    <p>Une nouvelle version est communiquée au client avant son entrée en vigueur. Une modification des prix
      ne s’applique pas à une période déjà payée ni avant l’expiration d’un engagement en cours sans l’accord
      du client (<strong>préavis à fixer</strong>).</p>

    <h2>13. Droit applicable et litiges</h2>
    <p>Les présentes CGV sont soumises au droit français. Les parties recherchent d’abord une solution
      amiable. À défaut, le litige est porté devant {legalValue(e.jurisdiction)}.</p>
  </LegalPage>;
}
