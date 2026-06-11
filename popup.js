// popup.js — Rich Clip Popup Controller
// Tabs, clipboard manager, batch tools, templates, hotkeys.

(() => {
  'use strict';

  /* ================================================================
     CONSTANTS & STATE
     ================================================================ */

  const CLIPBOARD_KEY = 'clipboardHistory';
  const TEMPLATES_KEY = 'customTemplates';
  const SEARCHES_KEY  = 'customSearches';
  const SETTINGS_KEY  = 'rcSettings';

  let state = {
    tab:             'quick',
    currentTab:      null,   // { url, title } of the active browser tab
    history:         [],
    staged:          [],
    templates:       [],
    searches:        [],
    settings:        {},
    clipFocus:       -1,     // focused history index for keyboard nav
    batchLinks:      [],
    filterText:      '',
    filterType:      'all',
    filterFormat:    'all'
  };

  const FORMAT_META = {
    markdown: { label: 'Markdown',  color: '#374151', icon: 'M↓' },
    html:     { label: 'HTML',      color: '#6b7280', icon: '</>' },
    bbcode:   { label: 'BBCode',    color: '#6b7280', icon: 'BB' },
    richtext: { label: 'Rich Text', color: '#374151', icon: 'RT' },
    plain:    { label: 'Plain',     color: '#6b7280', icon: 'Tx' },
    citation: { label: 'Citation',  color: '#6b7280', icon: 'Ci' },
    custom:   { label: 'Custom',    color: '#6b7280', icon: '★' }
  };

  const QUICK_ACTIONS = [
    { id: 'copy-staged',  label: 'Copy Staged',  hotkey: 'V', handler: pasteAll },
    { id: 'clear-stage',  label: 'Clear Stage',  hotkey: 'X', handler: clearStage },
    { id: 'grab-links',   label: 'Grab Links',   hotkey: 'G', handler: grabLinks },
    { id: 'copy-history', label: 'Copy History', hotkey: 'A', handler: copyAllHistory },
    { id: 'open-options', label: 'Settings',     hotkey: 'O', handler: openOptions }
  ];

  /* ================================================================
     UTILITY HELPERS
     ================================================================ */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function relTime(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5)    return 'just now';
    if (s < 60)   return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function toast(msg, isError) {
    const t = $('rc-toast');
    t.textContent = msg;
    t.className = isError ? 'toast-error' : 'toast-show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = ''; }, 2200);
  }

  function setStatus(msg) {
    const el = $('status-text');
    if (el) el.textContent = msg;
  }

  /* ================================================================
     FORMAT CONVERTERS
     ================================================================ */

  function formatItem(url, title, fmt) {
    title = title || url || '';
    url   = url   || '';
    const date = new Date().toLocaleDateString();

    switch (fmt) {
      case 'markdown':
        return `[${title}](${url})`;

      case 'html':
        return `<a href="${url}" target="_blank" rel="noopener">${title}</a>`;

      case 'bbcode':
        return `[url=${url}]${title}[/url]`;

      case 'richtext':
        return title;

      case 'plain':
        return url;

      case 'citation': {
        let host = '';
        try { host = new URL(url).hostname.replace('www.', ''); } catch (_) {}
        return `${title}. ${host}. ${date}. ${url}`;
      }

      default:
        return url;
    }
  }

  /* ================================================================
     STORAGE
     ================================================================ */

  function loadAll() {
    return new Promise(resolve => {
      chrome.storage.local.get(
        [CLIPBOARD_KEY, TEMPLATES_KEY, SEARCHES_KEY, SETTINGS_KEY],
        data => {
          state.history   = data[CLIPBOARD_KEY] || [];
          state.templates = data[TEMPLATES_KEY] || [];
          state.searches  = data[SEARCHES_KEY]  || [];
          state.settings  = data[SETTINGS_KEY]  || {
            darkMode: false, theme: 'auto', autoStage: true,
            captureCopy: true, showPreview: true,
            selectionToolbar: 'full', defaultFormat: 'markdown', autoClose: false
          };
          resolve();
        }
      );
    });
  }

  function saveHistory() {
    chrome.storage.local.set({ [CLIPBOARD_KEY]: state.history });
  }

  function saveTemplates() {
    chrome.storage.local.set({ [TEMPLATES_KEY]: state.templates });
  }

  function saveSettings() {
    chrome.storage.local.set({ [SETTINGS_KEY]: state.settings });
  }

  /* ================================================================
     TAB SWITCHING
     ================================================================ */

  function switchTab(name) {
    state.tab = name;

    document.querySelectorAll('.rc-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name));

    document.querySelectorAll('.rc-tab-content').forEach(c =>
      c.classList.toggle('active', c.id === 'tab-' + name));

    if (name === 'clipboard') renderClipboard();
    if (name === 'batch')     renderBatch();
    if (name === 'templates') renderTemplates();
  }

  /* ================================================================
     TAB 1 — QUICK COPY
     ================================================================ */

  function renderQuickCopy() {
    if (!state.currentTab) return;
    const { url, title } = state.currentTab;

    $('page-title').textContent = title;
    $('page-url').textContent   = url;
    $('page-url').title         = url;

    const formats = [
      { key: 'markdown', hotkey: 'M' },
      { key: 'html',     hotkey: 'H' },
      { key: 'bbcode',   hotkey: 'B' },
      { key: 'richtext', hotkey: 'R' },
      { key: 'plain',    hotkey: 'P' },
      { key: 'citation', hotkey: 'C' }
    ];

    const grid = $('format-cards');
    grid.innerHTML = '';

    formats.forEach(f => {
      const meta   = FORMAT_META[f.key] || {};
      const output = formatItem(url, title, f.key);
      const card   = document.createElement('div');
      card.className = 'rc-format-card';
      card.style.setProperty('--fc', meta.color || '#888');
      card.dataset.format = f.key;

      card.innerHTML = `
        <div class="fc-head">
          <span class="fc-icon" style="background:${meta.color}">${meta.icon}</span>
          <span class="fc-name">${meta.label}</span>
          <kbd>${f.hotkey}</kbd>
          <button class="fc-stage-btn" title="Stage (Shift+${f.hotkey})">+</button>
        </div>
        <div class="fc-preview">${esc(output)}</div>
      `;

      // Click card → copy
      card.addEventListener('click', e => {
        if (e.target.closest('.fc-stage-btn')) return;
        doCopy(output, f.key);
      });

      // Stage button
      card.querySelector('.fc-stage-btn').addEventListener('click', e => {
        e.stopPropagation();
        doStage(output, f.key);
      });

      grid.appendChild(card);
    });

    // Render quick action buttons
    const qaContainer = $('quick-actions');
    qaContainer.innerHTML = '';
    QUICK_ACTIONS.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'rc-action-btn';
      btn.innerHTML = `${a.label} <kbd>${a.hotkey}</kbd>`;
      btn.addEventListener('click', a.handler);
      qaContainer.appendChild(btn);
    });
  }

  /* ── Copy / Stage helpers ──────────────────────────────────── */

  function doCopy(text, fmt) {
    navigator.clipboard.writeText(text).then(() => {
      addHistoryItem(text, fmt);
      toast(`Copied as ${FORMAT_META[fmt]?.label || fmt}`);
      setStatus('Copied!');
      if (state.settings.autoClose) {
        setTimeout(() => window.close(), 700);
      }
    }, err => {
      console.error(err);
      toast('Copy failed', true);
    });
  }

  function doStage(text, fmt) {
    addHistoryItem(text, fmt);
    stageItem({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text, format: fmt, timestamp: Date.now()
    });
    toast(`Staged as ${FORMAT_META[fmt]?.label || fmt}`);
  }

  function addHistoryItem(text, fmt) {
    const item = {
      id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      text,
      url:       state.currentTab?.url   || '',
      title:     state.currentTab?.title || '',
      format:    fmt || 'plain',
      timestamp: Date.now(),
      pinned:    false,
      source:    'popup',
      type:      'link'
    };

    // Deduplicate against most recent entry
    if (state.history.length && state.history[0].text === text &&
        (Date.now() - state.history[0].timestamp) < 3000) {
      return;
    }

    state.history.unshift(item);
    saveHistory();
    // Also notify background (in case it didn't see the copy event)
    chrome.runtime.sendMessage({ action: 'addClipboardItem', data: item }).catch(() => {});
  }

  /* ================================================================
     TAB 2 — CLIPBOARD MANAGER
     ================================================================ */

  function renderClipboard() {
    renderHistory();
    renderStaged();
  }

  function renderHistory() {
    const list    = $('clip-history');
    const search  = state.filterText.toLowerCase();
    const type    = state.filterType;
    const fmt     = state.filterFormat;

    const filtered = state.history.filter(item => {
      if (type !== 'all' && item.type !== type) return false;
      if (fmt  !== 'all' && item.format !== fmt) return false;
      if (search && !(
        (item.text  || '').toLowerCase().includes(search) ||
        (item.url   || '').toLowerCase().includes(search) ||
        (item.title || '').toLowerCase().includes(search)
      )) return false;
      return true;
    });

    if (!filtered.length) {
      list.innerHTML = '<div class="rc-empty">No items match your filters.</div>';
      return;
    }

    list.innerHTML = filtered.map((item, i) => {
      const meta   = FORMAT_META[item.format] || {};
      const active = i === state.clipFocus ? ' rc-focused' : '';
      return `
        <div class="rc-clip-item${active}" data-id="${item.id}" data-idx="${i}">
          <div class="rc-clip-dot" style="background:${meta.color}" title="${meta.label}"></div>
          <div class="rc-clip-body">
            <div class="rc-clip-text">${esc((item.text || '').slice(0, 140))}</div>
            <div class="rc-clip-meta">
              <span class="rc-pill" style="background:${meta.color}22;color:${meta.color}">${meta.label}</span>
              <span class="rc-time">${relTime(item.timestamp)}</span>
              ${item.pinned ? '<span class="rc-pinned">pinned</span>' : ''}
            </div>
          </div>
          <div class="rc-clip-actions">
            <button class="rc-act rc-a-copy"  title="Copy (Enter)">&#9112;</button>
            <button class="rc-act rc-a-stage" title="Stage (S)">+</button>
            <button class="rc-act rc-a-pin"   title="Pin">${item.pinned ? '&#9733;' : '&#9734;'}</button>
            <button class="rc-act rc-a-del"   title="Delete (X)">&times;</button>
          </div>
        </div>`;
    }).join('');

    // Wire up action buttons
    list.querySelectorAll('.rc-clip-item').forEach(el => {
      const id = el.dataset.id;
      const item = state.history.find(h => h.id === id);
      if (!item) return;

      el.querySelector('.rc-a-copy').onclick  = () => copyItem(item);
      el.querySelector('.rc-a-stage').onclick = () => {
        stageItem({ ...item });
        toast('Staged!');
      };
      el.querySelector('.rc-a-pin').onclick   = () => togglePin(id);
      el.querySelector('.rc-a-del').onclick   = () => deleteItem(id);
    });
  }

  function renderStaged() {
    const list = $('staged-list');
    $('staged-count').textContent         = state.staged.length;
    $('staged-count-detail').textContent  = state.staged.length;

    if (!state.staged.length) {
      list.innerHTML = '<div class="rc-empty">No staged items. Click + on any format card or history item.</div>';
      return;
    }

    list.innerHTML = state.staged.map((item, i) => {
      const meta = FORMAT_META[item.format] || {};
      return `
        <div class="rc-staged-item" data-idx="${i}">
          <div class="rc-staged-dot" style="background:${meta.color}"></div>
          <div class="rc-staged-text">${esc((item.text || '').slice(0, 120))}</div>
          <div class="rc-staged-actions">
            <button class="rc-act rc-s-up"   title="Move up">&uarr;</button>
            <button class="rc-act rc-s-down"  title="Move down">&darr;</button>
            <button class="rc-act rc-s-remove" title="Remove">&times;</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.rc-staged-item').forEach(el => {
      const i = parseInt(el.dataset.idx, 10);
      el.querySelector('.rc-s-up').onclick     = () => moveStaged(i, -1);
      el.querySelector('.rc-s-down').onclick   = () => moveStaged(i, 1);
      el.querySelector('.rc-s-remove').onclick = () => removeStaged(i);
    });
  }

  /* ── History actions ─────────────────────────────────────── */

  function copyItem(item) {
    navigator.clipboard.writeText(item.text).then(() => {
      toast(`Copied (${FORMAT_META[item.format]?.label || item.format})`);
      setStatus('Copied!');
    });
  }

  function togglePin(id) {
    const item = state.history.find(h => h.id === id);
    if (!item) return;
    item.pinned = !item.pinned;
    saveHistory();
    renderHistory();
    toast(item.pinned ? 'Pinned' : 'Unpinned');
  }

  function deleteItem(id) {
    state.history = state.history.filter(h => h.id !== id);
    saveHistory();
    renderHistory();
  }

  function clearHistory() {
    if (!state.history.length) return;
    const pinnedCount = state.history.filter(h => h.pinned).length;
    const msg = pinnedCount
      ? `Clear ${state.history.length - pinnedCount} unpinned items? (pinned items are kept)`
      : `Clear all ${state.history.length} items?`;
    if (!confirm(msg)) return;

    state.history = state.history.filter(h => h.pinned);
    saveHistory();
    renderHistory();
    toast('History cleared');
  }

  function copyAllHistory() {
    if (!state.history.length) return toast('History is empty', true);
    const text = state.history.map(h => h.text).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      toast(`Copied ${state.history.length} items`);
    });
  }

  /* ── Stage actions ───────────────────────────────────────── */

  function stageItem(item) {
    item.id = item.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    state.staged.push(item);
    renderStaged();
  }

  function moveStaged(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= state.staged.length) return;
    const temp = state.staged[idx];
    state.staged[idx]    = state.staged[newIdx];
    state.staged[newIdx] = temp;
    renderStaged();
  }

  function removeStaged(idx) {
    state.staged.splice(idx, 1);
    renderStaged();
  }

  function clearStage() {
    if (!state.staged.length) return;
    state.staged = [];
    renderStaged();
    toast('Stage cleared');
  }

  function pasteAll() {
    if (!state.staged.length) return toast('Nothing staged', true);
    const sepEl  = $('stage-separator');
    const rawSep = sepEl ? sepEl.value : '\\n';
    const sep    = rawSep.replace(/\\n/g, '\n');
    const output = state.staged.map(s => s.text).join(sep);

    navigator.clipboard.writeText(output).then(() => {
      toast(`Pasted ${state.staged.length} items`);
      setStatus('Pasted all!');
    }, () => toast('Paste failed', true));
  }

  /* ================================================================
     TAB 3 — BATCH TOOLS
     ================================================================ */

  function renderBatch() {
    // Show summary if we already grabbed links
    const summary = $('batch-link-summary');
    if (state.batchLinks.length) {
      summary.innerHTML = `<span class="rc-badge-info">${state.batchLinks.length} links grabbed from last session</span>`;
    } else {
      summary.innerHTML = '';
    }
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function grabLinks() {
    const tab = await getActiveTab();
    if (!tab) return toast('No active tab', true);

    try {
      // Ask content script to open its link grabber panel
      await chrome.tabs.sendMessage(tab.id, { action: 'openLinkGrabber' });

      // Also collect link count for summary
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const anchors = [...document.querySelectorAll('a[href]')];
          const seen = new Set();
          return anchors.reduce((n, a) => {
            if (!a.href || a.href.startsWith('javascript:')) return n;
            const key = a.href + '|' + a.textContent.trim();
            if (seen.has(key)) return n;
            seen.add(key);
            return n + 1;
          }, 0);
        }
      });

      const count = result?.result || 0;
      $('batch-link-summary').innerHTML =
        `<span class="rc-badge-info">${count} links found — grabber panel opened on page</span>`;

      toast(`Grabber opened with ${count} links`);
    } catch (e) {
      console.error(e);
      toast('Could not grab links — reload the page', true);
    }
  }

  async function convertLinks() {
    const fmt = $('convert-format').value;
    const tab = await getActiveTab();
    if (!tab) return toast('No active tab', true);

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const anchors = [...document.querySelectorAll('a[href]')];
          const seen = new Set();
          return anchors.reduce((acc, a) => {
            if (!a.href || a.href.startsWith('javascript:')) return acc;
            const key = a.href + '|' + a.textContent.trim();
            if (seen.has(key)) return acc;
            seen.add(key);
            acc.push({ url: a.href, text: a.textContent.trim().slice(0, 120) || a.href });
            return acc;
          }, []);
        }
      });

      const links = result?.result || [];
      if (!links.length) return toast('No links found on page', true);

      const output = links.map(l => formatItem(l.url, l.text, fmt)).join('\n');

      navigator.clipboard.writeText(output).then(() => {
        addHistoryItem(output, fmt);
        toast(`Copied ${links.length} links as ${FORMAT_META[fmt]?.label || fmt}`);
      });
    } catch (e) {
      console.error(e);
      toast('Conversion failed', true);
    }
  }

  async function scrapePage() {
    const tab = await getActiveTab();
    if (!tab) return toast('No active tab', true);

    try {
      // Ask content script to open its scraper panel
      await chrome.tabs.sendMessage(tab.id, { action: 'openPageScraper' });
      toast('Scraper opened on page');
    } catch (e) {
      console.error(e);
      toast('Could not open scraper — reload the page', true);
    }
  }

  /* ================================================================
     TAB 4 — TEMPLATES
     ================================================================ */

  function renderTemplates() {
    const list = $('template-list');

    if (!state.templates.length) {
      list.innerHTML = '<div class="rc-empty">No custom templates yet.</div>';
      return;
    }

    list.innerHTML = state.templates.map((tpl, i) => `
      <div class="rc-tpl-item" data-idx="${i}">
        <div class="rc-tpl-info">
          <strong>${esc(tpl.name)}</strong>
          <code>${esc(tpl.body)}</code>
        </div>
        <div class="rc-tpl-actions">
          <button class="rc-act rc-tpl-use" title="Use template">Use</button>
          <button class="rc-act rc-tpl-del" title="Delete">&times;</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.rc-tpl-item').forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      const tpl = state.templates[idx];
      if (!tpl) return;

      el.querySelector('.rc-tpl-use').onclick = () => useTemplate(tpl);
      el.querySelector('.rc-tpl-del').onclick = () => {
        state.templates.splice(idx, 1);
        saveTemplates();
        renderTemplates();
        toast('Template deleted');
      };
    });
  }

  function useTemplate(tpl) {
    if (!state.currentTab) return;
    const { url, title } = state.currentTab;
    const date = new Date().toLocaleDateString();

    const output = tpl.body
      .replace(/\{url\}/g, url)
      .replace(/\{title\}/g, title)
      .replace(/\{text\}/g, title)
      .replace(/\{date\}/g, date)
      .replace(/\{selection\}/g, '');

    navigator.clipboard.writeText(output).then(() => {
      addHistoryItem(output, 'custom');
      toast(`Copied with template "${tpl.name}"`);
    });
  }

  function saveNewTemplate(e) {
    e.preventDefault();
    const name = $('tpl-name').value.trim();
    const body = $('tpl-body').value.trim();
    if (!name || !body) return;

    state.templates.push({ name, body });
    saveTemplates();
    $('template-form').reset();
    renderTemplates();
    toast('Template saved!');
  }

  /* ================================================================
     SETTINGS
     ================================================================ */

  function applyTheme(mode) {
    // mode: 'auto' | 'light' | 'dark'
    const root = document.documentElement;
    root.classList.remove('rc-dark', 'rc-light');

    if (mode === 'dark') {
      root.classList.add('rc-dark');
    } else if (mode === 'light') {
      root.classList.add('rc-light');
    }
    // 'auto' — no class; CSS @media (prefers-color-scheme: dark) handles it
  }

  function loadSettingsUI() {
    const theme = state.settings.theme || 'auto';
    $('opt-dark').value = theme;
    applyTheme(theme);

    $('opt-auto-stage').checked   = state.settings.autoStage !== false;
    $('opt-capture-copy').checked = state.settings.captureCopy !== false;
    $('opt-show-preview').checked = state.settings.showPreview !== false;
    $('opt-auto-close').checked   = state.settings.autoClose === true;

    $('opt-selection-toolbar').value = state.settings.selectionToolbar || 'full';
    $('opt-default-format').value    = state.settings.defaultFormat    || 'markdown';
  }

  function bindSettings() {
    // Theme select (three-way)
    $('opt-dark').addEventListener('change', () => {
      state.settings.theme = $('opt-dark').value;
      // Migrate legacy darkMode boolean
      state.settings.darkMode = (state.settings.theme === 'dark');
      saveSettings();
      applyTheme(state.settings.theme);
    });

    // Checkbox toggles
    const toggles = [
      { id: 'opt-auto-stage',   key: 'autoStage' },
      { id: 'opt-capture-copy', key: 'captureCopy' },
      { id: 'opt-show-preview', key: 'showPreview' },
      { id: 'opt-auto-close',   key: 'autoClose' }
    ];

    toggles.forEach(({ id, key }) => {
      $(id).addEventListener('change', () => {
        state.settings[key] = $(id).checked;
        saveSettings();
      });
    });

    // Select-based settings
    $('opt-selection-toolbar').addEventListener('change', () => {
      state.settings.selectionToolbar = $('opt-selection-toolbar').value;
      saveSettings();
    });

    $('opt-default-format').addEventListener('change', () => {
      state.settings.defaultFormat = $('opt-default-format').value;
      saveSettings();
    });
  }

  /* ================================================================
     KEYBOARD SHORTCUTS
     ================================================================ */

  function setupHotkeys() {
    document.addEventListener('keydown', e => {
      // Ignore when typing in inputs (except for specific shortcuts)
      const tag = e.target.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Escape — close modals, switch to quick tab
      if (e.key === 'Escape') {
        const modal = $('rc-shortcuts-modal');
        if (!modal.classList.contains('hidden')) {
          modal.classList.add('hidden');
          e.preventDefault();
          return;
        }
        if (inInput) {
          e.target.blur();
          e.preventDefault();
          return;
        }
      }

      // Don't process further if in an input field
      if (inInput) return;

      const key   = e.key;
      const shift = e.shiftKey;
      const ctrl  = e.ctrlKey || e.metaKey;

      // ── Global ──
      if (key === '?') { e.preventDefault(); toggleShortcutsModal(); return; }
      if (key === '/') { e.preventDefault(); $('clip-search')?.focus(); return; }

      // Tab switching
      if (!shift && !ctrl) {
        if (key === '1') { switchTab('quick');     return; }
        if (key === '2') { switchTab('clipboard');  return; }
        if (key === '3') { switchTab('batch');      return; }
        if (key === '4') { switchTab('templates');  return; }
      }

      // ── Quick Copy tab ──
      if (state.tab === 'quick') {
        const fmtMap = { m: 'markdown', h: 'html', b: 'bbcode', r: 'richtext', p: 'plain', c: 'citation' };
        const lk = key.toLowerCase();

        if (fmtMap[lk] && state.currentTab) {
          e.preventDefault();
          const fmt    = fmtMap[lk];
          const output = formatItem(state.currentTab.url, state.currentTab.title, fmt);

          if (shift) {
            doStage(output, fmt);
          } else {
            doCopy(output, fmt);
          }
          return;
        }

        // Quick action hotkeys
        if (!shift && !ctrl) {
          const action = QUICK_ACTIONS.find(a => a.hotkey.toLowerCase() === lk);
          if (action) { e.preventDefault(); action.handler(); return; }
        }
      }

      // ── Clipboard tab ──
      if (state.tab === 'clipboard') {
        const filtered = getFilteredHistory();

        if (key === 'j' || key === 'ArrowDown') {
          e.preventDefault();
          state.clipFocus = Math.min(state.clipFocus + 1, filtered.length - 1);
          renderHistory();
          scrollFocusedIntoView();
        }
        if (key === 'k' || key === 'ArrowUp') {
          e.preventDefault();
          state.clipFocus = Math.max(state.clipFocus - 1, 0);
          renderHistory();
          scrollFocusedIntoView();
        }
        if (key === 'Enter' && state.clipFocus >= 0) {
          e.preventDefault();
          const item = filtered[state.clipFocus];
          if (item) copyItem(item);
        }
        if (key === 's' && state.clipFocus >= 0) {
          e.preventDefault();
          const item = filtered[state.clipFocus];
          if (item) { stageItem({ ...item }); toast('Staged!'); }
        }
        if (key === 'x' && state.clipFocus >= 0) {
          e.preventDefault();
          const item = filtered[state.clipFocus];
          if (item) deleteItem(item.id);
        }
        if (key === 'p' && state.clipFocus >= 0) {
          e.preventDefault();
          const item = filtered[state.clipFocus];
          if (item) togglePin(item.id);
        }
        if (ctrl && shift && (key === 'V' || key === 'v')) {
          e.preventDefault();
          pasteAll();
        }
      }

      // ── Batch tab ──
      if (state.tab === 'batch') {
        if (!shift && !ctrl) {
          if (key === 'g') { e.preventDefault(); grabLinks(); }
          if (key === 'l') { e.preventDefault(); convertLinks(); }
          if (key === 's') { e.preventDefault(); scrapePage(); }
        }
      }
    });
  }

  function getFilteredHistory() {
    const search = state.filterText.toLowerCase();
    const type   = state.filterType;
    const fmt    = state.filterFormat;

    return state.history.filter(item => {
      if (type !== 'all' && item.type !== type) return false;
      if (fmt  !== 'all' && item.format !== fmt) return false;
      if (search && !(
        (item.text  || '').toLowerCase().includes(search) ||
        (item.url   || '').toLowerCase().includes(search) ||
        (item.title || '').toLowerCase().includes(search)
      )) return false;
      return true;
    });
  }

  function scrollFocusedIntoView() {
    const el = document.querySelector('.rc-focused');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function toggleShortcutsModal() {
    $('rc-shortcuts-modal').classList.toggle('hidden');
  }

  /* ================================================================
     OPTIONS PAGE
     ================================================================ */

  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  /* ================================================================
     INIT
     ================================================================ */

  async function init() {
    // Load data
    await loadAll();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.currentTab = tab ? { url: tab.url, title: tab.title } : null;

    // Tab bar
    document.querySelectorAll('.rc-tab').forEach(t =>
      t.addEventListener('click', () => switchTab(t.dataset.tab)));

    // Render
    renderQuickCopy();
    renderStaged();
    loadSettingsUI();
    bindSettings();

    // Clipboard controls
    $('clip-search').addEventListener('input', e => {
      state.filterText = e.target.value;
      state.clipFocus  = 0;
      renderHistory();
    });
    $('clip-filter').addEventListener('change', e => {
      state.filterType = e.target.value;
      state.clipFocus  = 0;
      renderHistory();
    });
    $('clip-format-filter').addEventListener('change', e => {
      state.filterFormat = e.target.value;
      state.clipFocus = 0;
      renderHistory();
    });
    $('btn-clear-history').addEventListener('click', clearHistory);
    $('btn-clear-stage').addEventListener('click', clearStage);
    $('btn-copy-stage').addEventListener('click', pasteAll);
    $('btn-paste-all').addEventListener('click', pasteAll);
    $('btn-options').addEventListener('click', openOptions);

    // Batch
    $('btn-grab-links').addEventListener('click', grabLinks);
    $('btn-convert-links').addEventListener('click', convertLinks);
    $('btn-scrape-page').addEventListener('click', scrapePage);

    // Templates
    $('template-form').addEventListener('submit', saveNewTemplate);

    // Shortcuts modal
    $('close-shortcuts').addEventListener('click', toggleShortcutsModal);
    document.querySelector('.rc-modal-backdrop')?.addEventListener('click', toggleShortcutsModal);

    // Keyboard shortcuts
    setupHotkeys();

    // Status
    setStatus('Ready');
  }

  init();
})();
