import { createMawServer } from './server.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
// Comma-separated list of allowed web origins; unset = allow any (fine for local dev).
const corsOrigin = process.env.WEB_ORIGIN ? process.env.WEB_ORIGIN.split(',') : true;

const server = createMawServer({ corsOrigin });
const actual = await server.listen(port, host);
console.log(`Maw server listening on http://${host}:${actual}`);

const shutdown = () => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
