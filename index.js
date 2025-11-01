require('make-promises-safe');

const PORT = 8080;

const path = require('path');
const Fastify = require('fastify');
const { takeScreenshot } = require('./lib');

const fastify = Fastify({ logger: true });

fastify.register(require('fastify-static'), {
  root: path.join(__dirname, 'public'),
});

fastify.post('/api/screenshots', async (request, reply) => {
  try {
    const screenshot = await takeScreenshot({
      withSubtitle: request.body.withSubtitle,
      username: request.body.username,
    });
    reply.code(201);
    const warn = `${screenshot.sessionsForUser > 1 ? 'Warn: more than one session!! ' : ''}`;
    return {
      success: true,
      message: `${warn}Screenshot ${screenshot.result.outputFilename} saved`,
      url: path.join(screenshot.base_screenshots_url,screenshot.result.outputFilename)
    };
  } catch (error) {
    reply.code(500);
    return { success: false, message: error.toString() };
  }
});

const start = async () => {
  try {
    await fastify.listen(PORT, '0.0.0.0');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
