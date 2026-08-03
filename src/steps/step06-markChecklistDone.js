const config = require('../../config');
const { childLogger } = require('../utils/logger');

async function markStepDone(ctx, stepRef) {
  const log = childLogger(ctx, 'step06');
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const sheet = (await smartsheet.get(`/sheets/${sheetId}`)).data;
  const columns = columnsByTitle(sheet);
  const statusColumn = columns[config.columns.checklistStatus];
  const row = findRowByColumnValue(sheet, config.columns.checklistStepRef, stepRef);

  if (!statusColumn || !row) {
    throw new Error(`Checklist is missing status column or row for ${stepRef}`);
  }

  await smartsheet.put(`/sheets/${sheetId}/rows`, [{
    id: row.id,
    cells: [buildCell(statusColumn, 'Done')]
  }]);

  ctx.checklistRowMap[stepRef] = row.id;
  log.info({ stepRef, rowId: row.id }, 'marked checklist step done');
  return ctx;
}

async function run(ctx) {
  return ctx;
}

module.exports = { markStepDone, run };

function columnsByTitle(sheetOrColumns) {
  const columns = Array.isArray(sheetOrColumns) ? sheetOrColumns : sheetOrColumns.columns || [];
  return Object.fromEntries(columns.map((column) => [column.title, column]));
}

function cellValue(row, columnId) {
  const cell = (row.cells || []).find((item) => item.columnId === columnId);
  return cell?.displayValue ?? cell?.value;
}

function findRowByColumnValue(sheet, columnTitle, value) {
  const column = columnsByTitle(sheet)[columnTitle];
  const expected = String(value).trim().toLowerCase();
  return (sheet.rows || []).find((row) => String(cellValue(row, column.id) || '').trim().toLowerCase() === expected) || null;
}

function buildCell(column, value) {
  return { columnId: column.id, value, strict: false };
}
