// options.js — Rich Clip Options Page Controller

const LINK_KEY      = 'savedLinks';
const SEARCH_KEY    = 'customSearches';
const CLIPBOARD_KEY = 'clipboardHistory';
const TEMPLATES_KEY = 'customTemplates';
const SETTINGS_KEY  = 'rcSettings';

/* ================================================================
   SAVED LINKS ARCHIVE
   ================================================================ */

function renderLinkList() {
  const list   = document.getElementById('link-list');
  const filter = document.getElementById('archive-filter').value.toLowerCase();
  list.innerHTML = '';

  chrome.storage.local.get([LINK_KEY], data => {
    const links = data[LINK_KEY] || [];

    const filtered = links.filter(l =>
      (l.url  || '').toLowerCase().includes(filter) ||
      (l.text || '').toLowerCase().includes(filter) ||
      (l.tags || '').toLowerCase().includes(filter)
    );

    if (!filtered.length) {
      list.innerHTML = '<li class="rc-empty">No saved links.</li>';
      return;
    }

    filtered.forEach((link, displayIdx) => {
      const realIdx = links.indexOf(link);
      const li = document.createElement('li');
      li.className = 'rc-opt-item';
      li.innerHTML = `
        <div class="rc-opt-info">
          <strong>${esc(link.text || '(no text)')}</strong>
          <a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.url)}</a>
          ${link.tags ? `<span class="rc-tags">${esc(link.tags)}</span>` : ''}
          ${link.timestamp ? `<span class="rc-time">${relTime(link.timestamp)}</span>` : ''}
        </div>
        <div class="rc-opt-actions">
          <button data-index="${realIdx}" class="rc-act rc-del-link" title="Delete">&times;</button>
        </div>
      `;
      li.querySelector('.rc-del-link').addEventListener('click', () => {
        links.splice(realIdx, 1);
        chrome.storage.local.set({ [LINK_KEY]: links }, renderLinkList);
      });
      list.appendChild(li);
    });
  });
}

document.getElementById('archive-filter').addEventListener('input', renderLinkList);
document.getElementById('clear-archive').addEventListener('click', () => {
  if (confirm('Delete all saved links?')) {
    chrome.storage.local.remove([LINK_KEY], renderLinkList);
  }
});

/* ================================================================
   CUSTOM SEARCH ENGINES
   ================================================================ */

function renderSearchList() {
  const list = document.getElementById('search-list');
  list.innerHTML = '';

  chrome.storage.local.get([SEARCH_KEY], data => {
    const engines = data[SEARCH_KEY] || [];

    if (!engines.length) {
      list.innerHTML = '<li class="rc-empty">No search engines configured.</li>';
      return;
    }

    engines.forEach((eng, idx) => {
      const li = document.createElement('li');
      li.className = 'rc-opt-item';
      li.innerHTML = `
        <div class="rc-opt-info">
          <strong>${esc(eng.name)}</strong>
          <code>${esc(eng.url)}</code>
          ${eng.vars && eng.vars.length ? `<span class="rc-vars">vars: ${eng.vars.join(', ')}</span>` : ''}
        </div>
        <div class="rc-opt-actions">
          <button data-index="${idx}" class="rc-act rc-edit-search" title="Edit">Edit</button>
          <button data-index="${idx}" class="rc-act rc-del-search" title="Delete">&times;</button>
        </div>
      `;

      li.querySelector('.rc-edit-search').addEventListener('click', () => {
        document.getElementById('search-name').value = eng.name;
        document.getElementById('search-url').value  = eng.url;
        document.getElementById('search-vars').value = (eng.vars || []).join(', ');
      });

      li.querySelector('.rc-del-search').addEventListener('click', () => {
        engines.splice(idx, 1);
        chrome.storage.local.set({ [SEARCH_KEY]: engines }, () => {
          renderSearchList();
          chrome.runtime.sendMessage({ action: 'rebuildMenu' });
        });
      });

      list.appendChild(li);
    });
  });
}

document.getElementById('search-form').addEventListener('submit', e => {
  e.preventDefault();
  const name    = document.getElementById('search-name').value.trim();
  const url     = document.getElementById('search-url').value.trim();
  const rawVars = document.getElementById('search-vars').value.trim();
  const vars    = rawVars ? rawVars.split(',').map(v => v.trim()).filter(Boolean) : [];

  chrome.storage.local.get([SEARCH_KEY], data => {
    const list     = data[SEARCH_KEY] || [];
    const existing = list.findIndex(e => e.name === name);

    if (existing >= 0) {
      list[existing] = { name, url, vars };
    } else {
      list.push({ name, url, vars });
    }

    chrome.storage.local.set({ [SEARCH_KEY]: list }, () => {
      renderSearchList();
      document.getElementById('search-form').reset();
      chrome.runtime.sendMessage({ action: 'rebuildMenu' });
    });
  });
});

/* ================================================================
   CUSTOM TEMPLATES (read-only here; added via popup)
   ================================================================ */

function renderTemplateList() {
  const list    = document.getElementById('tpl-list');
  const emptyEl = document.getElementById('tpl-empty');
  list.innerHTML = '';

  chrome.storage.local.get([TEMPLATES_KEY], data => {
    const templates = data[TEMPLATES_KEY] || [];
    emptyEl.style.display = templates.length ? 'none' : '';

    templates.forEach((tpl, idx) => {
      const li = document.createElement('li');
      li.className = 'rc-opt-item';
      li.innerHTML = `
        <div class="rc-opt-info">
          <strong>${esc(tpl.name)}</strong>
          <code>${esc(tpl.body)}</code>
        </div>
        <div class="rc-opt-actions">
          <button class="rc-act rc-del-tpl" title="Delete">&times;</button>
        </div>
      `;
      li.querySelector('.rc-del-tpl').addEventListener('click', () => {
        templates.splice(idx, 1);
        chrome.storage.local.set({ [TEMPLATES_KEY]: templates }, renderTemplateList);
      });
      list.appendChild(li);
    });
  });
}

/* ================================================================
   APPEARANCE & BEHAVIOUR
   ================================================================ */

function applyThemeFromSettings(settings) {
  const theme = settings.theme || (settings.darkMode ? 'dark' : 'auto');
  const root  = document.documentElement;
  root.classList.remove('rc-dark', 'rc-light');
  if (theme === 'dark')  root.classList.add('rc-dark');
  else if (theme === 'light') root.classList.add('rc-light');
}

function loadAppearanceSettings() {
  chrome.storage.local.get([SETTINGS_KEY], data => {
    const s = data[SETTINGS_KEY] || {};
    document.getElementById('opt-theme').value                = s.theme || (s.darkMode ? 'dark' : 'auto');
    document.getElementById('opt-selection-toolbar').value    = s.selectionToolbar || 'full';
    document.getElementById('opt-default-format').value       = s.defaultFormat || 'markdown';
    document.getElementById('opt-auto-stage').checked         = s.autoStage !== false;
    document.getElementById('opt-capture-copy').checked       = s.captureCopy !== false;
    document.getElementById('opt-show-preview').checked       = s.showPreview !== false;
    document.getElementById('opt-auto-close').checked         = s.autoClose === true;
    applyThemeFromSettings(s);
  });
}

function saveAppearanceSettings() {
  chrome.storage.local.get([SETTINGS_KEY], data => {
    const s = data[SETTINGS_KEY] || {};
    s.theme              = document.getElementById('opt-theme').value;
    s.darkMode           = (s.theme === 'dark');
    s.selectionToolbar   = document.getElementById('opt-selection-toolbar').value;
    s.defaultFormat      = document.getElementById('opt-default-format').value;
    s.autoStage          = document.getElementById('opt-auto-stage').checked;
    s.captureCopy        = document.getElementById('opt-capture-copy').checked;
    s.showPreview        = document.getElementById('opt-show-preview').checked;
    s.autoClose          = document.getElementById('opt-auto-close').checked;
    chrome.storage.local.set({ [SETTINGS_KEY]: s }, () => applyThemeFromSettings(s));
  });
}

[
  'opt-theme', 'opt-selection-toolbar', 'opt-default-format',
  'opt-auto-stage', 'opt-capture-copy', 'opt-show-preview', 'opt-auto-close'
].forEach(id => {
  document.getElementById(id).addEventListener('change', saveAppearanceSettings);
});

/* ================================================================
   CLIPBOARD SETTINGS
   ================================================================ */

function loadClipSettings() {
  chrome.storage.local.get([SETTINGS_KEY], data => {
    const s = data[SETTINGS_KEY] || {};
    document.getElementById('opt-max-history').value  = s.maxHistory  || 200;
    document.getElementById('opt-expire-days').value  = s.expireDays  || 0;
    document.getElementById('opt-dedup').checked      = s.dedup       !== false;
  });
}

['opt-max-history', 'opt-expire-days', 'opt-dedup'].forEach(id => {
  document.getElementById(id).addEventListener('change', saveClipSettings);
});

function saveClipSettings() {
  chrome.storage.local.get([SETTINGS_KEY], data => {
    const s = data[SETTINGS_KEY] || {};
    s.maxHistory  = parseInt(document.getElementById('opt-max-history').value, 10) || 200;
    s.expireDays  = parseInt(document.getElementById('opt-expire-days').value, 10) || 0;
    s.dedup       = document.getElementById('opt-dedup').checked;
    chrome.storage.local.set({ [SETTINGS_KEY]: s });
  });
}

/* ================================================================
   DATA EXPORT / IMPORT
   ================================================================ */

document.getElementById('btn-export').addEventListener('click', () => {
  chrome.storage.local.get(null, data => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `rich-clip-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

document.getElementById('btn-import').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!confirm(`Import data? This will merge with existing data.`)) return;
      chrome.storage.local.set(imported, () => {
        renderAll();
        alert('Data imported successfully!');
      });
    } catch (err) {
      alert('Invalid JSON file: ' + err.message);
    }
  };
  reader.readAsText(file);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('This will DELETE ALL extension data (clipboard history, saved links, templates, search engines). Continue?')) return;
  if (!confirm('Are you really sure? This cannot be undone.')) return;
  chrome.storage.local.clear(() => {
    renderAll();
    alert('All data has been reset.');
  });
});

/* ================================================================
   HELPERS
   ================================================================ */

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function relTime(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/* ================================================================
   INIT
   ================================================================ */

function renderAll() {
  renderLinkList();
  renderSearchList();
  renderTemplateList();
  loadAppearanceSettings();
  loadClipSettings();
}

renderAll();
