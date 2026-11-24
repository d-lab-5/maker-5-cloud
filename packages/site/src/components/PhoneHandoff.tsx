import * as React from "react";
import { Qr } from "./Qr";
import { useSession } from "./AuthGate";
import { useT } from "../lib/i18n";

/**
 * On a computer, Scan is for the phone: a QR that opens this same page there,
 * with the person's e-mail filled in on the phone's sign-in (it travels in the
 * #fragment, which the browser never sends to a server). Nothing else is in
 * the code: no token, no password; the phone signs in itself.
 */

/** A computer: a mouse and no touch screen. Phones and tablets answer false. */
export function useComputer(): boolean {
  const [computer, setComputer] = React.useState(false);
  React.useEffect(() => {
    setComputer(window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(any-pointer: coarse)").matches);
  }, []);
  return computer;
}

/** The address the phone opens: this page, its mode, and the e-mail after #. */
export function phoneLink(path: string, email?: string): string {
  const url = new URL(path, window.location.origin);
  if (email) url.hash = `u=${encodeURIComponent(email)}`;
  return url.toString();
}

export function PhoneHandoff({ path }: { path: string }) {
  const { t } = useT();
  const { email } = useSession();
  const link = phoneLink(path, email);
  return (
    <div className="mk-card mk-handoff">
      <Qr text={link} size={168} label={t("ph.qr")} />
      <div>
        <h2 className="mk-panel__title">{t("ph.title")}</h2>
        <p className="mk-panel__hint">{t("ph.hint")}</p>
        {email && <p className="mk-muted">{t("ph.email", { email })}</p>}
      </div>
    </div>
  );
}
