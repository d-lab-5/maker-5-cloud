import * as React from "react";
import { CameraScanner } from "./Scanner";
import * as m from "../lib/materials";
import { useT } from "../lib/i18n";

/**
 * The intake on the phone (ADR-0022 in maker-5-shared): scan the shelf or box
 * (the place), then the labels of what goes into it, one after the other.
 * Each scan is an item at once; a photo, a note and a count can follow. The
 * edge's agent describes the items later, and a person checks them in there.
 * A blank label scanned as the place becomes a new shelf or box.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Place = { tenantId: string; id: string; name: string };
const PLACE_KINDS = ["shelf", "box", "drawer", "bag", "folder"] as const;

export function Intake() {
  const { t } = useT();
  const [place, setPlace] = React.useState<Place | null>(null);
  const [blank, setBlank] = React.useState<{ code: string; tenantId: string } | null>(null);
  const [item, setItem] = React.useState<m.IntakeItem | null>(null);
  const [done, setDone] = React.useState<m.IntakeItem[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [typed, setTyped] = React.useState("");

  const run = async (fn: () => Promise<void>) => {
    setError(""); setBusy(true);
    try { await fn(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };

  const atPlace = (raw: string) => run(async () => {
    const r = await m.resolveCode(raw);
    if (r.status === "box") {
      const b = await m.box(r.tenantId, r.id);
      setPlace({ tenantId: r.tenantId, id: r.id, name: b.box.name });
    } else if (r.status === "blank") {
      setBlank({ code: raw, tenantId: r.tenantId });
    } else {
      throw new Error(t("in.notPlace"));
    }
  });

  const scanned = (raw: string) => run(async () => {
    const got = await m.intakeAdd(place!.tenantId, { code: raw, placeId: place!.id });
    setItem(got);
  });

  const found = (raw: string) => (place ? scanned(raw) : atPlace(raw));

  return (
    <div className="mk-card mk-intake">
      {place ? (
        <div className="mk-intake__place">
          <span className="mk-muted">{t("in.place")}</span> <b>{place.name}</b>
          <button type="button" className="mk-linkbutton" onClick={() => { setPlace(null); setItem(null); }}>{t("in.changePlace")}</button>
        </div>
      ) : <p className="mk-panel__hint">{t("in.hintPlace")}</p>}

      {blank && !place && <NewPlace blank={blank} onMade={(p) => { setBlank(null); setPlace(p); }} onCancel={() => setBlank(null)} />}

      {item ? (
        <Details key={item.id} item={item} onNext={(x) => { setDone((d) => [x, ...d.filter((y) => y.id !== x.id)]); setItem(null); }} />
      ) : !blank && (
        <>
          {place && <p className="mk-panel__hint">{t("in.hintLabel")}</p>}
          <CameraScanner key={place ? "label" : "place"} auto={Boolean(place)} onFound={(raw) => void found(raw)} />
          <form className="mk-form" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { void found(typed.trim()); setTyped(""); } }}>
            <input className="mk-input" placeholder={t("sc.type")} value={typed} onChange={(e) => setTyped(e.target.value)}
              aria-label={t("sc.type")} autoComplete="off" spellCheck={false} />
            <button type="submit" className="mk-button mk-button--ghost" disabled={busy || !typed.trim()}>{t("sc.open")}</button>
          </form>
        </>
      )}
      {error && <p className="mk-error" role="alert">{error}</p>}

      {done.length > 0 && (
        <div className="mk-intake__done">
          <h2 className="mk-panel__title">{t("in.tonight", { n: done.length })}</h2>
          <ul className="mk-list">
            {done.map((x) => (
              <li key={x.id}>
                <span><code className="mk-id">{x.code.kind === "m5" ? `${m.markOf(x.family)} ${x.code.value}` : x.code.value}</code>
                  {x.known?.name ? ` · ${x.known.name}` : ""}{x.note ? ` · ${x.note}` : ""}{x.qty ? ` · ${x.qty}` : ""}
                  <span className="mk-muted"> · {x.placeName}{x.photos.length ? ` · ${t("in.photos", { n: x.photos.length })}` : ""}</span></span>
                <button type="button" className="mk-linkbutton" onClick={() => void run(async () => {
                  await m.intakeDrop(x.tenantId, x.id); setDone((d) => d.filter((y) => y.id !== x.id));
                })}>{t("in.drop")}</button>
              </li>
            ))}
          </ul>
          <p className="mk-muted">{t("in.atEdge")}</p>
        </div>
      )}
    </div>
  );
}

/** A blank label scanned as the place: name the new shelf or box, and the label is its. */
function NewPlace({ blank, onMade, onCancel }: { blank: { code: string; tenantId: string }; onMade: (p: Place) => void; onCancel: () => void }) {
  const { t } = useT();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<(typeof PLACE_KINDS)[number]>("shelf");
  const [error, setError] = React.useState("");
  const make = async () => {
    setError("");
    try {
      const b = await m.saveBox(blank.tenantId, { name: name.trim(), kind });
      await m.bindCode(blank.tenantId, blank.code, "box", b.id);
      onMade({ tenantId: blank.tenantId, id: b.id, name: b.name });
    } catch (e) { setError(message(e)); }
  };
  return (
    <form className="mk-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void make(); }}>
      <p className="mk-panel__hint">{t("in.newPlace")}</p>
      <input className="mk-input" autoFocus required maxLength={120} placeholder={t("in.placeName")} value={name}
        onChange={(e) => setName(e.target.value)} aria-label={t("in.placeName")} />
      <select className="mk-select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t("bx.f.kind")}>
        {PLACE_KINDS.map((k) => <option key={k} value={k}>{t(`bx.kind.${k}`)}</option>)}
      </select>
      <button type="submit" className="mk-button">{t("in.makePlace")}</button>
      <button type="button" className="mk-button mk-button--ghost" onClick={onCancel}>{t("mt.cancel")}</button>
      {error && <p className="mk-error" role="alert">{error}</p>}
    </form>
  );
}

/** After a scan: a photo or two, a note, a count; then the next label. */
function Details({ item, onNext }: { item: m.IntakeItem; onNext: (x: m.IntakeItem) => void }) {
  const { t } = useT();
  const [note, setNote] = React.useState(item.note ?? "");
  const [qty, setQty] = React.useState(item.qty ? String(item.qty) : "");
  const [photos, setPhotos] = React.useState(item.photos.length);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const photo = async (f: File | undefined) => {
    if (!f) return;
    setError(""); setBusy(true);
    try { await m.intakePhoto(item.tenantId, item.id, f); setPhotos((n) => n + 1); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const next = async () => {
    setError(""); setBusy(true);
    try {
      const changed = note.trim() !== (item.note ?? "") || (qty ? Number(qty) : undefined) !== item.qty;
      const got = changed
        ? await m.intakeAdd(item.tenantId, { code: item.code.value, placeId: item.placeId!, note: note.trim() || undefined, qty: qty ? Number(qty) : undefined })
        : item;
      onNext({ ...got, photos: Array.from({ length: photos }, (_, i) => ({ id: String(i), type: "image/jpeg", size: 0 })) });
    } catch (e) { setError(message(e)); setBusy(false); }
  };
  const mark = item.code.kind === "m5" ? `${m.markOf(item.family)} ${item.code.value}` : item.code.value;
  return (
    <form className="mk-form mk-intake__item" onSubmit={(e) => { e.preventDefault(); void next(); }}>
      <p><code className="mk-id">{mark}</code> {item.known?.name ? <b>{item.known.name}</b> : <span className="mk-muted">{t("in.newItem")}</span>}
        {item.again && <span className="mk-muted"> · {t("in.again")}</span>}</p>
      <label className="mk-button mk-button--ghost mk-intake__photo">
        {photos ? t("in.photoMore", { n: photos }) : t("in.photo")}
        <input type="file" accept="image/*" capture="environment" hidden disabled={busy || photos >= 3}
          onChange={(e) => { void photo(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      <input className="mk-input" placeholder={t("in.note")} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label={t("in.note")} />
      <input className="mk-input mk-input--num" type="number" min={1} placeholder={t("in.qty")} value={qty} onChange={(e) => setQty(e.target.value)} aria-label={t("in.qty")} />
      <button type="submit" className="mk-button" disabled={busy}>{t("in.next")}</button>
      {error && <p className="mk-error" role="alert">{error}</p>}
    </form>
  );
}
