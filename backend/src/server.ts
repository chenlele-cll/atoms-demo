import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { buildApp } from './app.js';
import { readConfig } from './config.js';

const app = buildApp();

async function start() {
  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const config = readConfig(process.env);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Stopping backend');
      app.close().catch((err: unknown) => {
        app.log.error({ err }, 'Backend shutdown failed');
        process.exitCode = 1;
      });
    });
  }

  await app.listen(config);
}

start().catch((err: unknown) => {
  app.log.error({ err }, 'Backend startup failed');
  process.exitCode = 1;
});
