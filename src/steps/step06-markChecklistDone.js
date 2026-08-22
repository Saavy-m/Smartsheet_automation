// Step 06 marks automated checklist rows as Done after successful orchestrator steps.
// markStepDone() maps a completed step ref to GEN009 template row numbers and writes Done; run() is a no-op placeholder for step-module consistency.
// Helper functions map columns, find rows by Smartsheet row number, and build Smartsheet cell payloads.

const config = require('../../config');
const { childLogger } = require('../utils/logger');

const STEP_ROW_NUMBERS = {
  step01: [],
  step02a: [9],
  step02b: [],
  step02c: [37],
  step02d: [10],
  step02e: [33],
  step03: [36],
  step04a: [],
  step04b: [45, 64]
};

async function markStepDone(ctx, stepRef) {
  const log = childLogger(ctx, 'step06');
  const rowNumbers = STEP_ROW_NUMBERS[stepRef] || [];

  if (rowNumbers.length === 0) {
    log.info({ stepRef }, 'no checklist rows mapped for step');
    return ctx;
  }

  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const sheet = (await smartsheet.get(`/sheets/${sheetId}`)).data;
  const columns = columnsByTitle(sheet);
  const statusColumn = columns[config.columns.checklistStatus];

  if (!statusColumn) {
    throw new Error('Checklist is missing status column');
  }

  const rows = rowNumbers.map((rowNumber) => findRowByNumber(sheet, rowNumber));
  const missingRowNumbers = rowNumbers.filter((rowNumber, index) => !rows[index]);

  if (missingRowNumbers.length > 0) {
    throw new Error(`Checklist is missing row number(s) ${missingRowNumbers.join(', ')} for ${stepRef}`);
  }

  await smartsheet.put(`/sheets/${sheetId}/rows`, rows.map((row) => ({
    id: row.id,
    cells: [buildCell(statusColumn, 'Done')]
  })));

  ctx.checklistRowMap[stepRef] = rows.map((row) => row.id);
  log.info({ stepRef, rowNumbers, rowIds: ctx.checklistRowMap[stepRef] }, 'marked checklist step done');
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

function findRowByNumber(sheet, rowNumber) {
  return (sheet.rows || []).find((row) => row.rowNumber === rowNumber) || null;
}

function buildCell(column, value) {
  return { columnId: column.id, value, strict: false };
}
