// Step 02a writes the project name and project number into the copied GEN009 checklist.
// run() loads the checklist sheet, updates the first Step cell, then updates legacy configured target rows/columns when present.
// Helper functions map columns, find primary-column rows, read cell values, and build Smartsheet cell payloads.

const config = require('../../config');
const { childLogger } = require('../utils/logger');

const STEP_COLUMN_NAME = 'Step';

async function run(ctx) {
  const log = childLogger(ctx, 'step02a');
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const sheet = (await smartsheet.get(`/sheets/${sheetId}`)).data;
  const columns = columnsByTitle(sheet);
  const firstStepUpdate = buildFirstStepUpdate(sheet, columns, ctx);
  const projectNameColumn = columns[config.columns.checklistProjectName];
  const projectNumberColumn = columns[config.columns.checklistProjectNumber];
  const updates = [];

  if (firstStepUpdate) {
    updates.push(firstStepUpdate);
  } else {
    log.warn({ sheetId, columnName: STEP_COLUMN_NAME }, 'checklist is missing first Step cell; skipped checklist title update');
  }

  if (!projectNameColumn || !projectNumberColumn) {
    log.warn({ sheetId }, 'checklist is missing configured project name or project number columns; skipped legacy project info update');
  } else {
    const nameRow = findRowByPrimaryValue(sheet, config.rows.projectName);
    const numberRow = findRowByPrimaryValue(sheet, config.rows.projectNumber);
    if (!nameRow || !numberRow) {
      log.warn({ sheetId }, 'checklist is missing configured project info target rows; skipped legacy project info update');
    } else {
      updates.push(
        { id: nameRow.id, cells: [buildCell(projectNameColumn, ctx.projectName)] },
        { id: numberRow.id, cells: [buildCell(projectNumberColumn, ctx.projectNumber)] }
      );

      ctx.checklistRowMap.projectName = nameRow.id;
      ctx.checklistRowMap.projectNumber = numberRow.id;
    }
  }

  if (!updates.length) {
    throw new Error('Checklist is missing first Step cell and configured project info targets');
  }

  await smartsheet.put(`/sheets/${sheetId}/rows`, updates);

  log.info({ sheetId }, 'wrote project info to checklist');
  return ctx;
}

module.exports = { run };

function columnsByTitle(sheetOrColumns) {
  const columns = Array.isArray(sheetOrColumns) ? sheetOrColumns : sheetOrColumns.columns || [];
  return Object.fromEntries(columns.map((column) => [column.title, column]));
}

function buildFirstStepUpdate(sheet, columns, ctx) {
  const stepColumn = columns[STEP_COLUMN_NAME];
  const firstRow = sheet.rows?.[0];
  if (!stepColumn || !firstRow) {
    return null;
  }

  return {
    id: firstRow.id,
    cells: [buildCell(stepColumn, `${ctx.projectName} - ${ctx.projectNumber}`)]
  };
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
