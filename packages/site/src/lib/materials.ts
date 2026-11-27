import { callApi } from "./data";

/**
 * A workspace's stock (ADR-0008 to ADR-0010 in maker-5-shared), through the
 * two operations of backend/amplify/functions/materials: `materials(op,
 * args)` reads, `changeMaterials(op, args)` writes. KEEP IN STEP by hand with
 * that handler's switch and materials-shared/store.ts, as for data.ts.
 */

export interface Article {
  tenantId: string; id: string; name: string; category: string; tracking: "bulk" | "serial"; unit: string;
  manufacturer?: string; mpn?: string; minStock?: number; location?: string; note?: string; datasheet?: string;
  /** Where it was bought (ADR-0023): "amazon.de:B0…". */
  supplierRefs?: string[];
  onHand: number; reserved: number; free: number; low?: boolean; boxed?: number;
  /** Proposed by an edge's BOM import, not accepted yet (ADR-0014). */
  proposed?: { by: string; at: string };
  /** Its documents (ADR-0024): invoices, delivery notes, service reports. */
  files?: ArticleFile[];
}
export interface ArticleFile { id: string; kind: LinkKind; name: string; size: number; type: string; sha256?: string; source?: string; at: string; by: string }
export interface Unit {
  tenantId: string; id: string; articleId: string; serial?: string; state: "in-stock" | "reserved" | "in-use" | "retired";
  spaceId?: string; parentId?: string; location?: string; articleName?: string;
  boxId?: string; boxName?: string; holder?: { by: string; at: string }; name?: string;
  firmware?: { name: string; version: string; at: string; by: string };
}
export interface Movement { sk: string; at: string; kind: string; articleId?: string; unitId?: string; spaceId?: string; boxId?: string; qty?: number; by: string; note?: string }

/** A box (ADR-0011 in maker-5-shared): it holds units, counted parts and other boxes, with links and files. */
export const BOX_KINDS = ["box", "bag", "folder", "drawer", "shelf", "cabinet", "bench"] as const;
export const LINK_KINDS = ["firmware", "cad", "schematic", "datasheet", "docs", "receipt", "repo", "other"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export interface BoxLink { id: string; kind: LinkKind; title: string; url: string; at: string; by: string }
export interface BoxFile { id: string; kind: LinkKind; name: string; size: number; type: string; at: string; by: string }
export interface Box {
  tenantId: string; id: string; name: string; kind: (typeof BOX_KINDS)[number];
  parentId?: string; parentName?: string; location?: string; spaceId?: string; note?: string;
  links?: BoxLink[] | number; files?: BoxFile[] | number; updatedAt?: string;
}
export interface BoxDetail {
  box: Box & { links?: BoxLink[]; files?: BoxFile[] };
  path: Array<{ id: string; name: string }>;
  space: { id: string; name: string } | null;
  boxes: Box[];
  units: Array<Unit & { codes: string[]; inside: Unit[] }>;
  lines: Array<{ articleId: string; qty: number; name?: string; unit: string }>;
  codes: CodeRow[];
  movements: Movement[];
}
export interface CodeRow { pk: string; kind: "m5" | "ean" | "qr" | "nfc"; value: string }
export interface StockWorkspace { id: string; name: string; admin: boolean }
/** A code as the site reads it; a GS1 code also names a serial number and a batch. */
export interface ReadCode { kind: string; value: string; serial?: string; batch?: string }
export type Resolved =
  | { status: "article" | "unit" | "box"; code: ReadCode; tenantId: string; id: string; articleId?: string; bySerial?: boolean }
  | { status: "blank"; code: ReadCode; tenantId: string; family?: Family }
  | { status: "unknown"; code: ReadCode };

const Q = `query Materials($op: String!, $args: AWSJSON) { materials(op: $op, args: $args) }`;
const M = `mutation ChangeMaterials($op: String!, $args: AWSJSON) { changeMaterials(op: $op, args: $args) }`;

const parse = <T,>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
async function read<T>(op: string, args: Record<string, unknown> = {}, quiet = false): Promise<T> {
  const r = await callApi<{ materials: unknown }>(Q, { op, args: JSON.stringify(args) }, { quiet });
  return parse<T>(r.materials);
}
async function change<T>(op: string, args: Record<string, unknown>): Promise<T> {
  const r = await callApi<{ changeMaterials: unknown }>(M, { op, args: JSON.stringify(args) });
  return parse<T>(r.changeMaterials);
}

export { CATEGORY_CODES as CATEGORIES } from "@dlab5/maker-5-core";
export const UNITS_OF = ["pcs", "m", "g", "ml", "set"] as const;

export const stockWorkspaces = () => read<StockWorkspace[]>("workspaces");
export const articles = (tenantId: string, q = "", category = "") => read<Article[]>("articles", { tenantId, q, category });
export const article = (tenantId: string, id: string) =>
  read<{ article: Article; units: Unit[]; allocations: Array<{ spaceId: string; reserved: number; consumed: number }>; movements: Movement[]; codes: CodeRow[];
    boxes: Array<{ boxId: string; qty: number; name?: string }> }>("article", { tenantId, id });
export const unit = (tenantId: string, id: string) =>
  read<{ unit: Unit; article: Article | null; parent: Unit | null; children: Unit[]; movements: Movement[]; codes: CodeRow[];
    space: { id: string; name: string } | null; box: { id: string; name: string } | null }>("unit", { tenantId, id });
export const resolveCode = (code: string) => read<Resolved>("resolve", { code });
export const spaceMaterials = (spaceId: string) =>
  read<{ space: { id: string; name: string; tenantId: string; tenantName?: string };
    lines: Array<{ articleId: string; reserved: number; consumed: number; article: Article | null; units: Unit[] }>; movements: Movement[] }>("spaceMaterials", { spaceId });

export const saveArticle = (tenantId: string, a: Partial<Article>) => change<Article>("saveArticle", { tenantId, article: a });
export const acceptArticle = (tenantId: string, id: string) => change<Article>("acceptArticle", { tenantId, id });
export const dropProposed = (tenantId: string, id: string) => change<{ deleted: string }>("dropProposed", { tenantId, id });
export const deleteArticle = (tenantId: string, id: string) =>
  change<{ deleted: string; units: number; boxes: number }>("deleteArticle", { tenantId, id });
export const receive = (tenantId: string, articleId: string, r: { qty?: number; units?: Array<{ serial?: string; location?: string }>; note?: string }) =>
  change<{ received: number; units: Unit[] }>("receive", { tenantId, articleId, ...r });
export const adjust = (tenantId: string, articleId: string, onHand: number, note?: string) => change("adjust", { tenantId, articleId, onHand, note });
export type Step = "reserve" | "release" | "consume" | "return";
export const step = (s: Step, spaceId: string, articleId: string, r: { qty?: number; unitId?: string; note?: string }) =>
  change<{ done: Step; qty: number }>(s, { spaceId, articleId, ...r });
export const changeUnit = (tenantId: string, unitId: string,
  ch: { location?: string; parentId?: string | null; firmware?: { name: string; version: string }; retire?: boolean; note?: string }) =>
  change("changeUnit", { tenantId, unitId, ...ch });
/** m5, the maker's parts, or dhc, devices a smart home can use (ADR-0022); printed as the label's mark. */
export type Family = "m5" | "dhc";
export const markOf = (f?: Family) => (f === "dhc" ? "DHC" : "M5");
export const mintCodes = (tenantId: string, n: number, family: Family = "m5") =>
  change<Array<{ code: string; url: string; family: Family }>>("mintCodes", { tenantId, n, family });
export const bindCode = (tenantId: string, code: string, kind: "article" | "unit" | "box", id: string) => change("bindCode", { tenantId, code, kind, id });

export const boxes = (tenantId: string, q = "", spaceId = "") => read<Box[]>("boxes", { tenantId, q, spaceId });
export const box = (tenantId: string, id: string) => read<BoxDetail>("box", { tenantId, id });

/** New boxes with their labels at once (an admin's): the names given, or n numbered "Box 01" on. */
export const makeBoxes = (tenantId: string, b: { names?: string[]; n?: number; prefix?: string; start?: number; kind: Box["kind"]; parentId?: string }) =>
  change<Array<{ id: string; name: string; kind: Box["kind"]; code: string }>>("makeBoxes", { tenantId, ...b });
export const saveBox = (tenantId: string, b: Partial<Box>) => change<Box>("saveBox", { tenantId, box: b });
export const moveBox = (tenantId: string, id: string, to: { parentId?: string | null; location?: string }) => change("moveBox", { tenantId, id, ...to });
export const deleteBox = (tenantId: string, id: string) => change("deleteBox", { tenantId, id });
export const checkIn = (tenantId: string, boxId: string, r: { unitId?: string; articleId?: string; qty?: number; note?: string }) =>
  change<{ in: string; qty?: number }>("checkIn", { tenantId, boxId, ...r });
export const checkOut = (tenantId: string, boxId: string, r: { unitId?: string; articleId?: string; qty?: number; spaceId?: string; note?: string }) =>
  change<{ out: string; qty?: number; reserved: boolean }>("checkOut", { tenantId, boxId, ...r });
export const addLink = (tenantId: string, boxId: string, link: { url: string; kind: LinkKind; title?: string }) => change<BoxLink>("addLink", { tenantId, boxId, link });
export const removeLink = (tenantId: string, boxId: string, linkId: string) => change("removeLink", { tenantId, boxId, linkId });
export const fileUrl = (tenantId: string, boxId: string, fileId: string) => change<{ url: string; name: string }>("fileUrl", { tenantId, boxId, fileId });
export const removeFile = (tenantId: string, boxId: string, fileId: string) => change("removeFile", { tenantId, boxId, fileId });
/** A part's documents (ADR-0024). */
export const articleFileUrl = (tenantId: string, articleId: string, fileId: string) =>
  change<{ url: string; name: string }>("articleFileUrl", { tenantId, articleId, fileId });
export const articleFileRemove = (tenantId: string, articleId: string, fileId: string) =>
  change("articleFileRemove", { tenantId, articleId, fileId });

/**
 * Upload one file to a box: ask for a short-lived URL, send the file straight
 * to storage, then record it. Up to 50 MB.
 */
export async function uploadFile(tenantId: string, boxId: string, file: File, kind: LinkKind) {
  const type = file.type || "application/octet-stream";
  const got = await change<{ fileId: string; url: string }>("uploadFile", { tenantId, boxId, name: file.name, size: file.size, type });
  const put = await fetch(got.url, { method: "PUT", body: file, headers: { "content-type": type } });
  if (!put.ok) throw new Error(`The upload failed (${put.status}).`);
  return change<BoxFile>("fileUploaded", { tenantId, boxId, fileId: got.fileId, name: file.name, type, kind });
}
export const unbindCode = (tenantId: string, code: string) => change("unbindCode", { tenantId, code });

/* -- the intake (ADR-0022): scanned at the shelf, described at the edge, checked in -- */

export type IntakeStatus = "new" | "described" | "checked-in" | "dropped";
export interface IntakeItem {
  tenantId: string; id: string; code: { kind: string; value: string }; family: Family;
  placeId?: string; placeName?: string; note?: string; qty?: number;
  photos: Array<{ id: string; type: string; size: number }>;
  status: IntakeStatus; at: string; by: string;
  known?: { kind: string; id: string; name?: string };
  suggestion?: { what: "device" | "box" | "bulk"; articleId?: string; article?: Partial<Article>; serial?: string; qty?: number; boxName?: string; orderLineId?: string };
  again?: boolean;
}
export const intake = (tenantId: string, status = "") => read<IntakeItem[]>("intake", { tenantId, status });
export const intakeAdd = (tenantId: string, r: { code: string; placeId: string; note?: string; qty?: number }) =>
  change<IntakeItem>("intakeAdd", { tenantId, ...r });
export const intakeDrop = (tenantId: string, id: string) => change("intakeDrop", { tenantId, id });
export type IntakeSuggestion = NonNullable<IntakeItem["suggestion"]> & { note?: string };
export const intakeGet = (tenantId: string, id: string) =>
  read<{ item: IntakeItem; photos: Array<{ id: string; url: string }>; article: Article | null }>("intakeGet", { tenantId, id });
export const intakeDescribe = (tenantId: string, id: string, suggestion: IntakeSuggestion) => change("intakeDescribe", { tenantId, id, suggestion });
/** An admin's, with two-step sign-in: makes the article, receives the stock, puts it in the place. */
export const intakeCheckIn = (tenantId: string, id: string, suggestion?: IntakeSuggestion) =>
  change<{ item: string; kind: "unit" | "box" | "article"; id: string; articleId?: string }>("intakeCheckIn", { tenantId, id, suggestion });

/* -- orders (ADR-0023): read from an order e-mail at the edge, expected until checked in -- */

export interface OrderLine {
  tenantId: string; id: string; supplier: string; orderRef: string; orderedAt?: string;
  title: string; sku?: string; qty: number; arrived: number; unitPrice?: number; currency?: string;
  what: "device" | "box" | "bulk"; articleId?: string; articleName?: string; article?: Partial<Article>;
  status: "open" | "arrived" | "dropped"; at: string; by: string;
}
export const orders = (tenantId: string, status = "open") => read<OrderLine[]>("orders", { tenantId, status });
export const orderDrop = (tenantId: string, id: string) => change("orderDrop", { tenantId, id });
/** A shop's page for an article it sells, when we know how to link it (Amazon's /dp/ pages). */
export function shopLink(ref: string): { label: string; href?: string } {
  const [shop, sku] = ref.split(":");
  return { label: `${shop} ${sku}`, href: /^amazon\.[a-z.]{2,6}$/.test(shop) && sku ? `https://www.${shop}/dp/${encodeURIComponent(sku)}` : undefined };
}

/** A photo for an item, shrunk in the browser to 1600 px at most, as JPEG, then sent straight to storage. */
export async function intakePhoto(tenantId: string, id: string, file: File) {
  const blob = await shrink(file, 1600);
  const got = await change<{ photoId: string; url: string }>("intakePhoto", { tenantId, id, type: "image/jpeg", size: blob.size });
  const put = await fetch(got.url, { method: "PUT", body: blob, headers: { "content-type": "image/jpeg" } });
  if (!put.ok) throw new Error(`The upload failed (${put.status}).`);
  return change("intakePhotoDone", { tenantId, id, photoId: got.photoId, type: "image/jpeg" });
}

async function shrink(file: File, max: number): Promise<Blob> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  img.close();
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("The photo could not be read."))), "image/jpeg", 0.82));
}

/**
 * The URL a label's QR and an NFC tag carry (ADR-0009): this site's own host,
 * in capitals for the QR's alphanumeric mode, so a label printed on stage
 * opens stage. Built without a window (a build), it names the production host.
 */
export const labelUrl = (code: string) =>
  `HTTPS://${(typeof window === "undefined" ? "maker5.cloud" : window.location.host).toUpperCase()}/T/${code}`;
/** Where one of our codes opens on this site, whatever host it is served from. */
export const cardHref = (code: string) => `/t/?c=${encodeURIComponent(code)}`;
export const unitHref = (tenantId: string, id: string) => `/t/?w=${tenantId}&u=${id}`;
export const boxHref = (tenantId: string, id: string) => `/t/?w=${tenantId}&x=${id}`;
