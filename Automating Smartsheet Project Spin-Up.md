# Feasibility and Limitations Report: Automating the Smartsheet "New Project Spin-Up" SOP

## TL;DR

- About 70 to 80 percent of this workflow can be automated today, but not as a simple linear script that mimics the human clicks. The realistic path is a redesign built around a template workspace copy plus a control script, not step-by-step UI automation.
- The three genuine hard blockers are: saved sheet filters (Smartsheet's own API best-practices documentation states "You cannot create or update filters using the API; however, you can query which rows have been filtered out and you can get filter definitions"), dashboard widget contents (cannot be edited by API), and Smartsheet Dynamic View (no API at all). Each needs a redesign or a human-in-the-loop checkpoint.
- The single most important finding for the top-priority "five reports" step: report filter criteria CAN now be changed by API (`PUT /reports/{reportId}/definition` shipped), and copying a template workspace automatically remaps each copied report to the new copied sheets while copying the filter criteria verbatim. This removes most of the pain. The one residual gap is renaming a report, which the plain API still does not support.

## Key Findings

1. The Smartsheet REST API added report CRUD endpoints, including `PUT /reports/{reportId}/definition` (create or replace filters, grouping, sorting), report create, and report delete. This is new and directly changes the answer to the top-priority step. A Smartsheet Community answer confirms the mechanism and its caveat: "we can update report definitions (filter, group, summarize, and sort) via the API... the caveat is that when you do so, you overwrite the existing. You have to first get the existing report definition."
2. Report renaming via the plain API is still not supported. A Smartsheet Community moderator confirmed: "I can rename every other item in a Folder, but I can't rename Reports using the API." The MCP `create_report` tool and the copy-workspace remap path give practical ways around this.
3. Saved sheet filters remain read-only through the API. You can list and get filters (`GET /sheets/{sheetId}/filters`) but there is no create, update, or apply endpoint. Smartsheet's API best-practices documentation states this plainly: "You cannot create or update filters using the API; however, you can query which rows have been filtered out and you can get filter definitions." This is an open enhancement request with no ship date.
4. Dashboard (Sight) widget contents cannot be updated by API. You can rename a dashboard, copy it, and change sharing, but the `widgets` field is not writable (attempting to write it returns error 1008, "Field widgets was of unexpected type"). Confirmed by multiple Smartsheet employee answers.
5. Dynamic View has no API, no MCP tool, and no Bridge module. It cannot be created, copied, renamed, filtered, or domain-shared programmatically. This is the hardest blocker.
6. Copying a workspace or folder by API remaps reports, cell links, sheet hyperlinks, and dashboards to the new copies by default, and copies report filter criteria verbatim. This is the backbone of the recommended architecture. The remap is controlled by the `skipRemap` query parameter.
7. OneDrive folder copy, rename, and move are fully supported by Microsoft Graph (`driveItem` copy/move/PATCH). This step is fully automatable.
8. The MCP server is a real, generally available product. Smartsheet's official API introduction page describes it as: "Connect Smartsheet to AI clients like Claude, Cursor, and Codex, and use 30+ tools to manage your sheets, rows, columns, and more through natural-language prompts." It is remote-hosted at mcp.smartsheet.com and requires Business, Enterprise, or Advanced Work Management. It exposes `create_report` but does NOT expose sheet filter writes or dashboard widget editing, so it does not unlock the blocked areas.

## Verdict on architecture

Do not try to automate the human's exact click path. Instead:
- Pre-build a template workspace containing the checklist sheet, the five reports, the Project Orders report, the CMR Project Plan, the Orders sheet, and the dashboard, all wired together.
- On a new project, copy the template workspace by API (remapping does most of the linking work for you).
- Use a control script (Python or Node using the official SDK) to fill in cells, set report filters, publish the Project Orders report, and update the master list.
- Accept human-in-the-loop checkpoints for: verifying the signed contract, the Dynamic View setup, and pasting the dashboard embed and Dynamic View URLs into widgets (unless you adopt report widgets, described below).

# Detailed step-by-step feasibility map

Legend for each step: (a) automatable today / partial / blocked; (b) exact mechanism; (c) hard limits; (d) workarounds; (e) human-in-the-loop needed.

## Step 1: Trigger on a new project

(a) Fully automatable, and better than email parsing.
(b) Two good options. First, Smartsheet webhooks: register a webhook (`POST /webhooks`) scoped to the intake sheet, event type row created or column changed. Smartsheet posts a callback to your HTTPS endpoint. Second, native Smartsheet automation with a "when rows are added" trigger that calls a webhook or sends a structured alert. The callback server must use a CA-signed certificate and a public URL (no private IPs, no self-signed certs).
(c) Webhooks fire on sheet-level row and cell events only. Some users report callback latency of up to 60 seconds. Webhooks do not fire on user or account changes.
(d) If you keep the email trigger, Power Automate can trigger on the Smartsheet alert email and parse the structured table, which avoids a Smartsheet connector entirely. But webhooks on the master project list are cleaner and more reliable than parsing email text.
(e) No human needed.

## Step 2: Copy the template checklist sheet and name it "[Project Name] Gen 009"

(a) Fully automatable.
(b) `POST /sheets/{sheetId}/copy` (Copy Sheet) with a destinationType of folder or workspace, a destinationId, and a newName. Use the include parameter to carry data, filters, forms, rules. MCP equivalent: `create_sheet` from a template with `fromId` and an include list.
(c) The name must be unique within the destination container. Copy does not copy cell history.
(d) None needed.
(e) No human needed.

## Step 3: Write project name and number into specific cells

(a) Fully automatable.
(b) `PUT /sheets/{sheetId}/rows` (Update Rows) or MCP `update_rows`. First read columns with `GET /sheets/{sheetId}/columns` (MCP `get_columns`) to resolve column IDs, and find the target rows.
(c) 500 rows per call, 4000 characters per cell, values over 4000 chars silently truncated.
(d) None needed.
(e) No human needed.

## Step 4: Conditionally hide the "Patterson" column for non-Patterson projects

(a) Fully automatable, given a project-type input.
(b) `PUT /sheets/{sheetId}/columns/{columnId}` (Update Column) with `"hidden": true`. MCP `update_column` supports the hidden flag.
(c) Requires ADMIN_SHEETS scope. Column type changes are destructive, but hiding is safe and reversible.
(d) The dependency is the project-type signal, which today is not on screen. See step 9. Add a project-type field to the intake form so the type is available as data.
(e) No human needed once type is an input.

## Step 5: Turn on a saved named sheet filter for the working user

(a) Blocked for the "apply a saved filter" action; partial via workarounds.
(b) The API can `GET /sheets/{sheetId}/filters` and get a single filter, but there is NO endpoint to create, update, or apply a saved filter. Smartsheet's own documentation is explicit: "You cannot create or update filters using the API; however, you can query which rows have been filtered out and you can get filter definitions."
(c) This is a genuine gap with no ship date, tracked in the open enhancement request "API Support to Create and Update Sheet Filters." The API even ignores a filterId as a way to filter a Get Sheet response in the way users expect.
(d) Options: (1) Pre-create the named filter in the template sheet so that Copy Sheet carries it over (Copy Sheet and workspace copy both support including shared sheet filters). The filter then already exists on the copy, and it can be the default view for users. (2) Replace the filter with report-based or current-user-based views. (3) Because "applying" a filter is a per-user view preference, it may not need automation at all if the filter is pre-built and shared.
(e) No human needed if the filter is pre-built in the template. Applying it as the active view for a specific user may still be a manual click, since view state is not API-controllable.

## Step 6: Share the sheet to Ashley as Editor plus Can Share, with notify

(a) Fully automatable.
(b) `POST /sheets/{sheetId}/shares` with accessLevel EDITOR_SHARE and a query parameter sendEmail=true. MCP has list_shares for auditing; sharing writes go through the API or SDK. Must use the user's primary email address, not an alternate.
(c) Sharing by email requires the exact primary email. EDITOR_SHARE is the access level that equals Editor plus Can Share.
(d) None needed. This removes the manual-typing and autofill fragility.
(e) No human needed.

## Step 7: Verify a signed letter of agreement is attached to the project row

(a) Partial. Listing attachments is automatable; confirming the document is actually signed is not.
(b) `GET /sheets/{sheetId}/attachments` or row-level list (MCP `list_attachments` with target_type ROW). You can confirm an attachment exists and get its name and download URL (MCP `get_attachment`).
(c) The API only tells you a file is attached. It cannot tell you the document is a signed letter of agreement.
(d) To fully automate, add a document-AI or e-signature step: pull the file via the temporary download URL, run signature detection or check an e-signature provider status (for example DocuSign) and write a "signed: yes" cell. Otherwise, gate on a checkbox that a human ticks.
(e) Human-in-the-loop unavoidable unless you add document AI or an e-signature integration. Verifying a signature visually is the classic case where a human checkpoint is the safe default.

## Step 8 (TOP PRIORITY): Five reports, update filter to new account number, rename to account number

(a) Substantially automatable now, with one caveat on renaming. This is a major change from the historical answer.
(b) Mechanisms:
- Report filter criteria: `PUT /reports/{reportId}/definition` creates or entirely replaces the report's filters, grouping, sorting, and summarizing. The filters object supports operators like EQUAL, CONTAINS, IS_ONE_OF, nested AND/OR up to three levels. This directly lets you replace the old project number with the new account number in each report's filter. A Smartsheet Community answer describes the exact workflow: "we can update report definitions (filter, group, summarize, and sort) via the API... the caveat is that when you do so, you overwrite the existing. You have to first get the existing report definition."
- Finding the five reports: `GET /reports` (MCP `list_reports`) plus MCP `search` with scope reportNames. The double-curly-brace naming convention the user plans is a good idea because it makes the variable part machine-findable and avoids the truncation problem.
- Report rename: not supported by the plain API. A Smartsheet Community moderator confirmed: "I can rename every other item in a Folder, but I can't rename Reports using the API."
(c) Hard limits: report rename is the one piece not supported by the direct API. Report names are limited to 50 characters. The definition replace is a full replace, so you must first GET the existing definition, then send the whole modified definition, not a patch.
(d) Best workaround architecture, in priority order:
1. Template workspace copy (recommended). Pre-build the five reports inside a template workspace, each scoped to the template's sheets, with the filter criteria already set. When you copy the workspace by API (`POST /workspaces/{workspaceId}/copy`), Smartsheet remaps each copied report to the new copied sheets by default, and copies the filter criteria verbatim (the Learning Center confirms the copy preserves "Source Sheets, Columns to Display, Filter Criteria, Group, Summarize, Sort"). The remap is controlled by the `skipRemap` query parameter (allowed values cellLinks, reports, sheetHyperlinks, sights); omit "reports" to keep the default remap to the new copies. After the copy, call `PUT /reports/{reportId}/definition` once per report to swap in the new account number, and only the account-number value changes.
2. Report rename: since direct rename is not supported, either (i) create the report fresh with the correct name using MCP `create_report` or `POST /reports` (name is settable at creation, up to 50 chars) instead of copying, or (ii) leave the copied report name generic and drive the visible header from data. If exact-name renaming is mandatory and neither create-fresh nor generic naming is acceptable, a UI automation tool (Selenium or Playwright) is the fallback, which Smartsheet staff themselves have suggested for report rename.
3. Single master report redesign. Replace five per-project reports with one master report scoped to the whole workspace, filtered by a current-user or account-number column, so report criteria never need per-project edits. This is the most maintainable long-term design.
4. Control-sheet driven filtering. Put the account number in a sheet summary field or a control column and filter on that, so the filter never changes even when the account number does.
(e) No human needed if you adopt the template-copy plus definition-update path and accept either create-fresh naming or generic names. A human or UI-bot is only needed if exact report-header renaming is mandatory.

## Step 9: Delete two of three sections in "CMR Project Plan" based on project type

(a) Automatable, given a project-type input.
(b) `DELETE /sheets/{sheetId}/rows` or MCP `delete_rows` (max 10 rows per call, so batch). Identify the section rows first with Get Sheet or MCP `find_in_sheet`.
(c) delete_rows is irreversible and limited to 10 rows per request. The bigger issue is that project type is not present on screen today.
(d) Add a project-type field (commercial, residential, Patterson) to the intake form so it arrives as data. Then map type to which row ranges to delete. Safer alternative: instead of deleting, pre-build three template variants (one per type) and copy the correct one, avoiding destructive deletes entirely.
(e) No human needed once type is an input. Given the irreversibility, a confirmation checkpoint is prudent in early runs.

## Step 10: Publish the "Project Orders" report and retrieve its embed code

(a) Fully automatable for the publish and the URL; partial for the exact iframe embed code.
(b) `PUT /reports/{reportId}/publish` sets readOnlyFullEnabled true and returns readOnlyFullUrl, plus access control (ALL, ORG, or SHARED). `GET /reports/{reportId}/publish` reads current settings.
(c) The publish endpoint returns the read-only-full URL, not a ready-made iframe string. Reports only support "Read Only - Full" publishing, not the "Read Only - HTML" mode sheets have.
(d) The iframe embed is just the published URL wrapped in an iframe tag, so your script can construct the iframe HTML from the returned readOnlyFullUrl. This is a well-known pattern.
(e) No human needed.

## Step 11: Paste the embed code into a specific dashboard web content widget

(a) Blocked by API for editing widget contents; solvable by redesign.
(b) Dashboards (Sights) support `GET /sights/{sightId}`, `PUT /sights/{sightId}` (rename only), `POST /sights/{sightId}/copy`, delete, and share endpoints. The widgets field is read-only; attempting to write widgets returns error 1008, "Field widgets was of unexpected type." Confirmed by multiple Smartsheet employee replies and the open "Expose Dashboard Widget APIs" request.
(c) You cannot write a URL into a web content widget or otherwise change widget contents via API. The manual verification cue (header flips from "read only" to the project number) has no API equivalent.
(d) Workarounds:
1. Use a native Report widget instead of a web-content-embedded published report. If the dashboard is copied from a template (`POST /sights/{sightId}/copy`) and the workspace copy remaps the report references, a report widget can auto-point at the copied report with no manual paste. This is the cleanest fix and removes both step 10 and step 11 pasting.
2. If you must use web content widgets, a UI automation bot (Playwright) can paste the embed. This is brittle.
3. Smartsheet Control Center (a separate premium product) is the vendor-supported way to provision dashboards from a template set at scale; it is what the API gap effectively pushes larger customers toward.
(e) Human or UI-bot needed only if you insist on web content widgets. Redesigning to report widgets removes the human step.

## Step 12: Duplicate a saved filter in the shared "Orders" sheet, name it by account number, set criteria

(a) Blocked, same root cause as step 5.
(b) No API to create, duplicate, or update saved sheet filters.
(c) The filter must exist before Dynamic View setup, and it takes several seconds to propagate. Even if filters were creatable by API, the propagation delay would require a wait-and-verify loop.
(d) Workarounds: (1) Pre-build a filter in the template Orders sheet and let Copy carry it; but the criteria value (account number) is project-specific, so this only helps if you filter on a stable column driven by a control value rather than a literal account number. (2) Redesign so Dynamic View filters on a "current user" or a control column, avoiding per-project filter creation. (3) UI automation as a last resort.
(e) Human or UI-bot needed unless you redesign the filtering model.

## Step 13: Dynamic View - copy the latest view, rename, set filter, domain-share

(a) Blocked. This is the hardest blocker in the entire workflow.
(b) There is no Dynamic View API, no MCP tool, and no Bridge module. Confirmed repeatedly in the Smartsheet Community ("I know there is no API for Dynamic Views yet"; "Can Dynamic Views be manipulated via the API?" answered no). Dynamic View is a separate premium app with its own admin login.
(c) Nothing about creating a view, copying, renaming, setting its filter, domain sharing, or retrieving its end-user URL is exposed to any automation surface. It also depends on the step 12 filter existing first.
(d) Workarounds:
1. Accept a human-in-the-loop step for Dynamic View. This is the pragmatic answer today.
2. UI automation (Playwright or Selenium) driving the separate admin browser profile. Feasible but brittle and against the spirit of unattended automation; Dynamic View's UI is complex.
3. Re-evaluate whether Dynamic View is truly required. If the external sharing need can be met by a published report with access control, or by a WorkApp, you may be able to drop Dynamic View from the automated path.
On the separate admin credential: because there is no API, OAuth scopes and service accounts do not help here. If you use UI automation, store the admin credentials in a secrets manager and run the bot in a dedicated, isolated browser profile. Do not hardcode credentials.
(e) Human-in-the-loop effectively unavoidable, or a brittle UI bot.

## Step 14: Retrieve the Dynamic View end-user URL and paste into a dashboard shortcut widget

(a) Blocked, combines the step 13 and step 11 blockers.
(b) No API to get a Dynamic View URL; no API to write a widget's target.
(c) Both halves are unsupported.
(d) The human who sets up the Dynamic View (step 13) copies the URL and either pastes it into the widget or records it in a control cell. If dashboards use shortcut widgets that cannot be API-written, this stays manual. A partial mitigation: store the Dynamic View URL in a sheet cell (automatable to read and use elsewhere), even though writing it into the widget is not.
(e) Human-in-the-loop unavoidable.

## Step 15: OneDrive - copy two template folders, rename exactly, move into Production

(a) Fully automatable.
(b) Microsoft Graph: `POST /me/drive/items/{item-id}/copy` (or `/drives/{driveId}/items/{itemId}/copy`) to copy a folder including children; `PATCH /me/drive/items/{item-id}` with a new name to rename; `PATCH` with a new parentReference.id to move. Copy is asynchronous; poll the Location header until done. Power Automate has OneDrive actions (Copy file, Move or rename file) as a lower-code alternative.
(c) Copy is async; a known issue is that passing name and includeAllVersionHistory together is ignored, so copy first then rename. conflictBehavior replace applies to files, not folders. Exact-name matching (including the dash, space, number) is just a string you supply, so it is fully controllable.
(d) Best practice: copy without a name, wait for completion, then PATCH the exact name, then PATCH the move. This avoids the async naming issue.
(e) No human needed. Requires Microsoft Graph app registration and Files.ReadWrite scope.

## Step 16: Mark checklist rows done, detect team completion, archive the sheet

(a) Marking rows done: fully automatable. Detecting other members' completion: automatable via webhooks. Archiving: automatable as a move.
(b) Update cells with `PUT /sheets/{sheetId}/rows` (MCP `update_rows`). Detect completion with a webhook on the checklist sheet watching the relevant status column, or poll `GET /sheets/{sheetId}/version` (MCP `get_sheet_version`) as a lightweight change check. "Archive" can mean moving the sheet with `POST /sheets/{sheetId}/move` to an archive folder or workspace, or copying then deleting.
(c) Webhooks have up to about 60 seconds latency and are sheet-scoped. There is no true "archive" object; you emulate it with a move.
(d) Define archive as move-to-archive-folder. Use a webhook that fires when all required status cells reach done, then trigger the move. Guard against webhook loops using the Smartsheet-Change-Agent header.
(e) No human needed, though a final human sign-off before archiving is a reasonable safety gate.

# Deep dives on the blocked and hard areas

## Deep dive A: The five-report filter step (the top priority)

The historical blocker (no way to change report filters by API) is largely resolved. `PUT /reports/{reportId}/definition` now lets you replace the entire report definition, including filters with rich operators and up to three levels of nested AND/OR. As a Smartsheet Community answer put it: "we can update report definitions (filter, group, summarize, and sort) via the API... the caveat is that when you do so, you overwrite the existing. You have to first get the existing report definition." Combined with the template-workspace copy behavior (reports remap to the new copied sheets by default, and filter criteria copy verbatim), the clean pattern is:

1. Build a template workspace with the five reports fully wired and filtered.
2. Copy the workspace by API for each new project. Reports now point at the copied sheets automatically; filter criteria are carried across unchanged.
3. GET each report's definition, substitute the new account number, and PUT the modified definition back once per report.

The only residual gap is renaming the report header to the account number. Direct API rename is not supported, confirmed by a Smartsheet moderator: "I can rename every other item in a Folder, but I can't rename Reports using the API." Choose one: create the reports fresh with the right name (MCP create_report or POST /reports, name settable at creation), keep names generic and show the account number via data, or use a UI bot for the rename. The double-curly-brace naming convention the user proposed is worth adopting because search by reportNames then reliably finds each report despite the historical name truncation.

## Deep dive B: Sheet filters (steps 5 and 12)

No create, update, or apply endpoint exists for saved sheet filters, only read. Smartsheet's documentation is explicit: "You cannot create or update filters using the API; however, you can query which rows have been filtered out and you can get filter definitions." This is a long-standing, still-open enhancement request. The practical responses are: pre-build and share filters in template sheets so Copy carries them; redesign filtering to use control columns or current-user logic so per-project filter creation is unnecessary; or use a UI bot. The propagation delay in step 12 (a filter must fully exist before Dynamic View can see it) means any automation here needs a wait-and-verify loop even if filters were API-creatable.

## Deep dive C: Dashboard widgets (steps 11 and 14)

Widget contents are not writable; attempting to write the widgets field returns error 1008. You can rename, copy, move, and share dashboards, but not edit a widget's URL or web content. The strongest redesign is to use native report widgets that auto-resolve through the workspace-copy remap, eliminating the manual embed paste. If web content or shortcut widgets are mandatory, the only options are a UI bot or Smartsheet Control Center. This gap is why Smartsheet steers template-driven provisioning toward Control Center.

## Deep dive D: Dynamic View (steps 13 and 14)

Zero automation surface. No API, MCP, or Bridge. Treat Dynamic View as a manual or UI-bot island. If external constrained sharing can instead be served by a published report with access control or a WorkApp, consider dropping Dynamic View from the automated path. The separate-admin-login requirement cannot be solved with OAuth or service accounts because there is nothing to authenticate against programmatically; a UI bot with credentials in a secrets manager is the only automated route.

# Recommended automation architecture options

## Option 1: Direct API script (Python or Node SDK) plus template workspace copy
- Pros: deterministic, testable, reliable, cheapest to run, no per-action AI risk. Best for the copy, cell writes, report definition updates, publish, sharing, master-list update, and OneDrive via Graph.
- Cons: cannot touch sheet filters, dashboard widgets, or Dynamic View. Requires developer skill. Report rename needs a workaround.
- Build complexity: medium. This should be the backbone.

## Option 2: Smartsheet Bridge
- Pros: low-code, native Smartsheet triggers, can call the API and run JavaScript, good for orchestration and webhooks. Handles the trigger, cell updates, sharing, and can call the report endpoints via its API module.
- Cons: still bound by the same API gaps (no filters, no widgets, no Dynamic View). Bridge is a premium add-on. Complex logic in Bridge can get unwieldy.
- Build complexity: medium. Good glue layer if you prefer low-code over a script.

## Option 3: MCP server plus AI agent (for example Claude)
- Pros: natural-language orchestration, 30-plus tools including create_report, create_sheet from template, update_rows, sharing, search, and publish-adjacent report tools. Remote-hosted at mcp.smartsheet.com. Good for ad hoc and human-supervised runs.
- Cons: does not expose sheet filters, dashboard widget editing, or Dynamic View, so it does not unlock any blocker. Unattended AI-driven automation carries reliability and safety risk: nondeterminism, prompt-injection exposure when reading untrusted cell content, and destructive tools (update_rows, delete_rows, delete_column are flagged destructive and irreversible). For a repeatable production SOP, a deterministic script is safer than an autonomous agent. Use the agent as a supervised copilot, not an unattended runner.
- Build complexity: low to set up, but high to make safe for unattended use. Recommended only with human approval gates ("needs approval" permission per tool).

## Option 4: Third-party connector (Power Automate, Zapier, Make)
- Pros: easy triggering (including on the alert email), decent row and sheet actions, good for the OneDrive steps (native Graph or OneDrive actions), and for stitching to other systems. Zapier and Make support copy row, add row, attachments; Power Automate has the official Smartsheet connector plus OneDrive actions.
- Cons: the standard connectors do not cover report definitions, sheet filters, dashboard widgets, or Dynamic View. Users report occasional Bad Gateway errors on the Smartsheet connector. For report filter edits you would fall back to a raw HTTP action against the API.
- Build complexity: low for triggers and OneDrive, medium once you need raw API calls.

## Option 5 (recommended): Hybrid
- Trigger and email handling: webhook or Power Automate.
- Core Smartsheet provisioning: a deterministic Python or Node script using the SDK, built around a template workspace copy, then report definition updates, publish, sharing, cell writes, and the master-list update.
- OneDrive: Microsoft Graph in the same script, or a Power Automate branch.
- Dashboards: redesign to native report widgets so the copy remap wires them automatically.
- Sheet filters, Dynamic View, signed-contract check: human-in-the-loop checkpoints, optionally assisted by a UI bot for Dynamic View if volume justifies the fragility.
- Pros: maximizes deterministic automation, isolates the three blockers to clearly bounded manual steps.
- Cons: requires up-front template-workspace engineering and developer effort.
- Build complexity: medium to high up front, low to run.

# Licensing, plan, rate limit, credential, and security requirements

## Plans and add-ons
- REST API and webhooks: require Business or Enterprise (the API is restricted to Business and Enterprise plans). Automation workflows also require Business or Enterprise.
- MCP server: requires Business, Enterprise, or Advanced Work Management.
- Bridge: premium add-on, contact sales; not in standard Business or Enterprise.
- Dynamic View: premium add-on, eligible on Business and Enterprise, sold separately, historically expensive; included in the Advanced Work Management bundle.
- Control Center: premium add-on, the vendor's answer to dashboard and report provisioning at scale.
- Note the User Subscription Model: users with editor permissions may auto-convert to paid members, which affects cost when you share sheets programmatically.

## Rate limits and error handling
- 300 requests per minute per API token. Resource-intensive operations (file attach, cell history) count 10x and are limited to 30 per minute.
- 429 responses return errorCode 4003. Smartsheet's scalability docs specify the exact body: `{ "errorCode": 4003, "message": "Rate limit exceeded." }`. The SDKs implement backoff and retry by default; otherwise implement exponential backoff and respect Retry-After.
- Do not fire rapid updates at the same object; batch with bulk operations (up to 500 rows per update). Execute updates to a single object serially to avoid save collisions.

## Authentication options
- Raw API access token (personal bearer token): simplest, but tied to a user and long-lived; store in a secrets manager.
- OAuth 2.0 app: better for production, supports scopes (READ_SHEETS, WRITE_SHEETS, ADMIN_SHEETS, SHARE_SHEETS, CREATE_SIGHTS, etc.). MCP and Claude connectors use OAuth 2.1 with PKCE.
- Service account pattern: use a dedicated Smartsheet user as the automation identity so shares and ownership are stable and not tied to an employee.
- The separate Dynamic View admin login cannot be handled by tokens or scopes because there is no Dynamic View API. If automated at all, it requires UI automation with credentials in a secrets manager.

## Security considerations
- Store all tokens and the Dynamic View credentials in a secrets manager, never in code or a .env committed to source control.
- The MCP path and any AI agent reading sheet content are exposed to prompt injection from untrusted cell data; the official MCP notes warn about this. Use per-tool approval gates for destructive tools.
- Publishing a report or dashboard exposes data to anyone with the link unless access control is set to ORG or SHARED. Set access control deliberately.
- Microsoft Graph requires an Entra app registration with least-privilege scopes (Files.ReadWrite, not Files.ReadWrite.All unless needed).

## Reliability considerations
- Filter propagation delay (several seconds) in step 12 means any dependent step must wait and verify.
- Inconsistent artifact naming (truncated report names) is best solved by the user's proposed double-curly-brace convention plus search by name scope.
- Webhook latency up to about 60 seconds; design for eventual consistency, and note the MCP search tool is eventually consistent with a possible first-time 24-hour provisioning delay.
- Copy limits: a folder or workspace copy is limited to 100 items (the Learning Center states "You can copy any folder or workspace that contains up to 100 items"); plan template size accordingly.
- Copy does not carry cell history, and Move or Copy Row automations are not remapped by a workspace copy (you must repoint them after copying).

# Open questions the user must verify in his own environment

1. Report rename: confirm whether creating reports fresh with the correct name (instead of copying) is acceptable, or whether exact renaming of existing copied reports is mandatory (which would force a UI bot).
2. Project type source: decide where the commercial/residential/Patterson signal will come from (add it to the intake form) so steps 4 and 9 can run unattended.
3. Signed-contract verification: decide whether a human tick is acceptable, or whether to invest in document AI or an e-signature integration.
4. Dynamic View necessity: verify whether a published report with access control or a WorkApp could replace Dynamic View, which would remove the hardest blocker.
5. Dashboard widget redesign: confirm whether native report widgets can replace the current web content and shortcut widgets, which would remove the manual paste steps.
6. Filter model: decide whether the Orders sheet and Dynamic View filtering can be driven by a control column or current-user logic rather than per-project account-number filters.
7. Plan and add-on entitlements: confirm the account is Business or Enterprise (for API and webhooks) and that Dynamic View and any Bridge or Control Center add-ons are licensed.
8. Copy remap behavior: run a controlled test of a workspace copy in your own environment to confirm the five reports remap to the copied sheets and retain filter criteria as expected, and confirm you are within the 100-item copy limit.
9. OneDrive: confirm whether the CAD Files and Client Files folders are in personal OneDrive or a SharePoint document library, since the Graph drive path differs.
10. Copy parameter changes: verify the current copy endpoints and parameters against the latest Smartsheet changelog, since Smartsheet moved copy parameters (include, exclude, skipRemap) to the dedicated copy endpoints and off the create endpoints.