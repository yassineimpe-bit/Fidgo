import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { LEGAL_ENTITY, LEGAL_LINKS, LEGAL_VERSION, legalValue } from "@/lib/legal";

export const metadata: Metadata = { title: "Politique de confidentialité | Retiko" };

// Statuts de conservation, alignés sur docs/DATA_LIFECYCLE.md :
//  - « appliquée » : garantie par le code en production ;
//  - « prévue, non active » : durée écrite dans le code mais purge non exécutée ;
//  - « à décider » : aucune durée arrêtée.
const RETENTION: [string, string, string][] = [
  ["Session de l’espace commerçant", "12 heures", "Appliquée"],
  ["Liens de vérification e-mail / réinitialisation / récupération de carte", "Valides 24 h / 30 min / 15 min, usage unique", "Appliquée"],
  ["Liens expirés ou utilisés", "Suppression 30 jours après expiration ou usage", "Prévue, non active"],
  ["Compteurs anti-abus (empreintes d’IP ou d’e-mail)", "48 heures", "Prévue (tâche planifiée quotidienne), exécution non vérifiée"],
  ["Événements produit (mesures de performance)", "180 jours", "Prévue, non active"],
  ["Journal d’audit des actions sensibles", "730 jours", "Prévue, non active"],
  ["Sauvegardes chiffrées de la base", "14 jours", "Appliquée"],
  ["Compte commerçant et équipe", "Durée du contrat ; après clôture : à décider", "À décider"],
  ["Preuve d’acceptation des CGU/CGV", "À décider (durée du contrat et délais de prescription)", "À décider"],
  ["Client fidélité actif", "Jusqu’à l’effacement demandé au commerce", "Appliquée"],
  ["Client fidélité inactif", "Aucune durée définie à ce jour", "À décider"],
  ["Historique des opérations après effacement d’un client", "Conservé sans identité (intégrité du registre, anti-fraude)", "À décider"],
  ["Journaux techniques de l’hébergeur", "Selon la rétention du plan d’hébergement", "À documenter"],
];

export default function PrivacyPage() {
  const privacyContact = legalValue(LEGAL_ENTITY.privacyContact);
  return <LegalPage title="Politique de confidentialité" version={LEGAL_VERSION}>
    <h2>1. Deux situations différentes</h2>
    <p><strong>Commerçants et membres de leur équipe.</strong> L’éditeur de Retiko ({legalValue(LEGAL_ENTITY.companyName)})
      est responsable des traitements liés aux comptes, à la sécurité, à la facturation et au fonctionnement
      de la plateforme.</p>
    <p><strong>Clients d’un programme de fidélité.</strong> Le commerce qui propose la carte décide de son
      programme : il est responsable de traitement. Retiko héberge et traite ces données uniquement pour son
      compte, en qualité de sous-traitant. Pour toute question sur votre carte, adressez-vous d’abord au
      commerce concerné.</p>

    <h2>2. Données des commerçants et de leur équipe</h2>
    <div className="table-scroll"><table>
      <thead><tr><th>Données</th><th>Pourquoi</th><th>Base légale proposée</th></tr></thead>
      <tbody>
        <tr><td>E-mail, mot de passe (stocké uniquement sous forme d’empreinte), rôle, état du compte</td><td>Créer le compte, vérifier l’adresse, authentifier, gérer les accès de l’équipe</td><td>Exécution du contrat</td></tr>
        <tr><td>Nom, adresse, téléphone, réseaux, logo et couleurs du commerce</td><td>Afficher le programme aux clients</td><td>Exécution du contrat</td></tr>
        <tr><td>Version et date d’acceptation des CGU/CGV</td><td>Prouver l’accord contractuel</td><td>Exécution du contrat / intérêt légitime (preuve)</td></tr>
        <tr><td>Choix de recevoir les nouveautés Retiko</td><td>Envoyer ces informations, seulement si vous l’avez demandé</td><td>Consentement, retirable à tout moment</td></tr>
        <tr><td>Offre, statut d’abonnement, identifiants Stripe (lorsque le paiement sera ouvert)</td><td>Facturer l’abonnement</td><td>Exécution du contrat, obligations comptables</td></tr>
        <tr><td>Journal des actions sensibles, empreintes d’IP ou d’e-mail pour limiter les tentatives</td><td>Sécurité, prévention des abus, enquête en cas d’incident</td><td>Intérêt légitime</td></tr>
      </tbody>
    </table></div>
    <p className="muted">Les bases légales indiquées sont proposées et restent à valider juridiquement.</p>

    <h2>3. Données des clients d’un programme de fidélité</h2>
    <p>E-mail (nécessaire pour retrouver la carte), prénom et téléphone (facultatifs), choix de recevoir les
      offres du commerce (case non cochée par défaut), carte (identifiant, code court, solde, dates),
      historique des tampons, points et récompenses, éventuelle note interne rédigée par le commerce. Le QR
      code de la carte ne contient aucune donnée de contact. Aucune donnée sensible n’est demandée.</p>
    <p>Le commerce ne voit que ses propres clients : les données de chaque commerce sont isolées. Retiko
      n’envoie aucune campagne marketing aux clients finaux à ce jour.</p>

    <h2>4. Prestataires</h2>
    <div className="table-scroll"><table>
      <thead><tr><th>Prestataire</th><th>Rôle</th><th>Statut</th></tr></thead>
      <tbody>
        <tr><td>Vercel</td><td>Hébergement de l’application (région de calcul : Francfort)</td><td>Actif</td></tr>
        <tr><td>Neon</td><td>Base de données PostgreSQL</td><td>Actif</td></tr>
        <tr><td>GitHub (Actions)</td><td>Sauvegarde quotidienne : la base est copiée sur un serveur temporaire le temps de la chiffrer ; seules des copies chiffrées sont conservées</td><td>Actif</td></tr>
        <tr><td>Resend</td><td>E-mails de vérification d’adresse et de réinitialisation de mot de passe ; e-mails de récupération de carte lorsque cette fonction est activée</td><td>Actif</td></tr>
        <tr><td>Stripe</td><td>Paiement des abonnements</td><td>Non activé à ce jour</td></tr>
        <tr><td>Google</td><td>Carte dans Google Wallet (prénom, nom du commerce, solde, QR)</td><td>Si activé et si le client ajoute sa carte</td></tr>
        <tr><td>Apple</td><td>Mise à jour des cartes Apple Wallet</td><td>Si activé et si le client ajoute sa carte</td></tr>
      </tbody>
    </table></div>
    <p>Plusieurs de ces prestataires sont des sociétés établies hors de l’Union européenne. Les garanties
      encadrant d’éventuels transferts de données sont en cours de documentation et seront précisées ici ;
      elles ne sont pas présumées acquises.</p>

    <h2>5. Durées de conservation</h2>
    <div className="table-scroll"><table>
      <thead><tr><th>Données</th><th>Durée</th><th>Statut</th></tr></thead>
      <tbody>{RETENTION.map(([data, duration, status]) => <tr key={data}><td>{data}</td><td>{duration}</td><td>{status}</td></tr>)}</tbody>
    </table></div>
    <p className="muted">« Prévue, non active » : la durée est définie mais la suppression automatique
      n’est pas encore exécutée en production. Les points « à décider » font l’objet d’une décision en
      cours.</p>

    <h2>6. Sécurité</h2>
    <p>Mots de passe et liens à usage unique stockés sous forme d’empreinte, sessions révocables immédiatement,
      contrôle d’accès par rôle, isolation stricte des commerces, limitation des tentatives, HTTPS, journal
      des actions sensibles, sauvegardes chiffrées avec test de restauration.</p>

    <h2>7. Vos droits</h2>
    <p>Vous pouvez demander l’accès à vos données, leur rectification, leur effacement, la limitation de leur
      traitement, leur portabilité, ou vous opposer à certains traitements ; vous pouvez retirer à tout moment
      un consentement donné.</p>
    <p><strong>Client d’un programme de fidélité :</strong> adressez votre demande au commerce. Il dispose
      d’un export complet de votre dossier et d’un effacement qui supprime vos coordonnées et désactive votre
      carte (l’historique des opérations est conservé sans votre identité). La modification de vos
      coordonnées et le retrait de votre choix marketing se font aujourd’hui sur demande, traitée par Retiko
      pour le compte du commerce.</p>
    <p><strong>Commerçant ou membre d’une équipe :</strong> écrivez à {privacyContact}.</p>
    <p>Une réponse est apportée dans un délai d’un mois, prolongeable dans les cas prévus par la
      réglementation. Vous pouvez aussi introduire une réclamation auprès de la CNIL (cnil.fr).</p>

    <h2>8. Cookies</h2>
    <p>Voir la page <Link href={LEGAL_LINKS.cookies}>cookies et traceurs</Link> : aucun traceur publicitaire ou
      de mesure d’audience n’est utilisé.</p>
  </LegalPage>;
}
