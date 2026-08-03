const config = require('../../config');
const { childLogger } = require('../utils/logger');

async function run(ctx) {
  const log = childLogger(ctx, 'step02c');
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.projectPlan || config.smartsheet.projectPlanTemplateId;
  const sheet = (await smartsheet.get(`/sheets/${sheetId}`)).data;
  const rowsToDelete = findRowsOutsideProjectType(sheet, ctx.projectType);

  log.warn({
    dryRun: config.dryRun,
    sheetId,
    rowIds: rowsToDelete.map((row) => row.id),
    rows: rowsToDelete.map((row) => ({ id: row.id, cells: row.cells }))
  }, 'project plan trim candidates');

  if (config.dryRun) {
    ctx.stepStatus.step02c = 'dry_run';
    return ctx;
  }

  for (const batch of chunk(rowsToDelete, 10)) {
    await smartsheet.delete(`/sheets/${sheetId}/rows`, {
      query: { ids: batch.map((row) => row.id).join(',') }
    });
  }

  ctx.sheetIds.projectPlan = sheetId;
  log.info({ deletedRowCount: rowsToDelete.length }, 'trimmed non-matching project plan sections');
  return ctx;
}

function findRowsOutsideProjectType(sheet, projectType) {
  const primary = primaryColumn(sheet);
  if (!primary) {
    throw new Error('Project Plan sheet has no primary column');
  }

  const sectionNames = config.projectPlanSectionNames;
  const normalizedType = normalizeProjectType(projectType);
  const sectionStarts = [];

  (sheet.rows || []).forEach((row, index) => {
    const value = String(cellValue(row, primary.id) || '').trim();
    const matched = sectionNames.find((section) => value.toLowerCase() === section.toLowerCase());
    if (matched) {
      sectionStarts.push({ name: normalizeProjectType(matched), index });
    }
  });

  if (sectionStarts.length < 3) {
    throw new Error('Could not identify all three Project Plan sections');
  }

  const rows = sheet.rows || [];
  const rowsToDelete = [];
  sectionStarts.forEach((section, position) => {
    const next = sectionStarts[position + 1]?.index ?? rows.length;
    if (section.name !== normalizedType) {
      rowsToDelete.push(...rows.slice(section.index, next));
    }
  });

  return rowsToDelete;
}

function normalizeProjectType(value) {
  if (/^hospitality$/i.test(value)) return 'Residential';
  if (/^commercial$/i.test(value)) return 'Commercial';
  if (/^residential$/i.test(value)) return 'Residential';
  if (/^patterson$/i.test(value)) return 'Patterson';
  return String(value || '').trim();
}

function primaryColumn(sheet) {
  return (sheet.columns || []).find((column) => column.primary) || sheet.columns?.[0];
}

function cellValue(row, columnId) {
  const cell = (row.cells || []).find((item) => item.columnId === columnId);
  return cell?.displayValue ?? cell?.value;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

module.exports = { findRowsOutsideProjectType, run };
