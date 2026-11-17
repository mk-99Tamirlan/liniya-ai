import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function randomPort() {
  const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const p = s.address().port; s.close(); await once(s, 'close'); return p;
}
async function startServer(env) {
  const port = await randomPort();
  const proc = spawn(process.execPath, ['server/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; proc.stdout.on('data', chunk => { output += chunk.toString(); }); proc.stderr.on('data', chunk => { output += chunk.toString(); });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    if (proc.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try { const r = await fetch(url + '/api/health'); if (r.ok) return { proc, url }; } catch {}
    await sleep(50);
  }
  proc.kill(); throw new Error(`Server not ready: ${output}`);
}
async function stop(proc) { if (proc.exitCode === null) { proc.kill(); await Promise.race([once(proc, 'exit'), sleep(2000)]); } }

await test('Static website and no-key API behavior', async () => {
  const { proc, url } = await startServer({ OPENAI_API_KEY: '' });
  try {
    const index = await fetch(url); assert.equal(index.status, 200); assert.match(await index.text(), /ИИ-конструктор сайтов/);
    for (const asset of ['/styles.css', '/app.js', '/templates.js', '/zip.js', '/favicon.svg']) assert.equal((await fetch(url + asset)).status, 200);
    assert.equal((await fetch(url + '/nonexistent')).status, 404);
    const health = await (await fetch(url + '/api/health')).json(); assert.equal(health.aiConfigured, false);
    const res = await fetch(url + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Сайт для кафе' }) });
    assert.equal(res.status, 503); assert.match((await res.json()).error, /OPENAI_API_KEY/);
  } finally { await stop(proc); }
});

await test('Generate endpoint handles OpenAI Responses API and CORS', async () => {
  let calls = 0; let received;
  const fake = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received = JSON.parse(body); calls++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '<!doctype html><html lang="ru"><head><title>Тестовый сайт</title></head><body><h1>Готово</h1></body></html>' }] }] }));
  });
  fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
  const { proc, url } = await startServer({ OPENAI_API_KEY: 'TEST_ONLY_KEY', OPENAI_API_URL: `http://127.0.0.1:${fake.address().port}`, ALLOWED_ORIGINS: 'https://example.github.io' });
  try {
    const payload = { prompt: 'Создай сайт для кофейни', style: 'minimal' };
    const res = await fetch(url + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.github.io' }, body: JSON.stringify(payload) });
    assert.equal(res.status, 200); assert.equal(res.headers.get('access-control-allow-origin'), 'https://example.github.io');
    const data = await res.json(); assert.equal(data.title, 'Тестовый сайт'); assert.match(data.html, /<h1>Готово<\/h1>/);
    assert.equal(calls, 1); assert.equal(received.model, 'gpt-4o-mini'); assert.equal(received.store, false);
    assert.match(received.instructions, /HTML5/);
    assert.equal((await fetch(url + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'a' }) })).status, 422);
    assert.equal((await fetch(url + '/api/generate', { method: 'OPTIONS', headers: { Origin: 'https://example.github.io', 'Access-Control-Request-Method': 'POST' } })).status, 204);
    assert.equal((await fetch(url + '/api/generate', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 403);
  } finally { await stop(proc); fake.close(); await once(fake, 'close'); }
});
