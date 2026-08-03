const config = require('../../config');
const { childLogger } = require('../utils/logger');

async function run(ctx) {
  const log = childLogger(ctx, 'step05');
  const summary = [
    'Manual steps remaining:',
    `1. Paste the Orders report URL into the dashboard web content widget: ${ctx.publishedUrls.ordersReport || 'URL unavailable'}`,
    '2. Create, filter, domain-share, and link the Dynamic View using the Smartsheet Admin browser profile.',
    '',
    `Signed contract: ${formatSignedStatus(ctx)}`,
    '',
    formatProblems(ctx)
  ].join('\n');

  await writeManualSummary(ctx, summary);
  await markManualRows(ctx);
  await notifyOwner(ctx, summary);

  ctx.manualCheckpoint = {
    owner: config.manualCheckpointOwnerEmail,
    ordersReportUrl: ctx.publishedUrls.ordersReport,
    tasks: ['dashboard_orders_report_url_paste', 'dynamic_view_setup']
  };

  log.info({ owner: config.manualCheckpointOwnerEmail }, 'manual checkpoint handoff completed');
  return ctx;
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

async function notifyOwner(ctx, summary) {
  const graph = ctx.clients.graph;
  const html = `<p>Project spin-up automation has completed for <strong>${escapeHtml(ctx.projectNumber)} ${escapeHtml(ctx.projectName)}</strong>.</p><pre>${escapeHtml(summary)}</pre>`;
  await graph.sendMail({
    fromUserId: config.graph.mailboxUserId,
    to: config.manualCheckpointOwnerEmail,
    subject: `Manual Smartsheet steps remaining: ${ctx.projectNumber}`,
    html
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatSignedStatus(ctx) {
  if (ctx.contract?.needsManualReview) {
    return `Needs manual review (${ctx.contract.reason})`;
  }
  if (ctx.contract?.signed === true) {
    return 'Yes';
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
  return ['Automation problems:', ...problems.map((problem) => `- ${problem.step}: ${problem.message}`)].join('\n');
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
  const expected = String(value).trim().toLowerCase();
  return (sheet.rows || []).find((row) => String(cellValue(row, column.id) || '').trim().toLowerCase() === expected) || null;
}

function buildCell(column, value) {
  return { columnId: column.id, value, strict: false };
}
