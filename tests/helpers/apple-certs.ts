import { execFileSync, type StdioOptions } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TestAppleCertChain = {
  wwdr: string;
  signerCert: string;
  signerKey: string;
  cleanup: () => void;
};

/**
 * Genere localement une chaine (CA auto-signee + certificat signe par cette
 * CA) structurellement equivalente au WWDR Apple + certificat Pass Type ID,
 * encodee en base64 comme attendu par les variables d'environnement
 * APPLE_WWDR_CERT_BASE64 / APPLE_SIGNER_CERT_BASE64 / APPLE_SIGNER_KEY_BASE64.
 * Sert a valider la mecanique de signature PKCS#7 sans les vrais certificats
 * Apple, dont seule la confiance de la chaine (Apple -> appareil) depend.
 */
export function generateTestAppleCertChain(): TestAppleCertChain {
  const dir = mkdtempSync(join(tmpdir(), "apple-wallet-test-"));
  const caKey = join(dir, "ca.key");
  const caCert = join(dir, "ca.pem");
  const leafKey = join(dir, "leaf.key");
  const leafCsr = join(dir, "leaf.csr");
  const leafCert = join(dir, "leaf.pem");

  const quiet = { stdio: ["ignore", "ignore", "ignore"] as StdioOptions };
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", caCert, "-days", "1", "-subj", "/CN=Retiko Test WWDR"], quiet);
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", leafKey, "-out", leafCsr, "-subj", "/CN=Retiko Test Pass Signer"], quiet);
  execFileSync("openssl", ["x509", "-req", "-in", leafCsr, "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-out", leafCert, "-days", "1"], quiet);

  return {
    wwdr: readFileSync(caCert).toString("base64"),
    signerCert: readFileSync(leafCert).toString("base64"),
    signerKey: readFileSync(leafKey).toString("base64"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
