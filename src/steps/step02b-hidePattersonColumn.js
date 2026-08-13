// Step 02b hides the Patterson checklist column for non-Patterson projects.
// run() skips Patterson projects, otherwise finds the configured column and updates its hidden flag.
// Helper functions map Smartsheet columns by title.

const config = require('../../config');
const { childLogger } = require('../utils/logger');
const runStateStore = require('../utils/runStateStore');
const { findColumnByTitle } = require('../utils/smartsheetSheet');

async function run(ctx) {
  const log = childLogger(ctx, 'step02b');

  if (isPatersonProject(ctx)) {
    log.info('Paterson project; leaving Paterson column visible');
    return ctx;
  }

  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const columns = (await smartsheet.get(`/sheets/${sheetId}/columns`)).data.data || [];
  const column = findColumnByTitle(columns, config.columns.checklistPatterson, ['Paterson']);

  if (!column) {
    const reason = `Checklist is missing Patterson column: ${config.columns.checklistPatterson}`;
    ctx.stepStatus.step02b = 'needs_manual_review';
    ctx.problems = ctx.problems || [];
    ctx.problems.push({ step: 'step02b', message: reason });
    await runStateStore.markStepNeedsManualReview(ctx, 'step02b', { reason });
    log.warn({ sheetId, configuredColumn: config.columns.checklistPatterson }, 'Patterson column was not found; manual checklist review required');
    return ctx;
  }

  await smartsheet.put(`/sheets/${sheetId}/columns/${column.id}`, { hidden: true });
  log.info({ sheetId, columnId: column.id }, 'hid Paterson column for non-Paterson project');
  return ctx;
}

module.exports = { run };

function isPatersonProject(ctx) {
  if (ctx.patersonProject) {
    return /^(yes|y|true)$/i.test(String(ctx.patersonProject).trim());
  }
  return /^pat{1,2}erson$/i.test(String(ctx.projectType || '').trim());
}
