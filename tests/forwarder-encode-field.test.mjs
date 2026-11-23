// The forwarder output condition and expression, evaluated for every switch
// combination. `encodeFilter` and `encodeField` in
// pipelines/run/input/forwarder/config.yaml are expressions the engine compiles
// as Java at launch, so they may use only ternaries, string concatenation and
// calls. This test runs them with a stub TenXEnv and checks the strings they yield.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const yaml = readFileSync(join(here, '..', 'pipelines', 'run', 'input', 'forwarder', 'config.yaml'), 'utf8');

function expression(key) {
  const block = new RegExp(key + ': \\|-\\n((?:    .*\\n)+)').exec(yaml);
  assert.ok(block, key + ' block found');
  const script = block[1].split('\n').map((l) => l.slice(4)).join('\n').trim();
  assert.ok(script.startsWith('$=yield '), 'the block is a $=yield expression');
  return script.slice('$=yield '.length);
}

const filterExpr = expression('encodeFilter');
const fieldExpr = expression('encodeField');

test('the expressions have no statement syntax the engine cannot compile', () => {
  for (const expr of [filterExpr, fieldExpr]) {
    assert.doesNotMatch(expr, /\bfunction\b|\bvar\b|\blet\b|\bconst\b|=>|===|!==|[;{}]/);
  }
});

function run(expr, env) {
  const TenXEnv = { get: (k, d) => (k in env ? env[k] : d) };
  return new Function('TenXEnv', 'return (' + expr + ');')(TenXEnv);
}

function evaluate(env) {
  const filter = run(filterExpr, env);
  return [filter, run(fieldExpr, { ...env, outputEncodeFilter: filter })];
}

const cases = [
  [{}, 'false', 'encoded=(false) ? encode() : fullText("tenx_passthrough")'],
  [{ receiverOptimize: true }, 'true', 'encoded=(true) ? encode() : fullText("tenx_passthrough")'],
  [{ compactReceiverLookupFile: '/cap.csv' }, 'shouldEncode()', 'encoded=(shouldEncode()) ? encode() : fullText("tenx_passthrough")'],
  [{ compactReceiverLookupFile: '/cap.csv', receiverOptimize: true }, 'shouldEncode()', 'encoded=(shouldEncode()) ? encode() : fullText("tenx_passthrough")'],
  [{ outputOffload: true, compactReceiverLookupFile: '/cap.csv' }, 'false', 'encoded=(false) ? encode("routeState") : fullText("routeState")'],
  [{ outputSoftDrop: true }, 'isRoute("compact") || false', 'encoded=(isRoute("compact") || false) ? encode("routeState") : fullText("routeState")'],
  [{ outputSoftDrop: true, receiverOptimize: true }, 'isRoute("compact") || true', 'encoded=(isRoute("compact") || true) ? encode("routeState") : fullText("routeState")'],
  [{ outputSoftDrop: true, compactReceiverLookupFile: '/cap.csv' }, 'isRoute("compact") || shouldEncode()', 'encoded=(isRoute("compact") || shouldEncode()) ? encode("routeState") : fullText("routeState")'],
  [{ symbolMessageHashField: 'tenx_hash' }, 'false', 'encoded=(false) ? encode("tenx_hash") : fullText("tenx_hash")'],
  [{ symbolMessageHashField: 'tenx_hash', receiverOptimize: true }, 'true', 'encoded=(true) ? encode("tenx_hash") : fullText("tenx_hash")'],
  [{ symbolMessageHashField: 'tenx_hash', compactReceiverLookupFile: '/cap.csv' }, 'shouldEncode()', 'encoded=(shouldEncode()) ? encode("tenx_hash") : fullText("tenx_hash")'],
  [{ symbolMessageHashField: 'tenx_hash', outputSoftDrop: true, compactReceiverLookupFile: '/cap.csv' }, 'isRoute("compact") || shouldEncode()', 'encoded=(isRoute("compact") || shouldEncode()) ? encode("tenx_hash","routeState") : fullText("tenx_hash","routeState")'],
  [{ symbolMessageHashField: 'tenx_hash', outputOffload: true }, 'false', 'encoded=(false) ? encode("tenx_hash","routeState") : fullText("tenx_hash","routeState")'],
];

for (const [env, filter, field] of cases) {
  test(`encodeFilter and encodeField with ${JSON.stringify(env)}`, () => {
    assert.deepEqual(evaluate(env), [filter, field]);
  });
}

test('no branch yields the bare fullText field', () => {
  for (const [env] of cases) assert.doesNotMatch(evaluate(env)[1], /fullText(?!\()/);
});
