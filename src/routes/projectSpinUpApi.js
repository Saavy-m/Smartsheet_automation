const crypto = require('crypto');
const express = require('express');
const orchestrator = require('../orchestrator');
const { createSmartsheetClient } = require('../clients/smartsheetClient');
const { createOneDriveGraphClient } = require('../clients/graphClient');
const step02d = require('../steps/step02d-shareChecklist');
const step02e = require('../steps/step02e-verifyContract');
const { logger } = require('../utils/logger');

const router = express.Router();

const TEST_STEP02D_SHEET_ID = '4587817047904132';
const TEST_STEP02D_EMAIL = 'satyamshukla4916@gmail.com';

router.post('/', async (req, res, next) => {
  try {
    const project = normalizeProjectPayload(req.body);
    requireProjectType(project);
    const ctx = await runFullWorkflow(project);

    res.status(201).json(buildRunResponse(ctx));
  } catch (error) {
    next(error);
  }
});

router.post('/test-step01', async (req, res, next) => {
  try {
    const project = normalizeProjectPayload(req.body);
    const ctx = await runGen009Copy(project);

    res.status(201).json(buildRunResponse(ctx));
  } catch (error) {
    next(error);
  }
});

router.post('/test-step02d-share', async (req, res, next) => {
  try {
    const sheetId = String(req.body?.sheetId || TEST_STEP02D_SHEET_ID).trim();
    const email = String(req.body?.email || TEST_STEP02D_EMAIL).trim();
    const useSmartsheetDefaultEmail = getOptionalRequestBoolean(req.body?.useSmartsheetDefaultEmail ?? req.body?.omitShareEmailFields, false);
    const subject = useSmartsheetDefaultEmail ? undefined : String(req.body?.subject || 'Step 2d Smartsheet share email test').trim();
    const message = useSmartsheetDefaultEmail ? undefined : String(req.body?.message || `Testing Smartsheet share notification email for sheet ${sheetId}.`).trim();
    const ccMe = useSmartsheetDefaultEmail ? undefined : getOptionalRequestBoolean(req.body?.ccMe ?? req.body?.ccMyself, true);

    if (!sheetId || !email) {
      const error = new Error('Request body must include sheetId and email, or use the configured test defaults');
      error.status = 400;
      throw error;
    }

    logger.info({ sheetId, email, sendEmail: true, useSmartsheetDefaultEmail, subject, message, ccMe }, 'starting step02d share test endpoint');

    const ctx = {
      runId: `test-step02d-${crypto.randomUUID()}`,
      projectNumber: 'test-step02d',
      sheetIds: { gen009Checklist: sheetId },
      officeAdminGroupId: 'replace-me',
      officeAdminEmails: [email],
      useSmartsheetDefaultShareEmail: useSmartsheetDefaultEmail,
      shareEmailSubject: subject,
      shareEmailMessage: message,
      shareEmailCcMe: ccMe,
      clients: { smartsheet: createSmartsheetClient() }
    };

    await step02d.run(ctx);

    logger.info({ runId: ctx.runId, share: ctx.step02dShare }, 'completed step02d share test endpoint');

    res.status(201).json({
      ok: true,
      runId: ctx.runId,
      step: 'step02d',
      sheetId,
      emails: [email],
      sendEmail: true,
      useSmartsheetDefaultEmail,
      subject,
      message,
      ccMe,
      share: ctx.step02dShare
    });
  } catch (error) {
    next(error);
  }
});

router.post('/test-step02e-contract', async (req, res, next) => {
  try {
    const projectNumber = String(req.body?.projectNumber || req.body?.['Project Number'] || '110232').trim();
    const checklistSheetId = String(req.body?.checklistSheetId || req.body?.gen009ChecklistSheetId || req.body?.sheetId || '').trim();

    if (!projectNumber || !checklistSheetId) {
      const error = new Error('Request body must include projectNumber and checklistSheetId for the generated GEN009 checklist');
      error.status = 400;
      throw error;
    }

    const ctx = {
      runId: `test-step02e-${projectNumber}-${crypto.randomUUID()}`,
      projectNumber,
      sheetIds: { gen009Checklist: checklistSheetId },
      checklistRowMap: {},
      stepStatus: {},
      problems: [],
      clients: {
        smartsheet: createSmartsheetClient(),
        graph: createOneDriveGraphClient()
      }
    };

    logger.info({ runId: ctx.runId, projectNumber, checklistSheetId }, 'starting step02e contract verification test endpoint');
    await step02e.run(ctx);
    logger.info({ runId: ctx.runId, projectNumber, contract: ctx.contract, stepStatus: ctx.stepStatus }, 'completed step02e contract verification test endpoint');

    res.status(201).json({
      ok: ctx.stepStatus.step02e !== 'needs_manual_review',
      runId: ctx.runId,
      step: 'step02e',
      projectNumber,
      checklistSheetId,
      contract: ctx.contract,
      stepStatus: ctx.stepStatus,
      checklistRowMap: ctx.checklistRowMap,
      problems: ctx.problems
    });
  } catch (error) {
    next(error);
  }
});


function getOptionalRequestBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase())) {
    return value.toLowerCase() === 'true';
  }
  const error = new Error('ccMe/ccMyself must be true or false');
  error.status = 400;
  throw error;
}
function normalizeProjectPayload(body = {}) {
  const projectName = body.projectName || body['Project Name'];
  const projectNumber = body.projectNumber || body['Project Number'];
  const projectType = body.projectType || body['Project Type'] || body.projectVertical || body['Project Vertical'] || '';
  const patersonProject = body.patersonProject || body['patersonProject'] || body['Is this a Paterson Project'] || body['Is this a Patterson Project'] || '';
  const projectDashboardUrl = body.projectDashboardUrl || body.projectDashboard || body['Project Dashboard'] || '';
  const projectCreatedAt = body.projectCreatedAt || body.createdAt || body['Project Created'] || body['Created'] || '';

  if (!projectName || !projectNumber) {
    const receivedKeys = Object.keys(body).join(', ') || 'none';
    const error = new Error(`Request body must include projectName and projectNumber. Received keys: ${receivedKeys}`);
    error.status = 400;
    throw error;
  }

  return {
    projectName: String(projectName).trim(),
    projectNumber: String(projectNumber).trim(),
    projectType: String(projectType).trim(),
    patersonProject: String(patersonProject).trim(),
    projectDashboardUrl: String(projectDashboardUrl).trim(),
    projectCreatedAt: String(projectCreatedAt).trim(),
    masterProjectListSheetId: body.masterProjectListSheetId,
    masterProjectRowId: body.masterProjectRowId,
    runId: body.runId || `${String(projectNumber).trim()}-${crypto.randomUUID()}`
  };
}

function requireProjectType(project) {
  if (!project.projectType) {
    const error = new Error('Request body must include projectType when running through step03');
    error.status = 400;
    throw error;
  }
}

function buildRunResponse(ctx) {
  const failedSteps = ctx.automationReport?.failedSteps || 0;
  return {
    ok: failedSteps === 0,
    status: failedSteps > 0 ? 'failed' : 'completed',
    runId: ctx.runId,
    projectName: ctx.projectName,
    projectNumber: ctx.projectNumber,
    projectType: ctx.projectType,
    sheetIds: ctx.sheetIds,
    folderIds: ctx.folderIds,
    folderUrls: ctx.folderUrls,
    reportIds: ctx.reportIds,
    publishedUrls: ctx.publishedUrls,
    stepStatus: ctx.stepStatus,
    automationReport: ctx.automationReport
  };
}

async function runGen009Copy(project) {
  return orchestrator.run(project, {
    stopAfterStep: 'step01',
    markChecklistSteps: false
  });
}

async function runFullWorkflow(project) {
  return orchestrator.run(project);
}

module.exports = router;