// Step 02e verifies whether the project contract attachment appears signed.
// run() respects DRY_RUN, finds a likely contract attachment, downloads/parses the PDF, writes the signed status, or records manual review.
// Helper functions find attachments, classify the first PDF line, update checklist rows, and build Smartsheet cell payloads.

const pdfParse = require('pdf-parse');
const config = require('../../config');
const { childLogger } = require('../utils/logger');
const runStateStore = require('../utils/runStateStore');
const { buildCell, findColumnByTitle, findRowByPrimaryValue } = require('../utils/smartsheetSheet');

async function run(ctx) {
  const log = childLogger(ctx, 'step02e');

  if (config.dryRun) {
    log.info('DRY_RUN enabled; contract verification marked for manual review');
    await markNeedsReview(ctx, 'DRY_RUN enabled');
    return ctx;
  }

  try {
    const attachment = await findSignedContractAttachment(ctx);
    if (!attachment) {
      await markNeedsReview(ctx, 'No Letter of Agreement attachment found');
      return ctx;
    }

    const graph = ctx.clients.graph;
    const buffer = await graph.download(attachment.url);
    const parsed = await pdfParse(buffer);
    const firstLine = (parsed.text || '').split(/\r?\n/).find(Boolean) || '';
    const signed = classifySignedStatus(firstLine);

    await writeSignedStatus(ctx, signed ? 'Yes' : 'No');
    ctx.contract = { signed, attachmentId: attachment.id, firstLine };
    log.info({ signed, attachmentId: attachment.id }, 'verified signed contract PDF first line');
    return ctx;
  } catch (error) {
    log.warn({ err: error }, 'contract verification needs manual review');
    await markNeedsReview(ctx, error.message);
    return ctx;
  }
}

async function findSignedContractAttachment(ctx) {
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.masterProjectListSheetId;
  const rowId = ctx.masterProjectRowId;
  const response = await smartsheet.get(`/sheets/${sheetId}/rows/${rowId}/attachments`);
  const attachments = response.data.data || [];
  return attachments.find((attachment) => /letter|agreement|contract|loa/i.test(attachment.name || '')) || attachments[0];
}

function classifySignedStatus(firstLine) {
  return firstLine.includes(config.signedKeyword);
}

async function writeSignedStatus(ctx, value) {
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const sheet = (await smartsheet.get(`/sheets/${sheetId}`)).data;
  const valueColumn = findColumnByTitle(sheet, config.columns.checklistValue, ['Status', 'Done']);
  const row = findRowByPrimaryValue(sheet, config.rows.signed, ['Signed LOA', 'Signed Letter of Agreement', 'Contract Signed']);

  if (!valueColumn || !row) {
    throw new Error('Checklist is missing signed-status target column or row');
  }

  await smartsheet.put(`/sheets/${sheetId}/rows`, [{ id: row.id, cells: [buildCell(valueColumn, value)] }]);
  ctx.checklistRowMap.signed = row.id;
}

async function markNeedsReview(ctx, reason) {
  ctx.stepStatus.step02e = 'needs_manual_review';
  ctx.contract = { needsManualReview: true, reason };
  ctx.problems = ctx.problems || [];
  ctx.problems.push({ step: 'step02e', message: reason });
  await runStateStore.markStepNeedsManualReview(ctx, 'step02e', { reason });
  await writeSignedStatus(ctx, 'Needs Manual Review').catch((error) => {
    ctx.log?.warn({ err: error }, 'could not write contract manual-review status to checklist');
  });
}

module.exports = { classifySignedStatus, run };
