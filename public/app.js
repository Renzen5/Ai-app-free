
'use strict';

/* ============ Storage ============ */
const LS_CHATS = 'jw_chats_v1';
const LS_SETTINGS = 'jw_settings_v1';

const defaultSettings = {
  apiKey: '',
  model: 'claude-opus-4-8',
  maxTokens: 2048
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

/* ============ State ============ */
const state = {
  chats: loadChats(),
  settings: loadSettings(),
  currentId: null,
  tab: 'active',
  pending: [],      // attachments: {kind:'image'|'file', name, mediaType, dataUrl, text}
  sending: false
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ============ DOM ============ */
const $ = (id) => document.getElementById(id);
const els = {
  sidebar: $('sidebar'), overlay: $('overlay'),
  openSidebar: $('openSidebar'), closeSidebar: $('closeSidebar'),
  newChatBtn: $('newChatBtn'), newChatTop: $('newChatTop'),
  chatList: $('chatList'), messages: $('messages'),
  input: $('input'), sendBtn: $('sendBtn'),
  attachBtn: $('attachBtn'), fileInput: $('fileInput'),
  attachments: $('attachments'), topbarTitle: $('topbarTitle'),
  settingsBtn: $('settingsBtn'), settingsModal: $('settingsModal'),
  closeSettings: $('closeSettings'), apiKeyInput: $('apiKeyInput'),
  modelInput: $('modelInput'), maxTokensInput: $('maxTokensInput'),
  saveSettings: $('saveSettings'), clearAllBtn: $('clearAllBtn'),
  exportAllBtn: $('exportAllBtn'),
  viewer: $('viewer'), viewerImg: $('viewerImg'), viewerClose: $('viewerClose'),
  tabs: document.querySelectorAll('.tab'),
  toast: $('toast'),
  installToast: $('installToast'), installYes: $('installYes'), installNo: $('installNo')
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
  showToast._t = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

/* Minimal, safe markdown renderer */
function renderMarkdown(src) {
  const blocks = [];
  // extract fenced code blocks
  let text = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    const i = blocks.length;
    blocks.push({ lang: lang || 'code', code: code.replace(/\n$/, '') });
    return `\u0000CODE${i}\u0000`;
  });

  text = escapeHtml(text);

  // inline code
  text = text.replace(/`([^`\n]+)`/g, (m, c) => `<code class="inline">${c}</code>`);
  // bold / italic
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  // links
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // block parsing
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

  // restore code blocks
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => {
    const b = blocks[+i];
    return `<div class="code-block">
      <div class="code-head"><span>${escapeHtml(b.lang)}</span>
        <button class="copy-code"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Копировать</button>
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

/* ============ Rendering ============ */
function renderChatList() {
  const list = state.chats.filter(c => state.tab === 'archived' ? c.archived : !c.archived);
  els.chatList.innerHTML = '';
  if (!list.length) {
    els.chatList.innerHTML = `<div class="empty-list">${state.tab === 'archived' ? 'Архив пуст' : 'Пока нет чатов'}</div>`;
    return;
  }
  list.forEach(c => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (c.id === state.currentId ? ' active' : '');
    item.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-11.8 7.8L3 21l1.7-6.2A8.5 8.5 0 1 1 21 11.5z"/></svg>
      <span class="title">${escapeHtml(c.title)}</span>
      <div class="item-actions">
        <button class="act-archive" title="Архив">
          <svg viewBox="0 0 24 24"><path d="M3 7h18v4H3zM5 11v9h14v-9M10 15h4"/></svg>
        </button>
        <button class="act-export" title="Экспорт">
          <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>
        </button>
        <button class="act-delete" title="Удалить">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
        </button>
      </div>`;
    item.querySelector('.title').onclick = () => selectChat(c.id);
    item.querySelector('svg').onclick = () => selectChat(c.id);
    item.querySelector('.act-archive').onclick = (e) => { e.stopPropagation(); toggleArchive(c.id); };
    item.querySelector('.act-export').onclick = (e) => { e.stopPropagation(); exportChat(c.id); };
    item.querySelector('.act-delete').onclick = (e) => {
      e.stopPropagation();
      if (confirm('Удалить этот чат?')) deleteChat(c.id);
    };
    els.chatList.appendChild(item);
  });
}

function renderMessages() {
  const chat = getCurrent();
  els.topbarTitle.textContent = chat ? chat.title : 'Новый чат';

  if (!chat || !chat.messages.length) {
    els.messages.innerHTML = '';
    const w = document.createElement('div');
    w.className = 'welcome';
    w.innerHTML = `
      <div class="welcome-logo"><span class="brand-dot big"></span></div>
      <h1>Чем помочь?</h1>
      <p>Задай вопрос, прикрепи файл или изображение.</p>
      <div class="suggest-grid">
        <button class="suggest" data-prompt="Объясни квантовую запутанность одним абзацем.">Квантовая запутанность</button>
        <button class="suggest" data-prompt="Напиши функцию сортировки на Python с пояснением.">Код на Python</button>
        <button class="suggest" data-prompt="Составь план продуктивного дня.">План дня</button>
        <button class="suggest" data-prompt="Придумай идеи для стартапа в сфере ИИ.">Идеи стартапа</button>
      </div>`;
    els.messages.appendChild(w);
    w.querySelectorAll('.suggest').forEach(b => {
      b.onclick = () => { els.input.value = b.dataset.prompt; autoGrow(); els.input.focus(); };
    });
    return;
  }

  els.messages.innerHTML = '';
  chat.messages.forEach(m => els.messages.appendChild(renderMessage(m)));
  bindCopyButtons();
  scrollBottom();
}

function renderMessage(m) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap ' + (m.role === 'user' ? 'user' : 'ai');

  const avatar = document.createElement('div');
  avatar.className = 'avatar ' + (m.role === 'user' ? 'me' : 'ai');
  avatar.textContent = m.role === 'user' ? 'Я' : 'JW';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  let inner = '';
  if (m.images && m.images.length) {
    inner += '<div class="msg-images">';
    m.images.forEach(img => { inner += `<img src="${img.dataUrl}" alt="img" />`; });
    inner += '</div>';
  }
  if (m.files && m.files.length) {
    inner += '<div class="msg-files">';
    m.files.forEach(f => {
      inner += `<div class="file-chip"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>${escapeHtml(f.name)}</div>`;
    });
    inner += '</div>';
  }
  if (m.text) {
    inner += m.role === 'user'
      ? `<div>${escapeHtml(m.text).replace(/\n/g, '<br>')}</div>`
      : renderMarkdown(m.text);
  }
  if (m.typing) {
    inner += `<div class="typing"><span></span><span></span><span></span></div>`;
  }
  bubble.innerHTML = inner;

  bubble.querySelectorAll('.msg-images img').forEach(img => {
    img.onclick = () => openViewer(img.src);
  });

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  return wrap;
}

function bindCopyButtons() {
  els.messages.querySelectorAll('.copy-code').forEach(btn => {
    btn.onclick = () => {
      const code = btn.closest('.code-block').querySelector('pre').textContent;
      navigator.clipboard.writeText(code).then(() => showToast('Скопировано'));
    };
  });
}

function scrollBottom() {
  requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; });
}

/* ============ Attachments ============ */
function renderAttachments() {
  els.attachments.innerHTML = '';
  state.pending.forEach((att, idx) => {
    const el = document.createElement('div');
    if (att.kind === 'image') {
      el.className = 'att-item img';
      el.innerHTML = `<img src="${att.dataUrl}" alt=""/>
        <button class="att-remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    } else {
      el.className = 'att-item file';
      el.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        <span class="fname">${escapeHtml(att.name)}</span>
        <button class="att-remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    }
    el.querySelector('.att-remove').onclick = () => {
      state.pending.splice(idx, 1);
      renderAttachments();
    };
    els.attachments.appendChild(el);
  });
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
async function sendMessage() {
  if (state.sending) return;
  const text = els.input.value.trim();
  if (!text && !state.pending.length) return;

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

  // clear input/attachments
  els.input.value = '';
  autoGrow();
  state.pending = [];
  renderAttachments();

  saveChats();
  renderChatList();
  renderMessages();

  // typing bubble
  const typingMsg = { id: uid(), role: 'assistant', text: '', typing: true };
  chat.messages.push(typingMsg);
  renderMessages();

  state.sending = true;
  els.sendBtn.disabled = true;

  try {
    const reply = await callApi(chat);
    typingMsg.typing = false;
    typingMsg.text = reply;
  } catch (err) {
    typingMsg.typing = false;
    typingMsg.text = '⚠️ Ошибка: ' + (err.message || String(err));
  } finally {
    state.sending = false;
    els.sendBtn.disabled = false;
    saveChats();
    renderMessages();
    renderChatList();
  }
}

function buildApiMessages(chat) {
  // use all messages except trailing typing placeholder
  const msgs = chat.messages.filter(m => !m.typing);
  return msgs.map(m => {
    if (m.role === 'user') {
      const hasImages = m.images && m.images.length;
      let textPart = m.text || '';
      if (m.files && m.files.length) {
        m.files.forEach(f => {
          textPart += `\n\n[Файл: ${f.name}]\n${f.text}`;
        });
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

async function callApi(chat) {
  const s = state.settings;
  const headers = { 'Content-Type': 'application/json' };
  if (s.apiKey) headers['x-api-key'] = s.apiKey;

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: s.model || defaultSettings.model,
      max_tokens: Number(s.maxTokens) || 2048,
      messages: buildApiMessages(chat)
    })
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data && data.error ? (data.error.message || JSON.stringify(data.error)) : ('HTTP ' + res.status);
    throw new Error(msg);
  }

  // Anthropic-style response
  if (Array.isArray(data.content)) {
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      || '(пустой ответ)';
  }
  if (typeof data.completion === 'string') return data.completion;
  if (data.raw) return String(data.raw);
  return '(не удалось распознать ответ)';
}

/* ============ Viewer ============ */
function openViewer(src) {
  els.viewerImg.src = src;
  els.viewer.classList.add('show');
}
function closeViewer() { els.viewer.classList.remove('show'); els.viewerImg.src = ''; }

/* ============ Sidebar ============ */
function openSidebar() { els.sidebar.classList.add('open'); els.overlay.classList.add('show'); }
function closeSidebar() { els.sidebar.classList.remove('open'); els.overlay.classList.remove('show'); }

/* ============ Textarea autogrow ============ */
function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
}

/* ============ Settings ============ */
function openSettings() {
  els.apiKeyInput.value = state.settings.apiKey;
  els.modelInput.value = state.settings.model;
  els.maxTokensInput.value = state.settings.maxTokens;
  els.settingsModal.classList.add('show');
}
function closeSettings() { els.settingsModal.classList.remove('show'); }
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
els.sendBtn.onclick = sendMessage;
els.attachBtn.onclick = () => els.fileInput.click();
els.fileInput.onchange = (e) => { handleFiles(e.target.files); e.target.value = ''; };
els.settingsBtn.onclick = openSettings;
els.closeSettings.onclick = closeSettings;
els.saveSettings.onclick = saveSettingsHandler;
els.exportAllBtn.onclick = exportAll;
els.viewerClose.onclick = closeViewer;
els.viewer.onclick = (e) => { if (e.target === els.viewer) closeViewer(); };
els.settingsModal.onclick = (e) => { if (e.target === els.settingsModal) closeSettings(); };

els.clearAllBtn.onclick = () => {
  if (confirm('Удалить ВСЕ чаты и настройки? Это действие необратимо.')) {
    localStorage.removeItem(LS_CHATS);
    state.chats = [];
    state.currentId = null;
    saveChats();
    renderChatList();
    renderMessages();
    closeSettings();
    showToast('Все данные удалены');
  }
};

els.input.oninput = autoGrow;
els.input.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 820) {
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

// initial welcome suggestions binding
document.querySelectorAll('.suggest').forEach(b => {
  b.onclick = () => { els.input.value = b.dataset.prompt; autoGrow(); els.input.focus(); };
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
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  }
};
els.installNo.onclick = () => els.installToast.classList.remove('show');
window.addEventListener('appinstalled', () => {
  els.installToast.classList.remove('show');
  showToast('Приложение установлено');
});

/* ============ Service worker ============ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

/* ============ Init ============ */
renderChatList();
renderMessages();
autoGrow();
