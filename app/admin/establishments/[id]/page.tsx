import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminNav, StatusBadge, formatDate } from "@/components/admin-nav";
import { AdminSuspensionForm } from "@/components/admin-suspension-form";
import { activityActionLabel } from "@/lib/activity-log";
import { sql } from "@/lib/db";
import { staffRoleLabel, type StaffRole } from "@/lib/loyalty";
import { isUuid, requirePlatformAdmin } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

export default async function AdminEstablishmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const admin = await requirePlatformAdmin("establishment", {}, { type: "establishment", id });

  const [establishment] = await sql`
    select e.id, e.name, e.slug, e.status, e.address, e.phone, e.website, e.created_at, e.updated_at,
      e.platform_suspended_at, e.platform_suspension_reason,
      p.mode, p.program_name, p.reward_threshold, p.reward_label,
      sub.plan, sub.status as subscription_status, sub.trial_ends_at, sub.current_period_end,
      sub.cancel_at_period_end, (sub.external_subscription_id is not null) as stripe_linked
    from establishments e
    left join loyalty_programs p on p.establishment_id=e.id
    left join subscriptions sub on sub.establishment_id=e.id
    where e.id=${id}
  `;
  if (!establishment) notFound();

  const [stats] = await sql`
    select
      (select count(*)::int from customers where establishment_id=${id} and deleted_at is null) as customers,
      (select count(*)::int from cards where establishment_id=${id} and active) as active_cards,
      (select count(*)::int from transactions where establishment_id=${id} and type='earn' and created_at >= now() - interval '7 days') as scans_7d,
      (select count(*)::int from transactions where establishment_id=${id} and type='earn' and created_at >= now() - interval '30 days') as scans_30d,
      (select count(*)::int from transactions where establishment_id=${id} and type='redeem' and created_at >= now() - interval '30 days') as rewards_30d,
      (select max(created_at) from transactions where establishment_id=${id}) as last_activity,
      (select count(*)::int from product_events where establishment_id=${id} and event_type='SCAN_FAILED' and created_at >= now() - interval '7 days') as scan_failed_7d,
      (select count(*)::int from product_events where establishment_id=${id} and event_type='CAMERA_FAILED' and created_at >= now() - interval '7 days') as camera_failed_7d,
      (select count(*)::int from wallet_passes where establishment_id=${id} and status='error') as wallet_errors
  `;
  const staff = await sql`
    select s.id, s.email, s.role, s.active, s.created_at, (pa.staff_user_id is not null) as platform_admin
    from staff_users s left join platform_admins pa on pa.staff_user_id=s.id
    where s.establishment_id=${id}
    order by s.created_at
  `;
  const activity = await sql`
    select id, action, created_at from audit_logs where establishment_id=${id} order by created_at desc limit 20
  `;
  const adminHistory = await sql`
    select id, action, admin_email, reason, created_at from platform_admin_audit
    where target_type='establishment' and target_id=${id} and action <> 'ADMIN_VIEW'
    order by created_at desc limit 20
  `;

  const status = String(establishment.status);
  const platformSuspended = Boolean(establishment.platform_suspended_at);
  const ownEstablishment = id === admin.establishmentId;

  return <>
    <AdminNav email={admin.email}/>
    <main className="shell page">
      <div className="section-head">
        <div>
          <span className="eyebrow">Commerce</span>
          <h2 style={{margin:"12px 0 4px"}}>{String(establishment.name)}</h2>
          <p className="muted"><code>{String(establishment.slug)}</code> · inscrit le {formatDate(establishment.created_at)} · <StatusBadge status={status} platform={platformSuspended}/></p>
        </div>
        <Link className="btn" href="/admin/establishments">← Commerces</Link>
      </div>

      {platformSuspended && <div className="notice" style={{marginBottom:18}} role="status">
        Suspendu par Retiko le {formatDate(establishment.platform_suspended_at)} : {String(establishment.platform_suspension_reason)}
      </div>}
      {status === "suspended" && !platformSuspended && <div className="notice" style={{marginBottom:18}} role="status">
        Fermé à la demande du commerçant (cartes révoquées, accès désactivés). Non réversible depuis l’application.
      </div>}

      <section className="grid grid-4" style={{marginBottom:18}}>
        {([
          [stats.customers, "clients"], [stats.active_cards, "cartes actives"],
          [stats.scans_7d, "scans 7 j"], [stats.scans_30d, "scans 30 j"],
          [stats.rewards_30d, "récompenses 30 j"], [stats.scan_failed_7d, "scans échoués 7 j"],
          [stats.camera_failed_7d, "échecs caméra 7 j"], [stats.wallet_errors, "passes Wallet en erreur"],
        ] as const).map(([value, label]) => <div key={label} className="card metric"><strong>{Number(value)}</strong><span>{label}</span></div>)}
      </section>

      <div className="grid grid-2" style={{marginBottom:18}}>
        <section className="card">
          <h3>Abonnement & programme</h3>
          <ul style={{margin:0,paddingLeft:18}}>
            <li>Offre : {establishment.plan ? String(establishment.plan) : "—"} · statut {establishment.subscription_status ? String(establishment.subscription_status) : "—"}</li>
            <li>Fin d’essai : {formatDate(establishment.trial_ends_at)} · fin de période : {formatDate(establishment.current_period_end)}{establishment.cancel_at_period_end ? " · annulation programmée" : ""}</li>
            <li>Stripe lié : {establishment.stripe_linked ? "oui" : "non"}</li>
            <li>Programme : {establishment.program_name ? `${String(establishment.program_name)} · ${String(establishment.mode)} · ${Number(establishment.reward_threshold)} → ${String(establishment.reward_label)}` : "—"}</li>
            <li>Dernière transaction : {formatDate(stats.last_activity)}</li>
            <li>Coordonnées : {[establishment.address, establishment.phone, establishment.website].filter(Boolean).map(String).join(" · ") || "—"}</li>
          </ul>
        </section>

        <section className="card">
          <h3>Suspension</h3>
          {status === "active" && !ownEstablishment && <AdminSuspensionForm establishmentId={id} slug={String(establishment.slug)} mode="suspend"/>}
          {status === "active" && ownEstablishment && <p className="muted">C’est ton propre commerce : le suspendre te retirerait l’accès super-admin.</p>}
          {platformSuspended && <AdminSuspensionForm establishmentId={id} slug={String(establishment.slug)} mode="reactivate"/>}
          {status === "suspended" && !platformSuspended && <p className="muted">Aucune action disponible : fermeture commerçant.</p>}
        </section>
      </div>

      <section className="card" style={{marginBottom:18}}>
        <h3>Équipe</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Email</th><th>Rôle</th><th>État</th><th>Créé le</th></tr></thead>
          <tbody>{staff.map((row) => <tr key={String(row.id)}>
            <td>{String(row.email)}{row.platform_admin ? <span className="badge" style={{marginLeft:8}}>super-admin</span> : null}</td>
            <td>{staffRoleLabel(String(row.role) as StaffRole)}</td>
            <td>{row.active ? "Actif" : "Désactivé"}</td>
            <td>{formatDate(row.created_at)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <h3>Activité du commerce</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Action</th></tr></thead>
            <tbody>
              {activity.map((row) => <tr key={String(row.id)}><td>{formatDate(row.created_at)}</td><td>{activityActionLabel(String(row.action))}</td></tr>)}
              {activity.length === 0 && <tr><td colSpan={2} className="muted">Aucune action sensible journalisée.</td></tr>}
            </tbody>
          </table></div>
        </section>
        <section className="card">
          <h3>Actions super-admin</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Action</th><th>Admin</th><th>Motif</th></tr></thead>
            <tbody>
              {adminHistory.map((row) => <tr key={String(row.id)}><td>{formatDate(row.created_at)}</td><td>{activityActionLabel(String(row.action))}</td><td>{String(row.admin_email || "cli")}</td><td>{row.reason ? String(row.reason) : "—"}</td></tr>)}
              {adminHistory.length === 0 && <tr><td colSpan={4} className="muted">Aucune action super-admin sur ce commerce.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </div>
    </main>
  </>;
}
