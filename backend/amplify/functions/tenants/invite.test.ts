import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEmail, ensureAccount, statusOf } from "./handler";

// Accounts are by invitation (ADR-0007 in maker-5-shared): an e-mail without
// an account gets one, and Cognito sends the invitation; an existing one is
// used as it is. Every address here is invented.

const fake = (existing: string[]) => {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  const via = async (cmd: unknown) => {
    const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
    sent.push({ name: c.constructor.name, input: c.input });
    if (c.constructor.name === "ListUsersCommand") {
      const e = String(c.input.Filter).match(/"(.*)"/)![1];
      return { Users: existing.includes(e) ? [{ Username: `u-${e}`, Attributes: [{ Name: "email", Value: e }] }] : [] };
    }
    return { User: { Username: `new-${String(c.input.Username)}`, UserStatus: "FORCE_CHANGE_PASSWORD", Enabled: true } };
  };
  return { sent, via };
};

test("an e-mail without an account is invited, verified", async () => {
  const f = fake([]);
  const got = await ensureAccount("pool", " Ada@Example.org ", f.via);
  assert.equal(got.invited, true);
  const create = f.sent.find((s) => s.name === "AdminCreateUserCommand")!;
  assert.equal(create.input.Username, "ada@example.org");
  assert.deepEqual(create.input.DesiredDeliveryMediums, ["EMAIL"]);
  assert.deepEqual(create.input.UserAttributes, [{ Name: "email", Value: "ada@example.org" }, { Name: "email_verified", Value: "true" }]);
  assert.equal(statusOf(got.user), "invited");
});

test("an existing account is used, never created again", async () => {
  const f = fake(["bob@example.org"]);
  const got = await ensureAccount("pool", "bob@example.org", f.via);
  assert.equal(got.invited, false);
  assert.ok(!f.sent.some((s) => s.name === "AdminCreateUserCommand"));
});

test("only an address is accepted, and it cannot break the filter", () => {
  for (const bad of ["", "bob", "bob@", "a@b", 'x"@example.org', "a b@example.org"]) {
    assert.throws(() => cleanEmail(bad), bad);
  }
  assert.equal(statusOf({ Enabled: false, UserStatus: "CONFIRMED" }), "disabled");
  assert.equal(statusOf({ Enabled: true, UserStatus: "CONFIRMED" }), "active");
});
