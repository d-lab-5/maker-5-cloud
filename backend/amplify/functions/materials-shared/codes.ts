// Codes and tags (ADR-0009 in maker-5-shared).
//
// OUR code is six characters of Crockford base32, minted in batches and
// printed before it is bound to anything. A label's QR holds
//
//     HTTPS://MAKER5.CLOUD/T/K7Q2M9      (the host of the site that printed it)
//
// in capitals, so the QR uses its alphanumeric mode and fits version 2 at
// error correction L (25 modules: about 8 mm on an SD card). An NFC tag holds
// the same URL in lower case. Every host of this site is accepted back:
// maker5.cloud and its subdomains (stage), Amplify's branch hosts, localhost,
// and maker-5.cloud, which the first labels carried.
//
// EXISTING codes are aliases of an article or a unit: a GTIN/EAN from the
// box, a manufacturer's QR (its text, or a hash of it when long), an NFC
// tag's UID. Each is unique within a workspace (tenant); our own codes are
// unique on the site, because the URL names no workspace.

import { createHash, randomInt } from "node:crypto";

/** Crockford base32: no I, L, O, U. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const OWN = /^[0-9A-HJKMNP-TV-Z]{6}$/;
export const LABEL_HOST = "MAKER5.CLOUD";

export type CodeKind = "m5" | "ean" | "qr" | "nfc";
export interface Code { kind: CodeKind; value: string }

export class BadCode extends Error {}

export const mintOwn = (): string => Array.from({ length: 6 }, () => CROCKFORD[randomInt(32)]).join("");

/** Read as Crockford does: O→0, I and L→1, lower case is upper case. */
export function crockford(s: string): string {
  return s.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** The URL printed on a label and written to a tag. */
export const labelUrl = (code: string, host = LABEL_HOST) => `HTTPS://${host.toUpperCase()}/T/${code}`;

/** GS1 check digit over the first n−1 digits of an 8-, 12-, 13- or 14-digit code. */
export function gtinValid(digits: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return false;
  const body = digits.slice(0, -1).split("").reverse();
  const sum = body.reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/** A GTIN as 14 digits, so the EAN-13 and the GTIN-14 of a box with one item compare equal. */
export const gtin14 = (digits: string) => digits.padStart(14, "0");

const OUR_URL = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:maker5\.cloud|maker-5\.cloud|amplifyapp\.com)\/t\/([0-9a-z]{6})\/?$/i;
const LOCAL_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/t\/([0-9a-z]{6})\/?$/i;

/**
 * What a scanned or typed code is. `nfc:` prefixes a tag's UID (the page adds
 * it); anything else that is no code of ours and no valid GTIN is a QR's text.
 */
export function normalise(raw: string): Code {
  const s = String(raw ?? "").trim();
  if (!s) throw new BadCode("The code is empty.");
  const url = OUR_URL.exec(s) ?? LOCAL_URL.exec(s);
  if (url) return { kind: "m5", value: crockford(url[1]) };
  if (OWN.test(crockford(s)) && s.length === 6) return { kind: "m5", value: crockford(s) };
  const nfc = /^nfc:\s*((?:[0-9a-f]{2}[:\-\s]?){4,10})$/i.exec(s);
  if (nfc) return { kind: "nfc", value: nfc[1].replace(/[:\-\s]/g, "").toUpperCase() };
  const digits = s.replace(/[\s-]/g, "");
  if (/^\d+$/.test(digits)) {
    if (gtinValid(digits)) return { kind: "ean", value: gtin14(digits) };
    if (digits.length >= 8 && digits.length <= 14) throw new BadCode("Those digits are no valid EAN/GTIN: the check digit does not match.");
  }
  if (s.length > 4096) throw new BadCode("That code is too long to keep.");
  // long QR text (a URL with a token, a vCard) is kept as its hash
  return { kind: "qr", value: s.length <= 120 ? s : `sha256:${createHash("sha256").update(s).digest("hex")}` };
}

/** The table key: our codes for the whole site, aliases within a workspace. */
export const codeKey = (c: Code, tenantId: string) => (c.kind === "m5" ? `m5:${c.value}` : `${tenantId}#${c.kind}:${c.value}`);
