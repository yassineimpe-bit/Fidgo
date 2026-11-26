import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { HOSTING_PROVIDER, LEGAL_ENTITY, LEGAL_LINKS, LEGAL_VERSION, legalValue } from "@/lib/legal";

export const metadata: Metadata = { title: "Mentions légales | Retiko" };

export default function LegalNoticePage() {
  const e = LEGAL_ENTITY;
  const rows: [string, string][] = [
    ["Éditeur", legalValue(e.companyName)],
    ["Nom commercial", legalValue(e.tradingName)],
    ["Forme juridique", legalValue(e.legalForm)],
    ["SIREN", legalValue(e.siren)],
    ["SIRET", legalValue(e.siret)],
    ["Code APE", legalValue(e.apeCode)],
    ["Immatriculation", legalValue(e.registration)],
    ["TVA", legalValue(e.vatNumber)],
    ["Adresse", legalValue(e.headOffice)],
    ["Directeur de la publication", legalValue(e.publicationDirector)],
    ["Téléphone", legalValue(e.phone)],
    ["E-mail", legalValue(e.contactEmail)],
  ];
  return <LegalPage title="Mentions légales" version={LEGAL_VERSION}>
    <h2>Éditeur du site retiko.fr</h2>
    <div className="table-scroll"><table><tbody>
      {rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}
    </tbody></table></div>

    <h2>Hébergement</h2>
    <p>{HOSTING_PROVIDER.name} — {legalValue(HOSTING_PROVIDER.address)}.</p>
    <p className="muted">{HOSTING_PROVIDER.region}.</p>

    <h2>Propriété intellectuelle</h2>
    <p>Les éléments propres à Retiko (marque, interface, textes, logiciel) sont protégés. Les marques, logos
      et contenus des commerces restent la propriété de leurs titulaires.</p>

    <h2>Données personnelles et cookies</h2>
    <p>Voir la <Link href={LEGAL_LINKS.privacy}>politique de confidentialité</Link> et la{" "}
      <Link href={LEGAL_LINKS.cookies}>page cookies et traceurs</Link>.</p>
  </LegalPage>;
}
