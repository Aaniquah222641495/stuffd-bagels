# How this site is deployed

Plain words. Design and reasons: ADR-0042 in the Digital Pantry HQ repo (`ops/decisions/`). Last checked against GitHub and Cloudflare docs: 2026-11-19.

## The three places the site lives

| Name | Cloudflare Worker | Address | Gets new code | Money and email |
|---|---|---|---|---|
| **dev** | `stuffdbagels-dev` | https://stuffdbagels-dev.thedigitalpantryza.workers.dev | Automatically on every push to a pull request branch. The latest push wins. | No Yoco, no emails (no Apps Script secrets are set on it, so the forms say "not switched on yet"). Never indexed by Google. |
| **qa** | `stuffdbagels-preview` (the wrangler env is still called `preview`) | https://stuffdbagels-preview.thedigitalpantryza.workers.dev | Automatically when something is merged to `main` and the tests pass. | Yoco test mode and test emails. Never indexed. |
| **production** | `stuffdbagels` | https://stuffdbagels.co.za | Only after qa worked **and the founder clicks Approve**. | Live. |

## What happens, step by step

1. **A pull request is opened or pushed to** (branch in this repo, not a fork): the pipeline runs the checks (typecheck, build, unit tests, the Apps Script self-test, the API tests), then puts the build on **dev**.
2. **The pull request is merged to `main`** (the founder's yes, as always): the same checks run, then the build goes to **qa**, then a read-only smoke check runs against qa (home page loads, `/api/pickups` answers with a JSON list, the noindex header is there).
3. **Production waits.** GitHub shows "Waiting for review" on the run (Actions tab). The founder opens the run, clicks **Review deployments**, ticks `production`, clicks **Approve and deploy**. The exact build that just passed qa goes live, then the same smoke check runs against stuffdbagels.co.za. If a smoke check fails the run goes red; nothing is "half deployed" quietly.
4. Newer pushes: dev cancels the older deploy (latest wins). qa and production never cancel a deploy that has started; a newer main push waits its turn.

Smoke checks only read pages. They never place an order, start a Yoco checkout or send an email.

## Approving
Actions tab > the latest "Pipeline" run on `main` > **Review deployments** > tick `production` > **Approve and deploy**. To stop it instead, choose **Reject**.

## Rolling back
Production is wrong and you need the last good version back fast:
```
npx wrangler@4.148.0 rollback            # lists versions; or pass a version id: rollback <version-id>
npx wrangler@4.148.0 rollback --env preview   # the same for qa
```
Each deploy is tagged with its commit (the first 12 characters) and the message holds the full commit id, so the Cloudflare dashboard (Worker > Deployments) shows what each version was. Rollback does **not** undo data in KV or a Durable Object migration. The other way: re-run the last good "Pipeline" run from the Actions tab (Re-run all jobs; it redeploys that run's build, and asks for Approve again), or revert the bad commit in a pull request. Never fix forward on production without the Approve step.

## What the pipeline does not touch
Worker runtime secrets (ADMIN_PASSWORD, LIMITER_SALT, Yoco, Turnstile secret, Apps Script) are set by hand with `npx wrangler@4.148.0 secret put NAME [--env preview|dev]` and are not in GitHub. Cloudflare resources (KV namespaces, the Worker's custom domain, WAF rules) are made by hand too.

## One-time setup (founder, about 20 minutes)

### 1. Cloudflare: two API tokens
Do this twice: one token for **dev and qa**, a separate one used only by **production**.
1. Cloudflare dashboard > top-right profile menu > **My Profile > API Tokens** (or **Manage Account > Account API Tokens**) > **Create Token**.
2. Use the **Edit Cloudflare Workers** template. It grants: Account: Workers Scripts Write, Workers KV Storage Write, Workers Tail Read, Workers R2 Storage Write, Account Settings Read; Zone: Workers Routes Write; plus user details and memberships read.
3. Under **Account Resources** pick only the Digital Pantry account. Under **Zone Resources** pick only `stuffdbagels.co.za` (it is only needed if routes are ever added to `wrangler.jsonc`; today there are none).
4. Set an expiry (12 months) and put a reminder in your calendar to rotate it.
5. Copy the token once, straight into GitHub (next step). Never into chat, email or a file.
6. Your account ID: run `npx wrangler@4.148.0 whoami` (it prints it), or find it in the dashboard under Workers & Pages (right-hand side).

Honest limit: Cloudflare Workers tokens cover the whole account, not one Worker. The dev/qa token could therefore deploy to production if someone edited the workflow. The Approve click guards against accidents, not against someone who can push to this repo. See ADR-0042.

### 2. GitHub: three environments
Repo > **Settings > Environments > New environment**, for each:

| Environment | Deployment branches | Required reviewers | Secrets to add (Environment secrets > Add secret) |
|---|---|---|---|
| `dev` | no restriction | none | `CLOUDFLARE_API_TOKEN` (the dev/qa token), `CLOUDFLARE_ACCOUNT_ID` |
| `qa` | Selected branches: `main` | none | the same dev/qa token and the account ID |
| `production` | Selected branches: `main` | **you** (leave "Prevent self-review" OFF, you are the only person) | `CLOUDFLARE_API_TOKEN` (the production-only token), `CLOUDFLARE_ACCOUNT_ID` |

The account ID goes in as a secret (not a variable) so GitHub hides it in the public run logs.

### 3. GitHub: protect the pipeline itself
- **Settings > Branches > Add rule** for `main`: require a pull request, require the `Pipeline / ci / build` and `Pipeline / ci / tests` checks, and **Require review from Code Owners**. `.github/CODEOWNERS` already names you for `.github/`, `wrangler.jsonc` and this file.
- The name of the required check changed: CI now runs inside the Pipeline workflow. If `main` currently requires a check called `build`, replace it.

### 4. Dev Worker, first time
The dev Worker is created by its first deploy. It starts without KV (public pages work, admin saves answer 503) and without Yoco and email. To make it a full sandbox:
1. `npx wrangler@4.148.0 kv namespace create stuffd-kv-dev` and paste the printed id into the commented `kv_namespaces` line under `env.dev` in `wrangler.jsonc` (remove the `//`).
2. `npx wrangler@4.148.0 secret put ADMIN_PASSWORD --env dev` (16 or more characters) and `... secret put LIMITER_SALT --env dev`.
3. After the order-form PR (#16) is merged, add to `env.dev` its vars: `YOCO_MODE` "test", `SITE_ORIGIN` (the dev address above) and the Turnstile **test** site key `1x00000000000000000000AA`, plus a Yoco test secret key and a Turnstile test secret if you want checkouts there. Dev has no Apps Script secrets on purpose: no real emails.

### 5. Private repo? (the same file still works)
Required reviewers only exist on private repos on the Enterprise plan; this repo is public, so they work (GitHub docs, checked 2026-11-19). If a site's repo is ever private and has no reviewer gate, set the repository variable `PROD_DEPLOY_ON_PUSH` to `false` (Settings > Secrets and variables > Actions > Variables). Pushes to `main` then stop after qa, and production only deploys when you press **Actions > Pipeline > Run workflow** on `main`. The same Run workflow button on `main` also works on this public repo (it runs the full chain and still waits for Approve).

## Running the checks on your laptop
Same commands CI runs: see `worker/tests/README.md`. The API suites in one command (after building the site): `bash worker/tests/run-api-tests.sh` (set `DEV_PORT` and `FAKE_PORT` if ports 8787 or 8899 are busy). The Playwright browser test stays local on purpose (it needs Chrome and axe, which are not project dependencies).
