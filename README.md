# Smartsheet Project Spin-Up Automation Service

Production Node.js service for automating the Livia Design Group / CMR Design New Project Spin-Up workflow. It receives Microsoft Graph mailbox webhook notifications for forwarded Smartsheet alert emails, parses the project details, provisions Smartsheet and OneDrive artifacts, then hands off the two platform-blocked human steps.

## What It Automates

- Copies the `New GEN009` checklist template into the configured Smartsheet automation workspace and project toolkit folder.
- Writes project name and number onto the copied checklist.
- Hides the Patterson column for non-Patterson projects.
- Trims the CMR Project Plan to the matching project type, gated by `DRY_RUN`.
- Shares the checklist with the Office Admin group.
- Attempts signed-contract PDF verification by checking the first line for `Zoho signed document ID`.
- Updates five report definitions in place with project-specific account-number filters, preserving report IDs used by dashboards and other Smartsheet references.
- Publishes the Orders report and writes its URL to the checklist.
- Copies, polls, and renames the two OneDrive template folder sets into their configured destination folders.
- Writes and sends a manual handoff email with dashboard/Dynamic View tasks, contract signed status, and any non-fatal automation problems.

## Deliberately Out Of Scope

Dashboard widget updates and Dynamic View automation are excluded by design. Smartsheet does not expose an API to write dashboard widget contents, and Dynamic View has no public API. This service does not use Playwright, Selenium, or any browser/UI automation for those steps.

## Project Structure

```text
src/
	clients/
		smartsheetClient.js
		graphClient.js
	steps/
		step00-trigger.js
		step01-copyGen009Template.js
		step02a-writeProjectInfo.js
		step02b-hidePattersonColumn.js
		step02c-trimProjectPlan.js
		step02d-shareChecklist.js
		step02e-verifyContract.js
		step03-updateAndRenameReports.js
		step04a-publishOrdersReport.js
		step04b-createOneDriveFolders.js
		step05-manualCheckpointHandoff.js
		step06-markChecklistDone.js
	utils/
		logger.js
		retry.js
		pollAsyncOperation.js
		runStateStore.js
	orchestrator.js
	server.js
config/
	index.js
```

Each step exports `async function run(ctx)` and reads clients from `ctx.clients`, which keeps the files independently unit-testable.

## Setup

1. Install Node.js 20 or newer.
2. Install dependencies:

```bash
npm install
```

3. Copy `.env.example` to `.env` for local development and fill in real IDs/secrets. Production should inject environment variables from a secrets manager.

4. Start the service:

```bash
npm run dev
```

5. Register the Graph webhook subscription:

```bash
curl -X POST http://localhost:3000/webhooks/graph/register
```

The callback URL must be public HTTPS for Microsoft Graph subscription validation.

## Environment-Controlled Locations

Use environment variables to switch between test/prod workspaces and directory layouts. For the client-provided automation location, set:

```bash
SMARTSHEET_Z_ACTIVE_WORKSPACE_NAME=Z-Active Projects-Automation
SMARTSHEET_PROJECT_ROOT_FOLDER_PATH=Gen oh oh nine Folder
```

`SMARTSHEET_Z_ACTIVE_WORKSPACE_ID` is still the value the API actually uses to open the workspace. `SMARTSHEET_Z_ACTIVE_WORKSPACE_NAME` is a human-readable label for documentation/log context. `SMARTSHEET_PROJECT_ROOT_FOLDER_PATH` can be either `Gen oh oh nine Folder` or the full visible path `Z-Active Projects-Automation\Gen oh oh nine Folder`.

The per-project Smartsheet artifacts remain configurable too:

```bash
SMARTSHEET_PROJECT_FOLDER_NAME_TEMPLATE={projectName} - Project Toolkit
SMARTSHEET_GEN009_SHEET_NAME_TEMPLATE={projectName} Gen 009
```

All OneDrive directories are already environment-driven: `ONEDRIVE_CAD_TEMPLATE_PATH`, `ONEDRIVE_CAD_DESTINATION_PATH`, `ONEDRIVE_CLIENT_TEMPLATE_PATH`, and `ONEDRIVE_CLIENT_DESTINATION_PATH`. Step04b copies each template folder directly into its configured destination and names the copied folder `{projectName} - {projectNumber}`.

## Dry Run

Set `DRY_RUN=true` to prevent destructive project-plan row deletion and to force signed-contract verification into manual-review mode. This is the recommended mode for early workspace validation.

```bash
DRY_RUN=true npm run dev
```

## JSON Project Spin-Up API

Until the mailbox webhook is connected, post the project details as JSON. This endpoint currently runs step01 through step03: it copies `SMARTSHEET_GEN009_TEMPLATE_ID` into `SMARTSHEET_PROJECT_ROOT_FOLDER_PATH`, writes project info to the copied GEN009 checklist, hides the Patterson column when needed, finds and trims/logs the Project Plan sheet according to `DRY_RUN`, then updates and optionally renames the five report definitions found under the project toolkit folder:

```bash
curl -X POST http://localhost:3000/api/project-spin-up \
	-H 'Content-Type: application/json' \
	-d '{"projectName":"Example Project","projectNumber":"12345","projectType":"Commercial"}'
```

The step01 test endpoint is kept for copy-only testing:

```bash
curl -X POST http://localhost:3000/api/project-spin-up/test-step01 \
	-H 'Content-Type: application/json' \
	-d '{"projectName":"Example Project","projectNumber":"12345","projectType":"Commercial"}'
```

Both endpoints also accept email-style JSON keys, for example `{"Project Name":"Example Project","Project Number":"12345","Project Type":"Commercial"}`. The main endpoint stops after step03, so it skips OneDrive and email steps. The copy-only test endpoint stops before checklist writing, sharing, Project Plan trimming, reports, OneDrive, Master Project List reads, or email steps.

API responses include `automationReport`, which summarizes how many steps passed, failed, were skipped, need manual review, or ran in dry-run mode. If a step fails, the orchestrator records that step as failed and continues through the configured stop point; the response returns `ok: false` and `status: "failed"` when any step failed.

In Postman, choose Body -> raw -> JSON. The server also accepts raw JSON sent as `text/plain` or with no content type for local testing.

## Required API Permissions

Smartsheet scopes:

- `READ_SHEETS`
- `WRITE_SHEETS`
- `ADMIN_SHEETS`
- `SHARE_SHEETS`
- `CREATE_SIGHTS`

Microsoft Graph application permissions:

- `Mail.Read`
- `Mail.Send`
- `Files.SelectedOperations.Selected` with read grants on the template folders and write grants on the destination folders

The service uses app credentials through Entra ID. Configure `MS_GRAPH_MAILBOX_USER_ID` for the mailbox that receives forwarded Smartsheet alert emails, and `MS_GRAPH_ONEDRIVE_USER_ID` for the OneDrive owner whose drive contains the template folders.

## Client Access Checklist

Ask the client for these items before a real run:

- Smartsheet API token or OAuth app credentials for a service/automation account with admin access to the dedicated test/prod workspace.
- Smartsheet workspace ID for the safe automation workspace where we have full admin access. For the current client-provided location, this is the ID for `Z-Active Projects-Automation`; set `SMARTSHEET_PROJECT_ROOT_FOLDER_PATH=Gen oh oh nine Folder`.
- Smartsheet sheet IDs for `New GEN009`, the Master Project List / Project list sheet, and any project plan sheet if it is not discoverable in the toolkit folder.
- Office Admin Smartsheet group ID for checklist sharing.
- Confirmation that the Smartsheet alert email is delivered to `ShilatSSapi@LiviaDesignGroup.com` and includes Project Name, Project Number, `Is this a Paterson Project`, and vertical/project type using one of the configured labels in `PROJECT_TYPE_EMAIL_LABELS`.
- A sample forwarded alert email in HTML form so the parser can be tested against the real table structure.
- Confirmation that only three project types exist: `Commercial`, `Residential`, and `Patterson`.
- Confirmation that the five report names under the project toolkit folder contain `{{Update Filter}}`.
- The five report template name fragments and the account-number placeholder currently used inside report filters.
- Confirmation, on a disposable test report, whether undocumented `PUT /reports/{reportId}` rename works in the client's Smartsheet tenant before setting `SMARTSHEET_RENAME_REPORTS=true`.
- Microsoft Entra tenant ID, client ID, and client secret for the Graph app registration.
- Admin consent for Graph mailbox and OneDrive access, including access to `ShilatSSapi@LiviaDesignGroup.com` and the OneDrive/template folder owner.
- Public HTTPS webhook callback URL for Microsoft Graph subscription validation.
- OneDrive template and destination paths for CAD Files and Client Files, plus confirmation that the Graph app has read access to both templates and write access to both destinations in the OneDrive owner's drive.
- Manual checkpoint notification recipient email. Default is `satyamshukla4916@gmail.com`, but it is controlled by `MANUAL_CHECKPOINT_OWNER_EMAIL`.
- Agreement on whether read-only access to the sensitive Project list is acceptable. For contract checking, the automation needs read access to the project row plus attachment metadata/download URL; it does not need write/admin access to that sheet.

## Validation

Run a syntax-only check without requiring live credentials:

```bash
npm run check
```

## Open Questions Before Production Use

- Confirm the exact checklist row labels and column names for project info, signed status, manual summary, step refs, status, value, and link columns.
- Confirm the five double-curly-brace report template names and the account-number placeholder used inside each report definition. Report names are preserved unless `SMARTSHEET_RENAME_REPORTS=true`; that rename path uses an undocumented Smartsheet endpoint and falls back to the existing name if Smartsheet rejects it.
- Confirm whether the CMR Project Plan sheet ID should be discovered inside the project toolkit folder or whether `SMARTSHEET_PROJECT_PLAN_TEMPLATE_ID` is the correct live sheet to trim.
- Confirm the exact email label used for project type/vertical if it is not `Project Vertical`, `Project Type`, `Vertical`, or `Project Plan`. Project plan selection first checks `Is this a Paterson Project`; non-Paterson `Hospitality` projects are sent to the summary email as manual-trim errors with a Project Plan URL.
- Confirm that the signed PDF first-line check should remain `Zoho signed document ID`.
- Confirm the mailbox/OneDrive identity and Graph permission model for unattended access to the template folders.
- Confirm whether manual checkpoint notification should stay as Graph email or switch to Smartsheet update requests.
