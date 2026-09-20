import { LegalPage } from "@/components/legal-page";
import { LEGAL_VERSION } from "@/lib/legal";

export const metadata = { title: "Cookies et traceurs" };

export default function CookiesPage() {
  return (
    <LegalPage title="Cookies et traceurs" version={LEGAL_VERSION}>
      <h2>1. Situation actuelle</h2>
      <p>Retiko utilise des mécanismes techniques nécessaires au fonctionnement du service, notamment pour l’authentification sécurisée, la session, la sécurité et certaines préférences attendues par l’utilisateur.</p>

      <h2>2. Pas de traceur publicitaire activé par défaut</h2>
      <p>À la date de cette version, Retiko n’active pas de cookie publicitaire, de reciblage ni de pixel marketing tiers dans le parcours standard. Une bannière de consentement n’est donc pas affichée uniquement pour donner l’illusion d’un choix lorsqu’aucun traceur soumis au consentement n’est utilisé.</p>

      <h2>3. Mesure d’audience et nouveaux outils</h2>
      <p>Avant d’ajouter un outil de mesure d’audience ou un autre traceur, Retiko vérifie s’il entre réellement dans une exemption prévue par la réglementation. Lorsqu’un consentement est requis, le traceur concerné doit rester bloqué avant le choix de l’utilisateur, le refus doit être aussi accessible que l’acceptation et le consentement doit pouvoir être retiré facilement.</p>

      <h2>4. Durée</h2>
      <p>Les traceurs nécessaires sont conservés uniquement pendant la durée compatible avec leur finalité technique ou de sécurité.</p>

      <h2>5. Évolution</h2>
      <p>Cette page est mise à jour lorsqu’un nouveau traceur ou fournisseur est activé en production.</p>
    </LegalPage>
  );
}
