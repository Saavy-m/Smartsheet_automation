const { createSmartsheetClient } = require('./clients/smartsheetClient');
const { createGraphClient } = require('./clients/graphClient');
const { childLogger } = require('./utils/logger');
const runStateStore = require('./utils/runStateStore');
const { markStepDone } = require('./steps/step06-markChecklistDone');

const steps = [
  ['step01', require('./steps/step01-copyGen009Template')],
  ['step02a', require('./steps/step02a-writeProjectInfo')],
  ['step02b', require('./steps/step02b-hidePattersonColumn')],
  ['step02c', require('./steps/step02c-trimProjectPlan')],
  ['step02d', require('./steps/step02d-shareChecklist')],
  ['step02e', require('./steps/step02e-verifyContract')],
  ['step03', require('./steps/step03-updateAndRenameReports')],
  ['step04a', require('./steps/step04a-publishOrdersReport')],
  ['step04b', require('./steps/step04b-createOneDriveFolders')],
  ['step05', require('./steps/step05-manualCheckpointHandoff')]
];

const automatedChecklistSteps = new Set([
  'step01',
  'step02a',
  'step02b',
  'step02c',
  'step02d',
  'step02e',
  'step03',
  'step04a',
  'step04b'
]);

async function run(initialCtx) {
  let ctx = {
    sheetIds: {},
    folderIds: {},
    reportIds: {},
    publishedUrls: {},
    checklistRowMap: {},
    stepStatus: {},
    ...initialCtx
  };

  ctx.clients = ctx.clients || {
    smartsheet: createSmartsheetClient(),
    graph: createGraphClient()
  };
  ctx.log = ctx.log || childLogger(ctx, 'orchestrator');

  for (const [stepRef, stepModule] of steps) {
    const log = childLogger(ctx, stepRef);

    if (await runStateStore.isStepComplete(ctx, stepRef)) {
      log.info('step already complete; skipping');
      continue;
    }

    try {
      log.info('starting step');
      ctx = await stepModule.run(ctx);

      if (ctx.stepStatus?.[stepRef] === 'needs_manual_review') {
        log.warn('step completed with manual review required; not marking checklist done');
        continue;
      }

      await runStateStore.markStepComplete(ctx, stepRef);

      if (automatedChecklistSteps.has(stepRef)) {
        await markStepDone(ctx, stepRef);
      }
    } catch (error) {
      log.error({ err: error }, 'step failed; stopping run');
      await runStateStore.markStepFailed(ctx, stepRef, error);
      throw error;
    }
  }

  await runStateStore.markRunComplete(ctx);
  ctx.log.info('automated run complete; manual rows may remain open by design');
  return ctx;
}

module.exports = { run };
