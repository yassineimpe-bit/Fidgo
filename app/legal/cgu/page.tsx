import { LegalPage } from "@/components/legal-page";
import { CGU_VERSION } from "@/lib/legal";

export const metadata = { title: "Conditions générales d’utilisation" };

export default function CguPage() {
  return (
    <LegalPage title="Conditions générales d’utilisation (CGU)" version={CGU_VERSION}>
      <p><strong>Document destiné aux utilisateurs professionnels de Retiko.</strong> L’identité juridique définitive de l’éditeur sera complétée avant l’ouverture commerciale.</p>

      <h2>1. Objet</h2>
      <p>Retiko est un service SaaS de fidélité digitale permettant notamment à un commerce de créer et administrer un programme de fidélité, d’inscrire des clients, de créditer ou débiter des points ou tampons, et de mettre à disposition une carte digitale.</p>

      <h2>2. Accès au service</h2>
      <p>L’accès au back-office est réservé aux professionnels et aux membres de leur équipe autorisés. Le titulaire du compte OWNER est responsable des accès qu’il crée, des rôles attribués et de la confidentialité de ses identifiants.</p>

      <h2>3. Utilisation autorisée</h2>
      <p>Le service doit être utilisé conformément aux lois applicables, aux présentes CGU et aux droits des clients finaux. Sont notamment interdits : la fraude, la manipulation abusive de soldes, l’accès aux données d’un autre commerce, la collecte de données non nécessaires, le contournement des contrôles de sécurité et l’utilisation du service pour des campagnes illicites.</p>

      <h2>4. Responsabilité du commerce</h2>
      <p>Le commerce définit les règles de son programme de fidélité, les avantages accordés, les conditions d’obtention et d’utilisation des récompenses ainsi que les communications adressées à ses clients. Il doit présenter ces règles de manière loyale et respecter ses propres engagements envers ses clients.</p>

      <h2>5. Données personnelles</h2>
      <p>Pour les données de compte professionnel, Retiko agit en principe comme responsable de traitement. Pour les données des clients finaux traitées dans le cadre du programme de fidélité du commerce, le commerce agit en principe comme responsable de traitement et Retiko comme sous-traitant technique, selon l’annexe de sous-traitance applicable.</p>

      <h2>6. Sécurité</h2>
      <p>Retiko met en œuvre des mesures techniques et organisationnelles adaptées au service. L’utilisateur doit signaler sans délai toute suspicion de compromission, révoquer les accès inutiles et maintenir des mots de passe robustes.</p>

      <h2>7. Disponibilité et maintenance</h2>
      <p>Retiko vise une disponibilité compatible avec un usage professionnel, sans garantir une disponibilité absolument ininterrompue. Des opérations de maintenance, incidents d’infrastructure ou événements extérieurs peuvent entraîner une interruption temporaire.</p>

      <h2>8. Suspension</h2>
      <p>Un compte peut être temporairement suspendu en cas de risque de sécurité, fraude présumée, impayé, usage manifestement illicite ou violation grave des présentes conditions, dans la mesure nécessaire à la protection du service et des autres utilisateurs.</p>

      <h2>9. Propriété intellectuelle</h2>
      <p>Retiko, son interface, ses éléments graphiques, sa documentation et son code restent protégés par les droits de propriété intellectuelle applicables. Le client conserve les droits sur ses propres marques, logos, contenus et données.</p>

      <h2>10. Évolution des CGU</h2>
      <p>Les CGU peuvent évoluer pour tenir compte du produit, de la réglementation ou de contraintes de sécurité. Lorsqu’une nouvelle acceptation est nécessaire, elle est présentée au titulaire du compte avec identification de la version concernée.</p>

      <h2>11. Droit applicable</h2>
      <p>Les présentes CGU sont soumises au droit français. Les règles de compétence juridictionnelle applicables entre professionnels sont précisées dans les CGV et le contrat conclu avec le client.</p>

      <p className="muted">Ce texte est un projet contractuel à faire relire par un professionnel du droit avant la première facturation.</p>
    </LegalPage>
  );
}
