// content.js — Rich Clip Content Script
// Enhanced floating toolbar, batch link grabber, page scraper, and clipboard capture.

(() => {
  'use strict';

  let toolbar         = null;
  let grabberPanel    = null;
  let scrapeDialog    = null;
  let selectedRange   = null;
  let listenersReady  = false;

  /* ================================================================
     SETTINGS CACHE — syncs with chrome.storage.local
     ================================================================ */

  let contentSettings = {
    selectionToolbar: 'full',
    defaultFormat:    'markdown'
  };

  chrome.storage.local.get(['rcSettings'], data => {
    const s = data.rcSettings || {};
    contentSettings.selectionToolbar = s.selectionToolbar || 'full';
    contentSettings.defaultFormat    = s.defaultFormat    || 'markdown';
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.rcSettings) return;
    const s = changes.rcSettings.newValue || {};
    contentSettings.selectionToolbar = s.selectionToolbar || 'full';
    contentSettings.defaultFormat    = s.defaultFormat    || 'markdown';
    if (contentSettings.selectionToolbar === 'off') hideToolbar();
  });

  /* ================================================================
     FORMATTING HELPERS
     ================================================================ */

  function formatLink(url, text, fmt) {
    text = text || url;
    switch (fmt) {
      case 'markdown': return `[${text}](${url})`;
      case 'html':     return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
      case 'bbcode':   return `[url=${url}]${text}[/url]`;
      case 'richtext': return text;
      default:         return url;
    }
  }

  function wrapSelection(before, after) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const text  = range.toString();
    range.deleteContents();
    range.insertNode(document.createTextNode(before + text + (after || before)));
    sel.removeAllRanges();
  }

  /* ================================================================
     CLIPBOARD CAPTURE — intercept all copy events on the page
     ================================================================ */

  document.addEventListener('copy', () => {
    setTimeout(() => {
      const sel  = window.getSelection();
      const text = sel ? sel.toString() : '';
      if (!text.trim()) return;

      // Try to detect if selection is inside a link
      let linkUrl = '';
      let node    = sel.anchorNode;
      while (node) {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A' && node.href) {
          linkUrl = node.href;
          break;
        }
        node = node.parentNode;
      }

      chrome.runtime.sendMessage({
        action: 'addClipboardItem',
        data: {
          text, url: linkUrl || window.location.href,
          title: document.title, format: 'plain',
          source: 'page-copy', type: linkUrl ? 'link' : 'text'
        }
      }).catch(() => {});
    }, 50);
  }, true);

  /* ================================================================
     FLOATING TOOLBAR (on text selection)
     ================================================================ */

  function createToolbar() {
    if (toolbar) return toolbar;

    toolbar = document.createElement('div');
    toolbar.id = 'rc-toolbar';
    toolbar.innerHTML = `
      <div id="rc-tb-row">
        <span id="rc-tb-wc" class="rc-tb-wc"></span>
        <button id="rc-btn-bold"    title="Bold (Ctrl+B)"><b>B</b></button>
        <button id="rc-btn-italic"  title="Italic (Ctrl+I)"><i>I</i></button>
        <button id="rc-btn-code"    title="Code">&lt;/&gt;</button>
        <span class="rc-sep"></span>
        <button id="rc-btn-upper" class="rc-tb-case" title="UPPERCASE">AA</button>
        <button id="rc-btn-lower" class="rc-tb-case" title="lowercase">aa</button>
        <button id="rc-btn-title" class="rc-tb-case" title="Title Case">Aa</button>
        <span class="rc-sep rc-sep2"></span>
        <input  type="text" id="rc-tb-url"  placeholder="URL (for link)" size="18">
        <input  type="text" id="rc-tb-text" placeholder="Label" size="12">
        <select id="rc-tb-format">
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
          <option value="bbcode">BBCode</option>
          <option value="richtext">Rich Text</option>
          <option value="plain">Plain</option>
        </select>
        <button id="rc-btn-copy" title="Copy formatted (Ctrl+Enter)">Copy</button>
        <button id="rc-btn-stage" title="Stage for later">+Stage</button>
        <button id="rc-btn-save"  title="Save to archive">Save</button>
        <button id="rc-btn-close" title="Close (Esc)">&times;</button>
      </div>
      <div id="rc-tb-preview"></div>
    `;

    document.body.appendChild(toolbar);

    if (!listenersReady) {
      attachToolbarListeners();
      listenersReady = true;
    }
    return toolbar;
  }

  function positionToolbar() {
    if (!toolbar || toolbar.style.display === 'none') return;
    const sel = window.getSelection();
    if (!sel.rangeCount) { hideToolbar(); return; }

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const tbW  = toolbar.offsetWidth  || 500;
    const tbH  = toolbar.offsetHeight || 40;

    let left = window.scrollX + rect.left;
    let top  = window.scrollY + rect.top - tbH - 8;

    // Keep inside viewport
    if (left + tbW > window.scrollX + window.innerWidth) {
      left = window.scrollX + window.innerWidth - tbW - 12;
    }
    if (top < window.scrollY) {
      top = window.scrollY + rect.bottom + 8;
    }

    toolbar.style.left = `${Math.max(4, left)}px`;
    toolbar.style.top  = `${top}px`;
    toolbar.style.display = 'block';
  }

  function hideToolbar() {
    if (toolbar) toolbar.style.display = 'none';
  }

  function updatePreview() {
    const preview = toolbar.querySelector('#rc-tb-preview');
    if (!preview) return;
    const url  = toolbar.querySelector('#rc-tb-url').value.trim()  || window.location.href;
    const text = toolbar.querySelector('#rc-tb-text').value.trim() || window.getSelection().toString();
    const fmt  = toolbar.querySelector('#rc-tb-format').value;
    preview.textContent = formatLink(url, text, fmt);
  }

  /* ── Toolbar Actions ─────────────────────────────────────────── */

  function doCopy() {
    const url  = toolbar.querySelector('#rc-tb-url').value.trim()  || window.location.href;
    const text = toolbar.querySelector('#rc-tb-text').value.trim() || window.getSelection().toString();
    const fmt  = toolbar.querySelector('#rc-tb-format').value;
    const output = formatLink(url, text, fmt);

    navigator.clipboard.writeText(output).then(() => {
      chrome.runtime.sendMessage({
        action: 'addClipboardItem',
        data: { text: output, url, title: text || document.title, format: fmt, source: 'toolbar', type: 'link' }
      }).catch(() => {});
      showFloater('Copied!');
    }).catch(() => showFloater('Copy failed', true));
  }

  function doStage() {
    const url  = toolbar.querySelector('#rc-tb-url').value.trim()  || window.location.href;
    const text = toolbar.querySelector('#rc-tb-text').value.trim() || window.getSelection().toString();
    const fmt  = toolbar.querySelector('#rc-tb-format').value;
    const output = formatLink(url, text, fmt);

    chrome.runtime.sendMessage({
      action: 'addClipboardItem',
      data: { text: output, url, title: text || document.title, format: fmt, source: 'toolbar-stage', type: 'link' }
    }).catch(() => {});
    showFloater('Staged!');
  }

  function doSave() {
    const url  = toolbar.querySelector('#rc-tb-url').value.trim()  || window.location.href;
    const text = toolbar.querySelector('#rc-tb-text').value.trim() || window.getSelection().toString();
    chrome.storage.local.get(['savedLinks'], data => {
      const list = data.savedLinks || [];
      list.push({ url, text, tags: '', timestamp: Date.now() });
      chrome.storage.local.set({ savedLinks: list }, () => showFloater('Saved!'));
    });
  }

  /* ── Toolbar Event Wiring ────────────────────────────────────── */

  function attachToolbarListeners() {
    if (!toolbar) return;

    toolbar.querySelector('#rc-btn-bold').addEventListener('click',   () => wrapSelection('**'));
    toolbar.querySelector('#rc-btn-italic').addEventListener('click', () => wrapSelection('*'));
    toolbar.querySelector('#rc-btn-code').addEventListener('click',   () => wrapSelection('`'));
    toolbar.querySelector('#rc-btn-copy').addEventListener('click',   doCopy);
    toolbar.querySelector('#rc-btn-stage').addEventListener('click',  doStage);
    toolbar.querySelector('#rc-btn-save').addEventListener('click',   doSave);
    toolbar.querySelector('#rc-btn-close').addEventListener('click',  hideToolbar);

    // Text-case transforms
    toolbar.querySelector('#rc-btn-upper').addEventListener('click', () => {
      const textInput = toolbar.querySelector('#rc-tb-text');
      const src = textInput.value || window.getSelection().toString();
      textInput.value = src.toUpperCase();
      updatePreview();
    });
    toolbar.querySelector('#rc-btn-lower').addEventListener('click', () => {
      const textInput = toolbar.querySelector('#rc-tb-text');
      const src = textInput.value || window.getSelection().toString();
      textInput.value = src.toLowerCase();
      updatePreview();
    });
    toolbar.querySelector('#rc-btn-title').addEventListener('click', () => {
      const textInput = toolbar.querySelector('#rc-tb-text');
      const src = textInput.value || window.getSelection().toString();
      textInput.value = src.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      updatePreview();
    });

    const fmtSel = toolbar.querySelector('#rc-tb-format');
    fmtSel.addEventListener('change', updatePreview);
    toolbar.querySelector('#rc-tb-url').addEventListener('input',  updatePreview);
    toolbar.querySelector('#rc-tb-text').addEventListener('input', updatePreview);

    // Keyboard shortcuts inside toolbar inputs
    toolbar.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doCopy(); }
      if (e.key === 'Escape') { hideToolbar(); e.preventDefault(); }
    });
  }

  /* ── Selection Watcher ───────────────────────────────────────── */

  document.addEventListener('mouseup', e => {
    // Ignore clicks inside our own UI
    if (e.target.closest('#rc-toolbar, #rc-grabber, #rc-scrape')) return;

    const sel = window.getSelection();
    if (!sel.isCollapsed && sel.toString().trim().length > 0) {
      // Respect toolbar setting
      if (contentSettings.selectionToolbar === 'off') return;

      selectedRange = sel.getRangeAt(0);
      createToolbar();

      // Apply compact class
      toolbar.classList.toggle('rc-tb-compact', contentSettings.selectionToolbar === 'compact');

      // Detect if selection is inside a link
      let url  = '';
      let text = sel.toString();
      let node = sel.anchorNode;
      while (node) {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A' && node.href) {
          url = node.href;
          if (text === node.innerText.trim()) text = node.innerText;
          break;
        }
        node = node.parentNode;
      }

      toolbar.querySelector('#rc-tb-url').value  = url;
      toolbar.querySelector('#rc-tb-text').value = text;

      // Apply default format from settings
      const fmtSelect = toolbar.querySelector('#rc-tb-format');
      fmtSelect.value = contentSettings.defaultFormat || 'markdown';

      // Word count for compact mode indicator
      const words = text.trim().split(/\s+/).filter(w => w.length > 0);
      const wcEl  = toolbar.querySelector('#rc-tb-wc');
      if (wcEl) wcEl.textContent = words.length > 1 ? `${words.length}w` : '';

      updatePreview();
      positionToolbar();
    } else if (!e.target.closest('#rc-toolbar')) {
      hideToolbar();
    }
  });

  window.addEventListener('scroll', positionToolbar, { passive: true });
  window.addEventListener('resize', positionToolbar, { passive: true });

  /* ================================================================
     BATCH LINK GRABBER
     ================================================================ */

  function openLinkGrabber() {
    if (grabberPanel) { grabberPanel.remove(); grabberPanel = null; }

    // Collect visible links
    const anchors = [...document.querySelectorAll('a[href]')];
    const seen    = new Set();
    const links   = [];

    anchors.forEach(a => {
      if (!a.href || a.href.startsWith('javascript:')) return;
      const key = a.href + '|' + a.textContent.trim();
      if (seen.has(key)) return;
      seen.add(key);
      links.push({
        url:  a.href,
        text: (a.textContent || '').trim().slice(0, 120),
        title: a.title || ''
      });
    });

    grabberPanel = document.createElement('div');
    grabberPanel.id = 'rc-grabber';

    const itemsHtml = links.map((l, i) => `
      <div class="rc-grab-item" data-idx="${i}">
        <input type="checkbox" class="rc-grab-chk" data-idx="${i}">
        <span class="rc-grab-text" title="${escAttr(l.url)}">${esc(l.text) || '(no text)'}</span>
        <span class="rc-grab-url">${esc(l.url.slice(0, 60))}</span>
      </div>
    `).join('');

    grabberPanel.innerHTML = `
      <div id="rc-grab-header">
        <h3>Batch Link Grabber <small>(${links.length} links found)</small></h3>
        <button id="rc-grab-close" class="rc-close-btn">&times;</button>
      </div>
      <div id="rc-grab-controls">
        <input type="text" id="rc-grab-filter" placeholder="Filter links…">
        <button id="rc-grab-all">Select All</button>
        <button id="rc-grab-none">Clear</button>
        <select id="rc-grab-fmt">
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
          <option value="bbcode">BBCode</option>
          <option value="plain">Plain</option>
        </select>
        <button id="rc-grab-copy">Copy Selected</button>
        <button id="rc-grab-stage">Stage Selected</button>
      </div>
      <div id="rc-grab-list">${itemsHtml || '<p class="rc-empty">No links found on this page.</p>'}</div>
    `;

    document.body.appendChild(grabberPanel);

    // ── Event wiring ──
    const filterInput = grabberPanel.querySelector('#rc-grab-filter');
    const listEl      = grabberPanel.querySelector('#rc-grab-list');

    grabberPanel.querySelector('#rc-grab-close').onclick = () => {
      grabberPanel.remove(); grabberPanel = null;
    };

    filterInput.addEventListener('input', () => {
      const q = filterInput.value.toLowerCase();
      listEl.querySelectorAll('.rc-grab-item').forEach(el => {
        const idx = parseInt(el.dataset.idx, 10);
        const l   = links[idx];
        const match = !q || l.url.toLowerCase().includes(q) || l.text.toLowerCase().includes(q);
        el.style.display = match ? '' : 'none';
      });
    });

    grabberPanel.querySelector('#rc-grab-all').onclick = () => {
      listEl.querySelectorAll('.rc-grab-chk').forEach(c => {
        if (c.closest('.rc-grab-item').style.display !== 'none') c.checked = true;
      });
    };

    grabberPanel.querySelector('#rc-grab-none').onclick = () => {
      listEl.querySelectorAll('.rc-grab-chk').forEach(c => c.checked = false);
    };

    function getSelected() {
      const fmt  = grabberPanel.querySelector('#rc-grab-fmt').value;
      const sel  = [];
      listEl.querySelectorAll('.rc-grab-chk:checked').forEach(c => {
        const l = links[parseInt(c.dataset.idx, 10)];
        sel.push(formatLink(l.url, l.text || l.url, fmt));
      });
      return { sel, fmt };
    }

    grabberPanel.querySelector('#rc-grab-copy').onclick = () => {
      const { sel, fmt } = getSelected();
      if (!sel.length) return showFloater('No links selected');
      const output = sel.join('\n');
      navigator.clipboard.writeText(output).then(() => {
        chrome.runtime.sendMessage({
          action: 'addClipboardItem',
          data: { text: output, url: window.location.href, title: document.title, format: fmt, source: 'batch-grab', type: 'links' }
        }).catch(() => {});
        showFloater(`Copied ${sel.length} links!`);
      });
    };

    grabberPanel.querySelector('#rc-grab-stage').onclick = () => {
      const { sel, fmt } = getSelected();
      if (!sel.length) return showFloater('No links selected');
      sel.forEach(text => {
        chrome.runtime.sendMessage({
          action: 'addClipboardItem',
          data: { text, url: window.location.href, title: document.title, format: fmt, source: 'batch-stage', type: 'links' }
        }).catch(() => {});
      });
      showFloater(`Staged ${sel.length} links!`);
    };
  }

  /* ================================================================
     PAGE CONTENT SCRAPER
     ================================================================ */

  function openPageScraper() {
    if (scrapeDialog) { scrapeDialog.remove(); scrapeDialog = null; }

    // Collect content
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({
      level: parseInt(h.tagName[1]),
      text:  h.textContent.trim()
    }));

    const tables = [...document.querySelectorAll('table')].map((table, ti) => {
      const rows = [...table.querySelectorAll('tr')].map(row =>
        [...row.querySelectorAll('th,td')].map(cell => cell.textContent.trim())
      );
      return { index: ti, rows, header: rows[0] || [], rowCount: rows.length };
    });

    const lists = [...document.querySelectorAll('ul,ol')].map((list, li) => ({
      index: li,
      ordered: list.tagName === 'OL',
      items: [...list.querySelectorAll(':scope > li')].map(i => i.textContent.trim())
    }));

    scrapeDialog = document.createElement('div');
    scrapeDialog.id = 'rc-scrape';

    scrapeDialog.innerHTML = `
      <div id="rc-scrape-header">
        <h3>Page Content Scraper</h3>
        <button class="rc-close-btn" id="rc-scrape-close">&times;</button>
      </div>
      <div id="rc-scrape-body">
        <div class="rc-scrape-section">
          <h4>Headings (${headings.length})</h4>
          <div class="rc-scrape-items">
            ${headings.slice(0, 30).map((h, i) => `
              <div class="rc-scrape-item">
                <input type="checkbox" class="rc-h-chk" data-i="${i}">
                <span class="rc-h-level">H${h.level}</span>
                <span>${esc(h.text)}</span>
              </div>
            `).join('') || '<p class="rc-empty">No headings found.</p>'}
          </div>
        </div>
        <div class="rc-scrape-section">
          <h4>Tables (${tables.length})</h4>
          <div class="rc-scrape-items">
            ${tables.map((t, i) => `
              <div class="rc-scrape-item">
                <input type="checkbox" class="rc-t-chk" data-i="${i}">
                <span>Table ${i + 1}: ${t.rowCount} rows &times; ${(t.header).length} cols</span>
              </div>
            `).join('') || '<p class="rc-empty">No tables found.</p>'}
          </div>
        </div>
        <div class="rc-scrape-section">
          <h4>Lists (${lists.length})</h4>
          <div class="rc-scrape-items">
            ${lists.map((l, i) => `
              <div class="rc-scrape-item">
                <input type="checkbox" class="rc-l-chk" data-i="${i}">
                <span>${l.ordered ? 'OL' : 'UL'}: ${l.items.length} items</span>
              </div>
            `).join('') || '<p class="rc-empty">No lists found.</p>'}
          </div>
        </div>
      </div>
      <div id="rc-scrape-footer">
        <select id="rc-scrape-fmt">
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
          <option value="plain">Plain</option>
        </select>
        <button id="rc-scrape-copy">Copy Selected</button>
        <button id="rc-scrape-stage">Stage Selected</button>
      </div>
    `;

    document.body.appendChild(scrapeDialog);

    // ── Event wiring ──
    scrapeDialog.querySelector('#rc-scrape-close').onclick = () => {
      scrapeDialog.remove(); scrapeDialog = null;
    };

    function getScrapedContent(fmt) {
      const parts = [];

      // Headings
      scrapeDialog.querySelectorAll('.rc-h-chk:checked').forEach(chk => {
        const h = headings[parseInt(chk.dataset.i, 10)];
        if (fmt === 'markdown') parts.push('#'.repeat(h.level) + ' ' + h.text);
        else if (fmt === 'html') parts.push(`<h${h.level}>${esc(h.text)}</h${h.level}>`);
        else parts.push(h.text);
      });

      // Tables
      scrapeDialog.querySelectorAll('.rc-t-chk:checked').forEach(chk => {
        const t = tables[parseInt(chk.dataset.i, 10)];
        if (fmt === 'markdown') {
          const header = '| ' + t.header.join(' | ') + ' |';
          const sep    = '| ' + t.header.map(() => '---').join(' | ') + ' |';
          const rows   = t.rows.slice(1).map(r => '| ' + r.join(' | ') + ' |');
          parts.push([header, sep, ...rows].join('\n'));
        } else if (fmt === 'html') {
          let html = '<table>';
          t.rows.forEach((row, ri) => {
            html += '<tr>';
            const tag = ri === 0 ? 'th' : 'td';
            row.forEach(cell => { html += `<${tag}>${esc(cell)}</${tag}>`; });
            html += '</tr>';
          });
          html += '</table>';
          parts.push(html);
        } else {
          t.rows.forEach(row => parts.push(row.join('\t')));
        }
      });

      // Lists
      scrapeDialog.querySelectorAll('.rc-l-chk:checked').forEach(chk => {
        const l = lists[parseInt(chk.dataset.i, 10)];
        if (fmt === 'markdown') {
          l.items.forEach((item, i) => {
            parts.push(l.ordered ? `${i + 1}. ${item}` : `- ${item}`);
          });
        } else if (fmt === 'html') {
          const tag = l.ordered ? 'ol' : 'ul';
          parts.push(`<${tag}>${l.items.map(i => `<li>${esc(i)}</li>`).join('')}</${tag}>`);
        } else {
          l.items.forEach(item => parts.push(`• ${item}`));
        }
      });

      return parts.join('\n\n');
    }

    scrapeDialog.querySelector('#rc-scrape-copy').onclick = () => {
      const fmt    = scrapeDialog.querySelector('#rc-scrape-fmt').value;
      const output = getScrapedContent(fmt);
      if (!output) return showFloater('Nothing selected');
      navigator.clipboard.writeText(output).then(() => {
        chrome.runtime.sendMessage({
          action: 'addClipboardItem',
          data: { text: output, url: window.location.href, title: document.title, format: fmt, source: 'scrape', type: 'content' }
        }).catch(() => {});
        showFloater('Content copied!');
      });
    };

    scrapeDialog.querySelector('#rc-scrape-stage').onclick = () => {
      const fmt    = scrapeDialog.querySelector('#rc-scrape-fmt').value;
      const output = getScrapedContent(fmt);
      if (!output) return showFloater('Nothing selected');
      chrome.runtime.sendMessage({
        action: 'addClipboardItem',
        data: { text: output, url: window.location.href, title: document.title, format: fmt, source: 'scrape-stage', type: 'content' }
      }).catch(() => {});
      showFloater('Content staged!');
    };
  }

  /* ================================================================
     KEYBOARD SHORTCUTS (page-level)
     ================================================================ */

  document.addEventListener('keydown', e => {
    // Ignore when typing in inputs
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

    // Alt+Shift+L → open link grabber
    if (e.altKey && e.shiftKey && e.key === 'L') { e.preventDefault(); openLinkGrabber(); }
    // Alt+Shift+S → open page scraper
    if (e.altKey && e.shiftKey && e.key === 'S') { e.preventDefault(); openPageScraper(); }
  });

  /* ── Listen for messages from popup/background ───────────────── */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'openLinkGrabber') { openLinkGrabber(); sendResponse({ ok: true }); }
    if (msg.action === 'openPageScraper') { openPageScraper(); sendResponse({ ok: true }); }
    if (msg.action === 'getPageLinks') {
      const anchors = [...document.querySelectorAll('a[href]')];
      const seen = new Set();
      const links = [];
      anchors.forEach(a => {
        if (!a.href || a.href.startsWith('javascript:')) return;
        const key = a.href + '|' + a.textContent.trim();
        if (seen.has(key)) return;
        seen.add(key);
        links.push({ url: a.href, text: a.textContent.trim().slice(0, 120), title: a.title || '' });
      });
      sendResponse(links);
    }
    return true;
  });

  /* ================================================================
     UTILITY: toast floater + HTML escaping
     ================================================================ */

  function showFloater(message, isError) {
    const f = document.createElement('div');
    f.id = 'rc-floater';
    f.textContent = message;
    if (isError) f.classList.add('rc-floater-error');
    document.body.appendChild(f);
    requestAnimationFrame(() => f.classList.add('rc-floater-show'));
    setTimeout(() => {
      f.classList.remove('rc-floater-show');
      setTimeout(() => f.remove(), 300);
    }, 2000);
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function escAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

})();
