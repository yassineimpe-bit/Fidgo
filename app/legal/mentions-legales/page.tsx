import { LegalPage } from "@/components/legal-page";
import { LEGAL_VERSION } from "@/lib/legal";

export const metadata = { title: "Mentions légales" };

export default function LegalNoticePage() {
  return (
    <LegalPage title="Mentions légales" version={LEGAL_VERSION}>
      <p><strong>À compléter avant ouverture commerciale.</strong> Retiko n’est pas encore facturé tant que l’identité juridique définitive n’a pas été renseignée.</p>

      <h2>Éditeur</h2>
      <p>Nom / raison sociale : [À COMPLÉTER]</p>
      <p>Forme juridique : [À COMPLÉTER]</p>
      <p>Siège social : [À COMPLÉTER]</p>
      <p>SIREN / RNE / RCS selon le statut : [À COMPLÉTER]</p>
      <p>Capital social, si applicable : [À COMPLÉTER]</p>
      <p>TVA intracommunautaire, si applicable : [À COMPLÉTER]</p>
      <p>Email et téléphone : [À COMPLÉTER]</p>
      <p>Directeur de la publication : [À COMPLÉTER]</p>

      <h2>Hébergement applicatif</h2>
      <p>Vercel Inc. — les coordonnées légales complètes du prestataire doivent être reprises ici dans la version finale publiée.</p>

      <h2>Base de données</h2>
      <p>Neon — fournisseur PostgreSQL. La région réellement utilisée et les garanties de transfert doivent être documentées avant lancement.</p>

      <h2>Propriété intellectuelle</h2>
      <p>Sauf mention contraire, les marques, éléments graphiques, textes, logiciels et contenus propres à Retiko sont protégés par les règles de propriété intellectuelle applicables. Les marques et contenus fournis par les commerces restent la propriété de leurs titulaires.</p>

      <h2>Données personnelles</h2>
      <p>Les informations relatives aux traitements de données sont disponibles dans la Politique de confidentialité.</p>
    </LegalPage>
  );
}
