// The edge side of the stock (ADR-0010 in maker-5-shared). An edge works for
// the one workspace it was linked to: it reads the catalogue and units, and
// reserves, releases and returns parts for that workspace's products. It
// never edits the catalogue, receives stock or mints codes: a person does,
// on the site. Every step is logged as edge:<id>.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { extractBearer, json, parseJsonBody, versionGate } from "../edge-shared/http";
import { verifyDeviceToken } from "../edge-shared/registry";
import * as st from "../materials-shared/store";

type Body = { q?: string; category?: string; id?: string; code?: string; spaceId?: string; articleId?: string;
  qty?: number; unitId?: string; note?: string; articles?: unknown };

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const tooOld = versionGate(event);
  if (tooOld) return tooOld;
  const verified = await verifyDeviceToken(extractBearer(event));
  if (!verified.ok) {
    return verified.reason === "revoked" ? json(410, { error: "revoked" }) : json(401, { error: "invalid_token" });
  }
  const tenant = verified.row.tenant_id;
  if (!tenant) return json(403, { error: "no_tenant", message: "this edge belongs to no tenant yet; link it again" });
  const actor: st.Actor = {
    by: `edge:${verified.row.edge_id}`,
    tenants: new Set([tenant]),
    admin: () => false,
    usesSpace: (v) => v.tenantId === tenant,
  };
  const b = parseJsonBody<Body>(event) || {};
  const route = event.rawPath.replace(/^.*\/materials\//, "");
  try {
    switch (route) {
      case "list": return json(200, { articles: await st.listArticles(actor, tenant, b.q ?? "", b.category ?? "") });
      case "get": return json(200, await st.article(actor, tenant, String(b.id ?? "")));
      case "categories": return json(200, { categories: await st.categories(actor, tenant) });
      case "idle": return json(200, { parts: await st.idle(actor, tenant, b.category ?? "") });
      case "unit": return json(200, await st.unit(actor, tenant, String(b.id ?? "")));
      case "resolve": return json(200, await st.resolve(actor, String(b.code ?? "")));
      case "product": return json(200, await st.spaceMaterials(actor, String(b.spaceId ?? "")));
      // boxes, read only: the bench asks where a part is and where its files are
      case "boxes": return json(200, { boxes: await st.listBoxes(actor, tenant, String(b.q ?? ""), String(b.spaceId ?? "")) });
      case "box": {
        const { box, ...rest } = await st.box(actor, tenant, String(b.id ?? ""));
        return json(200, { ...rest, box: { ...box, files: (box.files ?? []).map(({ id, name, kind, size }) => ({ id, name, kind, size })) } });
      }
      // a BOM import proposes the articles it needs; an admin accepts them (ADR-0014)
      case "propose": return json(200, await st.proposeArticles(actor, tenant, b.articles));
      case "reserve": case "release": case "return":
        return json(200, await st.step(actor, route, String(b.spaceId ?? ""), String(b.articleId ?? ""), b));
      default: return json(404, { error: "not_found" });
    }
  } catch (err) {
    if (err instanceof st.Refused || err instanceof st.BadCode) return json(422, { error: "refused", message: err.message });
    console.error("edgeMaterials failed", { edge: verified.row.edge_id, err });
    return json(500, { error: "server_error" });
  }
};
