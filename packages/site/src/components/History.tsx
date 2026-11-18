import * as React from "react";
import type { Movement } from "../lib/materials";
import { useT } from "../lib/i18n";

/** The movement log of an article, a unit or a product, newest first (ADR-0010). */
export function History({ movements }: { movements: Movement[] }) {
  const { t, date } = useT();
  if (!movements.length) return null;
  return (
    <details className="mk-history">
      <summary>{t("mt.history", { n: movements.length })}</summary>
      <ul className="mk-list">
        {movements.map((x) => (
          <li key={x.sk}>
            <span className="mk-muted">{date(x.at, true)}</span>{" "}
            <strong>{t(`mv.${x.kind}`)}</strong>{x.qty ? ` ${x.qty}` : ""}{x.note ? ` · ${x.note}` : ""}
            <span className="mk-muted"> · {x.by}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
