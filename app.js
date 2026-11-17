import { templates } from './templates.js';
import { buildZip } from './zip.js';

const $ = (id) => document.getElementById(id);
const STORAGE = 'liniya-studio-projects-v1';
const SETTINGS = 'liniya-studio-settings-v1';
const MAX_PROJECTS = 20;
let projects = [];
let currentId = null;
let apiUrl = '';
let style = 'auto';
let device = 'desktop';
let busy = false;
let currentTab = 'preview';
let toastTimeout;

function notify(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('show'), 4200);
}
function id() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function current() { return projects.find(p => p.id === currentId) || null; }
function dateLabel(timestamp) { return new Date(timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); }
function timeLabel(timestamp) { return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function safeFilename(s) { return (s || 'site').toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'site'; }
function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    if (Array.isArray(parsed)) projects = parsed.filter(p => p && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.html === 'string' && p.html.length < 160000).slice(0, MAX_PROJECTS).map(p => ({ ...p, history: Array.isArray(p.history) ? p.history.slice(-8) : [], changes: Array.isArray(p.changes) ? p.changes.slice(-20) : [] }));
  } catch { projects = []; }
  try { apiUrl = String(JSON.parse(localStorage.getItem(SETTINGS) || '{}').apiUrl || ''); } catch { apiUrl = ''; }
}
function persist() {
  try { localStorage.setItem(STORAGE, JSON.stringify(projects)); return true; }
  catch { notify('Не удалось сохранить проект: хранилище браузера заполнено. Скачайте ZIP.'); return false; }
}
function addProject({ title, html, description = '', prompt = '' }) {
  const now = Date.now();
  const project = { id: id(), title: title.slice(0, 70), description, html, createdAt: now, updatedAt: now, history: [], changes: [{ text: prompt || 'Создан сайт из шаблона', at: now }] };
  projects.unshift(project);
  if (projects.length > MAX_PROJECTS) projects = projects.slice(0, MAX_PROJECTS);
  persist();
  return project;
}
function snapshot(p) { p.history = [...(p.history || []), p.html].slice(-8); }
function change(p, text) { p.changes = [...(p.changes || []), { text: text.slice(0, 300), at: Date.now() }].slice(-20); p.updatedAt = Date.now(); persist(); }
function renderProjects() {
  $('project-count').textContent = String(projects.length);
  const list = $('project-list'); list.replaceChildren();
  if (!projects.length) { const empty = document.createElement('p'); empty.className = 'empty-list'; empty.textContent = 'Здесь появятся ваши сайты'; list.append(empty); return; }
  for (const p of projects) {
    const item = document.createElement('div'); item.className = 'project-item' + (p.id === currentId ? ' active' : '');
    const icon = document.createElement('span'); icon.className = 'project-icon'; icon.textContent = '▧';
    const select = document.createElement('button'); select.className = 'project-select'; select.type = 'button';
    const name = document.createElement('strong'); name.textContent = p.title;
    const date = document.createElement('small'); date.textContent = dateLabel(p.updatedAt);
    select.append(name, date); select.addEventListener('click', () => openProject(p.id));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'project-delete'; del.textContent = '×'; del.title = 'Удалить проект'; del.setAttribute('aria-label', `Удалить ${p.title}`);
    del.addEventListener('click', () => { if (confirm(`Удалить проект «${p.title}»?`)) { projects = projects.filter(x => x.id !== p.id); if (currentId === p.id) showHome(); persist(); renderProjects(); notify('Проект удалён'); } });
    item.append(icon, select, del); list.append(item);
  }
}
function renderChanges() {
  const p = current(); const container = $('change-log'); container.replaceChildren();
  if (!p) return;
  const changes = [...(p.changes || [])].reverse();
  changes.forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'change-item';
    const n = document.createElement('span'); n.className = 'change-number'; n.textContent = String(changes.length - i);
    const info = document.createElement('div');
    const text = document.createElement('p'); text.textContent = c.text;
    const date = document.createElement('time'); date.textContent = timeLabel(c.at);
    info.append(text, date); row.append(n, info); container.append(row);
  });
}
function renderPreview() {
  const p = current(); if (!p) return;
  $('site-preview').srcdoc = p.html;
  $('code-editor').value = p.html;
  $('project-status').textContent = 'Изменения сохранены в браузере';
  $('undo-btn').disabled = !(p.history || []).length;
}
function openProject(projectId) {
  const p = projects.find(x => x.id === projectId); if (!p) return;
  currentId = p.id;
  $('home-view').hidden = true; $('builder-view').hidden = false;
  $('top-title').textContent = p.title; $('project-name').value = p.title;
  $('edit-prompt').value = '';
  renderProjects(); renderChanges(); renderPreview(); setTab('preview'); closeMenu();
}
function showHome() {
  currentId = null; $('home-view').hidden = false; $('builder-view').hidden = true;
  $('top-title').textContent = 'Новый проект'; renderProjects(); closeMenu();
}
function setTab(tab) {
  currentTab = tab;
  $('tab-preview').classList.toggle('active', tab === 'preview');
  $('tab-code').classList.toggle('active', tab === 'code');
  $('tab-preview').setAttribute('aria-pressed', String(tab === 'preview'));
  $('tab-code').setAttribute('aria-pressed', String(tab === 'code'));
  $('preview-stage').hidden = tab !== 'preview'; $('code-stage').hidden = tab !== 'code';
}
function applyCode(silent = false) {
  const p = current(); if (!p) return;
  const html = $('code-editor').value;
  if (html === p.html) { if (!silent) notify('Код уже актуален'); return; }
  if (!html.trim() || html.length > 150000) { notify('HTML должен содержать код размером до 150 КБ'); return; }
  snapshot(p); p.html = html; change(p, 'Изменён HTML-код вручную');
  $('site-preview').srcdoc = html; $('undo-btn').disabled = false;
  $('project-status').textContent = 'Изменения сохранены в браузере';
  renderChanges(); renderProjects(); if (!silent) notify('Код применён к предпросмотру');
}
function setDevice(value) {
  device = value;
  $('preview-frame').className = `preview-frame ${device}`;
  document.querySelectorAll('[data-device]').forEach(b => b.classList.toggle('active', b.dataset.device === device));
}
function setStyle(value) {
  style = value;
  document.querySelectorAll('[data-style]').forEach(b => b.classList.toggle('active', b.dataset.style === value));
}
function endpoint(path) { return (apiUrl || '') + path; }
async function checkHealth() {
  const connection = $('connection'); const label = $('connection-label');
  connection.classList.remove('online'); label.textContent = 'Проверка ИИ…';
  try {
    const response = await fetch(endpoint('/api/health'), { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!response.ok) throw new Error('offline');
    const data = await response.json();
    if (data.aiConfigured) { connection.classList.add('online'); label.textContent = 'ИИ подключён'; }
    else { label.textContent = 'Нужен API-ключ'; }
  } catch { label.textContent = 'Шаблоны доступны'; }
}
async function requestGeneration(prompt, existingHtml = '') {
  const response = await fetch(endpoint('/api/generate'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, currentHtml: existingHtml, style }),
    signal: AbortSignal.timeout(110000),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('Сервер не вернул корректный ответ'); }
  if (!response.ok) throw new Error(result.error || `Ошибка сервера (${response.status})`);
  if (typeof result.html !== 'string' || !result.html.includes('<html')) throw new Error('ИИ не вернул полноценную HTML-страницу');
  return result;
}
function setBusy(value) {
  busy = value;
  const homeBtn = document.querySelector('.generate-btn');
  homeBtn.disabled = value; homeBtn.textContent = value ? '✳ Создаём ваш сайт…' : 'Создать с ИИ ↗';
  $('edit-generate').disabled = value; $('edit-generate').textContent = value ? '✳ Обновляем сайт…' : '✳  Обновить с ИИ';
}
async function generateNew(prompt) {
  if (busy) return;
  setBusy(true);
  try {
    const result = await requestGeneration(prompt);
    const p = addProject({ title: result.title || 'Новый сайт', html: result.html, description: result.description || '', prompt: 'Создано с ИИ: ' + prompt });
    $('home-prompt').value = ''; openProject(p.id); notify('Сайт готов! Теперь его можно редактировать и скачать.');
  } catch (err) { notify(`Не удалось создать сайт: ${err.message}. Проверьте подключение в настройках.`); }
  finally { setBusy(false); }
}
async function refineProject(prompt) {
  const p = current(); if (!p || busy) return;
  if (currentTab === 'code' && $('code-editor').value !== p.html) applyCode(true);
  setBusy(true);
  try {
    const result = await requestGeneration(prompt, p.html);
    snapshot(p); p.html = result.html; change(p, prompt);
    renderChanges(); renderProjects(); renderPreview(); setTab('preview');
    $('edit-prompt').value = ''; notify('Готово! Сайт обновлён.');
  } catch (err) { notify(`Не удалось обновить сайт: ${err.message}`); }
  finally { setBusy(false); }
}
function downloadBlob(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function downloadHTML() {
  const p = current(); if (!p) return;
  if (currentTab === 'code' && $('code-editor').value !== p.html) applyCode(true);
  downloadBlob(p.html, `${safeFilename(p.title)}.html`, 'text/html;charset=utf-8'); notify('HTML-файл скачан');
}
function downloadZIP() {
  const p = current(); if (!p) return;
  if (currentTab === 'code' && $('code-editor').value !== p.html) applyCode(true);
  const readme = `Сайт «${p.title}»\n\nОткройте index.html в браузере.\n\nЭтот ZIP содержит готовую HTML-страницу со стилями и скриптами внутри файла.\nДля публикации: создайте репозиторий на GitHub, загрузите index.html и включите Settings → Pages → Deploy from a branch → main / (root).\n\nСоздано в ЛИНИЯ Studio.\n`;
  downloadBlob(buildZip([['index.html', p.html], ['README.txt', readme]]), `${safeFilename(p.title)}-website.zip`, 'application/zip');
  notify('Готовый сайт скачан в ZIP');
}
function closeMenu() { $('sidebar').classList.remove('open'); $('menu-overlay').hidden = true; }
function openMenu() { $('sidebar').classList.add('open'); $('menu-overlay').hidden = false; }
function openDialog(name) { const el = $(name); if (!el.open) el.showModal(); }
function saveSettings() {
  const input = $('api-url').value.trim().replace(/\/+$/, '');
  if (input && !/^https:\/\//i.test(input) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(input)) { notify('Для удалённого сервера нужен HTTPS-адрес'); return; }
  apiUrl = input;
  localStorage.setItem(SETTINGS, JSON.stringify({ apiUrl }));
  $('settings-dialog').close(); checkHealth(); notify('Адрес сервера сохранён');
}
function init() {
  load(); renderProjects(); checkHealth();
  $('new-project').addEventListener('click', showHome);
  $('home-form').addEventListener('submit', e => { e.preventDefault(); const prompt = $('home-prompt').value.trim(); if (prompt.length >= 5) generateNew(prompt); else notify('Опишите сайт хотя бы несколькими словами'); });
  document.querySelectorAll('[data-idea]').forEach(b => b.addEventListener('click', () => { $('home-prompt').value = b.dataset.idea; $('home-prompt').focus(); }));
  document.querySelectorAll('[data-template]').forEach(b => b.addEventListener('click', () => { const template = templates[b.dataset.template]; if (!template) return; const p = addProject(template); openProject(p.id); notify('Шаблон открыт. Теперь можете изменить его или скачать.'); }));
  $('edit-form').addEventListener('submit', e => { e.preventDefault(); const prompt = $('edit-prompt').value.trim(); if (prompt.length >= 5) refineProject(prompt); else notify('Опишите, что хотите изменить'); });
  $('edit-prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('edit-form').requestSubmit(); } });
  $('project-name').addEventListener('change', e => { const p = current(); if (!p) return; p.title = e.target.value.trim().slice(0, 70) || 'Без названия'; p.updatedAt = Date.now(); e.target.value = p.title; $('top-title').textContent = p.title; persist(); renderProjects(); });
  $('tab-preview').addEventListener('click', () => { const p = current(); if (p && $('code-editor').value !== p.html) applyCode(true); setTab('preview'); });
  $('tab-code').addEventListener('click', () => setTab('code'));
  $('apply-code').addEventListener('click', () => applyCode());
  $('code-editor').addEventListener('input', () => { $('project-status').textContent = 'В коде есть несохранённые изменения'; });
  $('code-editor').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); applyCode(); } if (e.key === 'Tab') { e.preventDefault(); const t = e.target; const s = t.selectionStart; t.setRangeText('  ', s, t.selectionEnd, 'end'); } });
  document.querySelectorAll('[data-device]').forEach(b => b.addEventListener('click', () => setDevice(b.dataset.device)));
  document.querySelectorAll('[data-style]').forEach(b => b.addEventListener('click', () => setStyle(b.dataset.style)));
  $('undo-btn').addEventListener('click', () => { const p = current(); if (!p?.history?.length) return; p.html = p.history.pop(); change(p, 'Отменено последнее изменение'); renderPreview(); renderChanges(); notify('Предыдущая версия восстановлена'); });
  $('download-html').addEventListener('click', downloadHTML); $('download-zip').addEventListener('click', downloadZIP);
  $('open-menu').addEventListener('click', openMenu); $('close-menu').addEventListener('click', closeMenu); $('menu-overlay').addEventListener('click', closeMenu);
  $('open-settings').addEventListener('click', () => { $('api-url').value = apiUrl; openDialog('settings-dialog'); closeMenu(); });
  $('close-settings').addEventListener('click', () => $('settings-dialog').close());
  $('save-settings').addEventListener('click', saveSettings);
  $('test-connection').addEventListener('click', async () => { saveSettings(); await checkHealth(); notify($('connection-label').textContent); });
  $('help-btn').addEventListener('click', () => openDialog('help-dialog'));
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('help-ok').addEventListener('click', () => $('help-dialog').close());
}
init();
