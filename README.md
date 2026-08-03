# Smartsheet Project Spin-Up Automation Service

Production Node.js service for automating the Livia Design Group / CMR Design New Project Spin-Up workflow. It receives Microsoft Graph mailbox webhook notifications for forwarded Smartsheet alert emails, parses the project details, provisions Smartsheet and OneDrive artifacts, then hands off the two platform-blocked human steps.

## What It Automates

- Copies the `New GEN009` checklist template into the project's `Z-Active Projects` toolkit folder.
- Writes project name and number onto the copied checklist.
- Hides the Patterson column for non-Patterson projects.
- Trims the CMR Project Plan to the matching project type, gated by `DRY_RUN`.
- Shares the checklist with the Office Admin group.
- Attempts signed-contract PDF verification by checking the first line for `Zoho signed document ID`.
- Recreates five reports with project-specific names and updated account-number filters.
- Publishes the Orders report and writes its URL to the checklist.
- Copies, polls, renames, and moves the two OneDrive template folder sets.
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

## Dry Run

Set `DRY_RUN=true` to prevent destructive project-plan row deletion and to force signed-contract verification into manual-review mode. This is the recommended mode for early workspace validation.

```bash
DRY_RUN=true npm run dev
```

## Required API Permissions

Smartsheet scopes:

- `READ_SHEETS`
- `WRITE_SHEETS`
- `ADMIN_SHEETS`
- `SHARE_SHEETS`
- `CREATE_SIGHTS`

Microsoft Graph permission:

- `Files.ReadWrite`

The service uses app credentials through Entra ID. Configure `MS_GRAPH_ONEDRIVE_USER_ID` for the OneDrive owner whose drive contains the template folders.

## Client Access Checklist

Ask the client for these items before a real run:

- Smartsheet API token or OAuth app credentials for a service/automation account with admin access to the dedicated test/prod workspace.
- Smartsheet workspace ID for the safe automation workspace where we have full admin access.
- Smartsheet sheet IDs for `New GEN009`, the Master Project List / Project list sheet, and any project plan sheet if it is not discoverable in the toolkit folder.
- Office Admin Smartsheet group ID for checklist sharing.
- Confirmation that the forwarded Smartsheet alert email includes Project Name, Project Number, and vertical/project type using one of the configured labels in `PROJECT_TYPE_EMAIL_LABELS`.
- A sample forwarded alert email in HTML form so the parser can be tested against the real table structure.
- Confirmation that only three project types exist: `Commercial`, `Residential`, and `Patterson`.
- Confirmation that report artifact folders are inside the toolkit folder and have names containing `{{Update Filter}}`.
- The five report template name fragments and the account-number placeholder currently used inside report filters.
- Microsoft Entra tenant ID, client ID, and client secret for the Graph app registration.
- Admin consent for Graph mailbox and OneDrive access, including access to `ShilatSSapi@LiviaDesignGroup.com` and the OneDrive/template folder owner.
- Public HTTPS webhook callback URL for Microsoft Graph subscription validation.
- OneDrive template and destination paths for CAD Files, Client Files, and the Client Files `Production` folder.
- Manual checkpoint notification recipient email. Default is `satyamshukla4916@gmail.com`, but it is controlled by `MANUAL_CHECKPOINT_OWNER_EMAIL`.
- Agreement on whether read-only access to the sensitive Project list is acceptable. For contract checking, the automation needs read access to the project row plus attachment metadata/download URL; it does not need write/admin access to that sheet.

## Validation

Run a syntax-only check without requiring live credentials:

```bash
npm run check
```

## Open Questions Before Production Use

- Confirm the exact checklist row labels and column names for project info, signed status, manual summary, step refs, status, value, and link columns.
- Confirm the five double-curly-brace report template names and the exact `SMARTSHEET_REPORT_NAME_TEMPLATE` format, keeping Smartsheet's 50-character report-name limit in mind.
- Confirm whether the CMR Project Plan sheet ID should be discovered inside the project toolkit folder or whether `SMARTSHEET_PROJECT_PLAN_TEMPLATE_ID` is the correct live sheet to trim.
- Confirm the exact email label used for project type/vertical if it is not `Project Type`, `Vertical`, or `Project Plan`.
- Confirm that the signed PDF first-line check should remain `Zoho signed document ID`.
- Confirm the mailbox/OneDrive identity and Graph permission model for unattended access to the template folders.
- Confirm whether manual checkpoint notification should stay as Graph email or switch to Smartsheet update requests.
