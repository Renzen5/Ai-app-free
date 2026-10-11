'use strict';

/* ============ Storage ============ */
const LS_CHATS = 'jw_chats_v1';
const LS_SETTINGS = 'jw_settings_v1';

const defaultSettings = {
  apiKey: '',
  model: 'claude-opus-4-8',
  maxTokens: 2048,
  theme: 'system',           // 'system' | 'light' | 'dark'
  webSearch: false           // let the model search the web (Anthropic web_search tool)
};

function loadChats() {
  try { return JSON.parse(localStorage.getItem(LS_CHATS)) || []; }
  catch (_) { return []; }
}
function saveChats() { localStorage.setItem(LS_CHATS, JSON.stringify(state.chats)); }

function loadSettings() {
  try { return { ...defaultSettings, ...(JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}) }; }
  catch (_) { return { ...defaultSettings }; }
}
function saveSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); }

/* Instruction sent to the model on every request. */
const SYSTEM_PROMPT = [
  'Ты — ИИ-ассистент JustWoker.',
  'ГЛАВНОЕ ПРАВИЛО: отвечай ТОЛЬКО на языке последнего сообщения пользователя. Пользователь пишет по-русски — весь ответ на русском, даже если результаты веб-поиска на английском (переведи и перескажи их по-русски).',
  'Веб-поиск используй ТОЛЬКО когда вопрос реально требует свежих или внешних фактов (цены, курсы, новости, статистика, события, факты, которых ты можешь не знать). На приветствия, короткие и разговорные реплики, а также на просьбы объяснить, написать, перевести или посчитать — отвечай сразу, без поиска.',
  'Если ищешь — формулируй точный запрос по смыслу, а не по буквальному слову, и понимай сленг: «биток»/«битки» = биткоин (Bitcoin), «эфир» = Ethereum, «бакс» = доллар США и т.п. Для цен, курсов и фактов ищи по правильному названию сущности, при необходимости по-английски (например «Bitcoin price USD»), и НЕ ищи перевод или словарное значение слова.',
  'Не пересказывай результаты поиска списком. Не пиши фразы вида «I\'ll search for…», «Here are the search results», «Поиск вернул…». Не вставляй строки «Source: …» и сырые URL — источники показываются пользователю отдельным блоком.',
  'Дай один связный, прямой ответ по сути вопроса своими словами, на русском, в Markdown. Отвечай кратко и по делу, без словарных эссе. Если нужных данных в выдаче нет — скажи это одним предложением и, если уместно, подскажи, где посмотреть.'
].join(' ');

/* System prompt for the second pass: rewrite found info in the user's language. */
const PARAPHRASE_SYSTEM = 'Ты переписываешь найденную в интернете информацию СВОИМИ СЛОВАМИ на русском языке — связно, по делу, без воды. Не переводи дословно, не копируй фразы источников, не перечисляй результаты поиска списком, не пиши «Source» и не вставляй ссылки. Отвечай только на русском.';

/* ============ State ============ */
const state = {
  chats: loadChats(),
  settings: loadSettings(),
  currentId: null,
  tab: 'active',
  pending: [],      // attachments: {kind:'image'|'file', name, mediaType, dataUrl, text}
  sending: false,
  editing: null,    // id of the user message being edited inline
  abort: null       // AbortController for the in-flight generation
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Backfill ids for any messages persisted without one (older data / imported chats)
state.chats.forEach(c => {
  if (Array.isArray(c.messages)) c.messages.forEach(m => { if (!m.id) m.id = uid(); });
});

/* ============ DOM ============ */
const $ = (id) => document.getElementById(id);
const els = {
  sidebar: $('sidebar'), overlay: $('overlay'),
  openSidebar: $('openSidebar'), closeSidebar: $('closeSidebar'),
  newChatBtn: $('newChatBtn'), newChatTop: $('newChatTop'),
  chatList: $('chatList'), messages: $('messages'), threadArea: $('threadArea'),
  input: $('input'), sendBtn: $('sendBtn'),
  attachBtn: $('attachBtn'), fileInput: $('fileInput'), webBtn: $('webBtn'),
  attachments: $('attachments'), topbarTitle: $('topbarTitle'),
  suggestRow: $('suggestRow'),
  themeToggle: $('themeToggle'), themeSeg: $('themeSeg'),
  settingsBtn: $('settingsBtn'), settingsModal: $('settingsModal'),
  closeSettings: $('closeSettings'), apiKeyInput: $('apiKeyInput'),
  modelInput: $('modelInput'), maxTokensInput: $('maxTokensInput'),
  saveSettings: $('saveSettings'), clearAllBtn: $('clearAllBtn'),
  exportAllBtn: $('exportAllBtn'),
  importBtn: $('importBtn'), importInput: $('importInput'),
  viewer: $('viewer'), viewerImg: $('viewerImg'), viewerClose: $('viewerClose'),
  tabs: document.querySelectorAll('.tab'),
  toast: $('toast'),
  installToast: $('installToast'), installYes: $('installYes'), installNo: $('installNo')
};
/* ============ Icons (Lucide-style, 24x24) ============ */
const svg = (inner) => `<svg viewBox="0 0 24 24">${inner}</svg>`;
const IC = {
  spark:   svg('<path d="M12 3v18"/><path d="M3 12h18"/><path d="M5.64 5.64 18.36 18.36"/><path d="M18.36 5.64 5.64 18.36"/>'),
  pencil:  svg('<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'),
  archive: svg('<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'),
  download:svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  trash:   svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
  copy:    svg('<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  check:   svg('<path d="M20 6 9 17l-5-5"/>'),
  retry:   svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  file:    svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  x:       svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  code:    svg('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
  book:    svg('<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'),
  bulb:    svg('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
  sun:     svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  moon:    svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  monitor: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'),
  arrowUp: svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'),
  stop:    svg('<rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor" stroke="none"/>'),
  globe:   svg('<circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/>'),
  chevron: svg('<path d="m9 18 6-6-6-6"/>')
};

/* ============ Helpers ============ */
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function copyText(text, btn) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showToast('Копирование недоступно (нужен HTTPS)');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showToast('Скопировано');
    if (btn) {
      const old = btn.innerHTML;
      btn.innerHTML = btn.classList.contains('labeled') ? IC.check + '<span>Скопировано</span>' : IC.check;
      setTimeout(() => { btn.innerHTML = old; }, 1500);
    }
  }).catch(() => showToast('Не удалось скопировать'));
}

/* ============ Web search blocks ============ */
function extractWebResults(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter(r => r && r.type === 'web_search_result' && typeof r.url === 'string' && /^https?:\/\//i.test(r.url))
    .map(r => ({ url: r.url, title: (typeof r.title === 'string' && r.title) ? r.title : r.url }));
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}

function searchBlockHtml(searches) {
  if (!searches || !searches.length) return '';
  return searches.map(s => {
    const results = s.results || [];
    const count = results.length;
    const items = results.map(r => {
      const safeUrl = (r && typeof r.url === 'string' && /^https?:\/\//i.test(r.url)) ? r.url : '';
      if (!safeUrl) return '';
      const d = domainOf(safeUrl);
      const fav = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d) + '&sz=64';
      return `<a class="ws-src" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">
        <img class="ws-fav" src="${fav}" alt="" loading="lazy" />
        <span class="ws-domain">${escapeHtml(r.title || d)}</span>
        <span class="ws-host">${escapeHtml(d)}</span></a>`;
    }).join('');
    const label = count ? 'Искал в интернете' : 'Поиск в интернете…';
    const countTag = count ? `<span class="ws-count">${count} рез.</span>` : '';
    return `<details class="websearch">
      <summary><span class="ws-ic">${IC.globe}</span><span class="ws-label">${label}</span>${countTag}<span class="ws-chev">${IC.chevron}</span></summary>
      <div class="ws-body">${items ? `<div class="ws-list">${items}</div>` : ''}</div>
    </details>`;
  }).join('');
}

// Some backends echo raw search results as text ("Source: …", "Here are the search
// results…"); the sources already render in their own block, so strip that noise.
function cleanWebDump(text) {
  return (text || '')
    .replace(/^\s*Source:\s*\S+\s*$/gim, '')
    .replace(/^\s*I'?ll search for[^\n]*$/gim, '')
    .replace(/Here are the (?:web )?search results[^\n]*:?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/* ============ Minimal, safe markdown renderer ============ */
function renderMarkdown(src) {
  const blocks = [];
  let text = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    const i = blocks.length;
    blocks.push({ lang: lang || 'code', code: code.replace(/\n$/, '') });
    return `\u0000CODE${i}\u0000`;
  });

  text = escapeHtml(text);

  text = text.replace(/`([^`\n]+)`/g, (m, c) => `<code class="inline">${c}</code>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = text.split('\n');
  let html = '', listType = null;
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };

  for (let raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      closeList();
      const lvl = m[1].length;
      html += `<h${lvl}>${m[2]}</h${lvl}>`;
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += `<li>${line.replace(/^\s*[-*]\s+/, '')}</li>`;
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += `<li>${line.replace(/^\s*\d+\.\s+/, '')}</li>`;
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html += `<p>${line}</p>`;
    }
  }
  closeList();

  html = html.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => {
    const b = blocks[+i];
    return `<div class="code-block">
      <div class="code-head"><span>${escapeHtml(b.lang)}</span>
        <button class="copy-code labeled">${IC.copy}<span>Копировать</span></button>
      </div>
      <pre>${escapeHtml(b.code)}</pre></div>`;
  });

  return html;
}
/* ============ Chat management ============ */
function getCurrent() { return state.chats.find(c => c.id === state.currentId); }

function newChat() {
  state.currentId = null;
  state.pending = [];
  renderAttachments();
  renderMessages();
  renderChatList();
  els.input.value = '';
  autoGrow();
  els.input.focus();
  closeSidebar();
}

function ensureChat() {
  let chat = getCurrent();
  if (!chat) {
    chat = { id: uid(), title: 'Новый чат', messages: [], archived: false, createdAt: Date.now() };
    state.chats.unshift(chat);
    state.currentId = chat.id;
  }
  return chat;
}

function selectChat(id) {
  state.currentId = id;
  renderMessages();
  renderChatList();
  closeSidebar();
}

function deleteChat(id) {
  state.chats = state.chats.filter(c => c.id !== id);
  if (state.currentId === id) state.currentId = null;
  saveChats();
  renderChatList();
  renderMessages();
}

function toggleArchive(id) {
  const c = state.chats.find(x => x.id === id);
  if (!c) return;
  c.archived = !c.archived;
  if (state.currentId === id && c.archived && state.tab === 'active') {
    state.currentId = null;
    renderMessages();
  }
  saveChats();
  renderChatList();
  showToast(c.archived ? 'Чат в архиве' : 'Чат восстановлен');
}

function renameChat(id) {
  const c = state.chats.find(x => x.id === id);
  if (!c) return;
  const name = prompt('Новое название чата:', c.title);
  if (name && name.trim()) {
    c.title = name.trim().slice(0, 80);
    saveChats();
    renderChatList();
    renderMessages();
  }
}
function exportChat(id) {
  const c = state.chats.find(x => x.id === id);
  if (!c) return;
  downloadJson(c, `chat-${c.title.slice(0, 20).replace(/\s+/g, '_') || 'export'}.json`);
}

function exportAll() {
  if (!state.chats.length) { showToast('Нет чатов для экспорта'); return; }
  downloadJson({ exportedAt: new Date().toISOString(), chats: state.chats },
    `justwoker-archive-${Date.now()}.json`);
  showToast('Архив всех чатов создан');
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Accepts a single chat, an array of chats, or an {chats:[...]} archive.
function normalizeChat(raw, usedIds) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({
      id: (typeof m.id === 'string' && m.id) ? m.id : uid(),
      role: m.role,
      text: typeof m.text === 'string' ? m.text : '',
      images: Array.isArray(m.images) ? m.images.filter(im => im && typeof im.dataUrl === 'string') : [],
      files: Array.isArray(m.files) ? m.files.filter(f => f && typeof f.name === 'string') : [],
      searches: (m.role === 'assistant' && Array.isArray(m.searches))
        ? m.searches.filter(x => x && typeof x === 'object').map(x => ({
            query: typeof x.query === 'string' ? x.query : '',
            results: Array.isArray(x.results)
              ? x.results.filter(r => r && typeof r.url === 'string' && /^https?:\/\//i.test(r.url))
                  .map(r => ({ url: r.url, title: typeof r.title === 'string' ? r.title : r.url }))
              : []
          }))
        : undefined
    }))
    .filter(m => m.text || m.images.length || m.files.length);

  let id = (typeof raw.id === 'string' && raw.id) ? raw.id : uid();
  while (usedIds.has(id)) id = uid();           // never overwrite an existing chat
  return {
    id,
    title: (typeof raw.title === 'string' && raw.title.trim()) ? raw.title.trim().slice(0, 80) : 'Импортированный чат',
    messages,
    archived: !!raw.archived,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
  };
}

function importChats(fileList) {
  const file = fileList && fileList[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => showToast('Не удалось прочитать файл');
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(String(reader.result)); }
    catch (_) { showToast('Файл повреждён или это не JSON'); return; }

    let incoming;
    if (Array.isArray(parsed)) incoming = parsed;
    else if (parsed && Array.isArray(parsed.chats)) incoming = parsed.chats;
    else if (parsed && Array.isArray(parsed.messages)) incoming = [parsed];
    else { showToast('Формат файла не распознан'); return; }

    const usedIds = new Set(state.chats.map(c => c.id));
    const imported = [];
    incoming.forEach(raw => {
      const chat = normalizeChat(raw, usedIds);
      if (chat) { usedIds.add(chat.id); imported.push(chat); }
    });
    if (!imported.length) { showToast('В файле нет чатов для импорта'); return; }

    state.chats = imported.concat(state.chats);   // imported chats appear on top
    saveChats();
    renderChatList();
    renderMessages();
    closeSidebar();
    showToast('Импортировано чатов: ' + imported.length);
  };
  reader.readAsText(file);
}

/* ============ Rendering: chat list ============ */
function renderChatList() {
  const list = state.chats.filter(c => state.tab === 'archived' ? c.archived : !c.archived);
  els.chatList.innerHTML = '';
  if (!list.length) {
    els.chatList.innerHTML = `<div class="empty-list">${state.tab === 'archived' ? 'Архив пуст' : 'Пока нет чатов'}</div>`;
    return;
  }
  const label = document.createElement('div');
  label.className = 'chat-list-label';
  label.textContent = state.tab === 'archived' ? 'Архив' : 'Недавние';
  els.chatList.appendChild(label);

  list.forEach(c => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (c.id === state.currentId ? ' active' : '');
    item.innerHTML = `
      <button class="title" type="button">${escapeHtml(c.title)}</button>
      <div class="item-actions">
        <button class="act-rename" title="Переименовать" aria-label="Переименовать">${IC.pencil}</button>
        <button class="act-archive" title="${c.archived ? 'Из архива' : 'В архив'}" aria-label="Архив">${IC.archive}</button>
        <button class="act-export" title="Экспорт" aria-label="Экспорт">${IC.download}</button>
        <button class="act-delete" title="Удалить" aria-label="Удалить">${IC.trash}</button>
      </div>`;
    item.querySelector('.title').onclick = () => selectChat(c.id);
    item.querySelector('.act-rename').onclick = (e) => { e.stopPropagation(); renameChat(c.id); };
    item.querySelector('.act-archive').onclick = (e) => { e.stopPropagation(); toggleArchive(c.id); };
    item.querySelector('.act-export').onclick = (e) => { e.stopPropagation(); exportChat(c.id); };
    item.querySelector('.act-delete').onclick = (e) => {
      e.stopPropagation();
      if (confirm('Удалить этот чат?')) deleteChat(c.id);
    };
    els.chatList.appendChild(item);
  });
}
/* ============ Rendering: messages ============ */
function welcomeEl() {
  const w = document.createElement('div');
  w.className = 'welcome';
  w.innerHTML = `<span class="spark" aria-hidden="true">${IC.spark}</span>
    <h1>Чем помочь?</h1>
    <p>Задайте вопрос, прикрепите файл или изображение.</p>`;
  return w;
}

function renderMessages() {
  const chat = getCurrent();
  els.topbarTitle.textContent = chat ? chat.title : 'Новый чат';
  const empty = !chat || !chat.messages.length;
  document.body.classList.toggle('empty', empty);

  els.messages.innerHTML = '';
  if (empty) {
    els.messages.appendChild(welcomeEl());
    updateSendState();
    return;
  }
  chat.messages.forEach(m => els.messages.appendChild(renderMessage(m)));
  bindMessageActions();
  if (!state.editing) scrollBottom();
  updateSendState();
}

function renderMessage(m) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
  wrap.dataset.id = m.id;

  let html = '';
  if (m.images && m.images.length) {
    html += '<div class="msg-media">' +
      m.images.map(img => `<img src="${img.dataUrl}" alt="изображение" />`).join('') +
      '</div>';
  }
  if (m.files && m.files.length) {
    html += '<div class="msg-files">' +
      m.files.map(f => `<div class="file-chip">${IC.file}<span>${escapeHtml(f.name)}</span></div>`).join('') +
      '</div>';
  }

  if (m.role !== 'user' && m.searches && m.searches.length) {
    html += searchBlockHtml(m.searches);
  }

  const editing = m.role === 'user' && state.editing === m.id;

  if (editing) {
    html += `<div class="edit-box">
      <textarea class="edit-input" rows="1" aria-label="Редактирование сообщения">${escapeHtml(m.text || '')}</textarea>
      <div class="edit-actions">
        <button class="edit-cancel" type="button">Отмена</button>
        <button class="edit-save" type="button">Сохранить и отправить</button>
      </div>
    </div>`;
  } else if (m.typing) {
    html += '<div class="prose"><div class="typing"><span></span><span></span><span></span></div></div>';
  } else if (m.text) {
    if (m.role === 'user') {
      html += `<div class="user-bubble">${escapeHtml(m.text)}</div>`;
    } else {
      const t = (m.searches && m.searches.length) ? cleanWebDump(m.text) : m.text;
      html += `<div class="prose">${renderMarkdown(t)}</div>`;
    }
  }

  if (!editing && !m.typing && m.text) {
    if (m.role === 'user') {
      html += `<div class="msg-actions">
        <button class="msg-edit" title="Редактировать" aria-label="Редактировать">${IC.pencil}</button>
        <button class="msg-copy" title="Копировать" aria-label="Копировать">${IC.copy}</button>
      </div>`;
    } else {
      html += `<div class="msg-actions">
        <button class="msg-copy" title="Копировать" aria-label="Копировать">${IC.copy}</button>
        <button class="msg-retry" title="Сгенерировать заново" aria-label="Сгенерировать заново">${IC.retry}</button>
      </div>`;
    }
  }

  wrap.innerHTML = html;
  return wrap;
}
function bindMessageActions(root) {
  root = root || els.messages;
  root.querySelectorAll('.copy-code').forEach(btn => {
    btn.onclick = () => copyText(btn.closest('.code-block').querySelector('pre').textContent, btn);
  });
  root.querySelectorAll('.msg-copy').forEach(btn => {
    btn.onclick = () => {
      const el = btn.closest('.msg').querySelector('.prose, .user-bubble');
      copyText(el ? el.innerText : '', btn);
    };
  });
  root.querySelectorAll('.msg-retry').forEach(btn => {
    btn.onclick = () => regenerate(btn.closest('.msg').dataset.id);
  });
  root.querySelectorAll('.msg-edit').forEach(btn => {
    btn.onclick = () => startEdit(btn.closest('.msg').dataset.id);
  });
  root.querySelectorAll('.msg-media img').forEach(img => {
    img.onclick = () => openViewer(img.src);
  });

  const editInput = root.querySelector('.edit-input');
  if (editInput) {
    const grow = () => {
      editInput.style.height = 'auto';
      const sh = editInput.scrollHeight;
      editInput.style.height = Math.min(sh, 300) + 'px';
      editInput.style.overflowY = sh > 300 ? 'auto' : 'hidden';
    };
    editInput.oninput = grow;
    grow();
    editInput.focus();
    editInput.setSelectionRange(editInput.value.length, editInput.value.length);
    const id = editInput.closest('.msg').dataset.id;
    const box = editInput.closest('.edit-box');
    box.querySelector('.edit-cancel').onclick = cancelEdit;
    box.querySelector('.edit-save').onclick = () => submitEdit(id, editInput.value);
    editInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 860) { e.preventDefault(); submitEdit(id, editInput.value); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    };
  }
}

function scrollBottom() {
  // behavior:'auto' overrides the CSS `scroll-behavior: smooth` on .messages — a
  // smooth programmatic scroll retargeted every streamed frame reads as jitter.
  requestAnimationFrame(() => { els.messages.scrollTo({ top: els.messages.scrollHeight, behavior: 'auto' }); });
}

// Mount a single new message node, without re-rendering (and thus re-animating
// via the msgIn keyframes) the rest of the thread. Only the new node is bound.
function appendMessage(m) {
  const node = renderMessage(m);
  els.messages.appendChild(node);
  bindMessageActions(node);
  if (!state.editing) scrollBottom();
}

// Update one message's node in place. The .msg wrapper element is kept — only its
// children are replaced — so its one-shot entrance animation does NOT restart.
// This is what stops the whole thread from strobing on every streamed frame.
// `finalizing` is the one synchronous call after a stream ends; during streaming a
// missing node means the user switched chats, so we skip rather than full-rebuild
// (which would re-fire msgIn ~60x/s on the chat they're now viewing).
function updateMessageNode(m, finalizing) {
  const node = els.messages.querySelector('.msg[data-id="' + m.id + '"]');
  if (!node) { if (finalizing) renderMessages(); return; }

  // Stick to the bottom only when already there (measured before the content grows),
  // so streaming text doesn't yank a reader who scrolled up.
  const box = els.messages;
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 120;

  const fresh = renderMessage(m);

  // Keep already-rendered web-search blocks (their <details> open state and loaded
  // favicons) instead of tearing them down each frame while the results are unchanged.
  const sig = (m.searches && m.searches.length) ? JSON.stringify(m.searches) : '';
  if (sig && sig === node.dataset.sig) {
    const oldWs = node.querySelectorAll(':scope > .websearch');
    const newWs = fresh.querySelectorAll(':scope > .websearch');
    if (oldWs.length === newWs.length) newWs.forEach((n, i) => n.replaceWith(oldWs[i]));
  }

  node.className = fresh.className;
  node.replaceChildren(...fresh.childNodes);
  node.dataset.sig = sig;
  bindMessageActions(node);
  if (!state.editing && stick) box.scrollTo({ top: box.scrollHeight, behavior: 'auto' });
}

// Coalesce rapid streaming updates into one in-place render per animation frame.
// Only the in-flight message is touched, so the rest of the thread (and the msgIn
// entrance animation on every bubble) isn't torn down and rebuilt ~60x/second.
let renderScheduled = 0;
let streamingMsg = null;
function scheduleRender(m) {
  if (m) streamingMsg = m;
  if (renderScheduled) return;
  renderScheduled = requestAnimationFrame(() => {
    renderScheduled = 0;
    if (streamingMsg) updateMessageNode(streamingMsg);
  });
}

/* ============ Suggestions (empty-state pills) ============ */
const SUGGESTIONS = [
  { icon: IC.pencil, label: 'Написать', prompt: 'Помоги написать вежливое письмо коллеге с переносом встречи на завтра.' },
  { icon: IC.book,   label: 'Объяснить', prompt: 'Объясни простыми словами, что такое квантовая запутанность.' },
  { icon: IC.code,   label: 'Код',       prompt: 'Напиши на Python функцию быстрой сортировки с пояснениями.' },
  { icon: IC.bulb,   label: 'Идеи',      prompt: 'Предложи 5 необычных идей для стартапа в сфере ИИ.' }
];
function renderSuggestions() {
  els.suggestRow.innerHTML = '';
  SUGGESTIONS.forEach(s => {
    const b = document.createElement('button');
    b.className = 'suggest';
    b.type = 'button';
    b.setAttribute('aria-label', s.label);
    b.title = s.label;
    b.innerHTML = `${s.icon}<span>${s.label}</span>`;
    b.onclick = () => {
      els.input.value = s.prompt;
      autoGrow();
      updateSendState();
      els.input.focus();
    };
    els.suggestRow.appendChild(b);
  });
}

/* ============ Attachments ============ */
function renderAttachments() {
  els.attachments.innerHTML = '';
  state.pending.forEach((att, idx) => {
    const el = document.createElement('div');
    if (att.kind === 'image') {
      el.className = 'att-item img';
      el.innerHTML = `<img src="${att.dataUrl}" alt=""/>
        <button class="att-remove" aria-label="Убрать">${IC.x}</button>`;
    } else {
      el.className = 'att-item file';
      el.innerHTML = `${IC.file}
        <span class="fname">${escapeHtml(att.name)}</span>
        <button class="att-remove" aria-label="Убрать">${IC.x}</button>`;
    }
    el.querySelector('.att-remove').onclick = () => {
      state.pending.splice(idx, 1);
      renderAttachments();
    };
    els.attachments.appendChild(el);
  });
  updateSendState();
}
function handleFiles(fileList) {
  Array.from(fileList).forEach(file => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        state.pending.push({
          kind: 'image', name: file.name,
          mediaType: file.type, dataUrl: reader.result
        });
        renderAttachments();
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        state.pending.push({
          kind: 'file', name: file.name,
          text: String(reader.result).slice(0, 20000)
        });
        renderAttachments();
      };
      reader.readAsText(file);
    }
  });
}

/* ============ Sending ============ */
function updateSendState() {
  const btn = els.sendBtn;
  if (state.sending) {
    btn.disabled = false;
    btn.classList.add('is-stop');
    btn.innerHTML = IC.stop;
    btn.setAttribute('aria-label', 'Остановить генерацию');
  } else {
    btn.classList.remove('is-stop');
    btn.innerHTML = IC.arrowUp;
    btn.setAttribute('aria-label', 'Отправить');
    const hasContent = els.input.value.trim().length > 0 || state.pending.length > 0;
    btn.disabled = !hasContent;
  }
}

function stopGeneration() {
  if (state.abort) { try { state.abort.abort(); } catch (_) {} }
}

function updateWebUI() {
  const on = !!state.settings.webSearch;
  els.webBtn.classList.toggle('active', on);
  els.webBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

async function sendMessage() {
  if (state.sending) return;
  const text = els.input.value.trim();
  if (!text && !state.pending.length) return;

  state.editing = null;
  const chat = ensureChat();

  const images = state.pending.filter(a => a.kind === 'image')
    .map(a => ({ dataUrl: a.dataUrl, mediaType: a.mediaType }));
  const files = state.pending.filter(a => a.kind === 'file')
    .map(a => ({ name: a.name, text: a.text }));

  const userMsg = { id: uid(), role: 'user', text, images, files };
  chat.messages.push(userMsg);

  if (chat.title === 'Новый чат' && text) {
    chat.title = text.slice(0, 40);
  }

  els.input.value = '';
  autoGrow();
  state.pending = [];
  renderAttachments();

  saveChats();
  renderChatList();
  // First message leaves the empty/welcome state (needs a full render); otherwise
  // just append the new bubble so the existing thread isn't re-animated.
  if (chat.messages.length === 1) renderMessages();
  else appendMessage(userMsg);

  await runCompletion(chat);
}

/* ============ Live crypto prices (CoinGecko) ============ */
// Web search only sees page TEXT, and exchange prices are script-rendered (not in
// that text), so "keep searching" can never surface a number — we fetch the real
// figure from a free price API (no key, CORS-enabled) instead.
const COIN_IDS = {
  bitcoin: ['биток','битки','биткоин','биткойн','btc','бтц'],
  ethereum: ['эфир','эфириум','ethereum','eth'],
  solana: ['солана','solana','sol','сол'],
  toncoin: ['тон','toncoin','ton'],
  dogecoin: ['додж','доге','dogecoin','doge'],
  binancecoin: ['bnb','бнб'],
  ripple: ['xrp','рипл','риппл'],
  cardano: ['cardano','ada','кардано'],
  litecoin: ['litecoin','ltc','лайткоин'],
  tron: ['tron','trx','трон'],
  tether: ['tether','usdt','тезер','юсдт']
};
const COIN_NAMES = {
  bitcoin: 'Биткоин', ethereum: 'Эфириум', solana: 'Solana', toncoin: 'Toncoin',
  dogecoin: 'Dogecoin', binancecoin: 'BNB', ripple: 'XRP', cardano: 'Cardano',
  litecoin: 'Litecoin', tron: 'TRON', tether: 'Tether'
};
const CUR_LABEL = { usd: '$', rub: '₽', eur: '€' };
const PRICE_WORDS = /(сколько\s+(?:стоит|сейчас|за)|стоит|цена|курс|стоимост|поч[её]м|price|cost|rate)/i;

function detectCoin(text) {
  const t = (text || '').toLowerCase();
  if (!PRICE_WORDS.test(t)) return null;
  for (const id in COIN_IDS) {
    for (const a of COIN_IDS[id]) {
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(?<![\\p{L}\\p{N}])' + esc + '(?![\\p{L}\\p{N}])', 'iu').test(t)) return id;
    }
  }
  return null;
}
function detectCurrencies(text) {
  const t = (text || '').toLowerCase();
  const cur = [];
  if (/(руб|рубл|₽|\brub\b)/i.test(t)) cur.push('rub');
  if (/(доллар|бакс|\$|\busd\b)/i.test(t)) cur.push('usd');
  if (/(евро|€|\beur\b)/i.test(t)) cur.push('eur');
  return cur.length ? cur : ['usd', 'rub'];
}
async function fetchCryptoPrice(id, currencies, signal) {
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(id) +
    '&vs_currencies=' + encodeURIComponent(currencies.join(',')) + '&include_24hr_change=true';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('CoinGecko HTTP ' + res.status);
  const data = await res.json();
  if (!data || !data[id]) throw new Error('CoinGecko: нет данных');
  return data[id];
}
function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: n >= 1 ? 2 : 8 });
}
function formatCryptoPrice(currencies, data) {
  let s = currencies.map(c => (CUR_LABEL[c] || c) + ' ' + fmtNum(data[c])).join(' / ');
  const chg = data[currencies[0] + '_24h_change'];
  if (typeof chg === 'number') s += ' (за 24ч ' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%)';
  return s;
}

// Shared completion step: append a typing bubble, stream the reply, allow stop.
async function runCompletion(chat) {
  const typingMsg = { id: uid(), role: 'assistant', text: '', typing: true };
  chat.messages.push(typingMsg);
  appendMessage(typingMsg);

  state.sending = true;
  state.abort = new AbortController();
  updateSendState();

  const s = state.settings;
  let aborted = false;
  try {
    // Live crypto price → fetch the real number from CoinGecko, bypassing web search.
    const priceUser = [...chat.messages].reverse().find(m => m.role === 'user');
    const coin = priceUser ? detectCoin(priceUser.text) : null;
    if (coin) {
      let priceText = null;
      try {
        const currencies = detectCurrencies(priceUser.text);
        const data = await fetchCryptoPrice(coin, currencies, state.abort.signal);
        priceText = formatCryptoPrice(currencies, data);
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;   // stop pressed
      }
      if (priceText) {
        const coinName = COIN_NAMES[coin] || coin;
        const direct = 'Актуальная цена: ' + coinName + ' — ' + priceText + '. Источник: CoinGecko.';
        const note = SYSTEM_PROMPT + '\n\nАКТУАЛЬНАЯ ЦЕНА из CoinGecko на ' +
          new Date().toLocaleString('ru-RU') + ': ' + coinName + ' = ' + priceText +
          '. Ответь пользователю этой ценой на русском, кратко. Не ищи в интернете — цифры уже актуальны.';
        try {
          const r = await callApi(chat, {
            signal: state.abort.signal,
            system: note,
            onUpdate: (p) => { typingMsg.text = p.text; if (p.text) typingMsg.typing = false; scheduleRender(typingMsg); }
          });
          typingMsg.text = r.text || direct;
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          typingMsg.text = direct;   // model call failed → still show the fetched price
        }
        typingMsg.typing = false;
        return;
      }
    }

    // Pass 1 — model answers (and runs web search if the toggle is on)
    const first = await callApi(chat, {
      signal: state.abort.signal,
      webSearch: s.webSearch,
      onUpdate: (p) => {
        typingMsg.searches = p.searches;
        if (!s.webSearch) { typingMsg.text = p.text; if (p.text) typingMsg.typing = false; }
        scheduleRender(typingMsg);
      }
    });
    typingMsg.searches = (first.searches && first.searches.length) ? first.searches : undefined;

    if (s.webSearch && typingMsg.searches && first.text) {
      // Pass 2 — retell the found info in the user's own words, in Russian
      const lastUser = [...chat.messages].reverse().find(m => m.role === 'user');
      const question = lastUser ? (lastUser.text || '') : '';
      try {
        const second = await callApi(null, {
          signal: state.abort.signal,
          system: PARAPHRASE_SYSTEM,
          messages: [{
            role: 'user',
            content: 'Вопрос пользователя: "' + question + '"\n\nИнформация из интернета (может быть на разных языках):\n' +
              first.text + '\n\nПерескажи её своими словами и дай один связный ответ на вопрос — на русском. ' +
              'Не переводи дословно, не копируй, без списка результатов, без ссылок и слова «Source».'
          }],
          onUpdate: (p) => { typingMsg.text = p.text; if (p.text) typingMsg.typing = false; scheduleRender(typingMsg); }
        });
        typingMsg.text = second.text || first.text;
      } catch (e2) {
        if (e2 && e2.name === 'AbortError') throw e2;   // stop was pressed
        typingMsg.text = first.text;                     // paraphrase failed → show the raw (cleaned at render)
      }
    } else {
      typingMsg.text = first.text;
    }
    typingMsg.typing = false;
    if (!typingMsg.text && !typingMsg.searches) typingMsg.text = '(пустой ответ)';
  } catch (err) {
    typingMsg.typing = false;
    if (err && err.name === 'AbortError') {
      aborted = true;
      const hasContent = typingMsg.text || (typingMsg.searches && typingMsg.searches.length);
      if (!hasContent) {
        const i = chat.messages.indexOf(typingMsg);
        if (i >= 0) chat.messages.splice(i, 1);   // nothing generated yet → drop empty bubble
      }
    } else {
      typingMsg.text = (typingMsg.text ? typingMsg.text + '\n\n' : '') +
        '⚠️ Ошибка: ' + (err.message || String(err));
    }
  } finally {
    state.sending = false;
    state.abort = null;
    if (renderScheduled) { cancelAnimationFrame(renderScheduled); renderScheduled = 0; }
    streamingMsg = null;
    saveChats();
    // Finalize the in-flight bubble in place. A full renderMessages() here would
    // remount every node and re-fire the msgIn entrance animation — a visible flash.
    if (chat.messages.indexOf(typingMsg) < 0) {
      const node = els.messages.querySelector('.msg[data-id="' + typingMsg.id + '"]');
      if (node) node.remove();              // aborted before any output → drop the empty bubble
      if (!chat.messages.length) renderMessages();
    } else {
      updateMessageNode(typingMsg, true);
    }
    renderChatList();
    updateSendState();
    if (aborted) showToast('Генерация остановлена');
  }
}

/* ---- Rollback: regenerate an answer / edit & resend a message ---- */
function regenerate(id) {
  if (state.sending) return;
  const chat = getCurrent();
  if (!chat) return;
  const idx = chat.messages.findIndex(m => m.id === id);
  if (idx < 0) return;
  state.editing = null;
  // drop this assistant answer and everything after it, then re-ask
  chat.messages = chat.messages.slice(0, idx);
  saveChats();
  renderMessages();
  renderChatList();
  if (chat.messages.length) runCompletion(chat);
}

function startEdit(id) {
  if (state.sending) return;
  state.editing = id;
  renderMessages();
}
function cancelEdit() {
  state.editing = null;
  renderMessages();
}
function submitEdit(id, newText) {
  if (state.sending) return;
  const chat = getCurrent();
  if (!chat) return;
  const idx = chat.messages.findIndex(m => m.id === id);
  if (idx < 0) return;
  const msg = chat.messages[idx];
  const text = (newText || '').trim();
  if (!text && !(msg.images && msg.images.length) && !(msg.files && msg.files.length)) { cancelEdit(); return; }
  msg.text = text;
  // drop everything after the edited message, then re-ask
  chat.messages = chat.messages.slice(0, idx + 1);
  state.editing = null;
  saveChats();
  renderMessages();
  renderChatList();
  runCompletion(chat);
}
function buildApiMessages(chat) {
  const msgs = chat.messages.filter(m => !m.typing);
  return msgs.map(m => {
    if (m.role === 'user') {
      const hasImages = m.images && m.images.length;
      let textPart = m.text || '';
      if (m.files && m.files.length) {
        m.files.forEach(f => { textPart += `\n\n[Файл: ${f.name}]\n${f.text}`; });
      }
      if (hasImages) {
        const content = [];
        if (textPart.trim()) content.push({ type: 'text', text: textPart });
        m.images.forEach(img => {
          const match = /^data:([^;]+);base64,(.*)$/.exec(img.dataUrl);
          if (match) {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] }
            });
          }
        });
        return { role: 'user', content };
      }
      return { role: 'user', content: textPart || '...' };
    }
    return { role: 'assistant', content: m.text || '' };
  });
}

async function callApi(chat, opts) {
  opts = opts || {};
  const s = state.settings;
  const headers = { 'Content-Type': 'application/json' };
  if (s.apiKey) headers['x-api-key'] = s.apiKey;

  const body = {
    model: s.model || defaultSettings.model,
    max_tokens: Number(s.maxTokens) || 2048,
    system: opts.system || SYSTEM_PROMPT,
    stream: true,
    messages: opts.messages || buildApiMessages(chat)
  };
  if (opts.webSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  }

  const res = await fetch('/api/chat', { method: 'POST', headers, signal: opts.signal, body: JSON.stringify(body) });

  const ctype = res.headers.get('content-type') || '';

  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch (_) {}
    const msg = data && data.error ? (data.error.message || JSON.stringify(data.error)) : ('HTTP ' + res.status);
    throw new Error(msg);
  }

  const searches = [];
  const emit = (full) => { if (opts.onUpdate) opts.onUpdate({ text: full, searches }); };

  // Streaming (Server-Sent Events): text tokens + web_search tool blocks
  if (res.body && ctype.includes('text/event-stream')) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const blocks = {};   // content-block index -> { type, search, jsonBuf }
    let buffer = '', full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let evt; try { evt = JSON.parse(payload); } catch (_) { continue; }
        if (evt.type === 'content_block_delta' && evt.delta) {
          const b = blocks[evt.index];
          if (evt.delta.type === 'text_delta') { full += evt.delta.text || ''; emit(full); }
          else if (evt.delta.type === 'input_json_delta' && b) { b.jsonBuf = (b.jsonBuf || '') + (evt.delta.partial_json || ''); }
        } else if (evt.type === 'content_block_start') {
          const cb = evt.content_block || {};
          const b = blocks[evt.index] = { type: cb.type };
          if (cb.type === 'server_tool_use' && cb.name === 'web_search') {
            b.search = { query: (cb.input && cb.input.query) || '', results: [] }; b.jsonBuf = '';
            searches.push(b.search);
          } else if (cb.type === 'web_search_tool_result') {
            let tgt = searches[searches.length - 1];
            if (!tgt || (tgt.results && tgt.results.length)) { tgt = { query: '', results: [] }; searches.push(tgt); }
            tgt.results = extractWebResults(cb.content); emit(full);
          }
        } else if (evt.type === 'content_block_stop') {
          const b = blocks[evt.index];
          if (b && b.search && b.jsonBuf) { try { const p = JSON.parse(b.jsonBuf); if (p.query) { b.search.query = p.query; emit(full); } } catch (_) {} }
        } else if (evt.type === 'error') {
          throw new Error((evt.error && evt.error.message) || 'Ошибка потока');
        }
      }
    }
    return { text: full.trim(), searches };
  }
  // Fallback: non-streaming JSON (Anthropic-style)
  const data = await res.json();
  if (Array.isArray(data.content)) {
    let text = '';
    data.content.forEach(b => {
      if (b.type === 'text') text += b.text || '';
      else if (b.type === 'server_tool_use' && b.name === 'web_search') searches.push({ query: (b.input && b.input.query) || '', results: [] });
      else if (b.type === 'web_search_tool_result') {
        let tgt = searches[searches.length - 1];
        if (!tgt) { tgt = { query: '', results: [] }; searches.push(tgt); }
        tgt.results = extractWebResults(b.content);
      }
    });
    return { text: text.trim(), searches };
  }
  if (typeof data.completion === 'string') return { text: data.completion, searches };
  if (data.raw) return { text: String(data.raw), searches };
  return { text: '(не удалось распознать ответ)', searches };
}

/* ============ Viewer / Sidebar / Textarea ============ */
let lastFocus = null;
function openViewer(src) {
  lastFocus = document.activeElement;
  els.viewerImg.src = src;
  els.viewer.classList.add('show');
  els.viewerClose.focus();
}
function closeViewer() {
  els.viewer.classList.remove('show');
  els.viewerImg.src = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

function openSidebar() { els.sidebar.classList.add('open'); els.overlay.classList.add('show'); }
function closeSidebar() { els.sidebar.classList.remove('open'); els.overlay.classList.remove('show'); }

function autoGrow() {
  els.input.style.height = 'auto';
  const sh = els.input.scrollHeight;
  els.input.style.height = Math.min(sh, 180) + 'px';
  els.input.style.overflowY = sh > 180 ? 'auto' : 'hidden';
}
/* ============ Theme ============ */
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function resolveTheme(t) {
  if (t === 'light' || t === 'dark') return t;
  return prefersDark.matches ? 'dark' : 'light';
}

function applyTheme() {
  const t = state.settings.theme || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);

  const color = resolveTheme(t) === 'dark' ? '#262624' : '#FAF9F5';
  let meta = document.getElementById('metaTheme');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.id = 'metaTheme';
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
  updateThemeUI();
}

function themeLabel(t) {
  return t === 'system' ? 'системная' : (t === 'light' ? 'светлая' : 'тёмная');
}

function updateThemeUI() {
  const t = state.settings.theme || 'system';
  if (els.themeSeg) {
    els.themeSeg.querySelectorAll('button').forEach(b =>
      b.classList.toggle('active', b.dataset.themeVal === t));
  }
  els.themeToggle.innerHTML = t === 'system' ? IC.monitor : (t === 'light' ? IC.sun : IC.moon);
  els.themeToggle.setAttribute('aria-label', 'Тема: ' + themeLabel(t));
}

function setTheme(t) {
  state.settings.theme = t;
  saveSettings();
  applyTheme();
}

prefersDark.addEventListener('change', () => {
  if ((state.settings.theme || 'system') === 'system') applyTheme();
});

/* ============ Settings ============ */
function openSettings() {
  lastFocus = document.activeElement;
  els.apiKeyInput.value = state.settings.apiKey;
  els.modelInput.value = state.settings.model;
  els.maxTokensInput.value = state.settings.maxTokens;
  updateThemeUI();
  els.settingsModal.classList.add('show');
  els.closeSettings.focus();
}
function closeSettings() {
  els.settingsModal.classList.remove('show');
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
function saveSettingsHandler() {
  state.settings.apiKey = els.apiKeyInput.value.trim();
  state.settings.model = els.modelInput.value.trim() || defaultSettings.model;
  state.settings.maxTokens = Number(els.maxTokensInput.value) || defaultSettings.maxTokens;
  saveSettings();
  closeSettings();
  showToast('Настройки сохранены');
}
/* ============ Events ============ */
els.openSidebar.onclick = openSidebar;
els.closeSidebar.onclick = closeSidebar;
els.overlay.onclick = closeSidebar;
els.newChatBtn.onclick = newChat;
els.newChatTop.onclick = newChat;
els.sendBtn.onclick = () => { if (state.sending) stopGeneration(); else sendMessage(); };
els.attachBtn.onclick = () => els.fileInput.click();
els.fileInput.onchange = (e) => { handleFiles(e.target.files); e.target.value = ''; };
els.webBtn.onclick = () => {
  state.settings.webSearch = !state.settings.webSearch;
  saveSettings();
  updateWebUI();
  showToast(state.settings.webSearch ? 'Поиск в интернете включён' : 'Поиск в интернете выключен');
};
els.settingsBtn.onclick = openSettings;
els.closeSettings.onclick = closeSettings;
els.saveSettings.onclick = saveSettingsHandler;
els.exportAllBtn.onclick = exportAll;
els.importBtn.onclick = () => els.importInput.click();
els.importInput.onchange = (e) => { importChats(e.target.files); e.target.value = ''; };
els.viewerClose.onclick = closeViewer;
els.viewer.onclick = (e) => { if (e.target === els.viewer) closeViewer(); };
els.settingsModal.onclick = (e) => { if (e.target === els.settingsModal) closeSettings(); };

els.themeToggle.onclick = () => {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(state.settings.theme || 'system') + 1) % order.length];
  setTheme(next);
  showToast('Тема: ' + themeLabel(next));
};
els.themeSeg.querySelectorAll('button').forEach(b => {
  b.onclick = () => setTheme(b.dataset.themeVal);
});

els.clearAllBtn.onclick = () => {
  if (confirm('Удалить ВСЕ чаты? Это действие необратимо.')) {
    localStorage.removeItem(LS_CHATS);
    state.chats = [];
    state.currentId = null;
    saveChats();
    renderChatList();
    renderMessages();
    closeSettings();
    showToast('Все чаты удалены');
  }
};

els.input.oninput = () => { autoGrow(); updateSendState(); };
els.input.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 860) {
    e.preventDefault();
    sendMessage();
  }
};

els.tabs.forEach(t => {
  t.onclick = () => {
    els.tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    state.tab = t.dataset.tab;
    renderChatList();
  };
});

// Escape closes the topmost open overlay
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (els.viewer.classList.contains('show')) closeViewer();
  else if (els.settingsModal.classList.contains('show')) closeSettings();
  else if (els.sidebar.classList.contains('open')) closeSidebar();
});

/* ============ PWA install ============ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!window.matchMedia('(display-mode: standalone)').matches) {
    els.installToast.classList.add('show');
  }
});
els.installYes.onclick = async () => {
  els.installToast.classList.remove('show');
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
};
els.installNo.onclick = () => els.installToast.classList.remove('show');
window.addEventListener('appinstalled', () => {
  els.installToast.classList.remove('show');
  showToast('Приложение установлено');
});

/* ============ Service worker ============ */
if ('serviceWorker' in navigator) {
  // When a new service worker takes over, reload once so fresh CSS/JS/HTML apply.
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return;   // skip the very first install
    refreshing = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.update();
      setInterval(() => reg.update(), 60 * 60 * 1000);   // check hourly
    }).catch(() => {});
  });
}

/* ============ Init ============ */
renderSuggestions();
applyTheme();
updateWebUI();
renderChatList();
renderMessages();
autoGrow();
updateSendState();










