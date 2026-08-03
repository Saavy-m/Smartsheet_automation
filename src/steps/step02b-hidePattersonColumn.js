const config = require('../../config');
const { childLogger } = require('../utils/logger');

async function run(ctx) {
  const log = childLogger(ctx, 'step02b');

  if (ctx.projectType === 'Patterson') {
    log.info('Patterson project; leaving Patterson column visible');
    return ctx;
  }

  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const columns = (await smartsheet.get(`/sheets/${sheetId}/columns`)).data.data || [];
  const column = columnsByTitle(columns)[config.columns.checklistPatterson];

  if (!column) {
    throw new Error(`Checklist is missing Patterson column: ${config.columns.checklistPatterson}`);
  }

  await smartsheet.put(`/sheets/${sheetId}/columns/${column.id}`, { hidden: true });
  log.info({ sheetId, columnId: column.id }, 'hid Patterson column for non-Patterson project');
  return ctx;
}

module.exports = { run };

function columnsByTitle(sheetOrColumns) {
  const columns = Array.isArray(sheetOrColumns) ? sheetOrColumns : sheetOrColumns.columns || [];
  return Object.fromEntries(columns.map((column) => [column.title, column]));
}
