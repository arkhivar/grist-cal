import { fileURLToPath } from 'node:url';
import { createCalendarServer } from '../server/http.mjs';
import { createGristClient } from '../server/grist-client.mjs';
import { createAllAttStore } from '../server/all-att-store.mjs';
import { readGristConfig } from '../server/config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex < 0 ? process.env.PORT || 4173 : args[portIndex + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const config = await readGristConfig();
const store = config ? createAllAttStore({ client: createGristClient(config) }) : null;
const server = createCalendarServer({ root, store });
server.listen(port, '127.0.0.1', () => console.log(`Grist Cal (${store ? 'Grist sandbox' : 'demo'}) — Local: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
