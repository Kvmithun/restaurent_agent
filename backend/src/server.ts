import { createApp } from './api/app.js';
import { env } from './config/env.js';
import { connectInfrastructure } from './infra/connections.js';

async function main() {
  await connectInfrastructure();
  const app = createApp();
  app.listen(env.PORT, () => console.info(JSON.stringify({ event: 'server.started', port: env.PORT })));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: 'server.startup_failed', error: error instanceof Error ? error.message : 'unknown error' }));
  process.exitCode = 1;
});
