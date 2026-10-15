import { readGristConfig } from '../server/config.mjs';
import { createGristClient } from '../server/grist-client.mjs';
import { ensureAllAttSchema } from '../server/all-att-schema.mjs';
import { prepareAllAtt, loadAllAttSource, buildAllAttPlan } from '../server/all-att-setup.mjs';

try {
  if (process.argv.includes('--import-attendance')) throw new Error('The legacy import is retired. Use --prepare-all-att for the ALL_ATT model.');
  const client = createGristClient(await readGristConfig({ required: true }));
  await ensureAllAttSchema(client);
  console.log('ALL_ATT calendar schema is ready. Existing columns were preserved.');
  const includeLegacyCalendar = process.argv.includes('--include-legacy-calendar');
  if (process.argv.includes('--prepare-all-att')) {
    const result = await prepareAllAtt({ client, includeLegacyCalendar, onProgress: ({ stage, completed, total }) => console.log(`${stage}: ${completed}/${total}`) });
    const { conflicts, ...summary } = result;
    console.log(JSON.stringify(summary));
    if (result.status !== 'complete') process.exitCode = 1;
  } else {
    const plan = buildAllAttPlan(await loadAllAttSource(client, { includeLegacyCalendar }));
    console.log(JSON.stringify(plan.summary));
    console.log('No records were written. Use --prepare-all-att to create missing group headers and link attendance.');
  }
} catch (error) {
  console.error(error.message);
  if (error.summary) console.error(JSON.stringify(error.summary));
  process.exitCode = 1;
}
