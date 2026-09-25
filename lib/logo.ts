/**
 * Règles du logo partagées par le navigateur et le serveur (aucune dépendance
 * serveur : ce module est importé par le formulaire client).
 */

/** Taille maximale du fichier envoyé, vérifiée avant tout décodage. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** Côté minimal de l'image source et du cadrage, en pixels. */
export const LOGO_MIN_SIDE = 128;
/** Côté maximal de l'image source (protection contre les bombes de décompression). */
export const LOGO_MAX_SIDE = 6000;
/** Côté du logo stocké et servi. */
export const LOGO_OUTPUT_SIDE = 512;

const LOGO_PATH = /^\/api\/logos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function logoPath(id: string) {
  return `/api/logos/${id}`;
}

/** Identifiant d'un logo importé si `url` en désigne un, sinon null. */
export function uploadedLogoId(url: unknown): string | null {
  return typeof url === "string" ? LOGO_PATH.exec(url)?.[1] ?? null : null;
}
