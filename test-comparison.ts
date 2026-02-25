// Quick test script to compare token sizes: raw vs simplified
// Run: npx tsx test-comparison.ts

import { N8nApiClient } from "./src/api-client.js";
import { simplifyWorkflow, workflowToText } from "./src/transform/simplify.js";

const HOST = process.env.N8N_HOST || process.env.N8N_API_URL || "";
const KEY = process.env.N8N_API_KEY || "";

if (!HOST || !KEY) {
  console.error("Set N8N_HOST and N8N_API_KEY env vars");
  process.exit(1);
}

const api = new N8nApiClient({ baseUrl: HOST, apiKey: KEY });

// Rough token estimate: ~4 chars per token for JSON
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function main() {
  console.log("Fetching workflows...\n");
  const { data: workflows } = await api.listWorkflows(undefined, 10);

  for (const wf of workflows.slice(0, 5)) {
    if (wf.isArchived) continue;

    try {
      const raw = await api.getWorkflow(wf.id);
      const rawJson = JSON.stringify(raw);

      const lite = simplifyWorkflow(raw);
      const liteJson = JSON.stringify(lite);

      const textVersion = workflowToText(lite);

      const rawTokens = estimateTokens(rawJson);
      const liteTokens = estimateTokens(liteJson);
      const textTokens = estimateTokens(textVersion);
      const savings = Math.round((1 - liteTokens / rawTokens) * 100);
      const textSavings = Math.round((1 - textTokens / rawTokens) * 100);

      console.log(`━━━ ${wf.name} (${raw.nodes.length} nodes) ━━━`);
      console.log(`  Raw JSON:    ${rawJson.length.toLocaleString()} chars (~${rawTokens.toLocaleString()} tokens)`);
      console.log(`  Lite JSON:   ${liteJson.length.toLocaleString()} chars (~${liteTokens.toLocaleString()} tokens) → ${savings}% savings`);
      console.log(`  Text format: ${textVersion.length.toLocaleString()} chars (~${textTokens.toLocaleString()} tokens) → ${textSavings}% savings`);
      console.log();
    } catch (e) {
      console.log(`  ✗ ${wf.name}: ${(e as Error).message}\n`);
    }
  }
}

main().catch(console.error);
