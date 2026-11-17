// materials (AppSync): `materials(op, args)` reads, `changeMaterials(op,
// args)` writes. One query and one mutation with an operation name, so the
// site and the edge speak the same small set of operations (store.ts) and the
// schema does not grow a field per verb.
//
// Who may do what (store.ts asks the Actor):
//   reads                                 anyone in the workspace (its admins, or a reader of one of its products)
//   reserve, release, consume, return     a reader of that product, or a workspace admin
//   move, install, flash, bind a code     anyone in the workspace (for a unit with a product: its readers)
//   the catalogue, receive, adjust,
//   retire, mint and unbind codes         the workspace's admins, with two-step sign-in

import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { claimsOf, tenantsOf } from "../shared/claims";
import { MfaRequired, requireMfa } from "../shared/mfa";
import { canRead, isAdminOf, readableSpaces } from "../shared/spaces";
import * as st from "../materials-shared/store";
import type { Step } from "../materials-shared/stock";

type Args = { op?: string; args?: string | Record<string, unknown> };

const ADMIN_OPS = new Set(["saveArticle", "receive", "adjust", "retire", "mintCodes", "unbindCode"]);

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  const { groups, userPoolId, username } = claimsOf(event.identity);
  if (!userPoolId) throw new Error("Unauthenticated");
  const claims = (event.identity as AppSyncIdentityCognito | undefined)?.claims ?? {};
  const op = String(event.arguments.op ?? "");
  const raw = event.arguments.args;
  const a: Record<string, any> = typeof raw === "string" ? JSON.parse(raw || "{}") : raw ?? {};   // eslint-disable-line @typescript-eslint/no-explicit-any
  const spaces = await readableSpaces(groups);
  const actor: st.Actor = {
    by: String(claims.email ?? username ?? "?"),
    tenants: new Set([...tenantsOf(groups), ...spaces.map((v) => v.tenantId)]),
    admin: (t) => isAdminOf(groups, t),
    usesSpace: (v) => canRead(groups, v),
  };
  const t = String(a.tenantId ?? "");
  try {
    if (ADMIN_OPS.has(op) || (op === "changeUnit" && a.retire)) await requireMfa(userPoolId, username);
    switch (op) {
      // reads
      case "workspaces": return [...actor.tenants].map((id) => ({
        id, name: spaces.find((v) => v.tenantId === id)?.tenantName ?? id, admin: actor.admin(id),
      }));
      case "articles": return await st.listArticles(actor, t, String(a.q ?? ""), String(a.category ?? ""));
      case "article": return await st.article(actor, t, String(a.id));
      case "unit": return await st.unit(actor, t, String(a.id));
      case "resolve": return await st.resolve(actor, String(a.code ?? ""));
      case "spaceMaterials": return await st.spaceMaterials(actor, String(a.spaceId));
      // the catalogue
      case "saveArticle": return await st.saveArticle(actor, t, a.article ?? {});
      case "receive": return await st.receive(actor, t, String(a.articleId), a);
      case "adjust": return await st.adjust(actor, t, String(a.articleId), Number(a.onHand), a.note);
      // a product takes from stock
      case "reserve": case "release": case "consume": case "return":
        return await st.step(actor, op as Step, String(a.spaceId), String(a.articleId), a);
      // units
      case "changeUnit": return await st.changeUnit(actor, t, String(a.unitId), a);
      // codes
      case "mintCodes": return await st.mintCodes(actor, t, Number(a.n));
      case "bindCode": return await st.bindCode(actor, t, String(a.code), String(a.kind), String(a.id));
      case "unbindCode": return await st.unbindCode(actor, t, String(a.code));
      default: throw new st.Refused(`No operation ${op}.`);
    }
  } catch (err) {
    if (err instanceof st.Refused || err instanceof st.BadCode || err instanceof MfaRequired) throw new Error(err.message);
    console.error("materials failed", { op, err });
    throw new Error("That did not work. Try again, or tell an operator.");
  }
};
