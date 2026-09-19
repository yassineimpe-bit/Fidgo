import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { CustomerTable } from "@/components/customer-table";
import { getSession } from "@/lib/auth";
import { phoneLookupVariants } from "@/lib/customer-lookup";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";

type Customer = {
  id: string;
  first_name?: string | null;
  email?: string | null;
  phone?: string | null;
  marketing_consent: boolean;
  created_at: string;
  short_code?: string | null;
  balance?: number | null;
  active?: boolean | null;
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { q = "" } = await searchParams;
  const term = q.trim().slice(0, 120);
  const pattern = `%${term.toLowerCase()}%`;
  const [phone1, phone2, phone3] = phoneLookupVariants(term);

  const [restaurant] = await sql`
    select name from establishments where id=${session.establishmentId}
  `;

  const rows = term
    ? await sql`
        select
          u.id,u.first_name,u.email,u.phone,u.marketing_consent,u.created_at,
          c.short_code,c.balance,c.active
        from customers u
        left join cards c on c.customer_id=u.id
        where u.establishment_id=${session.establishmentId}
          and u.deleted_at is null
          and (
            lower(coalesce(u.first_name,'')) like ${pattern}
            or lower(coalesce(u.email,'')) like ${pattern}
            or lower(coalesce(u.phone,'')) like ${pattern}
            or lower(coalesce(c.short_code,'')) like ${pattern}
            or (
              ${phone1}::text is not null
              and regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g')
                in (${phone1}, ${phone2}, ${phone3})
            )
          )
        order by u.created_at desc
        limit 100
      `
    : await sql`
        select
          u.id,u.first_name,u.email,u.phone,u.marketing_consent,u.created_at,
          c.short_code,c.balance,c.active
        from customers u
        left join cards c on c.customer_id=u.id
        where u.establishment_id=${session.establishmentId}
          and u.deleted_at is null
        order by u.created_at desc
        limit 100
      `;

  const customers: Customer[] = rows.map((row) => ({
    id: String(row.id),
    first_name: row.first_name ? String(row.first_name) : null,
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    marketing_consent: Boolean(row.marketing_consent),
    created_at: String(row.created_at),
    short_code: row.short_code ? String(row.short_code) : null,
    balance: row.balance == null ? null : Number(row.balance),
    active: row.active == null ? null : Boolean(row.active),
  }));

  return <>
    <AppNav restaurantName={String(restaurant.name)}/>
    <main className="shell page">
      <div className="section-head">
        <div>
          <h2>Clients</h2>
          <p className="muted">Recherche, export RGPD et effacement des données personnelles.</p>
        </div>
        <form>
          <label
            htmlFor="client-search"
            style={{position:"absolute",width:1,height:1,overflow:"hidden",clip:"rect(0,0,0,0)"}}
          >
            Rechercher un client
          </label>
          <input
            className="input"
            id="client-search"
            name="q"
            defaultValue={term}
            placeholder="Nom, email, téléphone ou code"
          />
        </form>
      </div>
      <CustomerTable
        initial={customers}
        canManage={canManageProgram(session.role)}
        searchActive={Boolean(term)}
      />
    </main>
  </>;
}
