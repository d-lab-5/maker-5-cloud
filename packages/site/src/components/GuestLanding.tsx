import * as React from "react";
import { ThemeSegments } from "./ThemeSegments";
import { HelpSwitch } from "./Feedback";
import { useT } from "../lib/i18n";

/**
 * What a visitor sees before signing in.
 *
 * ADR-0002 settled that there is no anonymous access and no self-service
 * sign-up. Nothing here is fetched, no tenant or space is named, and the only
 * control that does anything is the sign-in form passed in as `children`. A
 * page that showed counts, names or a "recent activity" strip would be leaking
 * to someone who has not signed in.
 *
 * What it is NOT is a bare password box on an empty background. A visitor
 * should arrive at something that says what this is.
 */
export function GuestLanding({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className="mk-shell mk-shell--railed mk-shell--guest">
      <nav className="mk-rail" aria-label={t("auth.signin")}>
        <span className="mk-rail__brand">
          <Mark />
          <Brand />
        </span>

        <div className="mk-rail__section">
          <h2 className="mk-rail__sectionlabel">{t("guest.access")}</h2>
          {children}
        </div>

        {/* Appearance before sign-in, not after. Someone arriving at night
            should be able to turn the lights down without authenticating
            first, and this is the screen they are looking at. */}
        <div className="mk-rail__section">
          <h2 className="mk-rail__sectionlabel">{t("guest.appearance")}</h2>
          <ThemeSegments />
          <HelpSwitch />
        </div>

        <div className="mk-rail__section">
          <h2 className="mk-rail__sectionlabel">{t("guest.accounts")}</h2>
          <p className="mk-rail__note">{t("guest.accounts.note")}</p>
        </div>
      </nav>

      <div className="mk-shell__body">
        {/* What Maker-5 is, in one line. Nothing here is fetched and
            nothing names an organisation or a workspace (ADR-0002). */}
        <main className="mk-shell__main mk-guest">
          <p className="mk-hero__eyebrow">D-LAB-5</p>

          <h1 className="mk-hero__title">
            Maker-5{" "}
            <span className="mk-hero__titleaccent">{t("guest.claim")}</span>
          </h1>

          <Logo />

          <p className="mk-guest__tagline">{t("guest.tagline")}</p>
        </main>
      </div>
    </div>
  );
}

/** The name in the rail: the site's domain, as on an edge ("Maker-5 edge"). */
export function Brand() {
  return (
    <span>
      maker5<span className="mk-rail__brandaccent">.cloud</span>
    </span>
  );
}

/**
 * The mark, in whichever theme is showing.
 *
 * Both files are rendered and CSS hides one, rather than swapping `src` from
 * the theme hook. The hook starts at "dark" on the first client render to
 * match what the server emitted, so a src swap would paint the dark logo and
 * then replace it — a visible flicker for every light-theme visitor, on the
 * first screen they ever see. CSS keyed on the same `data-mk-theme` attribute
 * the pre-paint script already set has no such gap.
 *
 * The cost is that both files are fetched. They are ~100 KB each, and this is
 * the only page that shows them.
 *
 * Served from `static/`, so the paths are literal and stable rather than
 * content-hashed imports. That is the trade `static/` makes: a replaced logo
 * keeps its URL, so a cache can hand back the old one. If that ever bites,
 * the fix is a query string on these two src values, not a new directory.
 */
function Logo() {
  return (
    <div className="mk-guest__logo">
      <img
        className="mk-guest__logoimg mk-guest__logoimg--dark"
        src="/logo-dark.png"
        alt="D-LAB-5 — Twin. Experiment. Automate."
        width={480}
        height={480}
      />
      <img
        className="mk-guest__logoimg mk-guest__logoimg--light"
        src="/logo-light.png"
        alt="D-LAB-5 — Twin. Experiment. Automate."
        width={480}
        height={480}
      />
    </div>
  );
}

function Mark() {
  return (
    <span className="mk-mark" aria-hidden="true">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8 8h8M8 12h5M8 16h3" />
      </svg>
    </span>
  );
}
