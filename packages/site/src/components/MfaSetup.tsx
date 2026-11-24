import * as React from "react";
import { Qr } from "./Qr";
import { setUpTOTP, updateMFAPreference, verifyTOTPSetup } from "aws-amplify/auth";
import { useT } from "../lib/i18n";
import { totpIssuer } from "../lib/totp";

/**
 * Two-step sign-in with an authenticator app (TOTP). Audit 2026-10-01, H-3.
 *
 * Optional for members, required for the people who manage a
 * tenant or the platform: AuthGate shows this before the app for them,
 * and the admin Lambdas refuse them until it is on (backend shared/mfa.ts).
 *
 * The QR code is drawn here from the library's module matrix as plain SVG,
 * so nothing is injected as HTML and the CSP needs no exception.
 */



/** The key in groups of four, easier to type than one long string. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

/** QR, key and the code field: shared by the sign-in step and the setup panel. */
export function TotpEnroll({ uri, secret, busy, error, onCode, action }: {
  uri: string; secret: string; busy: boolean; error: string | null; onCode: (code: string) => void; action?: string;
}) {
  const { t } = useT();
  const [code, setCode] = React.useState("");
  return (
    <form className="mk-mfa" onSubmit={(e) => { e.preventDefault(); onCode(code.replace(/\s/g, "")); }}>
      <p className="mk-muted">{t("mfa.scan")}</p>
      <div className="mk-mfa__qr"><Qr text={uri} /></div>
      <p className="mk-muted">{t("mfa.key")} <code className="mk-mfa__key">{grouped(secret)}</code></p>
      <label className="mk-field">
        <span>{t("mfa.code")}</span>
        <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" value={code}
          onChange={(e) => setCode(e.target.value)} required />
      </label>
      {error && <p className="mk-gate__error" role="alert">{error}</p>}
      <button className="mk-button" type="submit" disabled={busy}>{busy ? "…" : action ?? t("mfa.enable")}</button>
    </form>
  );
}

/**
 * Turn TOTP on for the signed-in account, then call onDone. With `again`, a
 * new authenticator entry replaces the old one (under today's name, as
 * lib/totp.ts makes it): the old entry's codes stop working once the new
 * one's first code is confirmed.
 */
export function MfaSetup({ email, onDone, again }: { email?: string; onDone: () => void; again?: boolean }) {
  const { t } = useT();
  const [setup, setSetup] = React.useState<{ uri: string; secret: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  React.useEffect(() => {
    setUpTOTP()
      .then((d) => setSetup({ uri: d.getSetupUri(totpIssuer(), email).toString(), secret: d.sharedSecret }))
      .catch(fail);
  }, [email]);

  const confirm = async (code: string) => {
    setBusy(true); setError(null);
    try {
      await verifyTOTPSetup({ code });
      await updateMFAPreference({ totp: "PREFERRED" });
      onDone();
    } catch (e) { fail(e); setBusy(false); }
  };

  if (!setup) return error ? <p className="mk-gate__error" role="alert">{error}</p> : <p className="mk-muted">…</p>;
  return <TotpEnroll uri={setup.uri} secret={setup.secret} busy={busy} error={error} onCode={confirm} action={again ? t("mfa.replace") : undefined} />;
}
