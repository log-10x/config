// The ready-made field profiles in pipelines/run/fields. The engine stops at
// launch on an option no unit declares, so a profile may set only the options
// the field parser's schema.json lists. It must open with `tenx: run` to load as
// an @file argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const unitDir = join(here, '..', 'pipelines', 'run', 'transform', 'fields');
const dir = join(here, '..', 'pipelines', 'run', 'fields');
const schema = JSON.parse(readFileSync(join(unitDir, 'schema.json'), 'utf8')).properties;
const profiles = readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
const readerNames = /Possible values: \[([^\]]+)\]/.exec(schema.field.properties.readers.markdownDescription)[1].split(', ');

function scalar(text) {
  if (text.startsWith('[') && text.endsWith(']')) {
    const items = text.slice(1, -1).match(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,\s][^,]*/g) ?? [];
    return items.map((item) => scalar(item.trim()));
  }
  if (text.startsWith('"')) return JSON.parse(text);
  if (text.startsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  if (text === 'true' || text === 'false') return text === 'true';
  if (/^-?\d+$/.test(text)) return Number(text);
  return text;
}

// Reads the YAML forms a profile uses: top-level keys, one level of nested keys
// and block lists. Any other line fails the read.
function read(file) {
  const doc = {};
  let parent = null;
  readFileSync(join(dir, file), 'utf8').split('\n').forEach((line, i) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    let m;
    if ((m = /^(\w+):(?: (.+))?$/.exec(line))) {
      assert.ok(!(m[1] in doc), `${file}:${i + 1} repeats ${m[1]}`);
      doc[m[1]] = m[2] === undefined ? null : scalar(m[2]);
      parent = m[2] === undefined ? m[1] : null;
    } else if (parent && (m = /^ {2}- (.+)$/.exec(line))) {
      doc[parent] ??= [];
      assert.ok(Array.isArray(doc[parent]), `${file}:${i + 1} mixes a list into ${parent}`);
      doc[parent].push(scalar(m[1]));
    } else if (parent && (m = /^ {2}(\w+): (.+)$/.exec(line))) {
      doc[parent] ??= {};
      assert.ok(!Array.isArray(doc[parent]) && !(m[1] in doc[parent]), `${file}:${i + 1} repeats ${m[1]}`);
      doc[parent][m[1]] = scalar(m[2]);
    } else {
      assert.fail(`${file}:${i + 1} is not a form a profile uses: ${line}`);
    }
  });
  return doc;
}

function assertType(file, key, value, spec) {
  const kind = Array.isArray(value) ? 'array' : typeof value;
  assert.ok(spec.type.includes(kind), `${file}: ${key} is ${kind}, the option takes ${spec.type}`);
  if (kind === 'array') value.forEach((v) => assert.equal(typeof v, 'string', `${file}: ${key} holds ${v}`));
}

test('the folder holds profiles', () => {
  assert.ok(profiles.length > 0);
});

// Every run app loads each YAML file under run/transform, so a profile there
// would apply to every launch.
test('the field parser folder holds only its default config', () => {
  assert.deepEqual(readdirSync(unitDir).filter((f) => /\.ya?ml$/.test(f)), ['config.yaml']);
});

for (const file of profiles) {
  test(`${file} sets only declared options`, () => {
    const doc = read(file);
    assert.equal(Object.keys(doc)[0], 'tenx', 'tenx is the first key');
    assert.equal(doc.tenx, 'run');
    for (const [key, value] of Object.entries(doc)) {
      assert.ok(key in schema, `${file}: ${key} is not an option of this unit`);
      if (key === 'tenx') continue;
      if (key === 'field') {
        for (const [name, v] of Object.entries(value)) {
          assert.ok(name in schema.field.properties, `${file}: field.${name} is not an option of this unit`);
          assertType(file, `field.${name}`, v, schema.field.properties[name]);
        }
      } else {
        assertType(file, key, value, schema[key]);
      }
    }
  });

  test(`${file} lists compact fields its readers can give`, () => {
    const doc = read(file);
    const readers = doc.field?.readers;
    assert.ok(Array.isArray(readers) && readers.length > 0, 'field.readers is set');
    readers.forEach((r) => assert.ok(readerNames.includes(r), `${r} is a reader`));
    assert.ok(Array.isArray(doc.compactFields) && doc.compactFields.length > 0, 'compactFields is set');
    const seen = new Set();
    for (const entry of doc.compactFields) {
      assert.ok(!seen.has(entry), `${entry} is listed twice`);
      seen.add(entry);
      assert.match(entry, /^[^=]+(=[^=]+)?$/, `${entry} is name or name=outputName`);
    }
  });
}
