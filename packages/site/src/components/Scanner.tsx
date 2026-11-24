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
  const stop = React.useRef<() => void>(() => undefined);
  React.useEffect(() => () => stop.current(), []);
  // auto: the camera is on as soon as it is shown (the intake's scan after scan)
  React.useEffect(() => { if (auto) void start(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setError("");
    try {
      if (window.BarcodeDetector) {
        const supported = (await window.BarcodeDetector.getSupportedFormats?.()) ?? FORMATS;
        const det = new window.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
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
        const { BrowserMultiFormatReader } = await import("@zxing/library");
        const reader = new BrowserMultiFormatReader();
        stop.current = () => reader.reset();
        setState("on");
        await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current!, (result) => {
          if (result) { reader.reset(); setState("idle"); onFound(result.getText(), "camera"); }
        });
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
        <button type="button" className="mk-button mk-button--ghost" onClick={() => { stop.current(); setState("idle"); }}>{t("sc.stop")}</button>
      )}
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
