import { test } from "node:test";
import assert from "node:assert/strict";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { linkedAdmin } from "./linkedAdmin";

// An edge checks the intake in only for an admin with two-step sign-in (ADR-0022).

const SUB = "11111111-2222-3333-4444-555555555555";

function cognito(user: { enabled?: boolean; groups: string[]; mfa: boolean } | null) {
  const asked: string[] = [];
  CognitoIdentityProviderClient.prototype.send = (async (cmd: { constructor: { name: string } }) => {
    asked.push(cmd.constructor.name);
    switch (cmd.constructor.name) {
      case "ListUsersCommand": return { Users: user ? [{ Username: "u-1", Enabled: user.enabled ?? true }] : [] };
      case "AdminListGroupsForUserCommand": return { Groups: user!.groups.map((g) => ({ GroupName: g })) };
      case "AdminGetUserCommand": return { UserMFASettingList: user!.mfa ? ["SOFTWARE_TOKEN_MFA"] : [] };
    }
    throw new Error(cmd.constructor.name);
  }) as never;
  return asked;
}

test("an admin of the organisation with two-step sign-in", async () => {
  process.env.USER_POOL_ID = "eu-west-1_example";
  cognito({ groups: ["t-2222222222"], mfa: true });
  assert.equal(await linkedAdmin(SUB, "t-2222222222"), true);
});

test("not an admin, no two-step sign-in, turned off, gone, or no one", async () => {
  process.env.USER_POOL_ID = "eu-west-1_example";
  cognito({ groups: ["s-2222222222"], mfa: true });
  assert.equal(await linkedAdmin(SUB, "t-2222222222"), false, "a reader of a workspace only");
  cognito({ groups: ["t-2222222222"], mfa: false });
  assert.equal(await linkedAdmin(SUB, "t-2222222222"), false, "no two-step sign-in");
  cognito({ enabled: false, groups: ["t-2222222222"], mfa: true });
  assert.equal(await linkedAdmin(SUB, "t-2222222222"), false, "account turned off");
  cognito(null);
  assert.equal(await linkedAdmin(SUB, "t-2222222222"), false, "no such person");
  const asked = cognito({ groups: ["t-2222222222"], mfa: true });
  assert.equal(await linkedAdmin(undefined, "t-2222222222"), false, "an edge linked before the person was recorded");
  assert.equal(await linkedAdmin('x" or sub = "y', "t-2222222222"), false, "nothing but a sub reaches the filter");
  assert.deepEqual(asked, []);
});
