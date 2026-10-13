import { readGristConfig } from '../server/config.mjs';
import { createGristClient } from '../server/grist-client.mjs';
import { ensureCalendarSchema } from '../server/schema.mjs';
import { importAttendance, loadImportSource } from '../server/import.mjs';
import { buildImportPlan } from '../server/grist-model.mjs';

try {
  const client = createGristClient(await readGristConfig({ required: true }));
  await ensureCalendarSchema(client);
  console.log('Calendar schema is ready. Existing columns were preserved.');
  if (process.argv.includes('--import-attendance')) {
    const result = await importAttendance({ client, onProgress: ({ stage, completed, total }) => console.log(`${stage}: ${completed}/${total}`) });
    console.log(JSON.stringify(result));
    if (result.status !== 'complete') process.exitCode = 1;
  } else {
    const plan = buildImportPlan(await loadImportSource(client));
    console.log(JSON.stringify(plan.summary));
    console.log('No lesson or attendance records were written. Use --import-attendance to apply this mapping.');
  }
} catch (error) {
  console.error(error.message);
  if (error.summary) console.error(JSON.stringify(error.summary));
  process.exitCode = 1;
}
