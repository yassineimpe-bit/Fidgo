import { getSession } from "@/lib/auth";
import { customerExportCsv } from "@/lib/customer-export";
import { parseCustomerListFilters } from "@/lib/customer-list";
import { phoneLookupVariants } from "@/lib/customer-lookup";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS } from "@/lib/security";

async function handleGet(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: PRIVATE_HEADERS });
  const limited = await enforceRateLimit(req, `customers-csv-export:${session.staffId}`, 10, 60 * 60);
  if (limited) return limited;

  const url = new URL(req.url);
  const { q } = parseCustomerListFilters({ q: url.searchParams.get("q") || undefined });
  const pattern = `%${q.toLowerCase()}%`;
  const [phone1, phone2, phone3] = phoneLookupVariants(q);
  const rows = await sql`
    select u.first_name,u.email,u.phone,u.marketing_consent,u.created_at,
      c.short_code,c.balance
    from customers u
    left join cards c on c.customer_id=u.id and c.establishment_id=u.establishment_id
    where u.establishment_id=${session.establishmentId}
      and u.deleted_at is null
      and (
        ${q} = ''
        or lower(coalesce(u.first_name,'')) like ${pattern}
        or lower(coalesce(u.email,'')) like ${pattern}
        or lower(coalesce(u.phone,'')) like ${pattern}
        or lower(coalesce(c.short_code,'')) like ${pattern}
        or (
          ${phone1}::text is not null
          and regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g')
            in (${phone1}, ${phone2}, ${phone3})
        )
      )
    order by u.created_at desc,u.id desc
    limit 10001
  `;
  if (rows.length > 10_000) {
    return Response.json({ error: "EXPORT_LIMIT_EXCEEDED" }, { status: 413, headers: PRIVATE_HEADERS });
  }

  await sql`
    insert into audit_logs(establishment_id,staff_user_id,action,entity_type,metadata)
    values(${session.establishmentId},${session.staffId},'CUSTOMERS_CSV_EXPORT','customer',
      ${sql.json({ rows: rows.length, filtered: Boolean(q) })})
  `;
  const csv = customerExportCsv(rows.map((row) => ({
    first_name: row.first_name ? String(row.first_name) : null,
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    marketing_consent: Boolean(row.marketing_consent),
    short_code: row.short_code ? String(row.short_code) : null,
    balance: row.balance == null ? null : Number(row.balance),
    created_at: String(row.created_at),
  })));
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      ...PRIVATE_HEADERS,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="retiko-clients-${date}.csv"`,
      "x-content-type-options": "nosniff",
    },
  });
}

export const GET = withApiErrorHandling("CUSTOMERS_CSV_EXPORT", handleGet);
