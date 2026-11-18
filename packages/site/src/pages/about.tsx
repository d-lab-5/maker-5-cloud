import * as React from "react";
import type { HeadFC } from "gatsby";
import { Shell } from "../components/Shell";
import { useSession } from "../components/AuthGate";
import { appInfo } from "../lib/about";
import { useT } from "../lib/i18n";

/** About this site: its version, and which edges it works with. */
const AboutPage: React.FC = () => {
  const session = useSession();
  const { t } = useT();
  const info = React.useMemo(appInfo, []);
  return (
    <Shell active="about" title={t("about.title")}>
      <div className="mk-pagehead"><h1>{t("about.title")}</h1></div>
      <div className="mk-panel">
        <h2 className="mk-panel__title">{t("app.name")}</h2>
        <dl className="mk-stats">
          <div className="mk-stat"><dt>{info.version}</dt><dd>{t("about.version")}</dd></div>
          <div className="mk-stat"><dt>{info.commit ? info.commit.slice(0, 7) : "—"}</dt><dd>{t("about.build")}</dd></div>
          <div className="mk-stat"><dt>{info.environment ?? "—"}</dt><dd>{t("about.environment")}</dd></div>
        </dl>
        <p className="mk-panel__hint">{t("about.lede")}</p>
      </div>
      <div className="mk-panel" style={{ marginTop: "1rem" }}>
        <h2 className="mk-panel__title">{t("about.edge")}</h2>
        <dl className="mk-stats">
          <div className="mk-stat"><dt>{info.minEdgeVersion ?? "—"}</dt><dd>{t("about.minedge")}</dd></div>
          <div className="mk-stat"><dt>{info.edgeRelease ?? "—"}</dt><dd>{t("about.edgerelease")}</dd></div>
        </dl>
        <p className="mk-panel__hint">{t("about.edge.hint", { min: info.minEdgeVersion ?? "—" })}</p>
        {(session.isAdmin || session.isOperator) && (
          <p className="mk-panel__hint"><a href="/settings/#install-edge">{t("about.install")}</a></p>
        )}
      </div>
      <div className="mk-panel" style={{ marginTop: "1rem" }}>
        <h2 className="mk-panel__title">{t("about.licence")}</h2>
        <p className="mk-panel__hint">{t("about.licence.hint")}</p>
      </div>
    </Shell>
  );
};

export default AboutPage;
export const Head: HeadFC = () => <title>About · maker5.cloud</title>;
