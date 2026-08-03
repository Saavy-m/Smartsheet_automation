const config = require('../../config');
const { childLogger } = require('../utils/logger');

async function run(ctx) {
  const log = childLogger(ctx, 'step04a');
  const smartsheet = ctx.clients.smartsheet;
  const reportId = ctx.reportIds.ordersReport || findOrdersReportId(ctx);

  if (!reportId) {
    throw new Error('Orders report ID was not found after report update step');
  }

  const published = (await smartsheet.put(`/reports/${reportId}/publish`, {
    readOnlyFullEnabled: true,
    accessLevel: config.smartsheet.ordersReportPublishAccessLevel
  })).data;

  const url = published.readOnlyFullUrl || published.result?.readOnlyFullUrl;
  if (!url) {
    throw new Error('Smartsheet publish response did not include readOnlyFullUrl');
  }

  await writeOrdersReportUrl(ctx, url);
  ctx.publishedUrls.ordersReport = url;
  ctx.reportIds.ordersReport = reportId;
  log.info({ reportId }, 'published Orders report and wrote URL to checklist');
  return ctx;
}

function findOrdersReportId(ctx) {
  const match = (ctx.reportIds.updatedReports || []).find((report) => {
    return report.afterName.toLowerCase().includes(config.smartsheet.ordersReportMatch.toLowerCase());
  });
  return match?.afterId;
}

async function writeOrdersReportUrl(ctx, url) {
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const sheet = (await smartsheet.get(`/sheets/${sheetId}`)).data;
  const columns = columnsByTitle(sheet);
  const linkColumn = columns[config.columns.checklistLink];
  const row = findRowByPrimaryValue(sheet, config.smartsheet.ordersReportMatch);

  if (!linkColumn || !row) {
    throw new Error('Checklist is missing Orders report link target column or row');
  }

  await smartsheet.put(`/sheets/${sheetId}/rows`, [{ id: row.id, cells: [buildCell(linkColumn, url)] }]);
  ctx.checklistRowMap.ordersReportLink = row.id;
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

function buildCell(column, value) {
  return { columnId: column.id, value, strict: false };
}
