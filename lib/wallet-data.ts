import { sql } from "@/lib/db";
import { parseCardToken, type LoyaltyMode } from "@/lib/loyalty";

export type WalletCard = {
  cardId: string;
  establishmentId: string;
  token: string;
  shortCode: string;
  balance: number;
  firstName: string | null;
  expiresAt: string | null;
  restaurantName: string;
  restaurantSlug: string;
  primaryColor: string;
  programName: string;
  mode: LoyaltyMode;
  rewardThreshold: number;
  rewardLabel: string;
  cardMessage: string | null;
};

function mapWalletCard(row: Record<string, unknown>): WalletCard {
  return {
    cardId: String(row.card_id),
    establishmentId: String(row.establishment_id),
    token: String(row.token),
    shortCode: String(row.short_code),
    balance: Number(row.balance),
    firstName: row.first_name ? String(row.first_name) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    restaurantName: String(row.restaurant_name),
    restaurantSlug: String(row.restaurant_slug),
    primaryColor: String(row.primary_color || "#111827"),
    programName: String(row.program_name),
    mode: String(row.mode) as LoyaltyMode,
    rewardThreshold: Number(row.reward_threshold),
    rewardLabel: String(row.reward_label),
    cardMessage: row.card_message ? String(row.card_message) : null,
  };
}

const SELECT_CARD = `
  select c.id as card_id,c.establishment_id,c.token,c.short_code,c.balance,c.expires_at,
    u.first_name,e.name as restaurant_name,e.slug as restaurant_slug,e.primary_color,
    p.program_name,p.mode,p.reward_threshold,p.reward_label,p.card_message
  from cards c
  join customers u on u.id=c.customer_id
  join establishments e on e.id=c.establishment_id
  join loyalty_programs p on p.establishment_id=c.establishment_id
`;

export async function walletCardByToken(input: string): Promise<WalletCard | null> {
  const token = parseCardToken(input);
  if (!token) return null;
  const rows = await sql.unsafe(`${SELECT_CARD} where c.token=$1 and c.active=true and u.deleted_at is null and e.status='active' and p.active=true limit 1`, [token]);
  if (!rows[0]) return null;
  const card = mapWalletCard(rows[0] as Record<string, unknown>);
  if (card.expiresAt && new Date(card.expiresAt) < new Date()) return null;
  return card;
}

export async function walletCardById(cardId: string): Promise<WalletCard | null> {
  const rows = await sql.unsafe(`${SELECT_CARD} where c.id=$1 and c.active=true and u.deleted_at is null and e.status='active' and p.active=true limit 1`, [cardId]);
  if (!rows[0]) return null;
  const card = mapWalletCard(rows[0] as Record<string, unknown>);
  if (card.expiresAt && new Date(card.expiresAt) < new Date()) return null;
  return card;
}
