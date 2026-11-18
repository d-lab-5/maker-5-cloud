import * as React from "react";
import type { HeadFC } from "gatsby";
import { Shell } from "../components/Shell";
import { CameraScanner, NfcReader } from "../components/Scanner";
import { cardHref } from "../lib/materials";
import { useT } from "../lib/i18n";

/**
 * Scan a code on the bench (ADR-0009 in maker-5-shared): our labels and
 * tags, an EAN on a box, a manufacturer's QR, an NFC tag. Whatever it reads
 * opens the card for it (/t/), which also offers to bind a code nobody
 * knows yet. A code can be typed, too: a scanner gun types and ends with Enter.
 */
const ScanPage: React.FC = () => {
  const { t } = useT();
  const [typed, setTyped] = React.useState("");
  const open = (raw: string) => window.location.assign(cardHref(raw.trim()));
  return (
    <Shell active="scan" title={t("sc.title")}>
      <div className="mk-pagehead"><h1>{t("sc.title")}</h1></div>
      <div className="mk-card">
        <p className="mk-panel__hint">{t("sc.hint")}</p>
        <CameraScanner onFound={(raw) => open(raw)} />
        <NfcReader onFound={(raw) => open(raw)} />
        <form className="mk-form" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) open(typed); }}>
          <input className="mk-input" autoFocus placeholder={t("sc.type")} value={typed} onChange={(e) => setTyped(e.target.value)}
            aria-label={t("sc.type")} autoComplete="off" spellCheck={false} />
          <button type="submit" className="mk-button mk-button--ghost" disabled={!typed.trim()}>{t("sc.open")}</button>
        </form>
      </div>
    </Shell>
  );
};

export default ScanPage;
export const Head: HeadFC = () => <title>Scan · maker5.cloud</title>;
