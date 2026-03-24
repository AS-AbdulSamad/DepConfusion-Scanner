// ============================================================
// DepConfusion Scanner — Popup Script v2.0
// Now supports scanning ALL loaded resources from any domain
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Tab navigation
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Scan mode toggle
  document.querySelectorAll('input[name="scanMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.getElementById('manual-input-group').style.display =
        radio.value === 'manual' && radio.checked ? 'flex' : 'none';
    });
  });

  // Settings modal
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').style.display = 'flex';
    loadSettings();
  });
  document.getElementById('close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').style.display = 'none';
    saveSettings();
  });

  // Scan button
  document.getElementById('scan-btn').addEventListener('click', startScan);

  // Progress listener
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SCAN_PROGRESS') updateProgress(msg.current, msg.total, msg.package);
  });

  // Load last scan
  chrome.storage.local.get(['lastScan', 'scanHistory'], (data) => {
    if (data.lastScan) displayResults(data.lastScan);
    if (data.scanHistory) displayHistory(data.scanHistory);
  });
});


// ═══════════════════════════════════════════════════════════
//  Start Scan
// ═══════════════════════════════════════════════════════════

async function startScan() {
  const scanBtn = document.getElementById('scan-btn');
  const progressArea = document.getElementById('scan-progress');
  const resultsArea = document.getElementById('scan-results');
  const mode = document.querySelector('input[name="scanMode"]:checked').value;

  scanBtn.disabled = true;
  progressArea.style.display = 'block';
  resultsArea.innerHTML = '';
  updateProgress(0, 1, 'Initializing…');

  try {
    if (mode === 'manual') {
      await scanManual(scanBtn, progressArea);
    } else if (mode === 'loaded') {
      await scanAllLoadedResources(scanBtn, progressArea);
    } else {
      await scanPageSources(scanBtn, progressArea);
    }
  } catch (err) {
    showError('Scan failed: ' + err.message);
    scanBtn.disabled = false;
    progressArea.style.display = 'none';
  }
}

// ── Mode: Manual Input ──────────────────────────────────────

async function scanManual(scanBtn, progressArea) {
  const content = document.getElementById('manual-content').value;
  const filename = document.getElementById('manual-filename').value || 'package.json';
  if (!content.trim()) { showError('Please paste dependency file content.'); scanBtn.disabled = false; return; }

  sendToBackground('ANALYZE_CONTENT', { files: [{ path: filename, content }] }, scanBtn, progressArea);
}

// ── Mode: Page Sources Only ─────────────────────────────────

async function scanPageSources(scanBtn, progressArea) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showError('No active tab found.'); scanBtn.disabled = false; return; }

  updateProgress(0, 1, 'Extracting page sources…');

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageSources
  });

  const files = results?.[0]?.result || [];
  if (files.length === 0) {
    showError('No dependency files found on this page. Try "All Loaded Resources" mode or the GitHub integration.');
    scanBtn.disabled = false;
    progressArea.style.display = 'none';
    return;
  }

  updateProgress(0, files.length, `Analyzing ${files.length} file(s)…`);
  sendToBackground('ANALYZE_CONTENT', { files }, scanBtn, progressArea);
}

// ── Mode: ALL Loaded Resources (the new deep scan) ──────────

async function scanAllLoadedResources(scanBtn, progressArea) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showError('No active tab found.'); scanBtn.disabled = false; return; }

  updateProgress(0, 1, 'Collecting all loaded resources via Performance API…');

  // Step 1: Inject script to collect performance resource entries + page HTML
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectAllLoadedResources
  });

  const data = results?.[0]?.result;
  if (!data) {
    showError('Could not collect loaded resources. The page may block content scripts.');
    scanBtn.disabled = false;
    progressArea.style.display = 'none';
    return;
  }

  const { resources, pageContent, pageUrl } = data;

  updateProgress(0, resources.length, `Discovered ${resources.length} loaded resources. Fetching & analyzing…`);

  // Step 2: Send everything to background for deep analysis
  chrome.runtime.sendMessage(
    { type: 'ANALYZE_LOADED_RESOURCES', resources, pageContent, pageUrl },
    (response) => {
      if (chrome.runtime.lastError) {
        showError('Analysis error: ' + chrome.runtime.lastError.message);
        scanBtn.disabled = false;
        return;
      }
      progressArea.style.display = 'none';
      displayResults(response);
      saveScanToHistory(response);
      scanBtn.disabled = false;
    }
  );
}

// ═══════════════════════════════════════════════════════════
//  Injected: Collect ALL loaded resources from the page
// ═══════════════════════════════════════════════════════════

function collectAllLoadedResources() {
  const resources = [];
  const seen = new Set();

  // 1. Performance API — every resource the browser loaded
  const perfEntries = performance.getEntriesByType('resource');
  for (const entry of perfEntries) {
    if (!seen.has(entry.name)) {
      seen.add(entry.name);
      resources.push({
        url: entry.name,
        type: entry.initiatorType || 'unknown',
        size: entry.transferSize || 0,
        duration: Math.round(entry.duration),
        protocol: entry.nextHopProtocol || ''
      });
    }
  }

  // 2. All <script src> not yet in performance entries
  document.querySelectorAll('script[src]').forEach(el => {
    try {
      const url = new URL(el.src, window.location.href).href;
      if (!seen.has(url)) { seen.add(url); resources.push({ url, type: 'script', size: 0 }); }
    } catch (e) {}
  });

  // 3. All <link rel="stylesheet" href>
  document.querySelectorAll('link[rel="stylesheet"][href], link[rel="preload"][href]').forEach(el => {
    try {
      const url = new URL(el.href, window.location.href).href;
      if (!seen.has(url)) { seen.add(url); resources.push({ url, type: 'link', size: 0 }); }
    } catch (e) {}
  });

  // 4. All <link rel="modulepreload"> (ES module preloads)
  document.querySelectorAll('link[rel="modulepreload"][href]').forEach(el => {
    try {
      const url = new URL(el.href, window.location.href).href;
      if (!seen.has(url)) { seen.add(url); resources.push({ url, type: 'modulepreload', size: 0 }); }
    } catch (e) {}
  });

  // 5. All <img> with srcset — could reference SVGs
  document.querySelectorAll('img[src$=".svg"]').forEach(el => {
    try {
      const url = new URL(el.src, window.location.href).href;
      if (!seen.has(url)) { seen.add(url); resources.push({ url, type: 'svg-img', size: 0 }); }
    } catch (e) {}
  });

  // 6. All <iframe src> — discover embedded pages
  document.querySelectorAll('iframe[src]').forEach(el => {
    try {
      const url = new URL(el.src, window.location.href).href;
      if (!seen.has(url) && !url.startsWith('about:')) { seen.add(url); resources.push({ url, type: 'iframe', size: 0 }); }
    } catch (e) {}
  });

  // 7. Look for source map URLs referenced in already-loaded scripts
  document.querySelectorAll('script[src]').forEach(el => {
    // We can't read cross-origin script content from here,
    // but we can guess sourcemap URLs (convention: script.js.map)
    try {
      const url = new URL(el.src, window.location.href).href;
      const mapUrl = url + '.map';
      if (!seen.has(mapUrl)) { seen.add(mapUrl); resources.push({ url: mapUrl, type: 'sourcemap-guess', size: 0 }); }
    } catch (e) {}
  });

  // 8. CSS source maps (convention: styles.css.map)
  document.querySelectorAll('link[rel="stylesheet"][href]').forEach(el => {
    try {
      const url = new URL(el.href, window.location.href).href;
      const mapUrl = url + '.map';
      if (!seen.has(mapUrl)) { seen.add(mapUrl); resources.push({ url: mapUrl, type: 'css-sourcemap-guess', size: 0 }); }
    } catch (e) {}
  });

  // 9. Grab the full page HTML for inline analysis
  const pageContent = document.documentElement.outerHTML;
  const pageUrl = window.location.href;

  return { resources, pageContent, pageUrl };
}


// ═══════════════════════════════════════════════════════════
//  Injected: Extract page-visible sources (original mode)
// ═══════════════════════════════════════════════════════════

function extractPageSources() {
  const files = [];
  const depFilenames = [
    'package.json','package-lock.json','yarn.lock','pnpm-lock.yaml',
    'requirements.txt','setup.py','setup.cfg','Pipfile','pyproject.toml',
    'Gemfile','Gemfile.lock','Cargo.toml','Cargo.lock',
    'composer.json','composer.lock','pom.xml',
    'build.gradle','build.gradle.kts','go.mod','go.sum',
    'packages.config','Directory.Packages.props'
  ];
  const depExtensions = ['.csproj','.fsproj','.vbproj','.gemspec','.nuspec'];

  // Inline <script type="application/json"> and import maps
  document.querySelectorAll('script[type="application/json"], script[type="importmap"]').forEach((s, i) => {
    try {
      const c = s.textContent;
      if (c && c.includes('"dependencies"')) files.push({ path: `inline-script-${i}/package.json`, content: c });
    } catch (e) {}
  });

  // Code blocks on the page
  document.querySelectorAll('pre, code, .blob-code-inner, .CodeMirror-code, .monaco-editor .view-lines, .highlight, [data-lang]').forEach((block, i) => {
    const text = block.textContent || '';
    if (text.length < 20) return;
    if (text.includes('"dependencies"') || text.includes('"devDependencies"')) files.push({ path: `codeblock-${i}/package.json`, content: text });
    else if (text.includes('[dependencies]') || text.includes('[dev-dependencies]')) files.push({ path: `codeblock-${i}/Cargo.toml`, content: text });
    else if (text.match(/^\s*gem\s+['"]/m)) files.push({ path: `codeblock-${i}/Gemfile`, content: text });
    else if (text.includes('<dependencies>') && text.includes('<groupId>')) files.push({ path: `codeblock-${i}/pom.xml`, content: text });
    else if (text.match(/implementation\s+['"]/)) files.push({ path: `codeblock-${i}/build.gradle`, content: text });
    else if (text.includes('require (') || text.match(/^module\s+/m)) files.push({ path: `codeblock-${i}/go.mod`, content: text });
    else if (text.includes('"require"') && text.includes('/')) files.push({ path: `codeblock-${i}/composer.json`, content: text });
    else if (text.includes('PackageReference') && text.includes('Include=')) files.push({ path: `codeblock-${i}/project.csproj`, content: text });
    else if (text.match(/^[a-zA-Z][a-zA-Z0-9_-]+[><=!~]+/m)) files.push({ path: `codeblock-${i}/requirements.txt`, content: text });
  });

  // GitHub blob file view
  const url = window.location.href;
  if (url.includes('github.com') && url.includes('/blob/')) {
    const allCode = Array.from(document.querySelectorAll('.blob-code-inner, [data-key] .react-code-text')).map(el => el.textContent).join('\n');
    const pathMatch = url.match(/\/blob\/[^/]+\/(.+)/);
    if (pathMatch && allCode) {
      const filePath = pathMatch[1];
      const fileName = filePath.split('/').pop();
      const isDep = depFilenames.includes(fileName) || depExtensions.some(ext => fileName.endsWith(ext)) || fileName.match(/requirements.*\.txt$/i);
      if (isDep) files.push({ path: filePath, content: allCode });
    }
  }

  return files;
}


// ═══════════════════════════════════════════════════════════
//  Display Results
// ═══════════════════════════════════════════════════════════

function displayResults(response) {
  const resultsArea = document.getElementById('scan-results');
  if (!response || !response.findings) {
    resultsArea.innerHTML = '<div class="empty-state"><p>No results available.</p></div>';
    return;
  }

  const { findings, summary, resourceStats } = response;
  let html = '';

  // Resource stats bar (if present from loaded-resources mode)
  if (resourceStats) {
    html += '<div class="resource-stats-bar">';
    html += `<div class="rs-item"><span class="rs-num">${resourceStats.total || 0}</span> <span class="rs-label">resources found</span></div>`;
    html += `<div class="rs-item"><span class="rs-num">${resourceStats.fetched || 0}</span> <span class="rs-label">fetched</span></div>`;
    html += `<div class="rs-item"><span class="rs-num">${resourceStats.failed || 0}</span> <span class="rs-label">failed</span></div>`;
    html += `<div class="rs-item"><span class="rs-num">${resourceStats.skipped || 0}</span> <span class="rs-label">skipped (binary)</span></div>`;
    if (resourceStats.sourceMapsFetched) {
      html += `<div class="rs-item"><span class="rs-num">${resourceStats.sourceMapsFetched}</span> <span class="rs-label">source maps</span></div>`;
    }
    // Type breakdown chips
    if (resourceStats.byType && Object.keys(resourceStats.byType).length > 0) {
      html += '<div class="resource-type-chips" style="width:100%;">';
      const typeLabels = { js: 'JS', css: 'CSS', html: 'HTML', json: 'JSON', sourcemap: 'SourceMap', svg: 'SVG', unknown: 'Other' };
      for (const [type, count] of Object.entries(resourceStats.byType).sort((a,b) => b[1] - a[1])) {
        html += `<span class="rt-chip rt-${type}">${typeLabels[type] || type}: ${count}</span>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }

  // Summary cards
  html += '<div class="results-summary">';
  html += `<div class="stat-card stat-critical"><div class="stat-num">${summary.critical || 0}</div><div class="stat-label">Critical</div></div>`;
  html += `<div class="stat-card stat-high"><div class="stat-num">${summary.high || 0}</div><div class="stat-label">High</div></div>`;
  html += `<div class="stat-card stat-medium"><div class="stat-num">${summary.medium || 0}</div><div class="stat-label">Medium</div></div>`;
  html += `<div class="stat-card stat-safe"><div class="stat-num">${summary.total - summary.vulnerable}</div><div class="stat-label">Safe</div></div>`;
  html += '</div>';

  // Vulnerable findings
  const vulnFindings = findings.filter(f => f.vulnerable);
  if (vulnFindings.length > 0) {
    html += '<div class="section-title">⚠ Vulnerable Packages</div>';
    for (const f of vulnFindings) html += buildFindingCard(f);
  }

  // Safe findings
  const safeFindings = findings.filter(f => !f.vulnerable);
  if (safeFindings.length > 0) {
    html += `<div class="section-title" id="safe-toggle" style="cursor:pointer;">✓ Safe (${safeFindings.length}) <span style="float:right;font-size:10px;">▸</span></div>`;
    html += `<div id="safe-list" style="display:none;">`;
    for (const f of safeFindings) {
      html += `<div class="safe-pkg">
        <span class="eco-tag" style="background:${f.registryInfo?.color || '#666'};font-size:9px;">${f.registryInfo?.name || f.ecosystem}</span>
        <span>${esc(f.name)}</span>
        <span class="check">✓</span>
      </div>`;
    }
    html += '</div>';
  }

  // Export buttons
  html += '<div class="export-row">';
  html += '<button class="btn" id="export-json-btn">Export JSON</button>';
  html += '<button class="btn" id="export-csv-btn">Export CSV</button>';
  html += '</div>';

  resultsArea.innerHTML = html;

  // Bind events
  document.getElementById('export-json-btn')?.addEventListener('click', () => exportJSON(response));
  document.getElementById('export-csv-btn')?.addEventListener('click', () => exportCSV(response));
  document.getElementById('safe-toggle')?.addEventListener('click', () => {
    const list = document.getElementById('safe-list');
    const toggle = document.getElementById('safe-toggle');
    if (list.style.display === 'none') {
      list.style.display = 'block';
      toggle.querySelector('span').textContent = '▾';
    } else {
      list.style.display = 'none';
      toggle.querySelector('span').textContent = '▸';
    }
  });
}

function buildFindingCard(f) {
  // Shorten URLs for display
  const displayPath = f.filePath.length > 80 ? '…' + f.filePath.slice(-75) : f.filePath;
  return `
    <div class="finding-card severity-${f.severity}">
      <div class="finding-head">
        <span class="sev-tag ${f.severity}">${f.severity.toUpperCase()}</span>
        <span class="pkg-name">${esc(f.name)}</span>
        <span class="eco-tag" style="background:${f.registryInfo?.color || '#666'}">${f.registryInfo?.name || f.ecosystem}</span>
      </div>
      <div class="finding-body">
        <div class="detail-row"><span class="detail-label">File:</span> <code title="${esc(f.filePath)}">${esc(displayPath)}</code></div>
        <div class="detail-row"><span class="detail-label">Source:</span> <code>${esc(f.section)}</code></div>
        <div class="detail-row"><span class="detail-label">Version:</span> <code>${esc(f.version)}</code></div>
        <div class="detail-row"><span class="detail-label">Issue:</span> ${esc(f.reason)}</div>
        ${f.recommendation ? `<div class="detail-row"><span class="detail-label">Fix:</span> ${esc(f.recommendation)}</div>` : ''}
        ${f.pocRegistryUrl ? `
          <div class="poc-box">
            <div class="poc-title">POC Information</div>
            <div class="detail-row"><span class="detail-label">Register:</span> <a href="${esc(f.pocRegistryUrl)}" target="_blank">${esc(f.pocRegistryUrl)}</a></div>
            <div class="detail-row"><span class="detail-label">Publish:</span> <code>${esc(f.pocPublishCmd)}</code></div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}


// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

function sendToBackground(type, data, scanBtn, progressArea) {
  chrome.runtime.sendMessage({ type, ...data }, (response) => {
    if (chrome.runtime.lastError) {
      showError('Analysis error: ' + chrome.runtime.lastError.message);
      scanBtn.disabled = false;
      return;
    }
    progressArea.style.display = 'none';
    displayResults(response);
    saveScanToHistory(response);
    scanBtn.disabled = false;
  });
}

function updateProgress(current, total, text) {
  const fill = document.getElementById('progress-fill');
  const label = document.getElementById('progress-text');
  if (fill) fill.style.width = `${Math.round((current / Math.max(total, 1)) * 100)}%`;
  if (label) label.textContent = text || `Checking ${current}/${total}…`;
}

function showError(msg) {
  document.getElementById('scan-results').innerHTML = `<div class="empty-state" style="color:var(--danger);"><p>${esc(msg)}</p></div>`;
}

function saveScanToHistory(response) {
  chrome.storage.local.get(['scanHistory'], (data) => {
    const history = data.scanHistory || [];
    history.unshift({ timestamp: Date.now(), summary: response.summary, resourceStats: response.resourceStats, url: '', title: '' });
    chrome.storage.local.set({ scanHistory: history.slice(0, 20) });
    displayHistory(history);
  });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.storage.local.get(['scanHistory'], (data) => {
      const h = data.scanHistory || [];
      if (h[0]) { h[0].url = tabs[0].url; h[0].title = tabs[0].title; chrome.storage.local.set({ scanHistory: h }); }
    });
  });
}

function displayHistory(history) {
  const list = document.getElementById('history-list');
  const clearBtn = document.getElementById('clear-history-btn');
  if (!history || history.length === 0) {
    list.innerHTML = `<div class="empty-state"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p>No scan history yet.</p><p class="text-muted">Run your first scan to see results here.</p></div>`;
    clearBtn.style.display = 'none';
    return;
  }
  clearBtn.style.display = 'block';
  clearBtn.onclick = () => { chrome.storage.local.set({ scanHistory: [] }); displayHistory([]); };
  list.innerHTML = history.map(item => {
    const rs = item.resourceStats;
    const rsInfo = rs ? ` · ${rs.fetched || 0} resources` : '';
    return `<div class="history-item">
      <div class="history-meta">
        <span>${esc(item.title || item.url || 'Unknown')}</span>
        <span>${new Date(item.timestamp).toLocaleString()}</span>
      </div>
      <div class="history-stats">
        ${item.summary.vulnerable > 0 ? `<span class="vuln-count">⚠ ${item.summary.vulnerable} vulnerable</span>` : `<span style="color:var(--success);">✓ Clean</span>`}
        <span class="total-count">${item.summary.total} packages${rsInfo}</span>
      </div>
    </div>`;
  }).join('');
}

function loadSettings() {
  chrome.storage.local.get(['settings'], (data) => {
    const s = data.settings || {};
    document.getElementById('setting-auto-scan').checked = !!s.autoScan;
    document.getElementById('setting-skip-scoped').checked = s.skipScoped !== false;
    document.getElementById('setting-internal-heuristic').checked = s.internalHeuristic !== false;
    document.getElementById('setting-delay').value = s.delay || 200;
  });
}

function saveSettings() {
  chrome.storage.local.set({ settings: {
    autoScan: document.getElementById('setting-auto-scan').checked,
    skipScoped: document.getElementById('setting-skip-scoped').checked,
    internalHeuristic: document.getElementById('setting-internal-heuristic').checked,
    delay: parseInt(document.getElementById('setting-delay').value) || 200
  }});
}

function exportJSON(response) {
  const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `depconfusion-scan-${Date.now()}.json`);
}

function exportCSV(response) {
  let csv = 'Severity,Package,Ecosystem,File,Source,Version,Vulnerable,Reason,Registry URL,Publish Command\n';
  for (const f of response.findings) {
    csv += [f.severity, csvEsc(f.name), f.ecosystem, csvEsc(f.filePath), csvEsc(f.section), csvEsc(f.version), f.vulnerable, csvEsc(f.reason || ''), f.pocRegistryUrl || '', csvEsc(f.pocPublishCmd || '')].join(',') + '\n';
  }
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `depconfusion-scan-${Date.now()}.csv`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try { chrome.downloads.download({ url, filename }); } catch (e) {
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  }
}

function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function csvEsc(str) { if (!str) return ''; return `"${str.replace(/"/g, '""')}"`; }
