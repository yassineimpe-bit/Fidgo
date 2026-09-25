import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { LEGAL_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "Cookies et traceurs | Retiko" };

// Inventaire tenu à jour à partir du code : tout nouveau cookie, stockage local
// ou script tiers doit être ajouté ici avant sa mise en production.
const TRACKERS: [string, string, string, string][] = [
  ["Cookie « loyalty_staff »", "Session de l’espace commerçant (authentification)", "12 heures, supprimé à la déconnexion", "Strictement nécessaire"],
  ["Stockage local « loyalty:<commerce> »", "Retrouver sa carte de fidélité sur son propre téléphone", "Jusqu’à suppression par l’utilisateur ou le navigateur", "Strictement nécessaire à la carte demandée"],
  ["Stockage local « retiko:pwa-install-dismissed »", "Ne plus afficher la suggestion d’installer l’application", "Jusqu’à suppression par l’utilisateur", "Préférence demandée par l’utilisateur"],
  ["Stockage local « loyalty_scan_metrics »", "Mesures de rapidité du scanner, sur l’appareil du commerce uniquement (50 dernières)", "Jusqu’à effacement depuis l’écran de statistiques", "Fonctionnement du scanner, jamais transmis"],
  ["Cache du service worker « retiko-shell-* »", "Afficher l’application hors connexion", "Remplacé à chaque nouvelle version", "Strictement nécessaire à l’application installée"],
];

export default function CookiesPage() {
  return <LegalPage title="Cookies et traceurs" version={LEGAL_VERSION}>
    <p>Retiko n’utilise à ce jour <strong>aucun cookie publicitaire, aucun outil de mesure d’audience et
      aucun script de suivi tiers</strong>. Les seuls traceurs déposés sont nécessaires au fonctionnement du
      service ou correspondent à une préférence exprimée par l’utilisateur ; ils ne nécessitent pas de
      consentement préalable, c’est pourquoi aucune bannière n’est affichée.</p>

    <h2>Inventaire</h2>
    <div className="table-scroll"><table>
      <thead><tr><th>Traceur</th><th>Finalité</th><th>Durée</th><th>Nature</th></tr></thead>
      <tbody>{TRACKERS.map(([name, purpose, duration, kind]) => <tr key={name}>
        <td>{name}</td><td>{purpose}</td><td>{duration}</td><td>{kind}</td>
      </tr>)}</tbody>
    </table></div>

    <h2>Remontée d’erreurs</h2>
    <p>En cas d’erreur d’affichage, le navigateur envoie à Retiko (et à personne d’autre) le type d’erreur,
      un message tronqué et l’adresse de la page, débarrassée des identifiants sensibles. Aucun cookie n’est
      utilisé pour cela.</p>

    <h2>Évolution</h2>
    <p>Avant l’ajout de tout outil de mesure d’audience ou traceur non nécessaire, cette page sera mise à jour
      et, si la réglementation l’exige, un choix préalable (accepter ou refuser aussi simplement) sera
      proposé, le traceur restant bloqué tant que l’utilisateur n’a pas consenti.</p>

    <h2>Supprimer ces données</h2>
    <p>Les paramètres du navigateur permettent d’effacer cookies et données de site à tout moment. Effacer
      le stockage local d’une carte ne supprime pas la carte : elle reste retrouvable par e-mail lorsque la
      récupération est activée.</p>
  </LegalPage>;
}
