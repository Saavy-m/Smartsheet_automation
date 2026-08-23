// Step 07 emails the final automation report with manual-action URLs and failed-step recovery details.

const config = require('../../config');
const { buildAutomationReport } = require('../utils/automationReport');
const { childLogger } = require('../utils/logger');

const MAX_INLINE_ATTACHMENT_BYTES = 3 * 1024 * 1024;

async function run(ctx) {
  const log = childLogger(ctx, 'step07');
  const report = buildAutomationReport(ctx);
  const resources = await collectResources(ctx, log);
  const failureRecap = buildFailureRecap(ctx);
  const attachments = prepareEmailAttachments(ctx, log);
  const html = buildEmailHtml({ ctx, report, resources, failureRecap });

  const mailGraph = ctx.clients.mailGraph || ctx.clients.graph;

  await mailGraph.sendMail({
    fromUserId: config.graph.mailboxUserId,
    to: config.manualCheckpointOwnerEmail,
    subject: `Project Spin Up Automation Report for ${ctx.projectName} - ${failureRecap.length} ${failureRecap.length === 1 ? 'error' : 'errors'}`,
    html,
    attachments
  });

  ctx.automationReportEmail = {
    from: config.graph.mailboxUserId,
    to: config.manualCheckpointOwnerEmail,
    sentAt: new Date().toISOString(),
    resourceCount: resources.length,
    failedStepCount: failureRecap.length,
    attachmentCount: attachments.length
  };

  log.info({ to: config.manualCheckpointOwnerEmail, failedStepCount: failureRecap.length }, 'automation report email sent');
  return ctx;
}

function prepareEmailAttachments(ctx, log) {
  const attachments = [];

  for (const attachment of ctx.emailAttachments || []) {
    const byteLength = Buffer.byteLength(attachment.contentBytes || '', 'base64');
    if (byteLength > MAX_INLINE_ATTACHMENT_BYTES) {
      const warning = `${attachment.name} was not attached because it is larger than Microsoft Graph inline email attachment limits.`;
      ctx.manualCheckpoint = ctx.manualCheckpoint || {};
      ctx.manualCheckpoint.warnings = ctx.manualCheckpoint.warnings || [];
      ctx.manualCheckpoint.warnings.push(warning);
      log.warn({ attachmentName: attachment.name, byteLength }, 'skipping oversized email attachment');
      continue;
    }

    attachments.push(attachment);
    if (ctx.contract?.attachmentName === attachment.name) {
      ctx.contract.emailAttachmentIncluded = true;
    }
  }

  return attachments;
}

async function collectResources(ctx, log) {
  const smartsheet = ctx.clients.smartsheet;
  const smartsheetUrls = await resolveSmartsheetUrls({ ctx, log, smartsheet });
  ctx.resourceUrls = {
    ...(ctx.resourceUrls || {}),
    smartsheet: smartsheetUrls
  };

  const resources = [];
  const add = (role, label, url, details) => {
    if (!url && !details) {
      return;
    }
    resources.push({ role, label, url, details });
  };

  add('Manual destination', 'Project dashboard', ctx.projectDashboardUrl, 'Paste the published Orders report URL or iframe embed code into the dashboard web content widget.');
  add('Source', 'Published Orders report', ctx.publishedUrls?.ordersReport, 'Use this URL for the dashboard web content widget.');
  add('Source', 'Published Orders report embed code', ctx.publishedUrls?.ordersReport, ctx.publishedEmbeds?.ordersReport || 'Embed code unavailable; use the published report URL.');
  add('Destination', 'GEN009 checklist', smartsheetUrls.gen009Checklist, 'Checklist receiving project values, links, and manual rows.');
  add('Destination', 'Project Plan sheet', smartsheetUrls.projectPlan, 'Review this if project plan trimming failed or needs manual review.');
  add('Source', 'GEN009 template sheet', smartsheetUrls.gen009Template, 'Configured source template copied by step01.');
  add('Source', 'Automation workspace', smartsheetUrls.automationWorkspace, config.smartsheet.zActiveWorkspaceName || 'Configured Smartsheet workspace.');
  add('Destination', 'Project toolkit folder', smartsheetUrls.projectToolkitFolder, 'Destination folder for project Smartsheet artifacts.');

  for (const report of ctx.reportIds?.updatedReports || []) {
    const reportId = report.afterId || report.beforeId;
    add('Destination', report.afterName || report.beforeName || 'Updated report', smartsheetUrls.reports?.[reportId], report.filterError ? `Filter update failed: ${report.filterError}` : 'Report filter updated for this project.');
  }

  add('Destination', 'Orders report definition', smartsheetUrls.ordersReport, 'Report that was published for dashboard embedding.');
  add('Destination', 'CAD project folder', ctx.folderUrls?.oneDrive?.cad, 'Created OneDrive CAD folder.');
  add('Destination', 'Client Files project folder', ctx.folderUrls?.oneDrive?.client, 'Created OneDrive client folder.');

  await addOneDrivePathResource({ ctx, log, resources, role: 'Source', label: 'CAD template folder', path: config.oneDrive.cadTemplatePath });
  await addOneDrivePathResource({ ctx, log, resources, role: 'Destination', label: 'CAD destination folder', path: config.oneDrive.cadDestinationPath });
  await addOneDrivePathResource({ ctx, log, resources, role: 'Source', label: 'Client Files template folder', path: config.oneDrive.clientTemplatePath });
  await addOneDrivePathResource({ ctx, log, resources, role: 'Destination', label: 'Client Files destination folder', path: config.oneDrive.clientDestinationPath });

  return resources;
}

async function resolveSmartsheetUrls({ ctx, log, smartsheet }) {
  const reports = {};
  const reportIds = new Set((ctx.reportIds?.updatedReports || [])
    .map((report) => report.afterId || report.beforeId)
    .filter(Boolean));
  if (ctx.reportIds?.ordersReport) {
    reportIds.add(ctx.reportIds.ordersReport);
  }

  for (const reportId of reportIds) {
    reports[reportId] = await smartsheetPermalink({ smartsheet, log, path: `/reports/${reportId}`, label: `report ${reportId}` });
  }

  const projectToolkitFolderId = ctx.folderIds?.projectToolkit || ctx.folderIds?.projectFolder;
  return {
    gen009Checklist: await smartsheetPermalink({ smartsheet, log, path: `/sheets/${ctx.sheetIds?.gen009Checklist}`, label: 'GEN009 checklist' }),
    projectPlan: await smartsheetPermalink({ smartsheet, log, path: `/sheets/${ctx.sheetIds?.projectPlan}`, label: 'Project Plan sheet' }),
    gen009Template: await smartsheetPermalink({ smartsheet, log, path: `/sheets/${config.smartsheet.gen009TemplateId}`, label: 'GEN009 template sheet' }),
    automationWorkspace: await smartsheetPermalink({ smartsheet, log, path: `/workspaces/${config.smartsheet.zActiveWorkspaceId}`, label: 'Automation workspace' }),
    projectToolkitFolder: await smartsheetPermalink({ smartsheet, log, path: `/folders/${projectToolkitFolderId}`, label: 'Project toolkit folder' }),
    ordersReport: ctx.reportIds?.ordersReport ? reports[ctx.reportIds.ordersReport] : '',
    reports
  };
}

async function smartsheetPermalink({ smartsheet, log, path, label }) {
  if (!path || /\/undefined$|\/null$|\/replace-me$/i.test(path)) {
    return '';
  }

  try {
    const item = (await smartsheet.get(path)).data;
    return item.permalink || '';
  } catch (error) {
    log.warn({ err: error, path, label }, 'could not resolve Smartsheet permalink for report');
    return '';
  }
}

async function addOneDrivePathResource({ ctx, log, resources, role, label, path }) {
  if (!path) {
    return;
  }

  try {
    const graph = ctx.clients.oneDriveGraph || ctx.clients.graph;
    const item = (await graph.resolveDriveItemByPath(path)).data;
    resources.push({ role, label, url: item.webUrl, details: path });
  } catch (error) {
    log.warn({ err: error, path, label }, 'could not resolve OneDrive URL for report');
    resources.push({ role, label, details: `${path} (URL unavailable: ${error.message})` });
  }
}

function buildFailureRecap(ctx) {
  const problemsByStep = new Map();
  for (const problem of ctx.problems || []) {
    const step = problem.step || problem.stepRef || 'unknown';
    const list = problemsByStep.get(step) || [];
    list.push(problem);
    problemsByStep.set(step, list);
  }

  const recaps = [];
  for (const step of ctx.stepResults || []) {
    if (!['failed', 'needs_manual_review'].includes(step.status)) {
      continue;
    }
    recaps.push({
      stepRef: step.stepRef,
      status: step.status,
      message: step.message || step.outcome || 'No message recorded',
      guidance: stepGuidance(step.stepRef, ctx),
      problems: problemsByStep.get(step.stepRef) || []
    });
  }

  for (const [stepRef, problems] of problemsByStep.entries()) {
    if (!recaps.some((recap) => recap.stepRef === stepRef)) {
      recaps.push({
        stepRef,
        status: 'needs_manual_review',
        message: problems.map((problem) => problem.message).filter(Boolean).join('; ') || 'Manual review recorded',
        guidance: stepGuidance(stepRef, ctx),
        problems
      });
    }
  }

  return recaps;
}

function stepGuidance(stepRef, ctx) {
  const smartsheetUrls = ctx.resourceUrls?.smartsheet || {};
  const guidance = {
    step01: `Confirm SMARTSHEET_GEN009_TEMPLATE_ID and SMARTSHEET_PROJECT_ROOT_FOLDER_PATH, then verify the destination folder: ${smartsheetUrls.projectToolkitFolder || 'folder URL unavailable'}`,
    step02a: `Open the copied checklist and verify the configured project name/number rows and columns: ${smartsheetUrls.gen009Checklist || 'checklist URL unavailable'}`,
    step02b: `Open the copied checklist and confirm the Patterson column name matches CHECKLIST_PATTERSON_COLUMN: ${smartsheetUrls.gen009Checklist || 'checklist URL unavailable'}`,
    step02c: `Open the Project Plan sheet and trim or verify the project-type section manually: ${smartsheetUrls.projectPlan || 'project plan URL unavailable'}`,
    step02d: `Confirm OFFICE_ADMIN_GROUP_ID and Smartsheet sharing permissions for the checklist: ${smartsheetUrls.gen009Checklist || 'checklist URL unavailable'}`,
    step02e: `Contract attachment verification was not automated for this run; confirm the signed contract manually from the project records.`,
    step03: `Open the project toolkit reports and confirm each filter uses project number ${ctx.projectNumber}: ${smartsheetUrls.projectToolkitFolder || 'folder URL unavailable'}`,
    step04a: `Open the Orders report, publish it, and paste the published URL into the checklist/dashboard: ${smartsheetUrls.ordersReport || 'Orders report URL unavailable'}`,
    step04b: `Check OneDrive template and destination access for ${config.graph.oneDriveUserId}; created folder URLs are included above when available.`,
    step05: `Open the checklist manual rows and confirm the handoff summary/status cells were written: ${smartsheetUrls.gen009Checklist || 'checklist URL unavailable'}`,
    step07: `Confirm Microsoft Graph Mail.Send permission for ${config.graph.mailboxUserId} and recipient ${config.manualCheckpointOwnerEmail}.`
  };
  return guidance[stepRef] || 'Review the step error message, configured IDs, and related source/destination URLs listed in this report.';
}

function buildEmailHtml({ ctx, report, resources, failureRecap }) {
  return `
    <div style="margin:0;padding:0;background:#f4f7f9;color:#23313d;font-family:Georgia,'Times New Roman',serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f7f9;">
        <tr>
          <td align="center" style="padding:28px 14px;">
            <table role="presentation" width="760" cellspacing="0" cellpadding="0" style="width:100%;max-width:760px;border-collapse:collapse;background:#ffffff;border:1px solid #d8e1e7;">
              <tr>
                <td style="padding:28px 32px 22px 32px;background:#12323f;color:#ffffff;">
                  <div style="font-family:Verdana,Geneva,sans-serif;font-size:12px;letter-spacing:0;text-transform:uppercase;color:#a9d7df;font-weight:700;">Automation Complete</div>
                  <h1 style="margin:8px 0 0 0;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">Smartsheet Automation Report</h1>
                  <p style="margin:10px 0 0 0;font-family:Verdana,Geneva,sans-serif;font-size:14px;line-height:1.6;color:#d7e8ed;">${escapeHtml(ctx.projectName)} - ${escapeHtml(ctx.projectNumber)}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:28px 32px;">
                  <h2 style="margin:0 0 14px 0;font-size:20px;line-height:1.3;color:#12323f;">Project Summary</h2>
                  ${buildProjectSummaryTable(report)}
                </td>
              </tr>
              <tr>
                <td style="padding:0 32px 28px 32px;">
                  <h2 style="margin:0 0 14px 0;font-size:20px;line-height:1.3;color:#12323f;">Manual Steps</h2>
                  ${buildManualWorkSection(ctx)}
                </td>
              </tr>
              <tr>
                <td style="padding:0 32px 28px 32px;">
                  <h2 style="margin:0 0 14px 0;font-size:20px;line-height:1.3;color:#12323f;">Failed steps and recovery notes</h2>
                  ${buildFailureSection(failureRecap)}
                </td>
              </tr>
              <tr>
                <td style="padding:26px 32px 32px 32px;background:#eef4f6;border-top:1px solid #d8e1e7;">
                  <h2 style="margin:0 0 14px 0;font-size:20px;line-height:1.3;color:#12323f;">Developer's Desk - Automation Logs</h2>
                  <h3 style="margin:18px 0 10px 0;font-family:Verdana,Geneva,sans-serif;font-size:14px;line-height:1.4;color:#315163;">Source and destination URLs</h3>
                  ${buildResourcesTable(resources)}
                  <h3 style="margin:22px 0 10px 0;font-family:Verdana,Geneva,sans-serif;font-size:14px;line-height:1.4;color:#315163;">All step results</h3>
                  ${buildStepsTable(report.steps)}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function buildProjectSummaryTable(report) {
  const rows = [
    ['Project Name', report.projectName],
    ['Project Number', report.projectNumber],
    ['Project Type', report.projectType || 'Not recorded'],
    ['Contract Signed', buildContractSignedSummary(report)],
    ['Run ID', report.runId],
    ['Completed Steps', report.passedSteps],
    ['Failed Steps', report.failedSteps],
    ['Manual Review Steps', report.manualReviewSteps]
  ];

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d8e1e7;font-family:Verdana,Geneva,sans-serif;font-size:13px;line-height:1.45;">
      <tbody>
        ${rows.map(([label, value]) => `
          <tr>
            <th align="left" style="width:34%;padding:11px 12px;background:#f7fafb;border-bottom:1px solid #e5edf1;color:#315163;font-weight:700;">${escapeHtml(label)}</th>
            <td style="padding:11px 12px;border-bottom:1px solid #e5edf1;color:#23313d;">${renderSummaryValue(value)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function buildContractSignedSummary(report) {
  const contract = report.contract || {};
  let label = 'Not checked';
  if (contract.signed === true) {
    label = 'Yes';
  } else if (contract.signed === false) {
    label = 'No - unsigned PDF';
  } else if (contract.needsManualReview) {
    label = 'Needs manual review';
  }

  if (contract.attachmentName) {
    const attachmentNote = contract.emailAttachmentIncluded ? ' - see attachments' : '';
    label = `${label} (${contract.attachmentName}${attachmentNote})`;
  }

  return {
    label
  };
}

function renderSummaryValue(value) {
  if (!value || typeof value !== 'object') {
    return escapeHtml(value);
  }
  const text = escapeHtml(value.label || '');
  if (!value.url) {
    return text;
  }
  return `${text}<div style="margin-top:4px;">${buildNamedLink(value.linkLabel || 'Open link', value.url)}</div>`;
}

function buildManualWorkSection(ctx) {
  const tasks = Array.isArray(ctx.manualCheckpoint?.tasks) ? ctx.manualCheckpoint.tasks : [];
  if (!tasks.length && !ctx.manualCheckpoint?.summary) {
    return '<p>No manual handoff instructions were recorded.</p>';
  }

  const warnings = ctx.manualCheckpoint.warnings || [];
  const warningHtml = warnings.length
    ? `<div style="margin:16px 0 0 0;padding:12px 14px;background:#fff8e8;border:1px solid #ead49a;font-family:Verdana,Geneva,sans-serif;font-size:13px;line-height:1.5;color:#5c4619;"><strong>Non-blocking handoff notes:</strong><ul style="margin:8px 0 0 18px;padding:0;">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div>`
    : '';

  if (!tasks.length) {
    return `<pre style="white-space:pre-wrap;margin:0;padding:14px;background:#f7fafb;border:1px solid #d8e1e7;font-family:Verdana,Geneva,sans-serif;font-size:13px;line-height:1.5;color:#23313d;">${escapeHtml(ctx.manualCheckpoint.summary)}</pre>${warningHtml}`;
  }

  return `${tasks.map((task, index) => buildManualTaskCard(task, index)).join('')}${warningHtml}`;
}

function buildManualTaskCard(task, index) {
  const sharedDomains = task.sharedDomains?.length
    ? `<tr><th align="left" style="padding:8px 10px;color:#315163;vertical-align:top;">Shared Domains</th><td style="padding:8px 10px;color:#23313d;">${task.sharedDomains.map(escapeHtml).join('<br>')}</td></tr>`
    : '';

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px 0;border-collapse:collapse;border:1px solid #d8e1e7;background:#fbfdfe;font-family:Verdana,Geneva,sans-serif;font-size:13px;line-height:1.5;">
      <tr>
        <td style="padding:15px 16px;background:#e7f1f3;border-bottom:1px solid #d8e1e7;">
          <div style="font-size:12px;color:#496879;font-weight:700;text-transform:uppercase;letter-spacing:0;">Task ${index + 1}</div>
          <div style="margin-top:3px;font-size:16px;color:#12323f;font-weight:700;">${escapeHtml(task.title)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 6px 12px 6px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <tr><th align="left" style="width:26%;padding:8px 10px;color:#315163;vertical-align:top;">Source</th><td style="padding:8px 10px;color:#23313d;">${buildNamedLink(task.sourceLabel, task.sourceUrl)}</td></tr>
            <tr><th align="left" style="padding:8px 10px;color:#315163;vertical-align:top;">Destination</th><td style="padding:8px 10px;color:#23313d;">${buildNamedLink(task.destinationLabel, task.destinationUrl)}</td></tr>
            ${sharedDomains}
            <tr><th align="left" style="padding:8px 10px;color:#315163;vertical-align:top;">Task Details</th><td style="padding:8px 10px;color:#23313d;">${escapeHtml(task.details)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function buildResourcesTable(resources) {
  if (!resources.length) {
    return '<p>No source or destination URLs were recorded.</p>';
  }

  const rows = resources.map((resource) => `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid #d8e1e7;color:#315163;">${escapeHtml(resource.role)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #d8e1e7;color:#23313d;font-weight:700;">${escapeHtml(resource.label)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #d8e1e7;color:#23313d;">${resource.url ? `<a href="${escapeAttribute(resource.url)}" style="color:#0f6674;text-decoration:underline;">Open link</a>` : 'URL unavailable'}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #d8e1e7;color:#496879;">${escapeHtml(resource.details || '')}</td>
    </tr>
  `).join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #d8e1e7;font-family:Verdana,Geneva,sans-serif;font-size:12px;line-height:1.45;">
      <thead><tr><th align="left" style="padding:9px 10px;background:#dfecef;color:#12323f;">Role</th><th align="left" style="padding:9px 10px;background:#dfecef;color:#12323f;">Item</th><th align="left" style="padding:9px 10px;background:#dfecef;color:#12323f;">URL</th><th align="left" style="padding:9px 10px;background:#dfecef;color:#12323f;">Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildFailureSection(failureRecap) {
  const contactHtml = buildRecoveryContactFooter();
  if (!failureRecap.length) {
    return `<p style="margin:0 0 12px 0;font-family:Verdana,Geneva,sans-serif;font-size:13px;line-height:1.5;color:#23313d;">No failed steps were recorded.</p>${contactHtml}`;
  }

  return `${failureRecap.map((failure) => `
    <div style="margin:0 0 12px 0;padding:12px 14px;background:#ffffff;border:1px solid #d8e1e7;font-family:Verdana,Geneva,sans-serif;font-size:13px;line-height:1.5;color:#23313d;">
    <p style="margin:0 0 8px 0;"><strong>${escapeHtml(failure.stepRef)}:</strong> ${escapeHtml(failure.status)}</p>
    <p style="margin:0 0 8px 0;"><strong>Error:</strong> ${escapeHtml(failure.message)}</p>
    <p style="margin:0;"><strong>Fix guidance:</strong> ${linkifyText(failure.guidance)}</p>
    ${failure.problems.map((problem) => `
      <p style="margin:8px 0 0 0;"><strong>Relevant info:</strong> ${escapeHtml(problem.message || '')}${problem.guidance ? `<br><strong>Recorded guidance:</strong> ${linkifyText(problem.guidance)}` : ''}</p>
    `).join('')}
    </div>
  `).join('')}${contactHtml}`;
}

function buildRecoveryContactFooter() {
  return `
    <div style="margin:14px 0 0 0;padding:12px 14px;background:#f7fafb;border:1px solid #d8e1e7;font-family:Verdana,Geneva,sans-serif;font-size:13px;line-height:1.5;color:#23313d;">
      <strong>Contact for recovery support:</strong>
      <a href="mailto:satyamofficial4916@gmail.com" style="color:#0f6674;text-decoration:underline;">satyamofficial4916@gmail.com</a>
      and
      <a href="mailto:aron@cmr-design.com" style="color:#0f6674;text-decoration:underline;">aron@cmr-design.com</a>
    </div>
  `;
}

function buildStepsTable(steps) {
  if (!steps.length) {
    return '<p>No step results were recorded.</p>';
  }

  const rows = steps.map((step) => `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid #d8e1e7;color:#23313d;font-weight:700;">${escapeHtml(step.stepRef)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #d8e1e7;color:#315163;">${escapeHtml(step.status)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #d8e1e7;color:#23313d;">${escapeHtml(step.message || step.outcome || '')}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #d8e1e7;color:#496879;">${escapeHtml(step.completedAt || '')}</td>
    </tr>
  `).join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #d8e1e7;font-family:Verdana,Geneva,sans-serif;font-size:12px;line-height:1.45;">
      <thead><tr><th align="left" style="padding:9px 10px;background:#dfecef;color:#12323f;">Step</th><th align="left" style="padding:9px 10px;background:#dfecef;color:#12323f;">Status</th><th align="left" style="padding:9px 10px;background:#dfecef;color:#12323f;">Message</th><th align="left" style="padding:9px 10px;background:#dfecef;color:#12323f;">Recorded at</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildNamedLink(label, url) {
  if (!url) {
    return `${escapeHtml(label || 'URL')} unavailable`;
  }
  return `<a href="${escapeAttribute(url)}" style="color:#0f6674;text-decoration:underline;font-weight:700;">${escapeHtml(label || url)}</a><div style="margin-top:3px;color:#496879;word-break:break-word;">${escapeHtml(url)}</div>`;
}

function smartsheetSheetUrl(id) {
  return id ? `https://app.smartsheet.com/sheets/${encodeURIComponent(id)}` : '';
}

function smartsheetReportUrl(id) {
  return id ? `https://app.smartsheet.com/reports/${encodeURIComponent(id)}` : '';
}

function smartsheetFolderUrl(id) {
  return id ? `https://app.smartsheet.com/folders/${encodeURIComponent(id)}` : '';
}

function smartsheetWorkspaceUrl(id) {
  return id ? `https://app.smartsheet.com/workspaces/${encodeURIComponent(id)}` : '';
}

function linkifyText(value) {
  const escaped = escapeHtml(value);
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${escapeAttribute(url)}">${url}</a>`);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

module.exports = { run };