const crypto = require('crypto');
const express = require('express');
const orchestrator = require('../orchestrator');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const project = normalizeProjectPayload(req.body);
    requireProjectType(project);
    const ctx = await runThroughReportUpdate(project);

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

function normalizeProjectPayload(body = {}) {
  const projectName = body.projectName || body['Project Name'];
  const projectNumber = body.projectNumber || body['Project Number'];
  const projectType = body.projectType || body['Project Type'] || body.projectVertical || body['Project Vertical'] || '';
  const patersonProject = body.patersonProject || body['patersonProject'] || body['Is this a Paterson Project'] || body['Is this a Patterson Project'] || '';

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

async function runThroughReportUpdate(project) {
  return orchestrator.run(project, {
    stopAfterStep: 'step03',
    markChecklistSteps: false
  });
}

module.exports = router;