// Step 04a publishes the Orders report and writes the published URL back to the GEN009 checklist.
// run() resolves the Orders report ID, enables read-only publishing, stores the URL/embed code, and updates the checklist link row.
// Helper functions find the Orders report, locate checklist rows/columns, read cell values, and build Smartsheet cell payloads.

const config = require('../../config');
const { childLogger } = require('../utils/logger');
const { buildCell, findColumnByTitle, findRowByPrimaryValue } = require('../utils/smartsheetSheet');

async function run(ctx) {
  const log = childLogger(ctx, 'step04a');
  const smartsheet = ctx.clients.smartsheet;
  const reportId = ctx.reportIds.ordersReport || findOrdersReportId(ctx);

  if (!reportId) {
    log.warn('Orders report ID was not found after report update step; manual report link remains required');
    ctx.ordersReportPublish = {
      needsManualLink: true,
      reason: 'Orders report ID was not found after report update step'
    };
    return ctx;
  }

  let published;
  try {
    published = (await smartsheet.put(`/reports/${reportId}/publish`, {
      readOnlyFullEnabled: true,
      readOnlyFullAccessibleBy: config.smartsheet.ordersReportPublishAccessLevel,
      readOnlyFullDefaultView: 'GRID'
    })).data;
  } catch (error) {
    log.warn({ err: error, reportId }, 'could not publish Orders report automatically; manual report link remains required');
    ctx.reportIds.ordersReport = reportId;
    ctx.ordersReportPublish = {
      needsManualLink: true,
      reason: error.message
    };
    return ctx;
  }

  const url = published.readOnlyFullUrl || published.result?.readOnlyFullUrl;
  if (!url) {
    log.warn({ reportId }, 'Smartsheet publish response did not include readOnlyFullUrl; manual report link remains required');
    ctx.reportIds.ordersReport = reportId;
    ctx.ordersReportPublish = {
      needsManualLink: true,
      reason: 'Smartsheet publish response did not include readOnlyFullUrl'
    };
    return ctx;
  }

  const embedCode = buildEmbedCode(url);
  ctx.publishedUrls.ordersReport = url;
  ctx.publishedEmbeds = ctx.publishedEmbeds || {};
  ctx.publishedEmbeds.ordersReport = embedCode;
  ctx.publishStatus = ctx.publishStatus || {};
  ctx.publishStatus.ordersReport = published.result || published;
  ctx.reportIds.ordersReport = reportId;

  try {
    await writeOrdersReportUrl(ctx, url);
  } catch (error) {
    log.warn({ err: error, reportId }, 'published Orders report but could not write URL to checklist; URL will be provided in report');
    ctx.ordersReportPublish = {
      ...(ctx.ordersReportPublish || {}),
      checklistWriteSkipped: true,
      checklistWriteReason: error.message
    };
  }

  log.info({ reportId, checklistWriteSkipped: Boolean(ctx.ordersReportPublish?.checklistWriteSkipped) }, 'published Orders report');
  return ctx;
}

function buildEmbedCode(url) {
  return `<iframe src="${escapeAttribute(url)}" width="100%" height="650" frameborder="0"></iframe>`;
}

function escapeAttribute(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  const linkColumn = findColumnByTitle(sheet, config.columns.checklistLink, ['URL', 'Published URL', 'Report Link', config.columns.checklistValue]);
  const row = findRowByPrimaryValue(sheet, config.smartsheet.ordersReportMatch, ['Project Orders', 'Order Report', 'Orders Report', 'Published Orders Report']);

  if (!linkColumn || !row) {
    throw new Error('Checklist is missing Orders report link target column or row');
  }

  await smartsheet.put(`/sheets/${sheetId}/rows`, [{ id: row.id, cells: [buildCell(linkColumn, url)] }]);
  ctx.checklistRowMap.ordersReportLink = row.id;
}

module.exports = { run };
