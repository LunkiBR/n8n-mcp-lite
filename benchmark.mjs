/**
 * Comprehensive benchmark for n8n-mcp-lite
 */
import { generateNodeSummary, extractExecutionRunData, getInputHintForNode } from "./dist/transform/focus.js";
import { validateNodeConfig } from "./dist/security/config-validator.js";
import { autoLayout } from "./dist/transform/layout.js";
import { reconstructWorkflow, simplifyConnections } from "./dist/transform/simplify.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); console.log(`  ✅  ${name}`); passed++; }
  catch (e) { console.log(`  ❌  ${name}\n       ${e.message}`); failed++; failures.push({ name, error: e.message }); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg ?? "assertion failed"); }
function section(t) { console.log(`\n${"═".repeat(64)}\n  ${t}\n${"═".repeat(64)}`); }

function mockExec(runData) { return { resultData: { runData } }; }
function makeRun(outputs) {
  return [{ data: { main: outputs.map(items => items === null ? [] : items.map(json => ({ json }))) } }];
}

// ─── 1. Smart Summaries ──────────────────────────────────────────────────────

section("1. Smart Summaries");

test("Code: pula // e retorna 1ª linha real", () => {
  const s = generateNodeSummary("code", { jsCode: "// header\n// comment\nconst x = $input.all();" });
  assert(s === "JS: const x = $input.all();", `got: "${s}"`);
});

test("Code: pula /* */ e import", () => {
  const s = generateNodeSummary("code", { jsCode: "/* block */\nimport { x } from 'y';\nreturn items;" });
  assert(s === "JS: return items;", `got: "${s}"`);
});

test("Code: pula * (JSDoc interior)", () => {
  const s = generateNodeSummary("code", { jsCode: "/**\n * doc\n */\nconst result = 1;" });
  assert(s === "JS: const result = 1;", `got: "${s}"`);
});

test("Code: só comentários → '(comment-only code)' sem char count [Bug #1 fix]", () => {
  const s = generateNodeSummary("code", { jsCode: "// a\n// b\n// c" });
  assert(s.includes("comment-only"), `got: "${s}"`);
  assert(!s.includes("chars"), `should NOT have char count: "${s}"`);
});

test("Code: jsCode vazio → sem crash", () => {
  const s = generateNodeSummary("code", { jsCode: "" });
  assert(typeof s === "string" && s.length > 0, `got: "${s}"`);
});

test("Code: linha longa truncada em ≤60 chars", () => {
  const s = generateNodeSummary("code", { jsCode: "const " + "x".repeat(80) + " = 1;" });
  assert(s.replace(/^JS: /, "").length <= 60, `too long: "${s}"`);
});

test("IF v2: extrai leftValue/operator/rightValue", () => {
  const s = generateNodeSummary("if", { conditions: { conditions: [{ leftValue: "={{ $json.status }}", operator: { operation: "equals", type: "string" }, rightValue: "active" }] } });
  assert(s.includes("equals") && s.includes("active"), `got: "${s}"`);
});

test("IF v2: leftValue com expressão mostra a expressão", () => {
  const s = generateNodeSummary("if", { conditions: { conditions: [{ leftValue: "={{ $json.attachmentType }}", operator: { operation: "equals" }, rightValue: "audio" }] } });
  assert(s.includes("$json.attachmentType"), `got: "${s}"`);
});

test("IF v1: detecta value1/operation/value2", () => {
  const s = generateNodeSummary("if", { value1: "={{ $json.age }}", operation: "larger", value2: "18" });
  assert(s.includes("larger") && s.includes("18"), `got: "${s}"`);
});

test("Switch com regras: mostra labels", () => {
  const s = generateNodeSummary("switch", { rules: { values: [{ outputKey: "audio" }, { outputKey: "image" }, { outputKey: "text" }] } });
  assert(s.includes("audio") && s.includes("image"), `got: "${s}"`);
});

test("Switch com 0 regras: não é 'Switch' vazio [Bug #2 fix]", () => {
  const s = generateNodeSummary("switch", { rules: { values: [] } });
  assert(s !== "Switch", `should not be plain "Switch": "${s}"`);
  assert(!s.includes("undefined"), `has undefined: "${s}"`);
});

test("Switch sem rules: não crasha", () => {
  const s = generateNodeSummary("switch", {});
  assert(typeof s === "string" && !s.includes("undefined"), `got: "${s}"`);
});

test("AI Agent: lê options.systemMessage", () => {
  const s = generateNodeSummary("agent", { options: { systemMessage: "You are a helpful assistant" } });
  assert(s.includes("helpful assistant"), `got: "${s}"`);
});

test("AI Agent: lê top-level systemMessage", () => {
  const s = generateNodeSummary("agent", { systemMessage: "You are a bot" });
  assert(s.includes("bot"), `got: "${s}"`);
});

test("AI Agent: sem system prompt → 'AI Agent'", () => {
  assert(generateNodeSummary("agent", {}) === "AI Agent");
});

test("Set v3: assignments.assignments[].name", () => {
  const s = generateNodeSummary("set", { assignments: { assignments: [{ name: "email" }, { name: "name" }] } });
  assert(s.includes("email") && s.includes("name"), `got: "${s}"`);
});

test("Set v2: values.values[].name [Bug #4 fix]", () => {
  const s = generateNodeSummary("set", { values: { values: [{ name: "status" }, { name: "score" }] } });
  assert(s.includes("status") && s.includes("score"), `got: "${s}"`);
  assert(!s.includes("Set values"), `should not fallback: "${s}"`);
});

test("Summaries: nenhum excede 100 chars", () => {
  const cases = [
    ["httpRequest", { method: "POST", url: "https://api.example.com/v1/some/endpoint" }],
    ["code", { jsCode: "const result = items.map(i => ({ ...i.json, processed: true }));" }],
    ["if", { conditions: { conditions: [{ leftValue: "={{ $json.field }}", operator: { operation: "equals" }, rightValue: "value" }] } }],
    ["agent", { options: { systemMessage: "You are a helpful assistant for customer support." } }],
  ];
  for (const [type, params] of cases) {
    const s = generateNodeSummary(type, params);
    assert(s.length <= 100, `"${type}" too long (${s.length}): "${s}"`);
  }
});

// ─── 2. Ghost Payload ────────────────────────────────────────────────────────

section("2. Ghost Payload");

test("extrai keys do output[0]", () => {
  const map = extractExecutionRunData(mockExec({ "A": makeRun([[{ id: 1, name: "foo" }]]) }));
  assert(map["A"].outputKeys.includes("id") && map["A"].outputKeys.includes("name"), `keys: ${map["A"].outputKeys}`);
  assert(map["A"].itemCount === 1, `itemCount: ${map["A"].itemCount}`);
});

test("extrai ALL outputs — IF node 2 branches [Bug #5 fix]", () => {
  const map = extractExecutionRunData(mockExec({ "IF": makeRun([[{ trueField: 1 }], [{ falseField: 0 }]]) }));
  assert(map["IF"].outputs?.length === 2, `outputs: ${map["IF"].outputs?.length}`);
  assert(map["IF"].outputs[0].keys.includes("trueField"), "output[0] should have trueField");
  assert(map["IF"].outputs[1].keys.includes("falseField"), "output[1] should have falseField");
});

test("getInputHintForNode usa outputIndex correto [Bug #5 fix]", () => {
  const map = extractExecutionRunData(mockExec({ "IF": makeRun([[{ trueField: 1 }], [{ falseField: 0 }]]) }));
  const hint = getInputHintForNode("After False", [{ from: "IF", to: "After False", outputIndex: 1 }], map);
  assert(hint?.includes("falseField"), `hint: ${hint}`);
  assert(!hint?.includes("trueField"), `should not have trueField: ${hint}`);
});

test("cap 20 keys + '...+N more' [Bug #8 fix]", () => {
  const manyKeys = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
  const map = extractExecutionRunData(mockExec({ "A": makeRun([[manyKeys]]) }));
  const keys = map["A"].outputKeys;
  assert(keys.length === 21, `should be 21, got ${keys.length}`);
  assert(keys[20].startsWith("...+"), `last key should be indicator: "${keys[20]}"`);
  assert(keys[20].includes("5"), `should indicate +5: "${keys[20]}"`);
});

test("executionId inexistente: {} → {} sem crash", () => {
  const map = extractExecutionRunData({});
  assert(Object.keys(map).length === 0);
});

test("executionId null → {} sem crash", () => {
  assert(Object.keys(extractExecutionRunData(null)).length === 0);
});

test("node que falhou: error capturado, outputKeys vazio", () => {
  const map = extractExecutionRunData(mockExec({ "Broken": [{ error: { message: "boom" } }] }));
  assert(map["Broken"].error === "boom", `error: ${map["Broken"].error}`);
  assert(map["Broken"].outputKeys.length === 0);
});

test("trigger sem incoming: getInputHintForNode → undefined", () => {
  const map = extractExecutionRunData(mockExec({ "Webhook": makeRun([[{ body: {} }]]) }));
  assert(getInputHintForNode("Webhook", [], map) === undefined);
});

test("múltiplos upstream: union de keys", () => {
  const map = extractExecutionRunData(mockExec({
    "A": makeRun([[{ aField: 1 }]]),
    "B": makeRun([[{ bField: 2 }]]),
  }));
  const hint = getInputHintForNode("Merge", [{ from: "A", to: "Merge" }, { from: "B", to: "Merge" }], map);
  assert(hint?.includes("aField") && hint?.includes("bField"), `hint: ${hint}`);
});

test("node name com espaços: lookup funciona", () => {
  const map = extractExecutionRunData(mockExec({ "Meu Node Especial": makeRun([[{ valor: 42 }]]) }));
  assert(map["Meu Node Especial"]?.outputKeys?.includes("valor"));
});

test("output com 0 items → null no outputs array", () => {
  const exec = mockExec({ "IF": [{ data: { main: [[{ json: { x: 1 } }], []] } }] });
  const map = extractExecutionRunData(exec);
  assert(map["IF"].outputs[0] !== null, "output[0] should have data");
  assert(map["IF"].outputs[1] === null, `output[1] should be null: ${JSON.stringify(map["IF"].outputs[1])}`);
});

// ─── 3. Enhanced Validation ──────────────────────────────────────────────────

section("3. Enhanced Validation");

test("Pass 6: batchSize string → type_mismatch warning (splitInBatches)", () => {
  const { warnings } = validateNodeConfig({ name: "Split", type: "splitInBatches", parameters: { batchSize: "10" } });
  assert(warnings.some(w => w.type === "type_mismatch" && w.property === "batchSize"), `warnings: ${JSON.stringify(warnings.map(w=>w.type+":"+w.property))}`);
});

test("Pass 6: expressão = → nunca gera type_mismatch", () => {
  const { warnings } = validateNodeConfig({ name: "HTTP", type: "httpRequest", parameters: { url: "https://x.com", timeout: "={{ $json.t }}" } });
  assert(!warnings.some(w => w.type === "type_mismatch" && w.property === "timeout"), "expression should be ignored");
});

test("Pass 7 DESABILITADO: sendBody/sendHeaders não geram property_location_hint [Bug #9 fix]", () => {
  const { warnings } = validateNodeConfig({ name: "HTTP", type: "httpRequest", parameters: { url: "https://x.com", sendBody: true, sendHeaders: true, queryParameters: { parameters: [] } } });
  assert(!warnings.some(w => w.type === "property_location_hint"), `Pass 7 should be disabled: ${JSON.stringify(warnings.filter(w=>w.type==="property_location_hint"))}`);
});

test("Pass 7 DESABILITADO: resource/operation nunca flagados", () => {
  const { warnings } = validateNodeConfig({ name: "Slack", type: "slack", parameters: { resource: "channel", operation: "create" } });
  assert(!warnings.some(w => w.type === "property_location_hint"), "should not flag resource/operation");
});

test("node desconhecido: warning, sem error, sem crash", () => {
  const { errors, warnings } = validateNodeConfig({ name: "X", type: "custom.myNode", parameters: {} });
  assert(errors.length === 0, `errors: ${JSON.stringify(errors)}`);
  assert(warnings.some(w => w.type === "unknown_node_warning"));
});

test("validateNodeConfig: não crasha com params vazios", () => {
  const { errors, warnings } = validateNodeConfig({ name: "Code", type: "code", parameters: {} });
  assert(typeof errors === "object" && typeof warnings === "object");
});

// ─── 4. Layout ───────────────────────────────────────────────────────────────

section("4. Layout Automático");

const mkNodes = names => names.map(name => ({ name, type: "code" }));

test("linear A→B→C→D: x cresce da esquerda pra direita", () => {
  const pos = autoLayout(mkNodes(["A","B","C","D"]), [{ from:"A",to:"B" },{ from:"B",to:"C" },{ from:"C",to:"D" }]);
  const xs = ["A","B","C","D"].map(n => pos.get(n)[0]);
  assert(xs[0] < xs[1] && xs[1] < xs[2] && xs[2] < xs[3], `x order: ${xs}`);
});

test("branching A→B e A→C (false): B e C têm Y diferente", () => {
  const pos = autoLayout(mkNodes(["A","B","C"]), [{ from:"A",to:"B" },{ from:"A",to:"C",outputIndex:1 }]);
  assert(pos.get("B")[1] !== pos.get("C")[1], `same Y: ${pos.get("B")[1]} vs ${pos.get("C")[1]}`);
});

test("node desconectado: tem posição válida", () => {
  const pos = autoLayout(mkNodes(["A","B","Isolated"]), [{ from:"A",to:"B" }]);
  assert(pos.has("Isolated"), "Isolated missing");
  const [x,y] = pos.get("Isolated");
  assert(Number.isFinite(x) && Number.isFinite(y), `invalid: ${x},${y}`);
});

test("100+ nodes: sem loop infinito, < 2s", () => {
  const names = Array.from({ length: 100 }, (_,i) => `N${i}`);
  const flow = names.slice(1).map((n,i) => ({ from: names[i], to: n }));
  const t0 = Date.now();
  const pos = autoLayout(mkNodes(names), flow);
  assert(Date.now()-t0 < 2000, `too slow: ${Date.now()-t0}ms`);
  assert(pos.size === 100, `pos.size: ${pos.size}`);
});

test("ciclo A→B→A: não trava [Bug #16 fix]", () => {
  const t0 = Date.now();
  const pos = autoLayout(mkNodes(["A","B"]), [{ from:"A",to:"B" },{ from:"B",to:"A" }]);
  assert(Date.now()-t0 < 1000, `hang: ${Date.now()-t0}ms`);
  assert(pos.size === 2);
});

test("1 node: retorna posição", () => {
  assert(autoLayout([{ name:"A", type:"code" }], []).has("A"));
});

// ─── 5. reconstructWorkflow — Merge connections ───────────────────────────────

section("5. Merge Connections (reconstructWorkflow)");

const mkLite = (nodes, flow) => ({ id:"t", name:"t", active:false, nodeCount:nodes.length, nodes, flow });

test("Merge: 2 upstream sem inputIndex → portas distintas (0 e 1)", () => {
  const result = reconstructWorkflow(mkLite(
    [{ name:"A",type:"code" },{ name:"B",type:"code" },{ name:"Merge",type:"merge" }],
    [{ from:"A",to:"Merge" },{ from:"B",to:"Merge" }]
  ));
  const conns = [];
  for (const [from, outs] of Object.entries(result.connections))
    for (const [,arrs] of Object.entries(outs))
      arrs.forEach(targets => targets.forEach(t => { if(t.node==="Merge") conns.push({ from, idx: t.index }); }));
  assert(conns.length === 2, `expected 2, got ${conns.length}`);
  const idxs = conns.map(c => c.idx);
  assert(new Set(idxs).size === 2, `collision: ${idxs}`);
  assert(idxs.includes(0) && idxs.includes(1), `missing 0 or 1: ${idxs}`);
});

test("Merge: inputIndex explícito respeitado", () => {
  const result = reconstructWorkflow(mkLite(
    [{ name:"A",type:"code" },{ name:"B",type:"code" },{ name:"Merge",type:"merge" }],
    [{ from:"A",to:"Merge",inputIndex:1 },{ from:"B",to:"Merge" }]
  ));
  const conns = [];
  for (const [from, outs] of Object.entries(result.connections))
    for (const [,arrs] of Object.entries(outs))
      arrs.forEach(ts => ts.forEach(t => { if(t.node==="Merge") conns.push({ from, idx: t.index }); }));
  assert(conns.find(c=>c.from==="A").idx === 1, `A should be port 1: ${JSON.stringify(conns)}`);
  assert(new Set(conns.map(c=>c.idx)).size === 2, `should have unique ports`);
});

test("IF→Merge pattern (bug reportado pelo usuário): False branch vai para porta diferente", () => {
  const result = reconstructWorkflow(mkLite(
    [{ name:"IF",type:"if" },{ name:"Get",type:"httpRequest" },{ name:"DL",type:"httpRequest" },{ name:"Whisper",type:"httpRequest" },{ name:"Merge",type:"merge" }],
    [{ from:"IF",to:"Get" },{ from:"IF",to:"Merge",outputIndex:1 },{ from:"Get",to:"DL" },{ from:"DL",to:"Whisper" },{ from:"Whisper",to:"Merge" }]
  ));
  const conns = [];
  for (const [from, outs] of Object.entries(result.connections))
    for (const [,arrs] of Object.entries(outs))
      arrs.forEach(ts => ts.forEach(t => { if(t.node==="Merge") conns.push({ from, idx: t.index }); }));
  assert(conns.length === 2, `expected 2, got ${conns.length}`);
  assert(new Set(conns.map(c=>c.idx)).size === 2, `collision: ${JSON.stringify(conns)}`);
});

test("linear A→B→C: todos com inputIndex 0 (não incrementa desnecessariamente)", () => {
  const result = reconstructWorkflow(mkLite(
    [{ name:"A",type:"code" },{ name:"B",type:"code" },{ name:"C",type:"code" }],
    [{ from:"A",to:"B" },{ from:"B",to:"C" }]
  ));
  for (const [,outs] of Object.entries(result.connections))
    for (const [,arrs] of Object.entries(outs))
      arrs.forEach(ts => ts.forEach(t => assert(t.index === 0, `linear should use index 0, got ${t.index} for ${t.node}`)));
});

// ─── 6. simplifyConnections round-trip ───────────────────────────────────────

section("6. simplifyConnections Round-trip");

test("outputIndex > 0 preserved", () => {
  const flow = simplifyConnections({ "IF": { main: [[{ node:"True",type:"main",index:0 }],[{ node:"False",type:"main",index:0 }]] } });
  assert(flow.find(c=>c.to==="False")?.outputIndex === 1);
});

test("inputIndex > 0 preserved", () => {
  const flow = simplifyConnections({ "A": { main: [[{ node:"Merge",type:"main",index:1 }]] } });
  assert(flow.find(c=>c.to==="Merge")?.inputIndex === 1);
});

test("inputIndex = 0 stripped (compact)", () => {
  const flow = simplifyConnections({ "A": { main: [[{ node:"B",type:"main",index:0 }]] } });
  assert(flow.find(c=>c.to==="B")?.inputIndex === undefined);
});

// ─── 7. Regressões ───────────────────────────────────────────────────────────

section("7. Regressões");

test("n8n-nodes-base. stripped/restored", () => {
  const r = reconstructWorkflow(mkLite([{ name:"Webhook",type:"webhook" }], []));
  assert(r.nodes.find(n=>n.name==="Webhook")?.type === "n8n-nodes-base.webhook");
});

test("langchain: prefix restored", () => {
  const r = reconstructWorkflow(mkLite([{ name:"Agent",type:"langchain:agent" }], []));
  assert(r.nodes.find(n=>n.name==="Agent")?.type === "@n8n/n8n-nodes-langchain.agent");
});

test("tipo não reconhecido: humanizado sem crash", () => {
  const s = generateNodeSummary("someUnknownCustomType", {});
  assert(typeof s === "string" && !s.includes("undefined"), `got: "${s}"`);
});

test("focus sem executionId: runDataMap vazio → hint undefined", () => {
  assert(getInputHintForNode("X", [{ from:"Up",to:"X" }], {}) === undefined);
});

test("extractExecutionRunData com estrutura parcial (sem runData): não crasha", () => {
  const map = extractExecutionRunData({ resultData: {} });
  assert(Object.keys(map).length === 0);
});

test("extractExecutionRunData: runs array vazio → node ignorado", () => {
  const map = extractExecutionRunData(mockExec({ "A": [] }));
  assert(map["A"] === undefined, "empty runs should be skipped");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(64)}`);
console.log(`  RESULTADO: ${passed} ✅ passed  |  ${failed} ❌ failed`);
console.log("═".repeat(64));
if (failures.length) {
  console.log("\nFALHAS:");
  failures.forEach(f => console.log(`  ❌  ${f.name}\n       ${f.error}`));
  process.exit(1);
} else {
  console.log("\n🎉  Todos os testes passaram!\n");
  process.exit(0);
}
