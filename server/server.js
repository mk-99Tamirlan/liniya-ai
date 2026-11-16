// LINIYA: server-side OpenAI gateway. Never put API keys in browser code or Git.
// Node.js 20+; no third-party dependencies.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const key = process.env.OPENAI_API_KEY || '';
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean));

// Simple spending guardrails for a small demonstration. Counters are in memory,
// so they reset when the process restarts. Also set API project spending limits.
const MAX_DAILY_REQUESTS = Math.max(1, Math.min(1000, Number(process.env.MAX_DAILY_REQUESTS) || 60));
const MAX_DAILY_PER_IP = Math.max(1, Math.min(100, Number(process.env.MAX_DAILY_PER_IP) || 20));
const MAX_CONCURRENT_REQUESTS = 2;
let dailyDate = '';
let dailyCount = 0;
let inFlight = 0;
const recent = new Map();
const dailyByIP = new Map();

const assets = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'], ['/favicon.svg', 'favicon.svg'],
]);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(obj));
};

function allowOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const ownOrigin = `http://${req.headers.host || ''}`;
  // Browser requests to the same site are always allowed. For GitHub Pages,
  // list exact origins in ALLOWED_ORIGINS (without the repository path).
  const sameOrigin = origin === ownOrigin || origin === ownOrigin.replace(/^http:/, 'https:');
  if (!sameOrigin && !allowedOrigins.has(origin)) {
    json(res, 403, { error: 'Запрос с этого сайта запрещён' });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  return true;
}

function validMessage(message) {
  return message && ['user', 'assistant'].includes(message.role) &&
    typeof message.content === 'string' && message.content.length > 0 && message.content.length <= 12000;
}

function withinLimits(ip) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== dailyDate) { dailyDate = today; dailyCount = 0; dailyByIP.clear(); recent.clear(); }
  if (dailyCount >= MAX_DAILY_REQUESTS) return 'На сегодня лимит запросов сайта исчерпан';
  if ((dailyByIP.get(ip) || 0) >= MAX_DAILY_PER_IP) return 'Достигнут дневной лимит запросов';
  const times = (recent.get(ip) || []).filter(t => now - t < 60000);
  if (times.length >= 8) return 'Слишком много запросов. Подождите минуту';
  if (inFlight >= MAX_CONCURRENT_REQUESTS) return 'Сервис занят, попробуйте через несколько секунд';
  times.push(now);
  recent.set(ip, times);
  dailyCount++;
  dailyByIP.set(ip, (dailyByIP.get(ip) || 0) + 1);
  return null;
}

async function respond(req, res) {
  if (!allowOrigin(req, res)) return;
  if (!key) return json(res, 503, { error: 'На сервере не задан OPENAI_API_KEY' });
  const ip = req.socket.remoteAddress || 'unknown';
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 140000) return json(res, 413, { error: 'Слишком большой запрос' });
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return json(res, 400, { error: 'Неверный JSON' }); }
    if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 24 ||
        !input.messages.every(validMessage) ||
        input.messages.reduce((n, m) => n + m.content.length, 0) > 30000) {
      return json(res, 422, { error: 'Диалог слишком длинный или имеет неверный формат' });
    }
    const limitError = withinLimits(ip);
    if (limitError) return json(res, 429, { error: limitError });
    inFlight++;
    try {
      const body = {
        model,
        instructions: 'Ты ЛИНИЯ, полезный русскоязычный ассистент. Отвечай понятно и естественно. Не утверждай, что выполнил действия, которых не совершал.',
        input: input.messages.map(m => ({ role: m.role, content: m.content })),
        max_output_tokens: 1100,
        store: false,
      };
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error('OpenAI API error status:', response.status, 'type:', result?.error?.type || 'unknown');
        let message = 'Ошибка обращения к ИИ, проверьте настройки API';
        if (response.status === 401 || response.status === 403) message = 'Ключ API недействителен или нет доступа к модели';
        if (response.status === 429) message = 'Превышена квота или лимит OpenAI API, проверьте баланс';
        return json(res, 502, { error: message });
      }
      const answer = result.output_text || (result.output || []).flatMap(item => item.content || [])
        .filter(item => item.type === 'output_text').map(item => item.text).join('\n');
      if (!answer) return json(res, 502, { error: 'Модель не вернула текст' });
      return json(res, 200, { text: answer });
    } finally { inFlight--; }
  } catch (error) {
    console.error('Chat request failed:', error?.name || 'Error');
    return json(res, 502, { error: 'Не удалось связаться с ИИ, попробуйте позже' });
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/api/health') {
    if (req.method !== 'GET') return json(res, 405, { error: 'Метод не поддерживается' });
    return json(res, 200, { ok: true, aiConfigured: Boolean(key) });
  }
  if (pathname === '/api/chat') {
    if (req.method === 'OPTIONS') {
      if (!allowOrigin(req, res)) return;
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
      res.end();
      return;
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Метод не поддерживается' });
    return respond(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Метод не поддерживается' });
  const asset = assets.get(pathname);
  if (!asset) return json(res, 404, { error: 'Страница не найдена' });
  try {
    const file = path.join(root, asset);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { json(res, 500, { error: 'Не удалось открыть файл' }); }
});
server.listen(port, host, () => console.log(`ЛИНИЯ запущена на ${host}:${port}. ИИ: ${key ? 'настроен' : 'ключ не задан'}`));
