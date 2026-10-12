// The forwarder output expression, evaluated for every switch combination.
// `encodeField` in pipelines/run/input/forwarder/config.yaml is a JavaScript
// snippet the engine evaluates once at launch with TenXEnv; this test runs
// the same snippet with a stub TenXEnv and checks the string it yields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const yaml = readFileSync(join(here, '..', 'pipelines', 'run', 'input', 'forwarder', 'config.yaml'), 'utf8');
const block = /encodeField: \|-\n((?:    .*\n)+)/.exec(yaml);
assert.ok(block, 'encodeField block found');
const script = block[1].split('\n').map((l) => l.slice(4)).join('\n').trim();
assert.ok(script.startsWith('$=yield '), 'the block is a $=yield expression');
const expr = script.slice('$=yield '.length);

function evaluate(env) {
  const TenXEnv = { get: (k, d) => (k in env ? env[k] : d) };
  return new Function('TenXEnv', 'return (' + expr + ');')(TenXEnv);
}

const cases = [
  [{}, 'fullText("tenx_passthrough")'],
  [{ receiverOptimize: true }, 'encoded=encode()'],
  [{ compactReceiverLookupFile: '/cap.csv' }, 'encoded=shouldEncode() ? encode() : fullText("tenx_passthrough")'],
  [{ compactReceiverLookupFile: '/cap.csv', receiverOptimize: true }, 'encoded=shouldEncode() ? encode() : fullText("tenx_passthrough")'],
  [{ outputOffload: true, compactReceiverLookupFile: '/cap.csv' }, 'fullText("routeState")'],
  [{ outputSoftDrop: true }, 'encoded=(isRoute("compact") || false) ? encode("routeState") : fullText("routeState")'],
  [{ outputSoftDrop: true, receiverOptimize: true }, 'encoded=(isRoute("compact") || true) ? encode("routeState") : fullText("routeState")'],
  [{ outputSoftDrop: true, compactReceiverLookupFile: '/cap.csv' }, 'encoded=(isRoute("compact") || shouldEncode()) ? encode("routeState") : fullText("routeState")'],
  [{ symbolMessageHashField: 'tenx_hash' }, 'fullText("tenx_hash")'],
  [{ symbolMessageHashField: 'tenx_hash', receiverOptimize: true }, 'encoded=encode("tenx_hash")'],
  [{ symbolMessageHashField: 'tenx_hash', compactReceiverLookupFile: '/cap.csv' }, 'encoded=shouldEncode() ? encode("tenx_hash") : fullText("tenx_hash")'],
  [{ symbolMessageHashField: 'tenx_hash', outputSoftDrop: true, compactReceiverLookupFile: '/cap.csv' }, 'encoded=(isRoute("compact") || shouldEncode()) ? encode("tenx_hash","routeState") : fullText("tenx_hash","routeState")'],
  [{ symbolMessageHashField: 'tenx_hash', outputOffload: true }, 'fullText("tenx_hash","routeState")'],
];

for (const [env, want] of cases) {
  test(`encodeField with ${JSON.stringify(env)}`, () => {
    assert.equal(evaluate(env), want);
  });
}

test('no branch yields the bare fullText field', () => {
  for (const [env] of cases) assert.doesNotMatch(evaluate(env), /fullText(?!\()/);
});
