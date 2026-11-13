// Optional local server for real AI. The OpenAI key is read ONLY from the server environment.
// Node.js 20+; no external dependencies. Bind localhost by default for safety.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const key = process.env.OPENAI_API_KEY || '';
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const configuredOrigin = process.env.ALLOWED_ORIGIN || '';
const recent = new Map();
const assets = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'], ['/favicon.svg', 'favicon.svg'],
]);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const allowOrigin = (req, res) => {
  if (!configuredOrigin) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  if (origin !== configuredOrigin) { json(res, 403, { error: 'Запрос с этого сайта запрещён' }); return false; }
  res.setHeader('Access-Control-Allow-Origin', configuredOrigin);
  res.setHeader('Vary', 'Origin');
  return true;
};
function validMessage(message) {
  return message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string' && message.content.length <= 12000;
}
async function respond(req, res) {
  if (!allowOrigin(req, res)) return;
  if (!key) return json(res, 503, { error: 'На сервере не задан OPENAI_API_KEY' });
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const times = (recent.get(ip) || []).filter(time => now - time < 60000);
  if (times.length >= 12) return json(res, 429, { error: 'Слишком много запросов. Попробуйте позже.' });
  times.push(now); recent.set(ip, times);
  if (recent.size > 500) for (const [k, val] of recent) if (val.every(time => now - time >= 60000)) recent.delete(k);
  let data = '';
  try {
    for await (const chunk of req) {
      data += chunk.toString();
      if (Buffer.byteLength(data) > 140000) throw new Error('Слишком большой запрос');
    }
    const input = JSON.parse(data);
    if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 24 || !input.messages.every(validMessage)) {
      return json(res, 422, { error: 'Неверный формат диалога' });
    }
    const body = {
      model,
      instructions: 'Ты полезный русскоязычный ассистент. Отвечай понятным, естественным языком. Если вопрос сложный, объясняй по шагам. Не утверждай, что выполнял действия, которых не совершал.',
      input: input.messages.map(m => ({ role: m.role, content: m.content })),
      max_output_tokens: 1100,
    };
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('OpenAI upstream status:', response.status, 'type:', result?.error?.type || 'unknown');
      return json(res, 502, { error: response.status === 429 ? 'Недостаточно квоты API или слишком много запросов' : 'Ошибка подключения к сервису ИИ. Проверьте ключ и доступность API.' });
    }
    const text = result.output_text || (result.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
    if (!text) return json(res, 502, { error: 'Модель не вернула текст' });
    return json(res, 200, { text });
  } catch (err) {
    console.error('Request failed:', err.message);
    return json(res, err.message === 'Слишком большой запрос' ? 413 : 500, { error: err.message === 'Слишком большой запрос' ? err.message : 'Не удалось обработать запрос' });
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/api/chat') {
    if (req.method === 'OPTIONS') {
      if (!allowOrigin(req, res)) return;
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return;
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Метод не поддерживается' });
    return respond(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Метод не поддерживается' });
  const asset = assets.get(pathname);
  if (!asset) return json(res, 404, { error: 'Страница не найдена' });
  try {
    const file = path.join(root, asset); const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { json(res, 500, { error: 'Не удалось открыть файл' }); }
});
server.listen(port, host, () => console.log(`ЛИНИЯ: http://${host}:${port} (${key ? 'API подключён' : 'демо, API-ключ не задан'})`));
