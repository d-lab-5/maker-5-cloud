import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";

/**
 * Not found, except a code's card: where the hosting has no rewrite for
 * /t/<code> or /T/<code> (gatsby-node.ts), a scanned label still opens it.
 */
const NotFoundPage: React.FC<PageProps> = ({ location }) => {
  const code = /^\/t\/([0-9a-z]{6})\/?$/i.exec(location.pathname)?.[1];
  React.useEffect(() => { if (code) window.location.replace(`/t/?c=${code}`); }, [code]);
  if (code) return <Shell><p className="mk-muted">…</p></Shell>;
  return (
    <Shell>
      <h1>Not found</h1>
      <p>
        <a href="/">Back to spaces</a>
      </p>
    </Shell>
  );
};

export default NotFoundPage;

export const Head: HeadFC = () => <title>Not found · maker-5.dlab5</title>;
