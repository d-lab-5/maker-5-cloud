// Documents of a part (ADR-0024 in maker-5-shared): the invoice, the delivery
// note, the service report or the datasheet that came with it, kept privately
// for the organisation. An edge reads a supplier's e-mail, uploads each
// attachment once and attaches it to every article (or expected order line)
// it concerns; a check-in moves a line's documents onto its article. They
// carry the buyer's address and customer number: never in a public repository.
//
// The rules are here, without the tables and the bucket, so they are tested
// on their own.

import { LINK_KINDS, MAX_FILE_BYTES, Refused, fileName } from "./stock";

export const MAX_DOCS = 20;             // on one article or order line
export const DOC_ID = /^[0-9a-f]{12}$/;
export const SHA256 = /^[0-9a-f]{64}$/;

export interface DocFile {
  id: string; kind: (typeof LINK_KINDS)[number]; name: string; size: number; type: string;
  /** The file's sha256: the same document is kept once. */
  sha256?: string;
  /** Where it came from: "elv.de EX000001". */
  source?: string;
  at: string; by: string;
}

/** A document about to be uploaded: its name, size, type, kind, hash and source. */
export function docFields(f: Record<string, unknown>) {
  const size = Number(f.size);
  if (!Number.isInteger(size) || size < 1 || size > MAX_FILE_BYTES) throw new Refused("A document is up to 50 MB.");
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(String(f.type ?? "")) ? String(f.type).slice(0, 100) : "application/octet-stream";
  const kind = String(f.kind ?? "receipt");
  if (!(LINK_KINDS as readonly string[]).includes(kind)) throw new Refused(`No document kind ${kind}.`);
  const sha256 = f.sha256 ? String(f.sha256).toLowerCase() : undefined;
  if (sha256 && !SHA256.test(sha256)) throw new Refused("A document's hash is its sha256 in hex.");
  const source = String(f.source ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, 80) || undefined;
  return { name: fileName(f.name), size, type, kind: kind as DocFile["kind"], sha256, source };
}

/** The same document twice: the same id, or the same content. */
export const sameDoc = (a: Pick<DocFile, "id" | "sha256">, b: Pick<DocFile, "id" | "sha256">) =>
  a.id === b.id || Boolean(a.sha256 && a.sha256 === b.sha256);

/** had and more, each document once, at most MAX_DOCS; what is new is `added`. */
export function withDocs(had: DocFile[] | undefined, more: DocFile[]) {
  const list = [...(had ?? [])];
  const added: DocFile[] = [];
  for (const d of more) {
    if (list.some((x) => sameDoc(x, d))) continue;
    if (list.length >= MAX_DOCS) throw new Refused(`A part keeps at most ${MAX_DOCS} documents.`);
    list.push(d);
    added.push(d);
  }
  return { list, added };
}
