import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";
import { getSpace } from "../lib/data";
import type { Space } from "../lib/data";
import { SpaceMaterials } from "../components/SpaceMaterials";
import { useT } from "../lib/i18n";
import { workspaceName } from "../lib/names";
import * as m from "../lib/materials";

/**
 * Every route under /w/.
 *
 * This is a client-only page (see `onCreatePage` in gatsby-node.ts): there is
 * no build-time list of space ids, and a space's content is
 * authenticated per-group data in S3, so there is nothing to statically
 * render. The id and the view come out of the URL at runtime.
 *
 * ONE page component for all its views rather than five matchPath routes.
 * The alternative needs a hosting rewrite per route (constraint 11 in the dlab5-cloud-template skill)
 * — configuration that lives outside this repository and that nobody will
 * remember to add.
 *
 * When a view outgrows a `case`, move it to its own component in
 * src/components/ and keep the switch as the router. Do not turn the switch
 * into a lookup table: the whole value of it is that the reader sees every
 * route a space has in one screenful.
 */

const VIEWS = ["overview", "materials"] as const;

type View = (typeof VIEWS)[number];

/**
 * `/w/s-4k9mqhtx2p/items/` → `{ id, view }`.
 *
 * A missing or unrecognised trailing segment resolves to "overview" rather
 * than 404: /w/<id>/ is the space's home, and a typo in a view name is
 * better answered with the space than with a dead end.
 */
function parse(pathname: string): { id?: string; view: View } {
  const parts = pathname.split("/").filter(Boolean); // ["w", id, view?]
  const id = parts[1];
  const candidate = parts[2] as View | undefined;
  return {
    id,
    view: candidate && VIEWS.includes(candidate) ? candidate : "overview",
  };
}

const SpacePage: React.FC<PageProps> = ({ location }) => {
  const { id, view } = parse(location.pathname);
  const { t } = useT();

  const [space, setSpace] = React.useState<Space | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "denied">(
    "loading"
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) {
      setState("denied");
      return;
    }
    getSpace(id)
      .then((found) => {
        setSpace(found);
        // null covers both "no such space" and "not yours". AppSync does
        // not distinguish them and neither does this screen — telling them
        // apart would let anyone enumerate ids.
        setState(found ? "ready" : "denied");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setState("denied");
      });
  }, [id]);

  if (state === "loading") {
    return (
      <Shell space={id ? { id, active: view } : undefined}>
        <p className="mk-muted">Loading…</p>
      </Shell>
    );
  }

  if (state === "denied" || !space || !id) {
    return (
      <Shell>
        <h1>Not available</h1>
        <div className="mk-empty">
          <p>No such space, or you do not have access to it.</p>
          <p className="mk-muted">
            Access is granted by an admin of the space&rsquo;s tenant, in
            Settings: they add your account to the space&rsquo;s readers.
          </p>
          {error && (
            <p className="mk-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell space={{ id, name: space.name, active: view }}>
      <div className="mk-pagehead">
        <h1>{workspaceName(space, t)}</h1>
        {space.tenantName && <span className="mk-chip">{space.tenantName}</span>}
        <span className="mk-muted">{t(`ws.view.${view}`)}</span>
      </div>
      <ViewBody view={view} space={space} />
    </Shell>
  );
};

function ViewBody({ view, space }: { view: View; space: Space }) {
  switch (view) {
    case "overview":
      return <Overview space={space} />;
    case "materials":
      return <SpaceMaterials space={space} />;
  }
}

/**
 * A workspace at a glance (ADR-0011): its boxes, and the links and files kept
 * in them, so the firmware and CAD of a product are one click from its page.
 */
function Overview({ space }: { space: Space }) {
  const { t } = useT();
  const [boxes, setBoxes] = React.useState<m.BoxDetail[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    m.boxes(space.tenantId, "", space.id)
      .then((list) => Promise.all(list.slice(0, 40).map((b) => m.box(space.tenantId, b.id))))
      .then(setBoxes)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [space.id, space.tenantId]);
  const links = (boxes ?? []).flatMap((d) => (d.box.links ?? []).map((l) => ({ ...l, box: d.box })));
  const files = (boxes ?? []).flatMap((d) => (d.box.files ?? []).map((f) => ({ ...f, box: d.box })));
  const open = async (boxId: string, fileId: string) => window.location.assign((await m.fileUrl(space.tenantId, boxId, fileId)).url);
  return (
    <>
      <div className="mk-panel">
        <h2 className="mk-panel__title">{t("ws.boxes")}</h2>
        {error && <p className="mk-error" role="alert">{error}</p>}
        {!boxes && !error && <p className="mk-muted">…</p>}
        {boxes?.length === 0 && <p className="mk-panel__hint">{t("ws.boxes.none")} <a href={`/materials/?w=${space.tenantId}&tab=boxes`}>{t("bx.tab")}</a></p>}
        <ul className="mk-boxlist">
          {boxes?.map((d) => (
            <li key={d.box.id} className="mk-boxlist__row">
              <span><span aria-hidden="true">📦 </span><a href={m.boxHref(space.tenantId, d.box.id)}><strong>{d.box.name}</strong></a>
                <span className="mk-muted"> · {d.path.length ? d.path.map((p) => p.name).join(" › ") : d.box.location ?? t(`bx.kind.${d.box.kind}`)}</span></span>
              <span className="mk-muted">{t("ws.boxes.count", { n: d.units.length + d.lines.length + d.boxes.length })}</span>
            </li>
          ))}
        </ul>
      </div>
      {(links.length > 0 || files.length > 0) && (
        <div className="mk-panel">
          <h2 className="mk-panel__title">{t("bx.artifacts")}</h2>
          <ul className="mk-boxlist">
            {links.map((l) => (
              <li key={`${l.box.id}-${l.id}`}><span className="mk-chip">{t(`bx.link.${l.kind}`)}</span>{" "}
                <a href={l.url} target="_blank" rel="noreferrer noopener">{l.title}</a><span className="mk-muted"> · {l.box.name}</span></li>
            ))}
            {files.map((f) => (
              <li key={`${f.box.id}-${f.id}`}><span className="mk-chip">{t(`bx.link.${f.kind}`)}</span>{" "}
                <button type="button" className="mk-linkbutton" onClick={() => void open(f.box.id, f.id)}>{f.name}</button>
                <span className="mk-muted"> · {f.box.name}</span></li>
            ))}
          </ul>
        </div>
      )}
      <SpaceMaterials space={space} />
    </>
  );
}

export default SpacePage;

export const Head: HeadFC = () => <title>Workspace · maker5.cloud</title>;
