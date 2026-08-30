const fs = require('fs/promises');
const path = require('path');

const STATE_PATH = process.env.RUN_STATE_PATH || path.join(process.cwd(), '.run-state.json');

async function readState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function writeState(state) {
  await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function projectKey(ctx) {
  return ctx.runId || ctx.projectNumber;
}

async function getProjectState(ctx) {
  const state = await readState();
  return state[projectKey(ctx)] || { projectNumber: ctx.projectNumber, steps: {} };
}

async function isStepComplete(ctx, stepRef) {
  const projectState = await getProjectState(ctx);
  return projectState.steps[stepRef]?.status === 'complete';
}

async function markStepComplete(ctx, stepRef, details = {}) {
  const state = await readState();
  const key = projectKey(ctx);
  state[key] = state[key] || { projectNumber: ctx.projectNumber, steps: {} };
  state[key].steps[stepRef] = { status: 'complete', completedAt: new Date().toISOString(), ...details };
  await writeState(state);
}

async function markStepNeedsManualReview(ctx, stepRef, details = {}) {
  const state = await readState();
  const key = projectKey(ctx);
  state[key] = state[key] || { projectNumber: ctx.projectNumber, steps: {} };
  state[key].steps[stepRef] = { status: 'needs_manual_review', updatedAt: new Date().toISOString(), ...details };
  await writeState(state);
}

async function markStepFailed(ctx, stepRef, error) {
  const state = await readState();
  const key = projectKey(ctx);
  state[key] = state[key] || { projectNumber: ctx.projectNumber, steps: {} };
  state[key].steps[stepRef] = {
    status: 'failed',
    failedAt: new Date().toISOString(),
    message: error.message,
    stack: error.stack
  };
  await writeState(state);
}

async function markRunComplete(ctx) {
  const state = await readState();
  const key = projectKey(ctx);
  state[key] = state[key] || { projectNumber: ctx.projectNumber, steps: {} };
  state[key].status = 'automated_complete';
  state[key].completedAt = new Date().toISOString();
  await writeState(state);
}

async function markRunFatal(ctx, error) {
  const state = await readState();
  const key = projectKey(ctx);
  state[key] = state[key] || { projectNumber: ctx.projectNumber, steps: {} };
  state[key].status = 'fatal_error';
  state[key].fatalAt = new Date().toISOString();
  state[key].message = error.message;
  state[key].code = error.code;
  await writeState(state);
}

module.exports = {
  getProjectState,
  isStepComplete,
  markStepComplete,
  markStepNeedsManualReview,
  markStepFailed,
  markRunFatal,
  markRunComplete
};
