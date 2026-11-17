import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZip } from '../zip.js';

function unzipStored(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoded = new TextDecoder(); const files = new Map(); let i = 0;
  while (i + 30 <= bytes.length && view.getUint32(i, true) === 0x04034b50) {
    assert.equal(view.getUint16(i + 8, true), 0); // no compression
    const size = view.getUint32(i + 18, true);
    const nameLength = view.getUint16(i + 26, true);
    const extraLength = view.getUint16(i + 28, true);
    const name = decoded.decode(bytes.slice(i + 30, i + 30 + nameLength));
    const start = i + 30 + nameLength + extraLength;
    files.set(name, decoded.decode(bytes.slice(start, start + size)));
    i = start + size;
  }
  assert.equal(view.getUint32(i, true), 0x02014b50); // central directory
  return files;
}

test('Generated website ZIP is valid and includes HTML and instructions', async () => {
  const html = '<!doctype html><html><body>Привет</body></html>';
  const zip = buildZip([['index.html', html], ['README.txt', 'Инструкция']]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const files = unzipStored(bytes);
  assert.deepEqual([...files.keys()], ['index.html', 'README.txt']);
  assert.equal(files.get('index.html'), html);
  assert.equal(files.get('README.txt'), 'Инструкция');
  assert.equal(new DataView(bytes.buffer).getUint32(bytes.length - 22, true), 0x06054b50); // EOCD
});
