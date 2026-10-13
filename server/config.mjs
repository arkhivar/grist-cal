import { createInterface } from 'node:readline';

/** Read connection secrets from process memory or one JSON line on stdin, never from public files. */
export async function readGristConfig({ required = false } = {}) {
  let config;
  if (process.argv.includes('--grist-stdin')) {
    const lines = createInterface({ input: process.stdin, terminal: false });
    for await (const line of lines) {
      try { config = JSON.parse(line); }
      catch { throw new Error('Grist connection input must be valid JSON.'); }
      break;
    }
    lines.close();
    if (!config) throw new Error('Grist connection input is required.');
  } else if (process.env.GRIST_API_KEY || process.env.GRIST_BASE_URL || process.env.GRIST_DOC_ID) {
    config = { baseUrl: process.env.GRIST_BASE_URL, docId: process.env.GRIST_DOC_ID, apiKey: process.env.GRIST_API_KEY };
  }
  if ((required && !config) || (config && (!config.baseUrl || !config.docId || !config.apiKey))) {
    throw new Error('Grist configuration requires a host, document ID and API key.');
  }
  return config;
}
