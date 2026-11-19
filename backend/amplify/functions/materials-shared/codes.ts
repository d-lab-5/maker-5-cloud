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
//
// A GTIN names a PRODUCT, not one item: every box of the same board has the
// same EAN, so an EAN is always an alias of an article. GS1 codes (the
// DataMatrix or GS1-128 on boards, modules and reels, and GS1 Digital Link
// URLs) carry the GTIN together with a serial number (AI 21) and a batch
// (AI 10): the GTIN finds the article, the serial the unit.

import { createHash, randomInt } from "node:crypto";

/** Crockford base32: no I, L, O, U. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const OWN = /^[0-9A-HJKMNP-TV-Z]{6}$/;
export const LABEL_HOST = "MAKER5.CLOUD";

export type CodeKind = "m5" | "ean" | "qr" | "nfc";
/** A code; a GS1 code also carries the serial number and batch it names, beside its GTIN. */
export interface Code { kind: CodeKind; value: string; serial?: string; batch?: string }

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

/* GS1 application identifiers: the fixed-length ones by length, the rest end at a GS or the end. */
const GS = "\u001d";
const AI_FIXED: Record<string, number> = { "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 };
const AI_VAR2 = new Set(["10", "21", "22", "30", "37", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99"]);
const AI_VAR3 = new Set(["240", "241", "242", "250", "251", "400", "401", "403", "420", "421"]);

/** The fields of a GS1 element string, or null when it is not one. */
function elements(s: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) { i++; continue; }
    const two = s.slice(i, i + 2);
    const four = s.slice(i, i + 4);
    let ai: string; let len = 0;
    if (AI_FIXED[two]) { ai = two; len = AI_FIXED[two]; }
    else if (AI_VAR2.has(two)) ai = two;
    else if (AI_VAR3.has(s.slice(i, i + 3))) ai = s.slice(i, i + 3);
    else if (/^3[1-6]\d\d$/.test(four)) { ai = four; len = 6; }   // measures: weight, length…
    else return Object.keys(out).length ? out : null;
    i += ai.length;
    let value: string;
    if (len) { value = s.slice(i, i + len); if (value.length < len) return null; i += len; }
    else { const end = s.indexOf(GS, i); value = s.slice(i, end < 0 ? s.length : end); i = end < 0 ? s.length : end + 1; }
    if (!value || value.length > 30) return null;
    out[ai] = value;
  }
  return out;
}

/**
 * A GS1 code read as GTIN, serial and batch: a DataMatrix or GS1-128 (as the
 * scanner gives it, with GS separators and maybe a symbology prefix), the
 * printed form "(01)…(21)…", or a GS1 Digital Link URL (…/01/<gtin>/21/<serial>).
 */
export function gs1(raw: string): { gtin: string; serial?: string; batch?: string } | null {
  let s = raw.trim();
  const link = /^https?:\/\/[^/]+(?:\/[^?#]*)?\/01\/(\d{8,14})((?:\/(?:21|10|22|235)\/[^/?#]+)*)/i.exec(s);
  if (link) {
    const rest: Record<string, string> = {};
    const parts = link[2].split("/").filter(Boolean);
    for (let k = 0; k + 1 < parts.length; k += 2) rest[parts[k]] = decodeURIComponent(parts[k + 1]);
    return gtinValid(link[1]) ? { gtin: gtin14(link[1]), serial: rest["21"], batch: rest["10"] } : null;
  }
  const prefixed = /^\][dCQe]\d/.test(s);
  if (prefixed) s = s.slice(3);
  let f: Record<string, string> | null = null;
  if (/^\(\d{2,4}\)/.test(s)) {
    f = {};
    for (const m of s.matchAll(/\((\d{2,4})\)([^(]+)/g)) f[m[1]] = m[2].trim();
  } else if (prefixed || s.includes(GS) || /^01\d{14}\d{2}/.test(s)) {
    f = elements(s);
  }
  const gtin = f?.["01"] ?? f?.["02"];
  if (!gtin || !gtinValid(gtin)) return null;
  return { gtin: gtin14(gtin), ...(f!["21"] ? { serial: f!["21"] } : {}), ...(f!["10"] ? { batch: f!["10"] } : {}) };
}

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
  const g = gs1(s);
  if (g) return { kind: "ean", value: g.gtin, ...(g.serial ? { serial: g.serial } : {}), ...(g.batch ? { batch: g.batch } : {}) };
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
