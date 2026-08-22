const { createSmartsheetClient } = require('./clients/smartsheetClient');
const { createMailboxGraphClient, createOneDriveGraphClient } = require('./clients/graphClient');
const { childLogger } = require('./utils/logger');
const { addStepResult, buildAutomationReport } = require('./utils/automationReport');
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
  ['step05', require('./steps/step05-manualCheckpointHandoff')],
  ['step07', require('./steps/step07-sendAutomationReport')]
];

const automatedChecklistSteps = new Set([
  'step01',
  'step02a',
  'step02b',
  'step02c',
  'step02d',
  'step02e',
  'step03',
  'step04b'
]);

async function run(initialCtx, options = {}) {
  const markChecklistSteps = options.markChecklistSteps !== false;

  let ctx = {
    sheetIds: {},
    folderIds: {},
    folderUrls: {},
    reportIds: {},
    publishedUrls: {},
    checklistRowMap: {},
    stepStatus: {},
    stepResults: [],
    ...initialCtx
  };

  ctx.clients = {
    smartsheet: createSmartsheetClient(),
    mailGraph: createMailboxGraphClient(),
    oneDriveGraph: createOneDriveGraphClient(),
    ...ctx.clients
  };
  ctx.clients.graph = ctx.clients.graph || ctx.clients.oneDriveGraph;
  ctx.log = ctx.log || childLogger(ctx, 'orchestrator');

  for (const [stepRef, stepModule] of steps) {
    const log = childLogger(ctx, stepRef);

    if (await runStateStore.isStepComplete(ctx, stepRef)) {
      log.info('step already complete; skipping');
      addStepResult(ctx, { stepRef, status: 'skipped', message: 'Step was already complete before this run' });
      if (options.stopAfterStep === stepRef) {
        ctx.stoppedAfterStep = stepRef;
        ctx.automationReport = buildAutomationReport(ctx);
        return ctx;
      }
      continue;
    }

    try {
      log.info('starting step');
      ctx = await stepModule.run(ctx);

      if (ctx.stepStatus?.[stepRef] === 'needs_manual_review') {
        log.warn('step completed with manual review required; not marking checklist done');
        addStepResult(ctx, { stepRef, status: 'needs_manual_review', message: 'Step completed with manual review required' });
        if (options.stopAfterStep === stepRef) {
          ctx.stoppedAfterStep = stepRef;
          ctx.automationReport = buildAutomationReport(ctx);
          return ctx;
        }
        continue;
      }

      await runStateStore.markStepComplete(ctx, stepRef);

      if (markChecklistSteps && automatedChecklistSteps.has(stepRef)) {
        await markStepDone(ctx, stepRef);
      }

      addStepResult(ctx, {
        stepRef,
        status: 'completed',
        outcome: ctx.stepStatus?.[stepRef] || 'completed',
        message: buildStepMessage(stepRef, ctx)
      });

      if (options.stopAfterStep === stepRef) {
        log.info('requested stop point reached; ending run early');
        ctx.stoppedAfterStep = stepRef;
        ctx.automationReport = buildAutomationReport(ctx);
        return ctx;
      }
    } catch (error) {
      log.error({ err: error }, 'step failed; continuing run');
      await runStateStore.markStepFailed(ctx, stepRef, error);
      ctx.stepStatus[stepRef] = 'failed';
      ctx.problems = ctx.problems || [];
      ctx.problems.push({ step: stepRef, message: error.message });
      addStepResult(ctx, { stepRef, status: 'failed', message: error.message });

      if (options.stopAfterStep === stepRef) {
        ctx.stoppedAfterStep = stepRef;
        ctx.automationReport = buildAutomationReport(ctx);
        return ctx;
      }
    }
  }

  if (!ctx.automationReport?.failedSteps) {
    await runStateStore.markRunComplete(ctx);
  }
  ctx.automationReport = buildAutomationReport(ctx);
  ctx.log.info({ failedSteps: ctx.automationReport.failedSteps }, 'automated run finished; manual rows may remain open by design');
  return ctx;
}

function buildStepMessage(stepRef, ctx) {
  if (stepRef === 'step02e' && ctx.contract?.signedLine) {
    return `Signed contract line: ${ctx.contract.signedLine}`;
  }

  return undefined;
}

module.exports = { run };
