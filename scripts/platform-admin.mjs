// Attribution des droits super-admin Retiko. Volontairement hors application :
// il faut un accès direct à la base (DATABASE_URL) pour promouvoir un compte.
//
//   npm run admin:platform -- list
//   npm run admin:platform -- grant <email> "<motif>"
//   npm run admin:platform -- revoke <email> "<motif>"
import postgres from "postgres";

const [, , command, rawEmail, ...noteParts] = process.argv;
const usage = "Usage: npm run admin:platform -- list | grant <email> \"<motif>\" | revoke <email> \"<motif>\"";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL est requis.");
  process.exit(1);
}
if (!["list", "grant", "revoke"].includes(command)) {
  console.error(usage);
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  if (command === "list") {
    const rows = await sql`
      select s.email, s.role, s.active, e.name as establishment, pa.created_at, pa.note
      from platform_admins pa
      join staff_users s on s.id = pa.staff_user_id
      join establishments e on e.id = s.establishment_id
      order by pa.created_at
    `;
    if (!rows.length) console.log("Aucun super-admin.");
    for (const row of rows) {
      console.log(`${row.email} · ${row.establishment} · ${row.role}${row.active ? "" : " (inactif)"} · depuis ${row.created_at.toISOString()}${row.note ? ` · ${row.note}` : ""}`);
    }
  } else {
    const email = String(rawEmail || "").trim().toLowerCase();
    const note = noteParts.join(" ").trim();
    if (!email || note.length < 5 || note.length > 200) {
      console.error(`${usage}\nLe motif (5 à 200 caractères) est obligatoire.`);
      process.exit(2);
    }
    const [staff] = await sql`select id, email, active from staff_users where lower(email) = ${email} limit 1`;
    if (!staff) {
      console.error("Aucun compte staff avec cet email. Le compte doit exister avant d'être promu.");
      process.exit(1);
    }
    await sql.begin(async (tx) => {
      if (command === "grant") {
        if (!staff.active) throw new Error("Compte inactif : réactive-le avant de le promouvoir.");
        await tx`
          insert into platform_admins(staff_user_id, note) values(${staff.id}, ${note})
          on conflict (staff_user_id) do update set note = excluded.note
        `;
      } else {
        await tx`delete from platform_admins where staff_user_id = ${staff.id}`;
      }
      await tx`
        insert into platform_admin_audit(admin_staff_user_id, admin_email, action, target_type, target_id, reason, metadata)
        values(null, 'cli', ${command === "grant" ? "PLATFORM_ADMIN_GRANT" : "PLATFORM_ADMIN_REVOKE"},
          'staff_user', ${String(staff.id)}, ${note}, ${tx.json({ email: String(staff.email) })})
      `;
    });
    console.log(command === "grant" ? `Super-admin accordé à ${staff.email}.` : `Super-admin retiré à ${staff.email}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Erreur inattendue");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
