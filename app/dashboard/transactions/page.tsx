import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canAccessBackoffice, canManageProgram, canReverse } from "@/lib/loyalty";
import { AppNav } from "@/components/app-nav";
import { TransactionTable } from "@/components/transaction-table";
import {
  parseTransactionHistoryFilters,
  TRANSACTION_PERIOD_OPTIONS,
  TRANSACTION_TYPE_OPTIONS,
} from "@/lib/transaction-history";

type Row = {
  id: string;
  type: string;
  delta: number;
  balance_after: number;
  unit: string;
  created_at: string;
  short_code: string;
  first_name?: string | null;
  staff_email?: string | null;
  reversed: boolean;
};

function exportHref(filters: ReturnType<typeof parseTransactionHistoryFilters>) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.type !== "ALL") params.set("type", filters.type);
  if (filters.period !== "ALL") params.set("period", filters.period);
  const query = params.toString();
  return query ? `/api/transactions/export?${query}` : "/api/transactions/export";
}

function pageHref(filters: ReturnType<typeof parseTransactionHistoryFilters>, page: number) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.type !== "ALL") params.set("type", filters.type);
  if (filters.period !== "ALL") params.set("period", filters.period);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/dashboard/transactions?${query}` : "/dashboard/transactions";
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; type?: string | string[]; period?: string | string[]; page?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canAccessBackoffice(session.role)) redirect("/s");
  const filters = parseTransactionHistoryFilters(await searchParams);
  const searchPattern = `%${filters.q.toLowerCase()}%`;

  const [restaurant] = await sql`select name from establishments where id=${session.establishmentId}`;
  const [countRow] = await sql`
    select count(*)::int as total
    from transactions t
    join cards c on c.id=t.card_id
    join customers u on u.id=c.customer_id
    left join staff_users st on st.id=t.staff_user_id
    where t.establishment_id=${session.establishmentId}
      and (${filters.q} = '' or lower(coalesce(u.first_name,'')) like ${searchPattern}
        or lower(coalesce(c.short_code,'')) like ${searchPattern}
        or lower(coalesce(st.email,'')) like ${searchPattern})
      and (${filters.type} = 'ALL' or t.type = ${filters.type})
      and (${filters.days} = 0 or t.created_at >= now() - (${filters.days}::int * interval '1 day'))
  `;
  const total = Number(countRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const page = Math.min(filters.page, totalPages);
  const offset = (page - 1) * filters.limit;

  const raw = await sql`
    select t.id,t.type,t.delta,t.balance_after,t.unit,t.created_at,c.short_code,u.first_name,
           st.email as staff_email,
           exists(select 1 from transactions x where x.reversed_transaction_id=t.id) as reversed
    from transactions t
    join cards c on c.id=t.card_id
    join customers u on u.id=c.customer_id
    left join staff_users st on st.id=t.staff_user_id
    where t.establishment_id=${session.establishmentId}
      and (${filters.q} = '' or lower(coalesce(u.first_name,'')) like ${searchPattern}
        or lower(coalesce(c.short_code,'')) like ${searchPattern}
        or lower(coalesce(st.email,'')) like ${searchPattern})
      and (${filters.type} = 'ALL' or t.type = ${filters.type})
      and (${filters.days} = 0 or t.created_at >= now() - (${filters.days}::int * interval '1 day'))
    order by t.created_at desc
    limit ${filters.limit}
    offset ${offset}
  `;
  const rows: Row[] = raw.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    delta: Number(row.delta),
    balance_after: Number(row.balance_after),
    unit: String(row.unit),
    created_at: String(row.created_at),
    short_code: String(row.short_code),
    first_name: row.first_name ? String(row.first_name) : null,
    staff_email: row.staff_email ? String(row.staff_email) : null,
    reversed: Boolean(row.reversed),
  }));

  return <><AppNav restaurantName={String(restaurant.name)}/><main className="shell page">
    <div className="section-head"><div><h2>Transactions</h2><p className="muted">Ledger append-only. Recherche, filtres et annulations par écriture inverse.</p></div>{canManageProgram(session.role) && <a className="btn" href={exportHref(filters)}>Exporter CSV</a>}</div>

    <section className="card" style={{marginBottom:18}}>
      <form method="get" className="grid grid-3" aria-label="Filtrer les transactions">
        <div>
          <label htmlFor="transaction-search">Client, code ou employé</label>
          <input className="input" id="transaction-search" name="q" defaultValue={filters.q} placeholder="Camille, ABC123 ou email"/>
        </div>
        <div>
          <label htmlFor="transaction-type">Type</label>
          <select className="input" id="transaction-type" name="type" defaultValue={filters.type}>
            {TRANSACTION_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="transaction-period">Période</label>
          <select className="input" id="transaction-period" name="period" defaultValue={filters.period}>
            {TRANSACTION_PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="actions" style={{margin:0}}>
          <button className="btn btn-primary" type="submit">Filtrer</button>
          <Link className="btn" href="/dashboard/transactions">Réinitialiser</Link>
        </div>
      </form>
      <p className="muted" style={{marginBottom:0}}>{total} transaction{total > 1 ? "s" : ""} trouvée{total > 1 ? "s" : ""} · page {page}/{totalPages}</p>
    </section>

    <TransactionTable
      key={`${filters.q}:${filters.type}:${filters.period}:${page}`}
      initial={rows}
      canReverse={canReverse(session.role)}
    />

    {totalPages > 1 && <nav className="actions" aria-label="Pagination des transactions" style={{justifyContent:"space-between"}}>
      <div>{page > 1 && <Link className="btn" href={pageHref(filters, page - 1)}>← Précédent</Link>}</div>
      <span className="muted">Page {page} sur {totalPages}</span>
      <div>{page < totalPages && <Link className="btn" href={pageHref(filters, page + 1)}>Suivant →</Link>}</div>
    </nav>}
  </main></>;
}
