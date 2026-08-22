// Step 05 writes the manual handoff summary, marks manual checklist rows, and records handoff metadata for the final automation report.
// run() builds the dashboard/Dynamic View handoff summary and updates checklist rows.
// Helper functions write checklist cells, format email HTML/status/problem text, locate rows/columns, and build Smartsheet cell payloads.

const config = require('../../config');
const { childLogger } = require('../utils/logger');

const DYNAMIC_VIEW_SOURCE_URL = 'https://app.smartsheet.com/dynamicview/views/d9e9377f-6857-4475-9853-b6eb27571526/admin/basic';
const DYNAMIC_VIEW_SHARED_DOMAINS = [
  'CMR-Design.com',
  'LiviaDesigngroup.com',
  'LiviaDesign.com',
  'SusanStraussDesign.com'
];

async function run(ctx) {
  const log = childLogger(ctx, 'step05');
  const manualTasks = await buildManualTasks(ctx, log);
  const summary = buildManualSummary(ctx, manualTasks);

  try {
    await writeManualSummary(ctx, summary);
  } catch (error) {
    log.warn({ err: error }, 'manual handoff summary could not be written to checklist; continuing because this is manual work');
    ctx.manualCheckpointWarnings = ctx.manualCheckpointWarnings || [];
    ctx.manualCheckpointWarnings.push(`Checklist summary not written: ${error.message}`);
  }

  try {
    await markManualRows(ctx);
  } catch (error) {
    log.warn({ err: error }, 'manual checklist rows could not be marked; continuing because this is manual work');
    ctx.manualCheckpointWarnings = ctx.manualCheckpointWarnings || [];
    ctx.manualCheckpointWarnings.push(`Manual checklist rows not marked: ${error.message}`);
  }

  ctx.manualCheckpoint = {
    owner: config.manualCheckpointOwnerEmail,
    ordersReportUrl: manualTasks[0].sourceUrl,
    dashboardUrl: manualTasks[0].destinationUrl,
    tasks: manualTasks,
    summary,
    warnings: ctx.manualCheckpointWarnings || []
  };

  log.info({ owner: config.manualCheckpointOwnerEmail, warningCount: ctx.manualCheckpointWarnings?.length || 0 }, 'manual checkpoint handoff recorded');
  return ctx;
}

async function buildManualTasks(ctx, log) {
  const ordersReportUrl = await resolveOrdersReportUrl(ctx, log);
  const dashboardUrl = await resolveDashboardUrl(ctx, log);

  return [
    {
      id: 'publish-order-report-widget',
      title: 'Publish the Order Report Widget to the dashboard',
      sourceLabel: 'Project Order report',
      sourceUrl: ordersReportUrl,
      destinationLabel: 'Project Dashboard',
      destinationUrl: dashboardUrl,
      details: 'Click Publish in the Order report, copy the provided embed code, then open the destination dashboard and double click the current widget to replace it.'
    },
    {
      id: 'publish-dynamic-view-pencil-widget',
      title: 'Publish Dynamic View to pencil icon',
      sourceLabel: 'Dynamic View sharing settings',
      sourceUrl: DYNAMIC_VIEW_SOURCE_URL,
      destinationLabel: 'Project Dashboard',
      destinationUrl: dashboardUrl,
      sharedDomains: DYNAMIC_VIEW_SHARED_DOMAINS,
      details: 'Go to the Dynamic View source, open the Sharing tab, add the shared domains, return to View, copy the browser URL, then open the destination dashboard and double click the pencil widget. Paste the copied URL under widget behavior.'
    }
  ];
}

function buildManualSummary(ctx, manualTasks) {
  const lines = ['Manual steps remaining:'];

  manualTasks.forEach((task, index) => {
    lines.push(
      '',
      `${index + 1}. ${task.title}`,
      `Source: ${task.sourceUrl || `${task.sourceLabel} URL unavailable`}`,
      `Destination: ${task.destinationUrl || `${task.destinationLabel} URL unavailable`}`
    );
    if (task.sharedDomains?.length) {
      lines.push(`Shared domains: ${task.sharedDomains.join(', ')}`);
    }
    lines.push(`Task details: ${task.details}`);
  });

  lines.push('', `Signed contract: ${formatSignedStatus(ctx)}`, '', formatProblems(ctx));
  return lines.join('\n');
}

async function resolveOrdersReportUrl(ctx, log) {
  const reportId = ctx.reportIds?.ordersReport || findProjectOrderReportId(ctx);
  if (!reportId) {
    return ctx.publishedUrls?.ordersReport || '';
  }

  try {
    const report = (await ctx.clients.smartsheet.get(`/reports/${reportId}`)).data;
    return report.permalink || ctx.publishedUrls?.ordersReport || '';
  } catch (error) {
    log.warn({ err: error, reportId }, 'could not resolve Project Order report URL for manual checkpoint');
    return ctx.publishedUrls?.ordersReport || '';
  }
}

function findProjectOrderReportId(ctx) {
  const match = (ctx.reportIds?.updatedReports || []).find((report) => {
    const name = `${report.afterName || ''} ${report.beforeName || ''}`.toLowerCase();
    return name.includes('project order') || name.includes('orders report') || name.includes('order report');
  });
  return match?.afterId || match?.beforeId || '';
}

async function resolveDashboardUrl(ctx, log) {
  if (ctx.projectDashboardUrl) {
    return ctx.projectDashboardUrl;
  }

  const folderId = ctx.folderIds?.projectToolkit || ctx.folderIds?.projectFolder;
  if (!folderId) {
    return '';
  }

  try {
    const folder = (await ctx.clients.smartsheet.get(`/folders/${folderId}`)).data;
    const dashboard = await findProjectDashboard(ctx.clients.smartsheet, folder);
    if (!dashboard) {
      return '';
    }
    const dashboardUrl = dashboard.permalink || await resolveDashboardPermalink(ctx.clients.smartsheet, dashboard.id, log);
    ctx.projectDashboardUrl = dashboardUrl;
    return dashboardUrl;
  } catch (error) {
    log.warn({ err: error, folderId }, 'could not resolve Project Dashboard URL for manual checkpoint');
    return '';
  }
}

async function findProjectDashboard(smartsheet, container) {
  const match = (container.sights || []).find((item) => String(item.name || '').toLowerCase().includes('project dashboard'));
  if (match) {
    return match;
  }

  for (const folder of container.folders || []) {
    const folderDetails = folder.sights ? folder : (await smartsheet.get(`/folders/${folder.id}`)).data;
    const nested = await findProjectDashboard(smartsheet, folderDetails);
    if (nested) {
      return nested;
    }
  }

  return null;
}

async function resolveDashboardPermalink(smartsheet, dashboardId, log) {
  try {
    const dashboard = (await smartsheet.get(`/sights/${dashboardId}`)).data;
    return dashboard.permalink || '';
  } catch (error) {
    log.warn({ err: error, dashboardId }, 'could not resolve Project Dashboard permalink');
    return dashboardId ? `https://app.smartsheet.com/dashboards/${encodeURIComponent(dashboardId)}` : '';
  }
}

async function writeManualSummary(ctx, summary) {
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const sheet = (await smartsheet.get(`/sheets/${sheetId}`)).data;
  const columns = columnsByTitle(sheet);
  const valueColumn = columns[config.columns.checklistValue];
  const row = findRowByPrimaryValue(sheet, config.rows.manualSummary);

  if (!valueColumn || !row) {
    throw new Error('Checklist is missing manual summary target column or row');
  }

  await smartsheet.put(`/sheets/${sheetId}/rows`, [{ id: row.id, cells: [buildCell(valueColumn, summary)] }]);
  ctx.checklistRowMap.manualSummary = row.id;
}

async function markManualRows(ctx) {
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const sheet = (await smartsheet.get(`/sheets/${sheetId}`)).data;
  const columns = columnsByTitle(sheet);
  const statusColumn = columns[config.columns.checklistStatus];

  if (!statusColumn) {
    throw new Error('Checklist is missing status column');
  }

  const dashboardRow = findRowByColumnValue(sheet, config.columns.checklistStepRef, 'manual-dashboard-widget');
  const dynamicViewRow = findRowByColumnValue(sheet, config.columns.checklistStepRef, 'manual-dynamic-view');
  const rows = [dashboardRow, dynamicViewRow].filter(Boolean);

  if (rows.length !== 2) {
    throw new Error('Checklist is missing manual checkpoint rows');
  }

  await smartsheet.put(`/sheets/${sheetId}/rows`, rows.map((row) => ({
    id: row.id,
    cells: [buildCell(statusColumn, 'Needs Manual Action')]
  })));
}

function formatSignedStatus(ctx) {
  if (ctx.contract?.needsManualReview) {
    return `Needs manual review (${ctx.contract.reason})`;
  }
  if (ctx.contract?.signed === true) {
    return ctx.contract.signedLine || 'Yes';
  }
  if (ctx.contract?.signed === false) {
    return 'No';
  }
  return 'Not checked';
}

function formatProblems(ctx) {
  const problems = ctx.problems || [];
  if (problems.length === 0) {
    return 'Automation problems: None reported.';
  }
  return ['Automation problems:', ...problems.map(formatProblem)].join('\n');
}

function formatProblem(problem) {
  const lines = [`- ${problem.step}: ${problem.message}`];
  if (problem.guidance) {
    lines.push(`  Guidance: ${problem.guidance}`);
  }
  return lines.join('\n');
}

module.exports = { run };

function columnsByTitle(sheetOrColumns) {
  const columns = Array.isArray(sheetOrColumns) ? sheetOrColumns : sheetOrColumns.columns || [];
  return Object.fromEntries(columns.map((column) => [column.title, column]));
}

function primaryColumn(sheet) {
  return (sheet.columns || []).find((column) => column.primary) || sheet.columns?.[0];
}

function cellValue(row, columnId) {
  const cell = (row.cells || []).find((item) => item.columnId === columnId);
  return cell?.displayValue ?? cell?.value;
}

function findRowByPrimaryValue(sheet, value) {
  const primary = primaryColumn(sheet);
  const expected = String(value).trim().toLowerCase();
  return (sheet.rows || []).find((row) => String(cellValue(row, primary.id) || '').trim().toLowerCase() === expected) || null;
}

function findRowByColumnValue(sheet, columnTitle, value) {
  const column = columnsByTitle(sheet)[columnTitle];
  if (!column) {
    return null;
  }
  const expected = String(value).trim().toLowerCase();
  return (sheet.rows || []).find((row) => String(cellValue(row, column.id) || '').trim().toLowerCase() === expected) || null;
}

function buildCell(column, value) {
  return { columnId: column.id, value, strict: false };
}
