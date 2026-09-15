import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL est requis.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const slug = process.env.DEMO_SLUG || "fidgo-demo";
const restaurantName = process.env.DEMO_RESTAURANT_NAME || "Fidgo Demo";
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const demoEmail = "demo-card@fidgo.local";
const ownerEmail = process.env.DEMO_OWNER_EMAIL?.trim().toLowerCase() || null;
const ownerPassword = process.env.DEMO_OWNER_PASSWORD || null;
const makeToken = () => randomBytes(16).toString("base64url");
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeShortCode = () => Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");

try {
  const [establishment] = await sql`
    insert into establishments(slug,name,primary_color,status)
    values(${slug},${restaurantName},'#111827','active')
    on conflict(slug) do update set name=excluded.name,status='active',updated_at=now()
    returning id,slug,name
  `;

  await sql`
    insert into loyalty_programs(establishment_id,program_name,mode,reward_threshold,reward_label,stamps_per_visit,cooldown_seconds,card_message,active)
    values(${establishment.id},'Programme démo','STAMPS',8,'1 produit offert',1,5,'Carte de démonstration Fidgo',true)
    on conflict(establishment_id) do update set
      program_name=excluded.program_name,
      mode=excluded.mode,
      reward_threshold=excluded.reward_threshold,
      reward_label=excluded.reward_label,
      stamps_per_visit=excluded.stamps_per_visit,
      cooldown_seconds=excluded.cooldown_seconds,
      card_message=excluded.card_message,
      active=true,
      updated_at=now()
  `;

  if (ownerEmail && ownerPassword) {
    if (ownerPassword.length < 12) throw new Error("DEMO_OWNER_PASSWORD doit contenir au moins 12 caractères.");
    const passwordHash = await bcrypt.hash(ownerPassword, 12);
    await sql`
      insert into staff_users(establishment_id,email,password_hash,role,active)
      values(${establishment.id},${ownerEmail},${passwordHash},'OWNER',true)
      on conflict(lower(email)) do update set
        establishment_id=excluded.establishment_id,
        password_hash=excluded.password_hash,
        role='OWNER',
        active=true,
        updated_at=now()
    `;
  }

  let [customer] = await sql`
    select id from customers
    where establishment_id=${establishment.id} and lower(email)=lower(${demoEmail}) and deleted_at is null
    limit 1
  `;

  if (!customer) {
    [customer] = await sql`
      insert into customers(establishment_id,email,first_name,marketing_consent)
      values(${establishment.id},${demoEmail},'Client démo',false)
      returning id
    `;
  }

  let [card] = await sql`
    select token,short_code,balance from cards
    where customer_id=${customer.id} and active=true
    limit 1
  `;

  if (!card) {
    for (let attempt = 0; attempt < 5 && !card; attempt += 1) {
      try {
        [card] = await sql`
          insert into cards(establishment_id,customer_id,token,short_code,balance,active)
          values(${establishment.id},${customer.id},${makeToken()},${makeShortCode()},3,true)
          returning token,short_code,balance
        `;
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "23505")) throw error;
      }
    }
  }

  if (!card) throw new Error("Impossible de créer la carte de démo.");

  console.log("Démo Fidgo prête.");
  console.log(`Inscription : ${appUrl}/j/${establishment.slug}`);
  console.log(`Carte : ${appUrl}/c/${card.token}`);
  console.log(`Code court : ${card.short_code}`);
  if (ownerEmail && ownerPassword) console.log(`Owner : ${ownerEmail}`);
  else console.log("Owner non créé : définir DEMO_OWNER_EMAIL et DEMO_OWNER_PASSWORD pour activer le login de démo.");
} finally {
  await sql.end({ timeout: 5 });
}
