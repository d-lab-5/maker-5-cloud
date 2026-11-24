// Is the person who linked this edge an admin of its organisation, with
// two-step sign-in? Asked of Cognito each time, so a person removed from the
// admins, or one who turned two-step sign-in off, stops the edge too.
// Used for the one admin step an edge takes: checking in the intake (ADR-0022).

import { AdminListGroupsForUserCommand, CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { hasMfa } from "../shared/mfa";

const cognito = new CognitoIdentityProviderClient({});
const SUB = /^[0-9a-f-]{36}$/;

export async function linkedAdmin(sub: string | undefined, tenantId: string): Promise<boolean> {
  const pool = process.env.USER_POOL_ID;
  if (!pool || !sub || !SUB.test(sub)) return false;
  const found = await cognito.send(new ListUsersCommand({ UserPoolId: pool, Filter: `sub = "${sub}"`, Limit: 1 }));
  const user = found.Users?.[0];
  if (!user?.Username || user.Enabled === false) return false;
  const groups = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: pool, Username: user.Username, Limit: 60 }));
  if (!(groups.Groups ?? []).some((g) => g.GroupName === tenantId)) return false;
  return hasMfa(pool, user.Username);
}
