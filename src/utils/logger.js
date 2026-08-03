const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime
});

function childLogger(ctx = {}, step) {
  return logger.child({
    runId: ctx.runId,
    projectNumber: ctx.projectNumber,
    step
  });
}

module.exports = { logger, childLogger };
