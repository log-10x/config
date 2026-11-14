// The record the Fluent Bit and process outputs write for each event.
// Each output writes its `fields` values joined by a space, `[ <time> , {...} ]`,
// the form Fluent Bit's stdin input reads: a JSON array of a time and a map.
// This test evaluates each output's fields with stubs of the engine functions
// they call and parses the record, for an event with a timestamp and for one
// without. The stubs follow the engine: `dateFormat(pattern)` formats the
// event's first timestamp and writes nothing when the event has none, and
// `now()` is the current time in milliseconds (the engine divides it by 1000
// as whole numbers; the stub's time is a whole second, so JavaScript's
// division gives the same value).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'pipelines', 'run', 'output', 'event');

const outputs = [
  'fluentbit/azure.yaml',
  'fluentbit/cloudwatch.yaml',
  'fluentbit/datadog.yaml',
  'fluentbit/elasticsearch.yaml',
  'fluentbit/splunk.yaml',
  'fluentbit/stdout.yaml',
  'process/config.yaml',
];

// The `fields:` list of the first output entry: `- name=expression` items.
function fields(file) {
  const yaml = readFileSync(join(root, file), 'utf8');
  const block = /\n {4}fields: +#?\n((?: {6}- .*\n)+)/.exec(yaml);
  assert.ok(block, `fields block found in ${file}`);
  return block[1].split('\n').filter((l) => l.trim()).map((l) => {
    let item = l.trim().slice(2).trim();
    if (item.startsWith("'") && item.endsWith("'")) item = item.slice(1, -1).replace(/''/g, "'");
    const eq = item.indexOf('=');
    return item.slice(eq + 1);
  });
}

const NOW_MS = 1794564007000;

// `+%s.%N` of a millisecond epoch as the engine writes it: seconds, '.', the
// nanoseconds after the second (0 for a millisecond epoch).
function epochNanoSep(epochMs) {
  return Math.floor(epochMs / 1000) + '.0';
}

function record(file, event) {
  const scope = {
    timestamped: event.epochMs !== null,
    now: () => NOW_MS,
    dateFormat: () => (event.epochMs === null ? '' : epochNanoSep(event.epochMs)),
    joinFields: (_delim, ...names) => JSON.stringify(Object.fromEntries(names.map((n) => [n, event[n]]))),
  };
  const values = fields(file).map((exp) =>
    new Function(...Object.keys(scope), 'return (' + exp + ');')(...Object.values(scope)));
  return values.join(' ');
}

const withTime = { epochMs: 1794564001123, text: '2026-11-13T10:00:01.123Z INFO GET /api/items/42 user=alice' };
const noTime = { epochMs: null, text: '{"stream":"stdout","log":"Accounting service started"}' };

for (const file of outputs) {
  test(`${file}: an event with a timestamp is written as [time, map]`, () => {
    const r = record(file, withTime);
    assert.equal(r, '[ 1794564001.0 , {"text":"2026-11-13T10:00:01.123Z INFO GET /api/items/42 user=alice"} ]');
  });

  test(`${file}: an event with no timestamp is a time and a map`, () => {
    const r = record(file, noTime);
    let v;
    assert.doesNotThrow(() => { v = JSON.parse(r); }, `not JSON: ${r}`);
    assert.ok(Array.isArray(v) && v.length === 2, r);
    assert.equal(v[0], Math.floor(NOW_MS / 1000));
    assert.deepEqual(v[1], { text: noTime.text });
  });
}

test('the stdin input reads records larger than its 16k default buffer', () => {
  const conf = readFileSync(join(root, 'fluentbit', 'fluentbit-10x-input.conf'), 'utf8');
  const input = /\[INPUT\]\n((?: {4}.*\n)+)/.exec(conf);
  assert.ok(input, '[INPUT] section found');
  const size = /^ {4}Buffer_Size +(\d+)([kKmM]?)\s*$/m.exec(input[1]);
  assert.ok(size, 'Buffer_Size set in the stdin input');
  const bytes = Number(size[1]) * ({ k: 1024, m: 1024 * 1024 }[size[2].toLowerCase()] ?? 1);
  assert.ok(bytes >= 1024 * 1024, `Buffer_Size ${bytes} bytes`);
});
