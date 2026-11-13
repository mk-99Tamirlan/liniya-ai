const STORAGE_KEY = 'liniya.chat.v1';
const SETTINGS_KEY = 'liniya.settings.v1';
const MAX_CHATS = 60;
const MAX_MESSAGES_PER_CHAT = 90;

const $ = (selector) => document.querySelector(selector);
const el = {
  history: $('#history-list'), welcome: $('#welcome-view'), chat: $('#chat-view'),
  messages: $('#messages'), scroller: $('#messages-scroller'), title: $('#current-title'),
  sidebar: $('#sidebar'), scrim: $('#scrim'), dialog: $('#settings-dialog'),
  mode: $('#mode-select'), serverUrl: $('#server-url'), toast: $('#toast'),
};

function safeJSON(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function readChats() {
  const raw = safeJSON(localStorage.getItem(STORAGE_KEY), []);
  return Array.isArray(raw) ? raw.filter(x => x && typeof x.id === 'string' && Array.isArray(x.messages)).slice(0, MAX_CHATS) : [];
}
let chats = readChats();
let activeId = null;
let settings = { mode: 'demo', url: '', ...safeJSON(localStorage.getItem(SETTINGS_KEY), {}) };
settings.mode = settings.mode === 'api' ? 'api' : 'demo';
let pending = false;
let pendingRequest = null;
let toastHandle = null;
const composers = {};

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.slice(0, MAX_CHATS))); }
  catch { showToast('Хранилище браузера заполнено. Экспортируйте историю.'); }
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
function showToast(text) {
  el.toast.textContent = text; el.toast.classList.add('visible');
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => el.toast.classList.remove('visible'), 3500);
}
function currentChat() { return chats.find(x => x.id === activeId) || null; }
function chatTitle(prompt) { return prompt.replace(/\s+/g, ' ').trim().slice(0, 43) || 'Новый диалог'; }
function dateLabel(timestamp) {
  return new Date(timestamp).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function setActive(id) {
  if (pendingRequest) { pendingRequest.abort(); pendingRequest = null; pending = false; }
  activeId = id && chats.some(c => c.id === id) ? id : null;
  closeSidebar(); render();
}
function newChat() { setActive(null); $('#welcome-view textarea')?.focus(); }
function deleteChat(id) {
  if (!confirm('Удалить этот диалог?')) return;
  chats = chats.filter(x => x.id !== id);
  if (activeId === id) activeId = null;
  persist(); render(); showToast('Диалог удалён');
}
function renameChat(id) {
  const chat = chats.find(x => x.id === id);
  if (!chat) return;
  const title = prompt('Название диалога', chat.title);
  if (title === null) return;
  if (title.trim()) chat.title = title.trim().slice(0, 90);
  persist(); render();
}
function renderHistory() {
  el.history.replaceChildren();
  if (!chats.length) {
    const empty = document.createElement('p'); empty.className = 'empty-history';
    empty.textContent = 'Ваши диалоги будут появляться здесь после первого сообщения.';
    el.history.append(empty); return;
  }
  for (const chat of chats) {
    const row = document.createElement('div'); row.className = `history-item${chat.id === activeId ? ' selected' : ''}`;
    const title = document.createElement('button'); title.className = 'history-title';
    title.textContent = chat.title; title.title = `${chat.title} · двойной щелчок — переименовать`;
    title.addEventListener('click', () => setActive(chat.id));
    title.addEventListener('dblclick', () => renameChat(chat.id));
    const remove = document.createElement('button'); remove.className = 'history-delete'; remove.textContent = '×';
    remove.title = 'Удалить диалог'; remove.setAttribute('aria-label', `Удалить ${chat.title}`);
    remove.addEventListener('click', () => deleteChat(chat.id));
    row.append(title, remove); el.history.append(row);
  }
}
function addText(parent, text, className) {
  const node = document.createElement('div'); node.className = className; node.textContent = text; parent.append(node); return node;
}
function renderMessages() {
  el.messages.replaceChildren();
  const chat = currentChat();
  if (!chat) return;
  addText(el.messages, dateLabel(chat.createdAt).toUpperCase(), 'message-meta');
  for (let i = 0; i < chat.messages.length; i++) {
    const msg = chat.messages[i];
    const item = document.createElement('article');
    item.className = `message ${msg.role === 'user' ? 'user' : 'assistant'}${msg.error ? ' error' : ''}`;
    if (msg.role === 'assistant') {
      addText(item, 'л', 'assistant-mark');
      if (msg.heading) addText(item, msg.heading, 'assistant-heading');
    }
    addText(item, msg.content, 'message-body');
    if (msg.role === 'assistant') {
      const actions = document.createElement('div'); actions.className = 'message-actions';
      const copy = document.createElement('button'); copy.textContent = '▣  Скопировать';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(msg.content); showToast('Ответ скопирован'); }
        catch { showToast('Не удалось скопировать'); }
      });
      actions.append(copy);
      if (!msg.error && i === chat.messages.length - 1 && !pending) {
        const retry = document.createElement('button'); retry.textContent = '↻  Повторить ответ';
        retry.addEventListener('click', retryLast); actions.append(retry);
      }
      item.append(actions);
    }
    el.messages.append(item);
  }
  if (pending) {
    const item = document.createElement('article'); item.className = 'message assistant';
    addText(item, 'л', 'assistant-mark'); addText(item, 'Готовлю ответ…', 'message-body typing-dots');
    el.messages.append(item);
  }
}
function render() {
  renderHistory();
  const chat = currentChat();
  el.welcome.hidden = !!chat;
  el.chat.hidden = !chat;
  el.title.textContent = chat ? chat.title : 'Главная';
  document.title = `${chat ? chat.title + ' — ' : ''}ЛИНИЯ`;
  if (chat) { renderMessages(); requestAnimationFrame(() => { el.scroller.scrollTop = el.scroller.scrollHeight; }); }
  el.mode.value = settings.mode;
  $('#mode-dot').style.background = settings.mode === 'api' ? '#89a884' : '#c59b75';
  for (const comp of Object.values(composers)) {
    const send = comp.querySelector('.send-btn');
    send.disabled = pending;
  }
}
function demoAnswer(message) {
  const lower = message.toLowerCase();
  let heading = 'Начнём с того, что известно.';
  let content = 'Чтобы двигаться без лишних догадок, предлагаю такой порядок:\n\n01  Определить результат. Что должно получиться в конце?\n\n02  Разбить задачу на небольшие действия. Так проще заметить ошибки.\n\n03  Проверить каждый шаг отдельно и записать, что получилось.\n\nЭто демонстрационный ответ. Для настоящей генерации переключитесь в режим «ИИ через сервер» и настройте локальный backend.';
  if (/код|ошибк|программ|javascript|python|php|react|html|css/i.test(lower)) {
    heading = 'Разберёмся с кодом последовательно.';
    content = '01  Воспроизведите ошибку и сохраните её точный текст.\n\n02  Найдите минимальный участок кода, в котором проблема повторяется.\n\n03  Проверьте входные данные, типы и условия выполнения.\n\n04  После исправления запустите проверку ещё раз.\n\nЭто пример ответа в демонстрационном режиме, не результат анализа вашего кода. Для реальной помощи подключите сервер ИИ.';
  } else if (/текст|письм|редакт|сообщен|пост|сочинен/i.test(lower)) {
    heading = 'Сделаем текст понятнее.';
    content = 'При редактировании полезно сохранить основную мысль, убрать повторы и подобрать естественные формулировки.\n\nПроверьте три вещи:\n01  Понятна ли цель текста с первых строк?\n02  Нет ли слишком длинных предложений?\n03  Звучит ли текст так, как вы обычно разговариваете?\n\nЭто демонстрация интерфейса. Редактирование реального текста доступно после подключения ИИ.';
  } else if (/проект|иде|план|сайт|приложен/i.test(lower)) {
    heading = 'У идеи должна появиться структура.';
    content = 'Я бы предложил начать с короткого описания:\n\n01  Для кого проект и какую проблему он решает.\n\n02  Какие три функции должны работать в первой версии.\n\n03  Как пользователь пройдёт путь от начала до результата.\n\n04  Что нужно протестировать перед публикацией.\n\nЭто демонстрационная подсказка, а не индивидуально сгенерированный план. Для реальной генерации нужен backend ИИ.';
  } else if (/объясн|тем|что такое|почему|как работает/i.test(lower)) {
    heading = 'Начнём с простого объяснения.';
    content = 'Хороший способ разобраться в новой теме:\n\n01  Сформулировать понятие одним предложением.\n\n02  Найти бытовой или практический пример.\n\n03  Посмотреть, из каких частей состоит процесс.\n\n04  Проверить понимание на небольшом задании.\n\nСейчас это пример работы интерфейса. Настоящие ответы по вашей теме появятся при подключении ИИ.';
  }
  return { heading, content };
}
function newMessage(role, content, more = {}) { return { role, content, ...more }; }
function collectMessages(chat) {
  return chat.messages.filter(m => !m.error).slice(-24).map(m => ({ role: m.role, content: m.content }));
}
async function requestResponse(chat, signal) {
  const prompt = [...chat.messages].reverse().find(m => m.role === 'user')?.content || '';
  if (settings.mode === 'demo') { await new Promise(resolve => setTimeout(resolve, 380)); return demoAnswer(prompt); }
  let base = settings.url.trim().replace(/\/$/, '');
  const url = base ? `${base}/api/chat` : './api/chat';
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: collectMessages(chat) }), signal });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data?.error || `Сервер вернул ошибку ${response.status}`);
  if (typeof data?.text !== 'string' || !data.text.trim()) throw new Error('Сервер не вернул текст ответа');
  return { content: data.text };
}
async function finishReply(chat) {
  pending = true; pendingRequest = new AbortController();
  const signal = pendingRequest.signal;
  render();
  try {
    const reply = await requestResponse(chat, signal);
    if (!signal.aborted) { chat.messages.push(newMessage('assistant', reply.content, { heading: reply.heading })); chat.updatedAt = Date.now(); persist(); }
  } catch (error) {
    if (!signal.aborted) {
      chat.messages.push(newMessage('assistant', `Не удалось получить ответ: ${error.message}. Проверьте настройки сервера и попробуйте ещё раз.`, { error: true }));
      persist();
    }
  } finally {
    if (pendingRequest?.signal === signal) { pending = false; pendingRequest = null; }
    render();
  }
}
function retryLast() {
  const chat = currentChat();
  if (pending || !chat) return;
  const last = chat.messages.at(-1);
  if (last?.role === 'assistant') chat.messages.pop();
  persist(); void finishReply(chat);
}
function send(text, attachment = '') {
  if (pending) return;
  let message = text.trim();
  if (attachment) message += `${message ? '\n\n' : ''}Содержимое прикреплённого файла:\n${attachment}`;
  if (!message) return;
  if (message.length > 12000) { showToast('Сообщение слишком длинное. Максимум 12 000 символов.'); return; }
  let chat = currentChat();
  if (!chat) {
    chat = { id: crypto.randomUUID(), title: chatTitle(text || 'Файл'), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    chats.unshift(chat); activeId = chat.id;
  }
  if (chat.messages.length >= MAX_MESSAGES_PER_CHAT) { showToast('Диалог слишком длинный. Создайте новый.'); return; }
  chat.messages.push(newMessage('user', message)); chat.updatedAt = Date.now();
  chats = [chat, ...chats.filter(c => c.id !== chat.id)].slice(0, MAX_CHATS);
  persist();
  for (const comp of Object.values(composers)) resetComposer(comp);
  closeSidebar(); render(); void finishReply(chat);
}
function resetComposer(form) {
  form.reset(); form.dataset.fileText = '';
  form.querySelector('.attachment-preview').hidden = true;
  const area = form.querySelector('textarea'); area.style.height = 'auto';
}
function buildComposer(mount, name) {
  const form = $('#composer-template').content.firstElementChild.cloneNode(true);
  const area = form.querySelector('textarea'); const file = form.querySelector('.file-input');
  form.addEventListener('submit', (event) => { event.preventDefault(); send(area.value, form.dataset.fileText || ''); });
  area.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
  area.addEventListener('input', () => { area.style.height = 'auto'; area.style.height = Math.min(area.scrollHeight, 160) + 'px'; });
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; if (!f) return;
    if (f.size > 100 * 1024) { showToast('Файл должен быть не больше 100 КБ'); file.value = ''; return; }
    try {
      form.dataset.fileText = (await f.text()).slice(0, 8000);
      form.querySelector('.attachment-name').textContent = f.name;
      form.querySelector('.attachment-preview').hidden = false;
      showToast('Текстовый файл прикреплён');
    } catch { showToast('Не удалось прочитать файл'); }
  });
  form.querySelector('.attachment-remove').addEventListener('click', () => { form.dataset.fileText = ''; file.value = ''; form.querySelector('.attachment-preview').hidden = true; });
  mount.append(form); composers[name] = form; return form;
}
function openSidebar() { el.sidebar.classList.add('open'); el.scrim.hidden = false; }
function closeSidebar() { el.sidebar.classList.remove('open'); el.scrim.hidden = true; }
function openSettings() { el.serverUrl.value = settings.url; el.dialog.showModal(); closeSidebar(); }
function exportHistory() {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), chats }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'liniya-history.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); showToast('История экспортирована');
}

buildComposer($('#welcome-input-mount'), 'welcome');
buildComposer($('#chat-input-mount'), 'chat');
$('#new-chat').addEventListener('click', newChat);
$('#top-new').addEventListener('click', newChat);
$('#clear-history').addEventListener('click', () => {
  if (!chats.length) return;
  if (!confirm('Удалить всю историю диалогов? Это нельзя отменить.')) return;
  chats = []; persist(); newChat(); showToast('История удалена');
});
$('#open-sidebar').addEventListener('click', openSidebar);
$('#close-sidebar').addEventListener('click', closeSidebar);
el.scrim.addEventListener('click', closeSidebar);
$('#open-settings').addEventListener('click', openSettings);
$('#top-settings').addEventListener('click', openSettings);
$('#close-settings').addEventListener('click', () => el.dialog.close());
$('#save-settings').addEventListener('click', () => { settings.url = el.serverUrl.value.trim().replace(/\/$/, ''); saveSettings(); el.dialog.close(); showToast('Настройки сохранены'); });
$('#export-history').addEventListener('click', exportHistory);
el.mode.addEventListener('change', () => { settings.mode = el.mode.value; saveSettings(); render(); showToast(settings.mode === 'demo' ? 'Демо-режим включён' : 'Режим ИИ включён: нужен сервер'); });
for (const card of document.querySelectorAll('.suggestion')) card.addEventListener('click', () => send(card.dataset.prompt));
window.addEventListener('keydown', event => { if (event.key === 'Escape') closeSidebar(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newChat(); } });
render();
