/** Chemin public d'un visuel de carte (sans dépendance serveur : importé par le formulaire). */
const CARD_IMAGE_PATH = /^\/api\/card-images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function cardImagePath(id: string) {
  return `/api/card-images/${id}`;
}

export function cardImageId(value: unknown): string | null {
  return typeof value === "string" ? CARD_IMAGE_PATH.exec(value)?.[1] ?? null : null;
}
