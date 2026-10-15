import { readGristConfig } from '../server/config.mjs';
import { createGristClient } from '../server/grist-client.mjs';
import { DATE_REGISTRY_TABLE, DATE_REGISTRY_FIELDS, buildDateRegistryPlan,
  ensureDateRegistrySchema, prepareDateRegistry } from '../server/date-registry.mjs';

try {
  const args = process.argv.slice(2);
  const option = name => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const range = { startDate: option('--from'), endDate: option('--through') };
  // Reject invalid or excessive ranges before any schema or record mutation.
  buildDateRegistryPlan([], range);
  const client = createGristClient(await readGristConfig({ required: true }));
  const attendanceSchema = await ensureDateRegistrySchema(client);
  const transactionsSchema = args.includes('--include-transactions')
    ? await ensureDateRegistrySchema(client, { sourceTable: 'Transactions', sourceField: 'datetime' }) : null;
  console.log(JSON.stringify({ attendanceSchema, ...(transactionsSchema ? { transactionsSchema } : {}) }));
  if (args.includes('--populate')) {
    console.log(JSON.stringify(await prepareDateRegistry(client, range)));
  } else {
    const records = await client.records(DATE_REGISTRY_TABLE, DATE_REGISTRY_FIELDS);
    console.log(JSON.stringify(buildDateRegistryPlan(records, range).summary));
    console.log('Schema is ready. No date records were written. Add --populate to fill the requested range.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
