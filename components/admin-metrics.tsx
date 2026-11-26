import Link from "next/link";
import { WATCH_REASON_LABELS, describeWatchReason, watchReasons, type UsageRow } from "@/lib/platform-metrics";

/** Indicateur agrégé : valeur, libellé, précision facultative (période, définition, dénominateur). */
export function AdminMetric({ value, label, hint }: { value: string | number; label: string; hint?: string }) {
  return <div className="card metric admin-metric">
    <strong>{value}</strong>
    <span>{label}</span>
    {hint ? <div className="muted admin-metric-hint">{hint}</div> : null}
  </div>;
}

/** Barre horizontale proportionnelle, purement décorative (la valeur est affichée à côté). */
export function AdminBar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.round((Math.max(0, value) / max) * 100) : 0;
  return <div aria-hidden="true" className="admin-bar"><div style={{ width: `${width}%` }}/></div>;
}

/** Liste « À surveiller » : une ligne par commerce, chaque règle déclenchée expliquée. */
export function AdminWatchList({ rows, now, emptyText }: { rows: readonly UsageRow[]; now: Date; emptyText: string }) {
  if (rows.length === 0) return <div className="empty-state"><strong>Rien à signaler.</strong><p>{emptyText}</p></div>;
  return <ul className="admin-watch-list">
    {rows.map((row) => <li key={String(row.id)}>
      <Link href={`/admin/establishments/${row.id}`}><strong>{String(row.name)}</strong></Link>
      <ul>
        {watchReasons(row).map((reason) => <li key={reason}>
          <span className="badge warning">{WATCH_REASON_LABELS[reason]}</span> <span>{describeWatchReason(reason, row, now)}</span>
        </li>)}
      </ul>
    </li>)}
  </ul>;
}
