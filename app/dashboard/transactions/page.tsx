import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canReverse } from "@/lib/loyalty";
import { AppNav } from "@/components/app-nav";
import { TransactionTable } from "@/components/transaction-table";

type Row={id:string;type:string;delta:number;balance_after:number;unit:string;created_at:string;short_code:string;first_name?:string|null;staff_email?:string|null;reversed:boolean};
export default async function TransactionsPage(){
  const s=await getSession();if(!s)redirect("/login");
  const [r]=await sql`select name from establishments where id=${s.establishmentId}`;
  const rows=await sql`select t.id,t.type,t.delta,t.balance_after,t.unit,t.created_at,c.short_code,u.first_name,st.email as staff_email,exists(select 1 from transactions x where x.reversed_transaction_id=t.id) as reversed from transactions t join cards c on c.id=t.card_id join customers u on u.id=c.customer_id left join staff_users st on st.id=t.staff_user_id where t.establishment_id=${s.establishmentId} order by t.created_at desc limit 100`;
  return <><AppNav restaurantName={r.name}/><main className="shell page"><div className="section-head"><div><h2>Transactions</h2><p className="muted">Ledger append-only. Une correction crée une écriture inverse, l’historique reste intact.</p></div></div><TransactionTable initial={rows as Row[]} canReverse={canReverse(s.role)}/></main></>;
}
