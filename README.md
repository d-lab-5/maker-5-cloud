# Maker-5 cloud

Cloud lifecycle portal and semantic graph engine for **Maker-5**, at
**maker-5.cloud**. It orchestrates hardware and software product design with
human-in-the-loop AI agents.

The portal manages your product portfolio, system blueprints, architecture
decisions and AI agent proposals in one semantic graph. Agents analyse
requirements and propose changes, and a person reviews and approves every
step. It is the cloud half of Maker-5. The local half is
[maker-5-edge](https://github.com/d-lab-5/maker-5-edge), which runs on a
workstation or lab bench. The decisions, roadmap and ontology reference are at
[maker-5-shared](https://github.com/d-lab-5/maker-5-shared), published at
https://docs.dlab5.net/d-lab-5/maker-5/.

In this repository a **workspace** is a tenant and a **product** is a space.
Each product's knowledge is an RDF A-Box, checked against the Maker-5 T-Box
and SHACL shapes in [`packages/ontology`](packages/ontology). The shapes link
hardware blocks, interfaces, software modules and agent proposals, using
SysML v2, PROV-O and SPDX.

Made from [template-dlab5-cloud](https://github.com/d-lab-5/template-dlab5-cloud).
Its decisions, which this product inherits, are in [`docs/adr/`](docs/adr/).

## What you get

| | |
|---|---|
| **Auth** | Cognito user pool, no guest tier, no self-signup, admin-created accounts with the new-password challenge handled. One gate at the root, so a new page cannot be unprotected. |
| **Tenancy** | `Tenant` and `Space`, each a Cognito group named like its minted id (`t-…` admins, `s-…` readers), created by one function together with its rows. Operators create tenants and read no content. Two-step sign-in for admins and operators. ADR-0005. |
| **Data** | A space's content is an object in S3 behind the proxy; what a tenant knows is an RDF A-Box per space, validated against SHACL shapes (`packages/ontology`) and versioned. ADR-0004, ADR-0007. |
| **Edges** | The RFC 8628 device flow of DigitalHome's edges: an edge shows a code, a tenant admin approves it on `/link`, the edge gets a revocable token for that tenant. A version gate (426), A-Box sync, model downloads, and installers offered from Settings. ADR-0006, [`docs/specs/edge-cloud-api.md`](docs/specs/edge-cloud-api.md). |
| **Storage** | An `objectProxy` Lambda that is the real authorization boundary, hands back presigned GETs, and enforces an `If-Match` precondition on every write. |
| **Frontend** | One shell component, a collapsible rail with a placeholder menu, a light/dark theme with no flash on load, a token palette defined in both themes, English/German/French (`packages/i18n`), security headers (`customHttp.yml`), and Settings for tenants, members, edges and two-step sign-in. |
| **Build** | An `amplify.yml` whose comments encode why every line is the way it is. The build passes with no backend deployed. |
| **Dev loop** | `npm run demo` — a guided menu that checks the environment, deploys a sandbox, makes a demo user and starts the dev server. `npm run dev` is the same without the menu. |
| **Tests** | `node --test` over `packages/core`, `packages/i18n` and `packages/ontology`; `tsx --test` over the backend functions (version gate, token expiry, tenant codes, A-Box validation); `verify-auth.mjs` for the live sign-in path. |

## Getting started

```bash
nvm use                                        # Node 22
npm install && npm --prefix backend install    # separate trees — ADR-0001
npm run demo                                   # guided menu — start here
```

`npm run demo` checks your environment first (Node, dependencies, AWS
credentials, region, file watchers) and prints the fix for anything missing,
rather than failing four minutes into a deploy. Then it offers:

```
  1  Create sandbox  — deploy, make the demo user, start the dev server
  2  Delete sandbox           (no sandbox to delete)
  3  Start dev server only    (deploy one first)
  0  Exit
```

Options that cannot work yet are dimmed and say why. Creating the sandbox also
provisions an account you can sign in as straight away:

| | |
|---|---|
| email | `demo-user@example.com` |
| password | `Demo-user$1` |

Both are shaped by Cognito, not by preference: the username must be an email
(the pool signs in by email), and the password needs an uppercase letter (the
pool's default policy wants upper, lower, digit and symbol). Override with
`DEMO_EMAIL` / `DEMO_PASSWORD`.

Once you know the ropes, `npm run dev` is the same thing without the menu — it
deploys the sandbox, wires its outputs into the site, starts Gatsby on
http://localhost:8000, and re-wires on every redeploy.

No AWS, or you only want the frontend:

```bash
npm run dev -- --web-only
```

You will then see the "backend not configured" notice. That is correct, and the
build passing in that state is a property worth keeping — a frontend-only
rebuild must never fail the branch.

Once the backend is up, create a user in the Cognito console and add them to
`mk-admins` (the demo user already is). There is no sign-up: the landing page
is the sign-in page. An operator sets up two-step sign-in on first sign-in,
then creates the first tenant in Settings → Operator, naming its first admin.

### Which AWS account?

Nothing in this repository names one. `ampx sandbox` uses the ordinary AWS SDK
credential chain — `AWS_ACCESS_KEY_ID…`, then `AWS_PROFILE` or `--profile`,
then the `[default]` profile in `~/.aws`, then SSO or an instance role — so the
account is whatever your shell already points at.

That is convenient and it is how a sandbox ends up in production by accident,
so `npm run dev` prints the account, region, profile and sandbox name and makes
you look before it creates anything:

```
▸ AWS
  account     123456789012
  region      eu-central-1
  profile     default
  sandbox     your-username
```

Use a different one with `npm run dev -- --profile work`, and run a second
sandbox side by side with `--identifier qa`. Sandboxes are per-person: the
stack name embeds your system username, so two people never collide.

A sandbox is a real deployment holding a real Cognito pool, S3 bucket and
DynamoDB tables. It costs a little and it outlives your terminal — Ctrl-C
stops the dev server, not the backend. Remove it deliberately:

```bash
npm --prefix backend run sandbox:delete
```

## Stack

Gatsby 5 · React 18 · TypeScript · AWS Amplify Gen 2 · Cognito · AppSync ·
DynamoDB · S3 · API Gateway (HTTP) · RDF/SHACL · npm workspaces · Node 22.

## Licence

**AGPL-3.0-or-later**: see [LICENSE](LICENSE) and [COPYRIGHT](COPYRIGHT). If
you run a modified version of this portal as a network service, you must offer
its source to the people who use it.

`packages/ontology` is CC BY 4.0 (see its LICENSE), so that anyone can reuse the vocabulary.
