function addStepResult(ctx, result) {
  ctx.stepResults = ctx.stepResults || [];
  ctx.stepResults.push({
    stepRef: result.stepRef,
    status: result.status,
    outcome: result.outcome || result.status,
    message: result.message,
    completedAt: new Date().toISOString()
  });
  ctx.automationReport = buildAutomationReport(ctx);
  return ctx.automationReport;
}

function buildAutomationReport(ctx) {
  const steps = ctx.stepResults || [];
  const counts = countSteps(steps);

  return {
    runId: ctx.runId,
    projectNumber: ctx.projectNumber,
    projectName: ctx.projectName,
    projectType: ctx.projectType,
    contract: ctx.contract,
    stoppedAfterStep: ctx.stoppedAfterStep,
    totalStepsReported: steps.length,
    passedSteps: counts.completed,
    failedSteps: counts.failed,
    skippedSteps: counts.skipped,
    manualReviewSteps: counts.needs_manual_review,
    dryRunSteps: steps.filter((step) => step.outcome === 'dry_run').length,
    steps
  };
}

function countSteps(steps) {
  return steps.reduce((counts, step) => {
    counts[step.status] = (counts[step.status] || 0) + 1;
    return counts;
  }, {
    completed: 0,
    failed: 0,
    skipped: 0,
    needs_manual_review: 0
  });
}

module.exports = { addStepResult, buildAutomationReport };