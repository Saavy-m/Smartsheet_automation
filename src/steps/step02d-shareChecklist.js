// Step 02d shares the copied GEN009 checklist with the configured Office Admin Smartsheet group.
// run() sends the Smartsheet share request and records the share target in logs.

const config = require('../../config');
const { childLogger } = require('../utils/logger');
const runStateStore = require('../utils/runStateStore');

async function run(ctx) {
  const log = childLogger(ctx, 'step02d');
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const groupId = config.smartsheet.officeAdminGroupId;

  if (isPlaceholderGroupId(groupId)) {
    await markNeedsManualReview(ctx, `OFFICE_ADMIN_GROUP_ID is not configured: ${groupId}`);
    log.warn({ sheetId, groupId }, 'Office Admin group ID is not configured; manual checklist sharing required');
    return ctx;
  }

  try {
    await smartsheet.post(
      `/sheets/${sheetId}/shares`,
      {
        groupId,
        accessLevel: 'EDITOR_SHARE'
      },
      { query: { sendEmail: 'true' } }
    );
  } catch (error) {
    if (error.status === 404 || error.details?.errorCode === 1106) {
      await markNeedsManualReview(ctx, `Office Admin Smartsheet group was not found: ${groupId}`);
      log.warn({ err: error, sheetId, groupId }, 'Office Admin group was not found; manual checklist sharing required');
      return ctx;
    }
    throw error;
  }

  log.info({ sheetId, groupId }, 'shared checklist with Office Admin group');
  return ctx;
}

module.exports = { run };

function isPlaceholderGroupId(groupId) {
  return !groupId || /^replace-me$/i.test(String(groupId).trim());
}

async function markNeedsManualReview(ctx, reason) {
  ctx.stepStatus.step02d = 'needs_manual_review';
  ctx.problems = ctx.problems || [];
  ctx.problems.push({ step: 'step02d', message: reason });
  await runStateStore.markStepNeedsManualReview(ctx, 'step02d', { reason });
}
