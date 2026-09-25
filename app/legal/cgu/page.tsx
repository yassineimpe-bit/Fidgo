import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { LEGAL_ENTITY, LEGAL_LINKS, LEGAL_VERSION, legalValue } from "@/lib/legal";

export const metadata: Metadata = { title: "Conditions générales d’utilisation | Retiko" };

export default function CguPage() {
  return <LegalPage title="Conditions générales d’utilisation (CGU)" version={LEGAL_VERSION}>
    <p>Les présentes CGU fixent les règles d’utilisation de la plateforme Retiko par les professionnels et les
      membres de leur équipe. Les conditions commerciales de l’abonnement figurent dans les{" "}
      <Link href={LEGAL_LINKS.cgv}>conditions générales de vente</Link>.</p>

    <h2>1. Le service</h2>
    <p>Retiko permet à un commerce de gérer un programme de fidélité : inscription des clients par QR code,
      carte de fidélité web, scanner pour créditer tampons ou points et remettre les récompenses, gestion de
      l’équipe, historique et exports.</p>

    <h2>2. Compte et vérification</h2>
    <p>Le compte est créé par le responsable du commerce (rôle « propriétaire »). L’adresse e-mail doit être
      vérifiée par un lien à usage unique avant la première connexion. Le propriétaire répond de l’exactitude
      des informations fournies et de la confidentialité de ses identifiants.</p>

    <h2>3. Équipe et rôles</h2>
    <p>Le propriétaire peut créer des accès pour son équipe avec un rôle adapté (gérant, employé au scanner,
      lecture seule). Il est responsable des accès qu’il crée et doit désactiver sans délai ceux qui ne sont
      plus nécessaires. Une désactivation met fin immédiatement aux sessions du compte concerné.</p>

    <h2>4. Utilisations interdites</h2>
    <p>Sont notamment interdits : la fraude ou la manipulation des soldes, la tentative d’accéder aux données
      d’un autre commerce, le contournement des mesures de sécurité ou des limites d’usage, la collecte de
      données sans rapport avec le programme de fidélité, l’usage du service à des fins illicites.</p>

    <h2>5. Clients finaux et programme de fidélité</h2>
    <p>Le commerce définit les règles de son programme et les récompenses qu’il promet ; il les présente
      loyalement à ses clients et les respecte. Pour les données de ses clients, le commerce est responsable
      de traitement et Retiko agit pour son compte (voir la{" "}
      <Link href={LEGAL_LINKS.privacy}>politique de confidentialité</Link>). Le commerce répond aux demandes
      de ses clients relatives à leurs données, avec l’assistance de Retiko.</p>

    <h2>6. Sécurité</h2>
    <p>L’utilisateur choisit un mot de passe robuste, ne le partage pas et signale sans délai toute suspicion
      de compromission à {legalValue(LEGAL_ENTITY.contactEmail)}.</p>

    <h2>7. Disponibilité</h2>
    <p>Retiko met en œuvre des moyens raisonnables pour assurer la disponibilité du service, sans garantir une
      disponibilité ininterrompue : maintenance, incidents ou défaillance d’un prestataire technique peuvent
      l’interrompre temporairement.</p>

    <h2>8. Suspension</h2>
    <p>Retiko peut suspendre un compte, de manière proportionnée et réversible, en cas de risque avéré pour la
      sécurité, de fraude ou d’utilisation manifestement illicite. Hors urgence de sécurité, le titulaire est
      informé du motif. Une suspension désactive les accès et les cartes sans supprimer les données.</p>

    <h2>9. Propriété intellectuelle</h2>
    <p>Retiko, son interface et sa documentation restent la propriété de leur éditeur. Le commerce conserve
      ses droits sur ses marques, logos, contenus et données.</p>

    <h2>10. Évolution des CGU</h2>
    <p>Les CGU peuvent évoluer avec le service ou la réglementation. Chaque version est datée ; une nouvelle
      acceptation est demandée lorsque la modification l’exige.</p>

    <h2>11. Droit applicable</h2>
    <p>Les présentes CGU sont soumises au droit français.</p>
  </LegalPage>;
}
