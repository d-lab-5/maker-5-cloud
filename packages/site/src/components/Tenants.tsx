import * as React from "react";
import { refreshGroups, useSession } from "./AuthGate";
import {
  addMember,
  allPeople,
  createTenant,
  resendInvite,
  setUserEnabled,
  createSpace,
  groupMembers,
  tenantCode,
  listTenants,
  listSpaces,
  removeMember,
  renameTenant,
  renameSpace,
} from "../lib/data";
import type { Tenant, Member, Space } from "../lib/data";
import { useT } from "../lib/i18n";

/**
 * Tenants and spaces (ADR-0005), for the people who manage them.
 *
 *   TenantPanel     a tenant's admins: its admins, its spaces, who reads
 *                   each one, new private spaces
 *   OperatorPanel   operators (mk-admins): create a tenant with its
 *                   shared space and first admin
 *
 * Accounts are by invitation (ADR-0007): adding an e-mail without an account
 * invites it. Changes take effect at the member's next sign-in (or token
 * refresh, within the hour).
 */

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Who is in one group (a space's readers, or the tenant's admins), editable. */
function Members({ group, what, onSelf }: { group: string; what: string; onSelf: () => void }) {
  const session = useSession();
  const { t } = useT();
  const [list, setList] = React.useState<Member[] | null>(null);
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => { groupMembers(group).then(setList).catch((e) => setError(message(e))); }, [group]);

  const run = async (fn: () => Promise<Member[]>, self: boolean) => {
    setBusy(true); setError(null); setNote(null);
    const known = new Set((list ?? []).map((m) => m.email));
    try {
      const next = await fn();
      const added = next.find((m) => !known.has(m.email));
      if (added?.status === "invited") setNote(t("pp.sent", { email: added.email }));
      setList(next); setEmail(""); if (self) onSelf();
    }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };
  const me = (session.email ?? "").toLowerCase();

  return (
    <div className="mk-members">
      <ul className="mk-members__list">
        {list?.map((m) => (
          <li key={m.email} className="mk-chip">
            {m.name ? `${m.name} · ` : ""}{m.email}
            {m.status === "invited" && (
              <>
                {" "}<span className="mk-muted">· {t("pp.invited")}</span>{" "}
                <button type="button" className="mk-linkbutton" disabled={busy}
                  onClick={() => { setBusy(true); resendInvite(m.email).then(() => setNote(t("pp.resent", { email: m.email })))
                    .catch((e) => setError(message(e))).finally(() => setBusy(false)); }}>{t("pp.resend")}</button>
              </>
            )}
            {m.status === "disabled" && <>{" "}<span className="mk-muted">· {t("pp.disabled")}</span></>}
            <button type="button" className="mk-chip__x" disabled={busy} aria-label={t("hh.remove", { email: m.email, what })}
              onClick={() => {
                if (m.email.toLowerCase() === me && !window.confirm(t("hh.removeself", { what }))) return;
                void run(() => removeMember(group, m.email), m.email.toLowerCase() === me);
              }}>×</button>
          </li>
        ))}
        {list?.length === 0 && <li className="mk-muted">{t("hh.nobody")}</li>}
        {!list && !error && <li className="mk-muted">…</li>}
      </ul>
      <form className="mk-members__add" onSubmit={(e) => { e.preventDefault(); void run(() => addMember(group, email), email.trim().toLowerCase() === me); }}>
        <input className="mk-input" type="email" placeholder={t("hh.email")} value={email}
          onChange={(e) => setEmail(e.target.value)} aria-label={t("hh.addto", { what })} />
        <button type="submit" className="mk-button mk-button--ghost" disabled={busy || !email.includes("@")}>{t("hh.add")}</button>
      </form>
      {note && <p className="mk-ok" role="status">{note}</p>}
      {error && <p className="mk-error" role="alert">{error}</p>}
    </div>
  );
}

/** The tenant's code for another site (stage → prod): same ids, one store. */
function SiteCode({ code }: { code: string }) {
  const { t } = useT();
  const [copied, setCopied] = React.useState(false);
  if (!code) return null;
  return (
    <details className="mk-sitecode">
      <summary>{t("hh.code")}</summary>
      <p className="mk-panel__hint">{t("hh.code.hint")}</p>
      <code className="mk-id">{code}</code>{" "}
      <button type="button" className="mk-linkbutton" onClick={() => {
        void navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => undefined);
      }}>{copied ? t("hh.code.copied") : t("hh.code.copy")}</button>
    </details>
  );
}

export function TenantPanel() {
  const session = useSession();
  const { t } = useT();
  const [tenants, setTenants] = React.useState<Tenant[]>([]);
  const [spaces, setSpaces] = React.useState<Space[]>([]);
  const [newSpace, setNewSpace] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [changedSelf, setChangedSelf] = React.useState(false);

  const load = React.useCallback(() => {
    Promise.all([listTenants(), listSpaces()])
      .then(([hs, vs]) => {
        setTenants(hs.filter((h) => session.tenants.includes(h.id)).sort((a, b) => a.name.localeCompare(b.name)));
        setSpaces(vs);
      })
      .catch((e) => setError(message(e)));
  }, [session.tenants]);
  React.useEffect(load, [load]);

  const add = async (hid: string) => {
    try { await createSpace(hid, newSpace[hid] ?? ""); setNewSpace({ ...newSpace, [hid]: "" }); setChangedSelf(true); load(); }
    catch (e) { setError(message(e)); }
  };
  const renameH = async (h: Tenant) => {
    const name = window.prompt(t("hh.renametenant"), h.name);
    if (!name || name === h.name) return;
    try { await renameTenant(h.id, name); load(); } catch (e) { setError(message(e)); }
  };
  const rename = async (v: Space) => {
    const name = window.prompt(t("hh.renamespace"), v.name);
    if (!name || name === v.name) return;
    try { await renameSpace(v.id, name); load(); } catch (e) { setError(message(e)); }
  };

  return (
    <>
      {tenants.map((h) => (
        <div className="mk-panel" key={h.id}>
          <h2 className="mk-panel__title">
            {t("hh.title", { name: h.name })}{" "}
            <button type="button" className="mk-linkbutton" onClick={() => void renameH(h)}>{t("hh.rename")}</button>
            <span className="mk-muted mk-id" title={t("hh.id")}> {h.id}</span>
          </h2>
          <p className="mk-panel__hint">{t("hh.hint")}</p>
          <SiteCode code={tenantCode(h, spaces)} />
          <h3 className="mk-panel__sub">{t("hh.admins")}</h3>
          <Members group={h.id} what={t("hh.adminsof", { name: h.name })} onSelf={() => setChangedSelf(true)} />
          {spaces.filter((v) => v.tenantId === h.id).map((v) => (
            <section key={v.id} className="mk-space">
              <h3 className="mk-panel__sub">
                {v.kind === "private" ? "🔒 " : ""}{v.name}
                <span className="mk-muted"> · {v.kind === "shared" ? t("hh.sharedspace") : t("hh.privatespace")}</span>
                {" "}<button type="button" className="mk-linkbutton" onClick={() => void rename(v)}>{t("hh.rename")}</button>
              </h3>
              <Members group={v.id} what={t("hh.thespace", { name: v.name })} onSelf={() => setChangedSelf(true)} />
            </section>
          ))}
          <form className="mk-members__add" onSubmit={(e) => { e.preventDefault(); void add(h.id); }}>
            <input className="mk-input" placeholder={t("hh.newspace")} value={newSpace[h.id] ?? ""}
              onChange={(e) => setNewSpace({ ...newSpace, [h.id]: e.target.value })} aria-label={t("hh.newspace.name")} />
            <button type="submit" className="mk-button mk-button--ghost" disabled={!(newSpace[h.id] ?? "").trim()}>{t("hh.createspace")}</button>
          </form>
        </div>
      ))}
      {error && <p className="mk-error" role="alert">{error}</p>}
      {changedSelf && (
        <p className="mk-panel__hint">
          {t("hh.changedself")} <button type="button" className="mk-linkbutton" onClick={() => void refreshGroups()}>{t("hh.refreshnow")}</button>{" "}
          {t("hh.tosee")}
        </p>
      )}
    </>
  );
}

export function OperatorPanel() {
  const session = useSession();
  const [name, setName] = React.useState("");
  const [admin, setAdmin] = React.useState(session.email ?? "");
  const [sameAs, setSameAs] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<Tenant | null>(null);
  const { t } = useT();

  const create = async () => {
    setBusy(true); setError(null);
    try { setMade(await createTenant(name, admin, sameAs)); setName(""); setSameAs(""); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mk-panel">
      <h2 className="mk-panel__title">{t("op.title")}</h2>
      <p className="mk-panel__hint">{t("op.hint")}</p>
      <form className="mk-form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <input className="mk-input" placeholder={t("op.name")} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="mk-input" type="email" placeholder={t("op.admin")} value={admin}
          onChange={(e) => setAdmin(e.target.value)} />
        <input className="mk-input" placeholder={t("op.sameas")} value={sameAs} aria-label={t("op.sameas")}
          onChange={(e) => setSameAs(e.target.value)} spellCheck={false} autoComplete="off" />
        <span className="mk-muted">{t("op.sameas.hint")}</span>
        <button type="submit" className="mk-button" disabled={busy || !name.trim() || !admin.includes("@")}>
          {busy ? t("op.creating") : t("op.create")}
        </button>
        {!busy && (!name.trim() || !admin.includes("@")) && (
          <span className="mk-muted">{t("op.needs")}</span>
        )}
      </form>
      {error && <p className="mk-error" role="alert">{error}</p>}
      {made && (
        <p className="mk-ok" role="status">
          {t("op.ready", { name: made.name })}{" "}
          <button type="button" className="mk-linkbutton" onClick={() => void refreshGroups()}>{t("op.refresh")}</button> {t("op.tosee")}
        </p>
      )}
    </div>
  );
}

/** Operators: every account on this site; turn one off or on (ADR-0007). */
export function PeoplePanel() {
  const session = useSession();
  const { t } = useT();
  const [list, setList] = React.useState<Member[] | null>(null);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { allPeople().then(setList).catch((e) => setError(message(e))); }, []);
  const toggle = async (m: Member) => {
    if (m.status !== "disabled" && !window.confirm(t("pp.disable.confirm", { email: m.email }))) return;
    setBusy(true); setError(null);
    try { setList(await setUserEnabled(m.email, m.status === "disabled")); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };
  const me = (session.email ?? "").toLowerCase();
  const shown = (list ?? []).filter((m) => !q || `${m.email} ${m.name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="mk-panel">
      <h2 className="mk-panel__title">{t("pp.title")}</h2>
      <p className="mk-panel__hint">{t("pp.hint")}</p>
      <input className="mk-input" type="search" placeholder={t("pp.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("pp.search")} />
      <table className="mk-table">
        <thead><tr><th>{t("pp.who")}</th><th>{t("pp.status")}</th><th /></tr></thead>
        <tbody>
          {shown.map((m) => (
            <tr key={m.email}>
              <td>{m.name ? `${m.name} · ` : ""}{m.email}</td>
              <td>{t(`pp.${m.status ?? "active"}`)}</td>
              <td>
                {m.status === "invited" && (
                  <button type="button" className="mk-linkbutton" disabled={busy}
                    onClick={() => { setBusy(true); resendInvite(m.email).catch((e) => setError(message(e))).finally(() => setBusy(false)); }}>{t("pp.resend")}</button>
                )}{" "}
                {m.email.toLowerCase() !== me && (
                  <button type="button" className="mk-linkbutton" disabled={busy} onClick={() => void toggle(m)}>
                    {m.status === "disabled" ? t("pp.enable") : t("pp.disable")}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {list && shown.length === 0 && <tr><td colSpan={3} className="mk-muted">{t("hh.nobody")}</td></tr>}
          {!list && !error && <tr><td colSpan={3} className="mk-muted">…</td></tr>}
        </tbody>
      </table>
      {error && <p className="mk-error" role="alert">{error}</p>}
    </div>
  );
}
