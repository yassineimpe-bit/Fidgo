import { LegalPage } from "@/components/legal-page";
import { LEGAL_VERSION } from "@/lib/legal";

export const metadata = { title: "Politique de confidentialité" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Politique de confidentialité" version={LEGAL_VERSION}>
      <h2>1. Qui traite les données ?</h2>
      <p>Pour les comptes professionnels Retiko, l’éditeur de Retiko agit comme responsable de traitement. Pour les données des clients finaux utilisées dans le programme de fidélité d’un commerce, le commerce concerné détermine la finalité du programme et agit en principe comme responsable de traitement ; Retiko fournit l’infrastructure en qualité de sous-traitant.</p>

      <h2>2. Données traitées</h2>
      <p>Compte professionnel : adresse email, mot de passe sous forme hachée, rôle, données du commerce, préférences nécessaires au service, informations de facturation lorsque celle-ci est activée, journaux de sécurité et d’audit.</p>
      <p>Programme de fidélité : email client, prénom et téléphone lorsqu’ils sont fournis, consentement marketing du client, identifiants techniques de carte, solde, récompenses et historique des opérations.</p>

      <h2>3. Finalités et bases juridiques</h2>
      <p>Les traitements nécessaires à la création du compte, à la fourniture du service et à la facturation reposent principalement sur l’exécution du contrat. La sécurité, la prévention des abus et certains journaux techniques peuvent reposer sur l’intérêt légitime. Les communications promotionnelles nécessitant un consentement reposent sur un choix distinct, libre et révocable.</p>

      <h2>4. Destinataires et sous-traitants</h2>
      <p>Les données sont accessibles uniquement aux personnes qui en ont besoin pour fournir le service et aux prestataires techniques effectivement utilisés, notamment l’hébergement applicatif, la base de données et l’envoi d’emails transactionnels. La liste opérationnelle des sous-traitants est tenue à jour dans la documentation de conformité.</p>

      <h2>5. Durées</h2>
      <p>Les données sont conservées pendant la durée nécessaire au service et aux obligations contractuelles, comptables, de sécurité ou de preuve applicables. Les données d’identification d’une carte peuvent être effacées sur demande ; les écritures nécessaires à l’intégrité du registre de fidélité peuvent être conservées sous forme limitée ou pseudonymisée lorsqu’un motif légitime le justifie.</p>

      <h2>6. Droits</h2>
      <p>Selon la situation, vous pouvez demander l’accès, la rectification, l’effacement, la limitation, la portabilité ou vous opposer à certains traitements. Pour une carte de fidélité, contactez d’abord le commerce concerné. Pour un compte professionnel Retiko : [EMAIL RGPD À COMPLÉTER]. Vous pouvez également introduire une réclamation auprès de la CNIL.</p>

      <h2>7. Sécurité</h2>
      <p>Retiko utilise notamment des mots de passe hachés, des sessions révocables, des contrôles d’accès par rôle, l’isolation des commerces, des limites anti-bruteforce, HTTPS en production, des journaux d’audit et des mécanismes de sauvegarde.</p>

      <h2>8. Transferts internationaux</h2>
      <p>Lorsque l’utilisation d’un prestataire implique un transfert hors de l’Espace économique européen, Retiko documente le mécanisme juridique approprié et les garanties applicables avant son activation en production.</p>

      <h2>9. Contact</h2>
      <p>Contact protection des données : [EMAIL RGPD À COMPLÉTER].</p>
    </LegalPage>
  );
}
