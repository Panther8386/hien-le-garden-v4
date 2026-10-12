# SEC-1R — remote recovery drill, 10/10/2026

**Status: PASS within the stated remote drill scope.** Four recovery scenarios, real staging browser login, data preservation and cleanup passed. Time Travel restore on a separate isolated temporary D1 also passed. Completed 10/10/2026; see exact UTC timestamps in evidence.

Authorization: owner requested “bắt đầu SEC-1R nhé” in the current conversation. Scope: synthetic accounts on isolated staging plus a newly created temporary D1 for Time Travel. No production mutations, deployments, account recovery or whole shared-staging database restore.

Application staging source `b517796`, deployment `99c01b21`, has the same Git tree as production `cbc81c8`. Staging binding guard passed. Cloudflare OAuth/D1 access is now working; the historical 7403 failure did not recur.

Scenarios:

| Scenario | Required evidence |
|---|---|
| A: account lock | Locked fixture login/session rejected; exactly one synthetic admin unlocked; login/me and self-lock guard verified. |
| B: lost password | Application hashPassword/verifyPassword, guarded password update + session/challenge revocation in a remote batch; old credentials rejected; temporary password rotated through application and login restored. |
| C: lost TOTP | Clear only fixture TOTP configuration and revoke sessions/challenges; old challenge rejected; immediately enroll a new secret through the application and log in with new TOTP. |
| D: batch failure | Deliberate final-statement failure rolls back lock/session/challenge changes; original session and pending challenge still work. |
| Browser | Recovered synthetic admin signs in through real staging login page. |
| Data preservation | Hash/row-count comparison of non-auth/non-operational tables and in-memory comparison of pre-existing account fields. |

Time Travel: created a separate D1 containing only one synthetic sentinel table/row, recorded bookmark privately, changed the row, restored to the bookmark, verified the original value, deleted the temporary DB and checked it no longer exists. Shared staging was not rolled back. Checkpoints, restore responses and executable scripts remain outside the repository.

Failures are retained: initial browser check selected both login and 2FA submit buttons, causing an unhandled wait rejection. Four test admins (14–17) were subsequently locked and all their sessions/pending tokens removed. The corrected run uses scoped login selectors. Initial Time Travel request supplied bookmark in JSON instead of query parameters (7400); that temporary DB was deleted, the request corrected, and a fresh isolated restore succeeded. A first cleanup query used incompatible multi-statement parameter binding; corrected batch cleanup passed. These are drill-script errors, not application defects. Login 429 on the repeat run was respected using Retry-After; no counters were reset or protection disabled.

Evidence: `test-results/sec1r/remote-result.json`, baseline-business.json, remote-interrupted.json, interrupted-cleanup.json, time-travel-first.json and time-travel-result.json. No credentials, hashes, tokens, TOTP secrets, checkpoint bookmarks or executable recovery SQL belong in the public evidence package. Direct recovery writes do not fabricate application audit entries; fixture creation, TOTP enrollment, password change and locking use normal audited application endpoints.

Limits: this does not rehearse loss of the Cloudflare account itself, Cloudflare dashboard UI operations or restoring production data. The staging operational admin stays available throughout. Last-active-admin-only behavior is covered by the earlier isolated local drill, not induced on shared staging.

Final verification: 9/9 remote checks passed, including all four recovery scenarios and real browser login. All 36 non-auth/non-operational tables matched their baseline row counts and content hashes. All pre-existing account fields compared in memory were unchanged. Test admins 18–21 were locked with zero sessions and zero pending challenges; interrupted-run admins 14–17 were also locked with zero sessions/challenges. Roles/permissions were not changed; synthetic admins were created through the normal authorized application API, not SQL.

The temporary D1 restore passed four checks and the resource was deleted and absence verified. No database restore was applied to shared staging or production. No application code, migration or production configuration was changed.

API references: [D1 query/batch](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/), [bookmark](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/get_bookmark/), [restore](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/restore/).
