import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Link } from "gatsby";
import { Shell } from "../components/Shell";
import { useSession } from "../components/AuthGate";
import { graphActivity, listSpaces } from "../lib/data";
import type { Space } from "../lib/data";
import { useT } from "../lib/i18n";
import { byOrganisation, workspaceName } from "../lib/names";
import { ACTIVE_DAYS, ago, split, type Activity } from "../lib/activity";

const ORG_KEY = "mk-org";

/**
 * The launcher: the workspaces of the active organisation, split into active
 * (an edge used them in the last 14 days) and passive (ADR-0018 in
 * maker-5-shared). Someone in several organisations picks one; the choice is
 * kept in this browser.
 *
 * Reached only after AuthGate has a session, so there is no signed-out branch
 * to handle here — and no page below needs one either. That is the whole point
 * of gating at the root.
 *
 * Spaces are not created here: a tenant's admins add them in Settings (the
 * tenants function creates the row and its Cognito group together), and
 * operators create tenants there too.
 */
const IndexPage: React.FC<PageProps> = () => {
  const session = useSession();
  const { t } = useT();
  const [spaces, setSpaces] = React.useState<Space[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [orgId, setOrgId] = React.useState<string>(() => {
    try { return window.localStorage.getItem(ORG_KEY) || ""; } catch { return ""; }
  });
  const [activity, setActivity] = React.useState<Record<string, Activity>>({});

  React.useEffect(() => {
    listSpaces()
      .then(setSpaces)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const orgs = React.useMemo(() => (spaces ? byOrganisation(spaces) : []), [spaces]);
  const org = orgs.find((o) => o.id === orgId) ?? orgs[0];
  const choose = (id: string) => {
    setOrgId(id);
    try { window.localStorage.setItem(ORG_KEY, id); } catch { /* private window */ }
  };

  React.useEffect(() => {
    if (!org) return;
    setActivity({});
    graphActivity(org.id).then(setActivity).catch(() => setActivity({}));
  }, [org?.id]);

  const halves = org ? split(org.spaces, activity) : { active: [], passive: [] };
  const when = (iso?: string | null) => { const a = ago(iso); return a ? t(a.key, { n: a.n }) : ""; };
  const card = (space: Space) => {
    const a = activity[space.id];
    const counts = a && (a.blocks || a.modules) ? t("home.counts", { blocks: a.blocks ?? 0, modules: a.modules ?? 0 }) : "";
    return (
      <li key={space.id}>
        <a className="mk-card" href={`/w/${space.id}/`}>
          {/* The id, deliberately not shown. ADR-0003: never render an id
              where a name belongs. */}
          <span className="mk-card__title">{space.kind === "private" ? "🔒 " : ""}{workspaceName(space, t)}</span>
          {a?.edgeSeenAt && <span className="mk-card__meta">{t("home.edgeUsed", { edge: a.edgeSeenName || t("home.anEdge"), when: when(a.edgeSeenAt) })}</span>}
          {a?.updatedAt && <span className="mk-card__meta">{t("home.changed", { when: when(a.updatedAt) })}{counts ? ` · ${counts}` : ""}</span>}
          {!a && space.kind === "shared" && <span className="mk-card__meta">{t("space.shared.hint")}</span>}
        </a>
      </li>
    );
  };


  return (
    <Shell title={t("nav.spaces")}>
      <div className="mk-hero">
        <div className="mk-hero__copy">
          {/* No standing copy here. The cards below say what this page is for,
              and a paragraph explaining the product to someone who has already
              signed in is a paragraph nobody reads twice. */}
          <dl className="mk-stats">
            <div className="mk-stat">
              <dt>{spaces?.length ?? "—"}</dt>
              <dd>{t("home.spaces")}</dd>
            </div>
            <div className="mk-stat">
              <dt>{session.tenants.length}</dt>
              <dd>{t("home.admin")}</dd>
            </div>
            <div className="mk-stat">
              <dt>{session.isOperator ? t("set.role.operator") : session.isAdmin ? t("set.role.admin") : session.isMember ? t("set.role.member") : t("set.role.none")}</dt>
              <dd>{t("home.role")}</dd>
            </div>
          </dl>
        </div>
      </div>

      <h1 className="mk-cards__heading">{t("nav.spaces")}</h1>

      {error && <p className="mk-error" role="alert">{error}</p>}
      {!spaces && !error && <p className="mk-muted">{t("lib.loading")}</p>}

      {spaces?.length === 0 && (
        <div className="mk-empty">
          <p>{t("home.none")}</p>
          <p className="mk-muted">
            {session.isOperator ? <>{t("home.none.operator")} <Link to="/settings/">{t("nav.settings")}</Link></> : t("home.none.member")}
          </p>
        </div>
      )}

      {org && (
        <section className="mk-org">
          <div className="mk-org__head">
            {orgs.length > 1 ? (
              <label className="mk-org__pick">{t("home.org")}{" "}
                <select className="mk-select" value={org.id} onChange={(e) => choose(e.target.value)}>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
            ) : <h2 className="mk-org__name">{org.name}</h2>}
          </div>
          <div className="mk-split">
            <div className="mk-split__half">
              <h2 className="mk-split__title">{t("home.active")} <span className="mk-muted">({halves.active.length})</span></h2>
              <p className="mk-muted mk-split__hint">{t("home.active.hint", { days: ACTIVE_DAYS })}</p>
              {halves.active.length ? <ul className="mk-cards mk-cards--one">{halves.active.map(card)}</ul>
                : <p className="mk-muted">{t("home.active.none")}</p>}
            </div>
            <div className="mk-split__half">
              <h2 className="mk-split__title">{t("home.passive")} <span className="mk-muted">({halves.passive.length})</span></h2>
              <p className="mk-muted mk-split__hint">{t("home.passive.hint")}</p>
              {halves.passive.length ? <ul className="mk-cards mk-cards--one">{halves.passive.map(card)}</ul>
                : <p className="mk-muted">{t("home.passive.none")}</p>}
            </div>
          </div>
        </section>
      )}
    </Shell>
  );
};

export default IndexPage;

export const Head: HeadFC = () => <title>Workspaces · maker5.cloud</title>;
