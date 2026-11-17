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
  onHand: number; reserved: number; free: number; low?: boolean;
}
export interface Unit {
  tenantId: string; id: string; articleId: string; serial?: string; state: "in-stock" | "reserved" | "in-use" | "retired";
  spaceId?: string; parentId?: string; location?: string; articleName?: string;
  firmware?: { name: string; version: string; at: string; by: string };
}
export interface Movement { sk: string; at: string; kind: string; articleId?: string; unitId?: string; spaceId?: string; qty?: number; by: string; note?: string }
export interface CodeRow { pk: string; kind: "m5" | "ean" | "qr" | "nfc"; value: string }
export interface StockWorkspace { id: string; name: string; admin: boolean }
export type Resolved =
  | { status: "article" | "unit"; code: { kind: string; value: string }; tenantId: string; id: string }
  | { status: "blank"; code: { kind: string; value: string }; tenantId: string }
  | { status: "unknown"; code: { kind: string; value: string } };

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

export const CATEGORIES = ["compute", "storage", "electronic", "mechanical", "cable", "consumable", "tool", "other"] as const;
export const UNITS_OF = ["pcs", "m", "g", "ml", "set"] as const;

export const stockWorkspaces = () => read<StockWorkspace[]>("workspaces");
export const articles = (tenantId: string, q = "", category = "") => read<Article[]>("articles", { tenantId, q, category });
export const article = (tenantId: string, id: string) =>
  read<{ article: Article; units: Unit[]; allocations: Array<{ spaceId: string; reserved: number; consumed: number }>; movements: Movement[]; codes: CodeRow[] }>("article", { tenantId, id });
export const unit = (tenantId: string, id: string) =>
  read<{ unit: Unit; article: Article | null; parent: Unit | null; children: Unit[]; movements: Movement[]; codes: CodeRow[]; space: { id: string; name: string } | null }>("unit", { tenantId, id });
export const resolveCode = (code: string) => read<Resolved>("resolve", { code });
export const spaceMaterials = (spaceId: string) =>
  read<{ space: { id: string; name: string; tenantId: string; tenantName?: string };
    lines: Array<{ articleId: string; reserved: number; consumed: number; article: Article | null; units: Unit[] }>; movements: Movement[] }>("spaceMaterials", { spaceId });

export const saveArticle = (tenantId: string, a: Partial<Article>) => change<Article>("saveArticle", { tenantId, article: a });
export const receive = (tenantId: string, articleId: string, r: { qty?: number; units?: Array<{ serial?: string; location?: string }>; note?: string }) =>
  change<{ received: number; units: Unit[] }>("receive", { tenantId, articleId, ...r });
export const adjust = (tenantId: string, articleId: string, onHand: number, note?: string) => change("adjust", { tenantId, articleId, onHand, note });
export type Step = "reserve" | "release" | "consume" | "return";
export const step = (s: Step, spaceId: string, articleId: string, r: { qty?: number; unitId?: string; note?: string }) =>
  change<{ done: Step; qty: number }>(s, { spaceId, articleId, ...r });
export const changeUnit = (tenantId: string, unitId: string,
  ch: { location?: string; parentId?: string | null; firmware?: { name: string; version: string }; retire?: boolean; note?: string }) =>
  change("changeUnit", { tenantId, unitId, ...ch });
export const mintCodes = (tenantId: string, n: number) => change<Array<{ code: string; url: string }>>("mintCodes", { tenantId, n });
export const bindCode = (tenantId: string, code: string, kind: "article" | "unit", id: string) => change("bindCode", { tenantId, code, kind, id });
export const unbindCode = (tenantId: string, code: string) => change("unbindCode", { tenantId, code });

/** The URL a label's QR and an NFC tag carry (ADR-0009): capitals, for the QR's alphanumeric mode. */
export const labelUrl = (code: string) => `HTTPS://MAKER-5.CLOUD/T/${code}`;
/** Where one of our codes opens on this site, whatever host it is served from. */
export const cardHref = (code: string) => `/t/?c=${encodeURIComponent(code)}`;
export const unitHref = (tenantId: string, id: string) => `/t/?w=${tenantId}&u=${id}`;
