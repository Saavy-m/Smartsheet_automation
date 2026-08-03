const config = require('../../config');
const { childLogger } = require('../utils/logger');

async function run(ctx) {
  const log = childLogger(ctx, 'step02a');
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const sheet = (await smartsheet.get(`/sheets/${sheetId}`)).data;
  const columns = columnsByTitle(sheet);
  const projectNameColumn = columns[config.columns.checklistProjectName];
  const projectNumberColumn = columns[config.columns.checklistProjectNumber];

  if (!projectNameColumn || !projectNumberColumn) {
    throw new Error('Checklist is missing configured project name or project number columns');
  }

  const nameRow = findRowByPrimaryValue(sheet, config.rows.projectName);
  const numberRow = findRowByPrimaryValue(sheet, config.rows.projectNumber);
  if (!nameRow || !numberRow) {
    throw new Error('Checklist is missing configured project info target rows');
  }

  await smartsheet.put(`/sheets/${sheetId}/rows`, [
    { id: nameRow.id, cells: [buildCell(projectNameColumn, ctx.projectName)] },
    { id: numberRow.id, cells: [buildCell(projectNumberColumn, ctx.projectNumber)] }
  ]);

  ctx.checklistRowMap.projectName = nameRow.id;
  ctx.checklistRowMap.projectNumber = numberRow.id;
  log.info({ sheetId }, 'wrote project name and number to checklist');
  return ctx;
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
