import * as React from "react";
import { CameraScanner, hasNfc, writeTag } from "./Scanner";
import { History } from "./History";
import { LabelSheet } from "./Labels";
import { BindCard } from "./BindCard";
import { UnitPicker } from "./UnitPicker";
import * as m from "../lib/materials";
import { listSpaces, type Space } from "../lib/data";
import { useT } from "../lib/i18n";

/**
 * A box's card (ADR-0011 in maker-5-shared), what its large label opens on a
 * phone: where the box is, what is in it, and the steps at the shelf. Check a
 * part in by scanning its small label or its own barcode; take one out, for a
 * workspace or not; move the box; keep its firmware, CAD and other files.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

type Out = { unitId?: string; articleId?: string; name: string; unit?: string; max?: number };

export function BoxCard({ tenantId, id }: { tenantId: string; id: string }) {
  const { t } = useT();
  const [d, setD] = React.useState<m.BoxDetail | null>(null);
  const [spaces, setSpaces] = React.useState<Space[]>([]);
  const [admin, setAdmin] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const [panel, setPanel] = React.useState<"" | "in" | "move" | "edit" | "link" | "file">("");
  const [out, setOut] = React.useState<Out | null>(null);
  const [labels, setLabels] = React.useState<m.Box | null>(null);

  const load = React.useCallback(() => { m.box(tenantId, id).then(setD).catch((e) => setError(message(e))); }, [tenantId, id]);
  React.useEffect(load, [load]);
  React.useEffect(() => {
    void listSpaces().then((vs) => setSpaces(vs.filter((v) => v.tenantId === tenantId)));
    void m.stockWorkspaces().then((ws) => setAdmin(Boolean(ws.find((w) => w.id === tenantId)?.admin)));
  }, [tenantId]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError(null); setOk(null);
    try { await fn(); setOk(done); setPanel(""); setOut(null); load(); return true; } catch (e) { setError(message(e)); return false; }
  };
  if (!d) return <p className="mk-muted">{error ?? "…"}</p>;
  const b = d.box;
  const own = d.codes.find((c) => c.kind === "m5")?.value;
  const empty = !d.boxes.length && !d.units.length && !d.lines.length;

  const makeLabel = async () => {
    let code = own;
    if (!code) {
      code = (await m.mintCodes(tenantId, 1))[0].code;
      await m.bindCode(tenantId, code, "box", id);
      load();
    }
    setLabels({ ...b, id: code });
  };

  return (
    <div className="mk-card mk-boxcard">
      {labels && (
        <LabelSheet tenantId={tenantId} layout="box" onClose={() => setLabels(null)}
          items={[{ code: labels.id, title: b.name, sub: d.space?.name ?? b.location ?? "" }]} />
      )}
      <p className="mk-muted">
        {t(`bx.kind.${b.kind}`)}
        {d.path.length > 0 && <> · {d.path.map((p, i) => <React.Fragment key={p.id}>{i > 0 && " › "}<a href={m.boxHref(tenantId, p.id)}>{p.name}</a></React.Fragment>)}</>}
        {!b.parentId && b.location && <> · {b.location}</>}
        {own && <> · <code className="mk-id">{own}</code></>}
      </p>
      <h1>{b.name}</h1>
      {d.space && <p>{t("bx.for")} <a href={`/w/${d.space.id}/`}>{d.space.name}</a></p>}
      {b.note && <p className="mk-muted">{b.note}</p>}

      <div className="mk-actions">
        <button type="button" className="mk-button" onClick={() => setPanel(panel === "in" ? "" : "in")}>{t("bx.checkin")}</button>
        <button type="button" className="mk-button mk-button--ghost" onClick={() => setPanel(panel === "move" ? "" : "move")}>{t("bx.move")}</button>
        <button type="button" className="mk-button mk-button--ghost" onClick={() => setPanel(panel === "edit" ? "" : "edit")}>{t("mt.edit")}</button>
        {(own || admin) && <button type="button" className="mk-button mk-button--ghost" onClick={() => void makeLabel().catch((e) => setError(message(e)))}>{t("bx.label")}</button>}
        {own && hasNfc() && (
          <button type="button" className="mk-button mk-button--ghost" onClick={() => {
            const lock = window.confirm(t("un.nfc.lock"));
            void run(() => writeTag(m.labelUrl(own).toLowerCase(), lock), t("un.nfc.done"));
          }}>{t("un.nfc")}</button>
        )}
      </div>

      {panel === "in" && <CheckIn tenantId={tenantId} boxId={id} admin={admin} onDone={(msg) => { setOk(msg); load(); }} onError={setError} />}
      {panel === "move" && <MoveBox tenantId={tenantId} box={b} run={run} />}
      {panel === "edit" && <EditBox tenantId={tenantId} box={b} spaces={spaces} run={run} />}
      {ok && <p className="mk-ok" role="status">{ok}</p>}
      {error && <p className="mk-error" role="alert">{error}</p>}

      <h2 className="mk-panel__sub">{t("bx.contents")}</h2>
      {empty && <p className="mk-muted">{t("bx.empty")}</p>}
      <ul className="mk-boxlist">
        {d.boxes.map((x) => (
          <li key={x.id}><span aria-hidden="true">📦 </span><a href={m.boxHref(tenantId, x.id)}><strong>{x.name}</strong></a>
            <span className="mk-muted"> · {t(`bx.kind.${x.kind}`)}</span></li>
        ))}
        {d.units.map((u) => (
          <li key={u.id}>
            <div className="mk-boxlist__row">
              <span>
                <a href={m.unitHref(tenantId, u.id)}><strong>{u.name || u.articleName || u.id}</strong></a>
                {u.name && u.articleName && <span className="mk-muted"> · {u.articleName}</span>}
                {u.serial && <span className="mk-muted"> · {u.serial}</span>}
                {u.codes[0] && <> <code className="mk-id">{u.codes[0]}</code></>}
                {u.state !== "in-stock" && <span className="mk-chip">{t(`state.${u.state}`)}</span>}
              </span>
              <button type="button" className="mk-button mk-button--ghost" onClick={() => setOut({ unitId: u.id, name: u.name || u.articleName || u.id })}>{t("bx.takeout")}</button>
            </div>
            {u.inside.length > 0 && (
              <ul className="mk-boxlist mk-boxlist--inside">
                {u.inside.map((c) => (
                  <li key={c.id}><a href={m.unitHref(tenantId, c.id)}>{c.name || c.articleName || c.id}</a>
                    {c.firmware && <span className="mk-muted"> · {c.firmware.name} {c.firmware.version}</span>}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {d.lines.map((l) => (
          <li key={l.articleId} className="mk-boxlist__row">
            <span><a href={`/materials/?w=${tenantId}&a=${l.articleId}`}><strong>{l.name ?? l.articleId}</strong></a>
              <span className="mk-muted"> · {l.qty} {t(`unit.${l.unit}`)}</span></span>
            <button type="button" className="mk-button mk-button--ghost"
              onClick={() => setOut({ articleId: l.articleId, name: l.name ?? l.articleId, unit: l.unit, max: l.qty })}>{t("bx.takeout")}</button>
          </li>
        ))}
      </ul>
      {out && <TakeOut tenantId={tenantId} boxId={id} out={out} spaces={spaces} defaultSpace={b.spaceId ?? ""} run={run} onCancel={() => setOut(null)} />}

      <Artifacts tenantId={tenantId} box={b} panel={panel} setPanel={setPanel} run={run} />

      {admin && empty && (
        <p><button type="button" className="mk-button mk-button--ghost" onClick={() => {
          if (window.confirm(t("bx.delete.confirm", { name: b.name }))) void run(() => m.deleteBox(tenantId, id), t("bx.deleted")).then((done) => { if (done) window.location.assign(`/materials/?w=${tenantId}&tab=boxes`); });
        }}>{t("bx.delete")}</button></p>
      )}
      <History movements={d.movements} />
    </div>
  );
}

/**
 * Scan (or type) a part's code and put it into this box: our small label, the
 * product's own barcode (EAN, a GS1 DataMatrix with its serial), a maker's QR,
 * or a serial number printed on the board. A product barcode of an article
 * tracked unit by unit asks which unit; a code nobody knows is bound here.
 */
function CheckIn({ tenantId, boxId, admin, onDone, onError }: {
  tenantId: string; boxId: string; admin: boolean; onDone: (msg: string) => void; onError: (e: string | null) => void;
}) {
  const { t } = useT();
  const [raw, setRaw] = React.useState("");
  const [bulk, setBulk] = React.useState<m.Article | null>(null);
  const [qty, setQty] = React.useState(1);
  const [which, setWhich] = React.useState<{ article: m.Article; serial?: string } | null>(null);
  const [unknown, setUnknown] = React.useState<{ raw: string; resolved: m.Resolved } | null>(null);
  const [stock, setStock] = React.useState<m.Article[]>([]);
  React.useEffect(() => { void m.articles(tenantId).then((as) => setStock(as.filter((a) => a.tracking === "bulk"))); }, [tenantId]);

  const found = async (code: string) => {
    onError(null); setUnknown(null); setBulk(null); setWhich(null); setRaw("");
    try {
      const r = await m.resolveCode(code);
      if (r.status === "unit" && r.tenantId === tenantId) {
        await m.checkIn(tenantId, boxId, { unitId: r.id });
        onDone(t("bx.in.done"));
      } else if (r.status === "article" && r.tenantId === tenantId) {
        const a = (await m.article(tenantId, r.id)).article;
        if (a.tracking === "serial") setWhich({ article: a, serial: r.code.serial });
        else { setBulk(a); setQty(1); }
      } else if (r.status === "box" && r.tenantId === tenantId) {
        if (r.id === boxId) { onError(t("bx.in.self")); return; }
        await m.moveBox(tenantId, r.id, { parentId: boxId });
        onDone(t("bx.in.box"));
      } else if (r.status === "blank" || r.status === "unknown") {
        setUnknown({ raw: code, resolved: r });
      } else {
        onError(t("bx.in.elsewhere"));
      }
    } catch (e) { onError(message(e)); }
  };
  const putBulk = async () => {
    if (!bulk) return;
    try { await m.checkIn(tenantId, boxId, { articleId: bulk.id, qty }); setBulk(null); onDone(t("bx.in.done")); } catch (e) { onError(message(e)); }
  };

  return (
    <div className="mk-take">
      <p className="mk-muted">{t("bx.in.hint")}</p>
      <CameraScanner onFound={(code) => void found(code)} />
      <form className="mk-form" onSubmit={(e) => { e.preventDefault(); if (raw.trim()) void found(raw.trim()); }}>
        <input className="mk-input" placeholder={t("sc.type")} value={raw} onChange={(e) => setRaw(e.target.value)} />
        <button type="submit" className="mk-button mk-button--ghost" disabled={!raw.trim()}>{t("bx.checkin")}</button>
      </form>
      <form className="mk-form" onSubmit={(e) => { e.preventDefault(); void putBulk(); }}>
        <select className="mk-select" value={bulk?.id ?? ""} onChange={(e) => setBulk(stock.find((a) => a.id === e.target.value) ?? null)} aria-label={t("mt.article")}>
          <option value="">{t("bx.in.pick")}</option>
          {stock.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.onHand - (a.boxed ?? 0)} {t(`unit.${a.unit}`)} {t("bx.in.loose")}</option>)}
        </select>
        {bulk && <>
          <input className="mk-input mk-input--num" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label={t("wm.qty")} />
          <button type="submit" className="mk-button">{t("bx.checkin")}</button>
        </>}
      </form>
      {which && (
        <UnitPicker tenantId={tenantId} articleId={which.article.id} serial={which.serial} skipBox={boxId} admin={admin} action={t("bx.checkin")}
          onPick={async (u) => { await m.checkIn(tenantId, boxId, { unitId: u.id }); setWhich(null); onDone(t("bx.in.done")); }} />
      )}
      {unknown && (
        <BindCard inline raw={unknown.raw} resolved={unknown.resolved}
          onBound={() => { const again = unknown.raw; setUnknown(null); void found(again); }} />
      )}
    </div>
  );
}

/** Take a part out: it is then with you; named with a workspace, it is reserved for it. */
function TakeOut({ tenantId, boxId, out, spaces, defaultSpace, run, onCancel }: {
  tenantId: string; boxId: string; out: Out; spaces: Space[]; defaultSpace: string;
  run: (fn: () => Promise<unknown>, done: string) => Promise<boolean>; onCancel: () => void;
}) {
  const { t } = useT();
  const [space, setSpace] = React.useState(defaultSpace);
  const [qty, setQty] = React.useState(1);
  return (
    <form className="mk-form mk-take" onSubmit={(e) => {
      e.preventDefault();
      void run(() => m.checkOut(tenantId, boxId, { ...(out.unitId ? { unitId: out.unitId } : { articleId: out.articleId, qty }), spaceId: space || undefined }),
        space ? t("bx.out.reserved") : t("bx.out.done"));
    }}>
      <strong>{t("bx.takeout")}: {out.name}</strong>
      {out.articleId && <input className="mk-input mk-input--num" type="number" min={1} max={out.max} value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label={t("wm.qty")} />}
      <select className="mk-select" value={space} onChange={(e) => setSpace(e.target.value)} aria-label={t("shell.space")}>
        <option value="">{t("bx.out.nows")}</option>
        {spaces.map((v) => <option key={v.id} value={v.id}>{t("bx.out.for", { name: v.name })}</option>)}
      </select>
      <button type="submit" className="mk-button">{t("bx.takeout")}</button>
      <button type="button" className="mk-button mk-button--ghost" onClick={onCancel}>{t("mt.cancel")}</button>
    </form>
  );
}

/** Into another box (scan its label, or type its code), or set down at a place. */
function MoveBox({ tenantId, box, run }: { tenantId: string; box: m.Box; run: (fn: () => Promise<unknown>, done: string) => Promise<boolean> }) {
  const { t } = useT();
  const [place, setPlace] = React.useState(box.parentId ? "" : box.location ?? "");
  const into = async (code: string) => {
    const r = await m.resolveCode(code);
    if (r.status !== "box" || r.tenantId !== tenantId) throw new Error(t("bx.move.notabox"));
    return m.moveBox(tenantId, box.id, { parentId: r.id });
  };
  return (
    <div className="mk-take">
      <p className="mk-muted">{t("bx.move.hint")}</p>
      <CameraScanner onFound={(code) => void run(() => into(code), t("bx.moved"))} />
      <form className="mk-form" onSubmit={(e) => { e.preventDefault(); void run(() => m.moveBox(tenantId, box.id, { parentId: null, location: place }), t("bx.moved")); }}>
        <input className="mk-input" placeholder={t("bx.move.place")} value={place} onChange={(e) => setPlace(e.target.value)} />
        <button type="submit" className="mk-button mk-button--ghost">{t("bx.move.set")}</button>
      </form>
    </div>
  );
}

export function EditBox({ tenantId, box, spaces, run, onSaved }: {
  tenantId: string; box?: m.Box; spaces: Space[];
  run: (fn: () => Promise<unknown>, done: string) => Promise<boolean>; onSaved?: (b: m.Box) => void;
}) {
  const { t } = useT();
  const [f, setF] = React.useState<Partial<m.Box>>(box ? { id: box.id, name: box.name, kind: box.kind, spaceId: box.spaceId ?? "", location: box.location ?? "", note: box.note ?? "" } : { kind: "box", spaceId: "" });
  const set = (k: keyof m.Box) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="mk-form mk-articleform" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => { const saved = await m.saveBox(tenantId, f); onSaved?.(saved); }, t("bx.saved"));
    }}>
      <input className="mk-input" required placeholder={t("bx.f.name")} value={f.name ?? ""} onChange={set("name")} />
      <select className="mk-select" value={f.kind} onChange={set("kind")} aria-label={t("bx.f.kind")}>
        {m.BOX_KINDS.map((k) => <option key={k} value={k}>{t(`bx.kind.${k}`)}</option>)}
      </select>
      <select className="mk-select" value={f.spaceId ?? ""} onChange={set("spaceId")} aria-label={t("shell.space")}>
        <option value="">{t("bx.f.nows")}</option>
        {spaces.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      {!box && <input className="mk-input" placeholder={t("bx.move.place")} value={f.location ?? ""} onChange={set("location")} />}
      <textarea className="mk-input" placeholder={t("mt.f.note")} value={f.note ?? ""} onChange={set("note")} rows={2} />
      <button type="submit" className="mk-button">{t("mt.save")}</button>
    </form>
  );
}

/** The box's links and files: firmware, CAD, schematics, datasheets, docs, repositories. */
function Artifacts({ tenantId, box, panel, setPanel, run }: {
  tenantId: string; box: m.BoxDetail["box"]; panel: string; setPanel: (p: "" | "link" | "file") => void;
  run: (fn: () => Promise<unknown>, done: string) => Promise<boolean>;
}) {
  const { t, date } = useT();
  const links = box.links ?? [];
  const files = box.files ?? [];
  const [kind, setKind] = React.useState<m.LinkKind>("firmware");
  const [url, setUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const file = React.useRef<HTMLInputElement>(null);
  const open = async (fileId: string) => {
    const got = await m.fileUrl(tenantId, box.id, fileId);
    window.location.assign(got.url);
  };
  return (
    <>
      <h2 className="mk-panel__sub">{t("bx.artifacts")}</h2>
      {!links.length && !files.length && <p className="mk-muted">{t("bx.artifacts.none")}</p>}
      <ul className="mk-boxlist">
        {links.map((l) => (
          <li key={l.id} className="mk-boxlist__row">
            <span><span className="mk-chip">{t(`bx.link.${l.kind}`)}</span> <a href={l.url} target="_blank" rel="noreferrer noopener">{l.title}</a></span>
            <button type="button" className="mk-button mk-button--ghost" aria-label={t("bx.remove")}
              onClick={() => { if (window.confirm(t("bx.remove.confirm", { name: l.title }))) void run(() => m.removeLink(tenantId, box.id, l.id), t("bx.removed")); }}>✕</button>
          </li>
        ))}
        {files.map((x) => (
          <li key={x.id} className="mk-boxlist__row">
            <span><span className="mk-chip">{t(`bx.link.${x.kind}`)}</span> <button type="button" className="mk-linkbutton" onClick={() => void open(x.id)}>{x.name}</button>
              <span className="mk-muted"> · {kb(x.size)} · {date(x.at)}</span></span>
            <button type="button" className="mk-button mk-button--ghost" aria-label={t("bx.remove")}
              onClick={() => { if (window.confirm(t("bx.remove.confirm", { name: x.name }))) void run(() => m.removeFile(tenantId, box.id, x.id), t("bx.removed")); }}>✕</button>
          </li>
        ))}
      </ul>
      <div className="mk-actions">
        <button type="button" className="mk-button mk-button--ghost" onClick={() => setPanel(panel === "link" ? "" : "link")}>{t("bx.addlink")}</button>
        <button type="button" className="mk-button mk-button--ghost" onClick={() => setPanel(panel === "file" ? "" : "file")}>{t("bx.addfile")}</button>
      </div>
      {(panel === "link" || panel === "file") && (
        <form className="mk-form" onSubmit={(e) => {
          e.preventDefault();
          if (panel === "link") void run(() => m.addLink(tenantId, box.id, { url, kind, title }), t("bx.linked")).then((done) => { if (done) { setUrl(""); setTitle(""); } });
          else {
            const chosen = file.current?.files?.[0];
            if (chosen) void run(() => m.uploadFile(tenantId, box.id, chosen, kind), t("bx.uploaded"));
          }
        }}>
          <select className="mk-select" value={kind} onChange={(e) => setKind(e.target.value as m.LinkKind)} aria-label={t("bx.f.kind")}>
            {m.LINK_KINDS.map((k) => <option key={k} value={k}>{t(`bx.link.${k}`)}</option>)}
          </select>
          {panel === "link" ? <>
            <input className="mk-input" type="url" required placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <input className="mk-input" placeholder={t("bx.f.title")} value={title} onChange={(e) => setTitle(e.target.value)} />
            <button type="submit" className="mk-button">{t("bx.addlink")}</button>
          </> : <>
            <input ref={file} className="mk-input" type="file" required />
            <button type="submit" className="mk-button">{t("bx.upload")}</button>
            <span className="mk-muted">{t("bx.upload.hint")}</span>
          </>}
        </form>
      )}
    </>
  );
}
