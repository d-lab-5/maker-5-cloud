import * as React from "react";
import { useT } from "../lib/i18n";

/**
 * Reads a code with the phone's camera, or an NFC tag (ADR-0009 in
 * maker-5-shared). The camera uses the browser's BarcodeDetector where there
 * is one (Chrome on Android), and otherwise @zxing/library, bundled (iPhone,
 * Firefox). NFC uses Web NFC (Chrome on Android only); a tag's URL record is
 * reported as the URL, a tag without one by its serial number as nfc:<uid>.
 * On an iPhone the system reads our tags by itself: holding the phone to one
 * opens its card.
 */

type Found = (raw: string, how: "camera" | "nfc") => void;

/**
 * What the camera is asked for. Left to itself a phone's browser often gives
 * 640×480 with fixed focus: a large label reads, a small one (17 mm, the
 * smallbox sheet) is a few pixels a module and does not. The camera app reads
 * it because it films at full size, focuses all the time and zooms close.
 */
const VIDEO: MediaTrackConstraints = {
  facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 },
};
type Caps = MediaTrackCapabilities & { zoom?: { min: number; max: number }; focusMode?: string[] };

/** Focus all the time where the camera can; the zoom it offers, if any. */
async function tune(track: MediaStreamTrack): Promise<{ min: number; max: number } | null> {
  const caps = (track.getCapabilities?.() ?? {}) as Caps;
  try {
    if (caps.focusMode?.includes("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
  } catch { /* not this camera */ }
  return caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
}

const FORMATS = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "data_matrix"];

interface Detector { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
declare global {
  interface Window {
    BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
    NDEFReader?: new () => {
      scan(o?: { signal?: AbortSignal }): Promise<void>;
      write(m: unknown, o?: { overwrite?: boolean; signal?: AbortSignal }): Promise<void>;
      makeReadOnly?(o?: { signal?: AbortSignal }): Promise<void>;
      onreading: ((e: { serialNumber: string; message: { records: Array<{ recordType: string; data?: DataView }> } }) => void) | null;
      onreadingerror: (() => void) | null;
    };
  }
}

export const hasNfc = () => typeof window !== "undefined" && "NDEFReader" in window;

export function CameraScanner({ onFound, auto = false }: { onFound: Found; auto?: boolean }) {
  const { t } = useT();
  const video = React.useRef<HTMLVideoElement>(null);
  const [state, setState] = React.useState<"idle" | "on" | "error">("idle");
  const [error, setError] = React.useState("");
  const [zoom, setZoom] = React.useState<{ min: number; max: number; at: number } | null>(null);
  const track = React.useRef<MediaStreamTrack | null>(null);
  const stop = React.useRef<() => void>(() => undefined);
  React.useEffect(() => () => stop.current(), []);
  // auto: the camera is on as soon as it is shown (the intake's scan after scan)
  React.useEffect(() => { if (auto) void start(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const zoomTo = async (at: number) => {
    const tr = track.current;
    if (!tr || !zoom) return;
    try { await tr.applyConstraints({ advanced: [{ zoom: at } as MediaTrackConstraintSet] }); setZoom({ ...zoom, at }); } catch { /* not now */ }
  };
  const ready = async (stream: MediaStream) => {
    const tr = stream.getVideoTracks()[0] ?? null;
    track.current = tr;
    const z = tr ? await tune(tr) : null;
    const now = (tr?.getSettings?.() as { zoom?: number } | undefined)?.zoom ?? z?.min ?? 1;
    setZoom(z ? { ...z, at: now } : null);
  };

  const start = async () => {
    setError("");
    try {
      if (window.BarcodeDetector) {
        const supported = (await window.BarcodeDetector.getSupportedFormats?.()) ?? FORMATS;
        const det = new window.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
        const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        await ready(stream);
        let on = true;
        stop.current = () => { on = false; stream.getTracks().forEach((x) => x.stop()); };
        setState("on");
        const tick = async () => {
          if (!on) return;
          try {
            const got = await det.detect(v);
            if (got[0]?.rawValue) { stop.current(); setState("idle"); onFound(got[0].rawValue, "camera"); return; }
          } catch { /* a frame that could not be read */ }
          window.setTimeout(() => void tick(), 180);
        };
        void tick();
      } else {
        const { BrowserMultiFormatReader, DecodeHintType } = await import("@zxing/library");
        const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
        const reader = new BrowserMultiFormatReader(hints, 150);
        stop.current = () => reader.reset();
        setState("on");
        await reader.decodeFromConstraints({ video: VIDEO, audio: false }, video.current!, (result) => {
          if (result) { reader.reset(); setState("idle"); onFound(result.getText(), "camera"); }
        });
        const s = video.current?.srcObject;
        if (s instanceof MediaStream) await ready(s);
      }
    } catch (e) {
      stop.current();
      setState("error");
      setError(e instanceof Error && e.name === "NotAllowedError" ? t("sc.denied") : t("sc.nocamera"));
    }
  };

  return (
    <div className="mk-scanner">
      <video ref={video} className="mk-scanner__video" playsInline muted hidden={state !== "on"} />
      {state !== "on" ? (
        <button type="button" className="mk-button" onClick={() => void start()}>{t("sc.camera")}</button>
      ) : (
        <span className="mk-actions">
          <button type="button" className="mk-button mk-button--ghost" onClick={() => { stop.current(); setState("idle"); }}>{t("sc.stop")}</button>
          {zoom && (
            // a small label: zoom in and hold the phone a hand away, where it can focus
            <button type="button" className="mk-button mk-button--ghost" aria-pressed={zoom.at > zoom.min}
              onClick={() => void zoomTo(zoom.at > zoom.min ? zoom.min : Math.min(zoom.max, Math.max(zoom.min, 2.5)))}>
              {zoom.at > zoom.min ? t("sc.zoomOut") : t("sc.zoomIn")}</button>
          )}
        </span>
      )}
      {state === "on" && zoom && <p className="mk-muted">{t("sc.smallHint")}</p>}
      {error && <p className="mk-error" role="alert">{error}</p>}
    </div>
  );
}

export function NfcReader({ onFound }: { onFound: Found }) {
  const { t } = useT();
  const [on, setOn] = React.useState(false);
  const [error, setError] = React.useState("");
  const abort = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => abort.current?.abort(), []);
  if (!hasNfc()) return <p className="mk-muted">{t("sc.nonfc")}</p>;
  const start = async () => {
    setError("");
    try {
      const r = new window.NDEFReader!();
      abort.current = new AbortController();
      await r.scan({ signal: abort.current.signal });
      setOn(true);
      r.onreading = (e) => {
        const url = e.message.records.find((x) => x.recordType === "url" && x.data);
        abort.current?.abort(); setOn(false);
        onFound(url ? new TextDecoder().decode(url.data) : `nfc:${e.serialNumber}`, "nfc");
      };
      r.onreadingerror = () => setError(t("sc.nfcunread"));
    } catch {
      setError(t("sc.nfcdenied"));
    }
  };
  return (
    <div>
      <button type="button" className="mk-button mk-button--ghost" disabled={on} onClick={() => void start()}>
        {on ? t("sc.nfcwaiting") : t("sc.nfc")}
      </button>
      {error && <p className="mk-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * Write one of our codes to an NFC tag, and lock it so it cannot be changed
 * later (as DHC's portal does). Locking is asked for separately: it cannot be
 * undone.
 */
export async function writeTag(url: string, lock: boolean): Promise<void> {
  const w = new window.NDEFReader!();
  await w.write({ records: [{ recordType: "url", data: url.toLowerCase() }] }, { overwrite: true });
  if (lock && w.makeReadOnly) await w.makeReadOnly();
}
