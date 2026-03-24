// ============================================================
// DepConfusion Scanner — GitHub Content Script (v3.0)
// Supports: single repos, org repo pages, user profiles,
//           user ?tab=repositories — scans ALL repos recursively
// ============================================================

(function () {
  'use strict';

  const DEPENDENCY_FILES = [
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'pyproject.toml', 'poetry.lock',
    'Gemfile', 'Gemfile.lock',
    'Cargo.toml', 'Cargo.lock',
    'composer.json', 'composer.lock',
    'pom.xml', 'build.gradle', 'build.gradle.kts',
    'go.mod', 'go.sum',
    'packages.config', 'Directory.Packages.props'
  ];

  const DEPENDENCY_EXTENSIONS = ['.csproj', '.fsproj', '.vbproj', '.gemspec', '.nuspec'];

  let scannerPanel = null;
  let isScanning = false;
  let abortScan = false;

  // ═════════════════════════════════════════════════════════
  //  URL Parsing — detect what kind of GitHub page we're on
  // ═════════════════════════════════════════════════════════

  function parseGitHubPage() {
    const path = window.location.pathname;
    const parts = path.split('/').filter(Boolean);
    const search = window.location.search;

    if (parts[0] === 'orgs' && parts.length >= 3 && parts[2] === 'repositories') {
      return { type: 'org-repos', owner: parts[1] };
    }
    if (parts[0] === 'orgs' && parts.length >= 2) {
      return { type: 'org-repos', owner: parts[1] };
    }
    if (parts.length === 0) return null;

    if (parts.length === 1 && search.includes('tab=repositories')) {
      return { type: 'user-repos', owner: parts[0] };
    }

    if (parts.length === 1) {
      const isProfile = document.querySelector(
        '[data-tab-item="repositories"], [aria-label="Repositories"], .UnderlineNav-item[href*="repositories"]'
      );
      if (isProfile) return { type: 'user-repos', owner: parts[0] };
      const isOrg = document.querySelector('.org-header, [data-hovercard-type="organization"]');
      if (isOrg) return { type: 'org-repos', owner: parts[0] };
      return null;
    }

    if (parts.length < 2) return null;

    const owner = parts[0];
    const repo = parts[1];

    const nonRepoSections = ['settings','issues','pulls','actions','projects',
      'wiki','security','pulse','graphs','network','community',
      'stargazers','watchers','forks','compare','releases','tags',
      'labels','milestones','new','invitations','import','people','repositories',
      'packages','sponsors','followers','following','stars'];
    if (parts.length > 2 && nonRepoSections.includes(parts[2])) return null;
    if (nonRepoSections.includes(repo)) {
      if (repo === 'repositories') return { type: 'user-repos', owner };
      return null;
    }

    let branch = null;
    let type = 'repo';

    if (parts[2] === 'tree' && parts.length > 3) {
      branch = parts.slice(3).join('/');
      type = 'tree';
    } else if (parts[2] === 'blob' && parts.length > 3) {
      branch = parts.slice(3).join('/');
      type = 'blob';
    }

    return { type, owner, repo, branch, fullPath: parts.slice(4).join('/') };
  }

  // ═════════════════════════════════════════════════════════
  //  GitHub API: List all repos for a user or org
  // ═════════════════════════════════════════════════════════

  async function fetchAllRepos(owner, isOrg) {
    const repos = [];
    let page = 1;
    const perPage = 100;
    const endpoint = isOrg
      ? 'https://api.github.com/orgs/' + owner + '/repos'
      : 'https://api.github.com/users/' + owner + '/repos';

    while (true) {
      try {
        const resp = await fetch(
          endpoint + '?per_page=' + perPage + '&page=' + page + '&sort=updated&type=all',
          { headers: { 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (resp.status === 403) {
          const reset = resp.headers.get('X-RateLimit-Reset');
          const resetTime = reset ? new Date(parseInt(reset) * 1000).toLocaleTimeString() : 'unknown';
          if (repos.length > 0) break;
          throw new Error('GitHub API rate limited. Try again after ' + resetTime);
        }
        if (resp.status === 404) throw new Error('User/org "' + owner + '" not found.');
        if (!resp.ok) throw new Error('GitHub API returned ' + resp.status);

        const data = await resp.json();
        if (!Array.isArray(data) || data.length === 0) break;

        for (const r of data) {
          repos.push({
            name: r.name,
            fullName: r.full_name,
            defaultBranch: r.default_branch || 'main',
            private: r.private,
            fork: r.fork,
            archived: r.archived,
            size: r.size,
            language: r.language,
            url: r.html_url
          });
        }
        if (data.length < perPage) break;
        page++;
        await new Promise(function(r) { setTimeout(r, 100); });
      } catch (e) {
        if (repos.length === 0) throw e;
        break;
      }
    }
    return repos;
  }

  function scrapeReposFromDOM() {
    const repos = [];
    const seen = new Set();
    const selectors = [
      'a[itemprop="name codeRepository"]',
      'a[data-hovercard-type="repository"]',
      'h3 a[href*="/"]',
      '.repo-list-item h3 a',
      '[data-testid="listitem-title-link"]',
      '.Box-row h3 a'
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(function(el) {
        const href = el.getAttribute('href') || '';
        const ps = href.split('/').filter(Boolean);
        if (ps.length >= 2) {
          var full = ps[0] + '/' + ps[1];
          if (!seen.has(full)) {
            seen.add(full);
            repos.push({ name: ps[1], fullName: full, defaultBranch: 'main', private: false, fork: false, archived: false, url: 'https://github.com/' + full });
          }
        }
      });
      if (repos.length > 0) break;
    }
    return repos;
  }

  // ═════════════════════════════════════════════════════════
  //  Branch Detection
  // ═════════════════════════════════════════════════════════

  async function detectDefaultBranch(owner, repo) {
    var sels = ['[data-hotkey="w"] span', '#branch-select-menu summary span',
      'button[data-testid="anchor-button"] span', '.branch-select-menu .css-truncate-target',
      '[class*="BranchName"]', 'span[data-content]'];
    for (var s = 0; s < sels.length; s++) {
      var el = document.querySelector(sels[s]);
      if (el) { var t = el.textContent.trim(); if (t && t.length < 100 && t.indexOf(' ') === -1) return t; }
    }
    var inp = document.querySelector('input[name="branch"], input[data-branch]');
    if (inp) { var v = inp.value || inp.getAttribute('data-branch'); if (v) return v; }
    var og = document.querySelector('meta[property="og:url"]');
    if (og) { var m = og.content.match(/\/tree\/([^/]+)/); if (m) return m[1]; }
    try {
      var r = await fetch('https://api.github.com/repos/' + owner + '/' + repo, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
      if (r.ok) { var d = await r.json(); if (d.default_branch) return d.default_branch; }
    } catch (e) {}
    var branches = ['main','master','develop','dev','trunk'];
    for (var b = 0; b < branches.length; b++) {
      try {
        var resp = await fetch('https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branches[b] + '/README.md', { method: 'HEAD', credentials: 'include' });
        if (resp.ok) return branches[b];
      } catch (e) {}
    }
    return 'main';
  }

  // ═════════════════════════════════════════════════════════
  //  File Discovery & Fetching
  // ═════════════════════════════════════════════════════════

  async function discoverDepFilesInRepo(owner, repo, branch) {
    var files = [];
    try {
      var resp = await fetch(
        'https://api.github.com/repos/' + owner + '/' + repo + '/git/trees/' + branch + '?recursive=1',
        { headers: { 'Accept': 'application/vnd.github.v3+json' } }
      );
      if (!resp.ok) return files;
      var data = await resp.json();
      if (!data.tree) return files;
      for (var i = 0; i < data.tree.length; i++) {
        var item = data.tree[i];
        if (item.type !== 'blob') continue;
        var name = item.path.split('/').pop();
        if (DEPENDENCY_FILES.indexOf(name) !== -1 || DEPENDENCY_EXTENSIONS.some(function(ext) { return name.endsWith(ext); }) || (name.match && name.match(/requirements.*\.txt$/i))) {
          files.push({ name: name, path: item.path, downloadUrl: 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/' + item.path });
        }
      }
    } catch (e) {}
    return files;
  }

  async function fetchFileContent(owner, repo, branch, filePath) {
    try {
      var r = await fetch('https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/' + filePath, { credentials: 'include' });
      if (r.ok) return await r.text();
    } catch (e) {}
    try {
      var r2 = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + filePath + '?ref=' + branch, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
      if (r2.ok) {
        var d = await r2.json();
        if (d.content && d.encoding === 'base64') return atob(d.content.replace(/\n/g, ''));
        if (d.download_url) { var dr = await fetch(d.download_url, { credentials: 'include' }); if (dr.ok) return await dr.text(); }
      }
    } catch (e) {}
    try {
      var r3 = await fetch('https://github.com/' + owner + '/' + repo + '/blob/' + branch + '/' + filePath, { credentials: 'include' });
      if (r3.ok) {
        var html = await r3.text();
        var m1 = html.match(/"rawLines"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
        if (m1) { try { return JSON.parse(m1[1]).join('\n'); } catch (e) {} }
        var m2 = html.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (m2) { try { var t = JSON.parse('"' + m2[1] + '"'); if (t.length > 5) return t; } catch (e) {} }
      }
    } catch (e) {}
    return null;
  }

  // ═════════════════════════════════════════════════════════
  //  UI
  // ═════════════════════════════════════════════════════════

  function createPanel(pageInfo) {
    if (scannerPanel) scannerPanel.remove();
    var isMultiRepo = pageInfo.type === 'org-repos' || pageInfo.type === 'user-repos';
    var label = isMultiRepo
      ? 'Ready to scan all repos for <b>' + escapeHtml(pageInfo.owner) + '</b>.'
      : 'Ready to scan. Click <b>Scan</b> to analyze this repository.';
    var btnLabel = isMultiRepo ? 'Scan All Repos' : 'Scan';

    var panel = document.createElement('div');
    panel.id = 'depconfusion-panel';
    panel.innerHTML = '<div class="dcs-header">' +
      '<div class="dcs-logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg><span>DepConfusion Scanner</span></div>' +
      '<div class="dcs-controls">' +
      '<button id="dcs-scan-btn" class="dcs-btn dcs-btn-scan"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> ' + btnLabel + '</button>' +
      '<button id="dcs-stop-btn" class="dcs-btn" style="display:none;background:#dc2626;border-color:#dc2626;color:#fff;">&#9632; Stop</button>' +
      '<button id="dcs-minimize-btn" class="dcs-btn-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg></button>' +
      '<button id="dcs-close-btn" class="dcs-btn-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      '</div></div>' +
      '<div class="dcs-body" id="dcs-body">' +
      '<div class="dcs-status" id="dcs-status"><span class="dcs-status-dot"></span> ' + label + '</div>' +
      '<div id="dcs-progress-area" style="display:none;">' +
      '<div style="height:4px;background:#1c2128;border-radius:2px;overflow:hidden;margin:8px 0;"><div id="dcs-progress-bar" style="height:100%;background:linear-gradient(90deg,#a78bfa,#f472b6);width:0%;transition:width 0.3s;border-radius:2px;"></div></div>' +
      '<div id="dcs-progress-text" style="font-size:11px;color:#8b949e;"></div></div>' +
      '<div id="dcs-repo-list"></div>' +
      '<div id="dcs-results"></div></div>';

    document.body.appendChild(panel);
    scannerPanel = panel;

    document.getElementById('dcs-scan-btn').addEventListener('click', function() {
      if (isMultiRepo) startMultiRepoScan(pageInfo);
      else startSingleRepoScan(pageInfo);
    });
    document.getElementById('dcs-stop-btn').addEventListener('click', function() {
      abortScan = true;
      document.getElementById('dcs-stop-btn').style.display = 'none';
    });
    document.getElementById('dcs-minimize-btn').addEventListener('click', function() { panel.classList.toggle('dcs-minimized'); });
    document.getElementById('dcs-close-btn').addEventListener('click', function() { panel.remove(); scannerPanel = null; abortScan = true; });
  }

  function createFloatingButton(pageInfo) {
    var btn = document.getElementById('dcs-float-btn');
    if (btn) return;
    btn = document.createElement('button');
    btn.id = 'dcs-float-btn';
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>';
    btn.title = 'DepConfusion Scanner';
    btn.addEventListener('click', function() {
      if (!scannerPanel) createPanel(pageInfo);
      else scannerPanel.classList.remove('dcs-minimized');
    });
    document.body.appendChild(btn);
  }

  function setStatus(dot, html) {
    var el = document.getElementById('dcs-status');
    if (el) el.innerHTML = '<span class="dcs-status-dot ' + dot + '"></span> ' + html;
  }
  function setProgress(pct, text) {
    var a = document.getElementById('dcs-progress-area');
    var b = document.getElementById('dcs-progress-bar');
    var l = document.getElementById('dcs-progress-text');
    if (a) a.style.display = 'block';
    if (b) b.style.width = pct + '%';
    if (l) l.textContent = text;
  }
  function hideProgress() { var el = document.getElementById('dcs-progress-area'); if (el) el.style.display = 'none'; }

  // ═════════════════════════════════════════════════════════
  //  Single Repo Scan
  // ═════════════════════════════════════════════════════════

  async function startSingleRepoScan(pageInfo) {
    if (isScanning) return;
    isScanning = true; abortScan = false;
    var scanBtn = document.getElementById('dcs-scan-btn');
    if (scanBtn) scanBtn.disabled = true;
    setStatus('dcs-scanning', 'Detecting default branch\u2026');
    document.getElementById('dcs-results').innerHTML = '';
    var info = Object.assign({}, pageInfo);
    var branch = info.branch;
    if (!branch || info.type === 'repo') branch = await detectDefaultBranch(info.owner, info.repo);
    if (branch && branch.indexOf('/') !== -1 && info.type !== 'repo') {
      var segs = branch.split('/');
      var resolved = null;
      for (var si = 1; si <= Math.min(segs.length, 4); si++) {
        var tryB = segs.slice(0, si).join('/');
        try { var rr = await fetch('https://api.github.com/repos/' + info.owner + '/' + info.repo + '/git/ref/heads/' + tryB, { headers: { 'Accept': 'application/vnd.github.v3+json' } }); if (rr.ok) { resolved = tryB; break; } } catch (e) {}
      }
      if (resolved) { info.fullPath = segs.slice(resolved.split('/').length).join('/'); branch = resolved; }
      else { branch = segs[0]; info.fullPath = segs.slice(1).join('/'); }
    }
    info.branch = branch;
    setStatus('dcs-scanning', 'Branch: <b>' + escapeHtml(branch) + '</b>. Discovering dep files\u2026');
    var depFiles = await discoverDepFilesInRepo(info.owner, info.repo, branch);
    if (depFiles.length === 0 && info.type === 'blob' && info.fullPath) {
      var fn = info.fullPath.split('/').pop();
      if (DEPENDENCY_FILES.indexOf(fn) !== -1 || DEPENDENCY_EXTENSIONS.some(function(ext) { return fn.endsWith(ext); })) {
        depFiles.push({ name: fn, path: info.fullPath, downloadUrl: 'https://raw.githubusercontent.com/' + info.owner + '/' + info.repo + '/' + branch + '/' + info.fullPath });
      }
    }
    if (depFiles.length === 0) { setStatus('dcs-warn', 'No dependency files found.'); isScanning = false; if (scanBtn) scanBtn.disabled = false; return; }
    setStatus('dcs-scanning', 'Found <b>' + depFiles.length + '</b> dep files. Fetching\u2026');
    setProgress(0, '0/' + depFiles.length);
    var fileContents = [];
    for (var i = 0; i < depFiles.length; i++) {
      if (abortScan) break;
      setProgress(Math.round(((i+1)/depFiles.length)*50), 'Fetching ' + (i+1) + '/' + depFiles.length + ': ' + depFiles[i].name);
      var content = await fetchFileContent(info.owner, info.repo, branch, depFiles[i].path);
      if (content) fileContents.push({ path: info.owner + '/' + info.repo + '/' + depFiles[i].path, content: content });
      await new Promise(function(r) { setTimeout(r, 50); });
    }
    if (fileContents.length === 0) { setStatus('dcs-error', 'Could not fetch any file contents.<br>Branch: ' + escapeHtml(branch) + '<br>Check browser console (F12) for details.'); hideProgress(); isScanning = false; if (scanBtn) scanBtn.disabled = false; return; }
    setStatus('dcs-scanning', 'Analyzing packages against registries\u2026');
    setProgress(50, 'Checking registries\u2026');
    chrome.runtime.sendMessage({ type: 'ANALYZE_CONTENT', files: fileContents }, function(response) {
      hideProgress();
      if (chrome.runtime.lastError) setStatus('dcs-error', 'Analysis error: ' + chrome.runtime.lastError.message);
      else displayResults(response, info);
      isScanning = false;
      if (scanBtn) scanBtn.disabled = false;
    });
  }

  // ═════════════════════════════════════════════════════════
  //  Multi-Repo Scan (scans ALL repos for user/org)
  // ═════════════════════════════════════════════════════════

  async function startMultiRepoScan(pageInfo) {
    if (isScanning) return;
    isScanning = true; abortScan = false;
    var scanBtn = document.getElementById('dcs-scan-btn');
    var stopBtn = document.getElementById('dcs-stop-btn');
    if (scanBtn) scanBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-flex';
    var repoListEl = document.getElementById('dcs-repo-list');
    var resultsEl = document.getElementById('dcs-results');
    resultsEl.innerHTML = ''; repoListEl.innerHTML = '';
    var isOrg = pageInfo.type === 'org-repos';
    var owner = pageInfo.owner;
    setStatus('dcs-scanning', 'Enumerating all repositories for <b>' + escapeHtml(owner) + '</b>\u2026');
    setProgress(0, 'Loading repo list\u2026');

    var repos = [];
    try { repos = await fetchAllRepos(owner, isOrg); } catch (e) { repos = scrapeReposFromDOM(); }
    if (repos.length === 0) { setStatus('dcs-error', 'No repositories found for <b>' + escapeHtml(owner) + '</b>.'); hideProgress(); finishMultiRepoUI(); return; }

    var activeRepos = repos.filter(function(r) { return !r.archived; });
    var skipped = repos.length - activeRepos.length;
    setStatus('dcs-scanning', 'Found <b>' + activeRepos.length + '</b> repos' + (skipped > 0 ? ' (' + skipped + ' archived skipped)' : '') + '. Starting scan\u2026');

    // Render repo list
    var listHtml = '<div style="font-size:11px;color:#8b949e;margin:8px 0 6px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;border-bottom:1px solid #30363d;padding-bottom:4px;">Repository Scan Progress</div>';
    for (var ri = 0; ri < activeRepos.length; ri++) {
      var rr = activeRepos[ri];
      listHtml += '<div class="dcs-repo-row" id="dcs-repo-' + ri + '" style="display:flex;align-items:center;gap:8px;padding:4px 6px;font-size:12px;border-bottom:1px solid rgba(48,54,61,0.3);">' +
        '<span id="dcs-repo-icon-' + ri + '" style="width:16px;text-align:center;color:#8b949e;">\u25E6</span>' +
        '<a href="' + escapeHtml(rr.url) + '" target="_blank" style="color:#58a6ff;text-decoration:none;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(rr.name) + '</a>' +
        (rr.language ? '<span style="font-size:10px;color:#8b949e;">' + escapeHtml(rr.language) + '</span>' : '') +
        (rr.fork ? '<span style="font-size:9px;background:#1c2128;border:1px solid #30363d;border-radius:3px;padding:0 4px;color:#8b949e;">fork</span>' : '') +
        '<span id="dcs-repo-status-' + ri + '" style="font-size:10px;color:#8b949e;">pending</span></div>';
    }
    repoListEl.innerHTML = listHtml;

    var allFindings = [];
    var repoSummaries = [];
    var totalPkgs = 0, totalVuln = 0;

    for (var i = 0; i < activeRepos.length; i++) {
      if (abortScan) {
        setRepoStatus(i, '\u23F9', '#fbbf24', 'stopped');
        for (var j = i + 1; j < activeRepos.length; j++) setRepoStatus(j, '\u2014', '#8b949e', 'skipped');
        break;
      }
      var repo = activeRepos[i];
      setProgress(Math.round((i / activeRepos.length) * 100), 'Scanning ' + (i+1) + '/' + activeRepos.length + ': ' + repo.name);
      setRepoStatus(i, '\u27F3', '#58a6ff', 'scanning\u2026');

      try {
        var branch = repo.defaultBranch || 'main';
        var depFiles = await discoverDepFilesInRepo(owner, repo.name, branch);
        if (depFiles.length === 0) { setRepoStatus(i, '\u2014', '#8b949e', 'no deps'); repoSummaries.push({ repo: repo.name, files: 0, packages: 0, vulnerable: 0 }); continue; }

        var fileContents = [];
        for (var fi = 0; fi < depFiles.length; fi++) {
          if (abortScan) break;
          var content = await fetchFileContent(owner, repo.name, branch, depFiles[fi].path);
          if (content) fileContents.push({ path: owner + '/' + repo.name + '/' + depFiles[fi].path, content: content });
          await new Promise(function(r) { setTimeout(r, 30); });
        }
        if (fileContents.length === 0) { setRepoStatus(i, '\u26A0', '#d29922', '0 fetched'); repoSummaries.push({ repo: repo.name, files: depFiles.length, packages: 0, vulnerable: 0, fetchFailed: true }); continue; }

        var response = await new Promise(function(resolve, reject) {
          chrome.runtime.sendMessage({ type: 'ANALYZE_CONTENT', files: fileContents }, function(resp) {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(resp);
          });
        });

        var vc = response.summary ? response.summary.vulnerable : 0;
        var tc = response.summary ? response.summary.total : 0;
        totalPkgs += tc; totalVuln += vc;

        for (var fi2 = 0; fi2 < response.findings.length; fi2++) {
          response.findings[fi2].repoName = repo.name;
          response.findings[fi2].repoUrl = repo.url;
          allFindings.push(response.findings[fi2]);
        }
        repoSummaries.push({ repo: repo.name, files: depFiles.length, packages: tc, vulnerable: vc });
        if (vc > 0) setRepoStatus(i, '\u26A0', '#f85149', vc + ' vuln / ' + tc + ' pkgs');
        else setRepoStatus(i, '\u2713', '#3fb950', tc + ' pkgs');
      } catch (e) {
        setRepoStatus(i, '\u2717', '#f85149', 'error');
        repoSummaries.push({ repo: repo.name, files: 0, packages: 0, vulnerable: 0, error: e.message });
      }
      await new Promise(function(r) { setTimeout(r, 200); });
    }

    setProgress(100, 'Scan complete');
    var partial = abortScan ? 'PARTIAL: ' : '';
    if (totalVuln > 0) setStatus('dcs-danger', partial + '<b>' + totalVuln + '</b> vulnerable package(s) across <b>' + repoSummaries.length + '</b> repos (' + totalPkgs + ' total packages).');
    else setStatus('dcs-safe', partial + 'No dependency confusion issues across <b>' + repoSummaries.length + '</b> repos (' + totalPkgs + ' packages).');

    displayMultiRepoResults(allFindings, repoSummaries, owner);
    hideProgress(); finishMultiRepoUI();
  }

  function setRepoStatus(idx, icon, color, text) {
    var ic = document.getElementById('dcs-repo-icon-' + idx);
    var st = document.getElementById('dcs-repo-status-' + idx);
    if (ic) { ic.textContent = icon; ic.style.color = color; }
    if (st) { st.textContent = text; st.style.color = color; }
  }
  function finishMultiRepoUI() {
    isScanning = false; abortScan = false;
    var sb = document.getElementById('dcs-scan-btn');
    var st = document.getElementById('dcs-stop-btn');
    if (sb) { sb.style.display = 'inline-flex'; sb.disabled = false; }
    if (st) st.style.display = 'none';
  }

  // ═════════════════════════════════════════════════════════
  //  Results Display
  // ═════════════════════════════════════════════════════════

  function displayResults(response, repoInfo) {
    var statusEl = document.getElementById('dcs-status');
    var resultsEl = document.getElementById('dcs-results');
    if (!response || !resultsEl) return;
    var findings = response.findings, summary = response.summary;
    if (summary.vulnerable > 0) statusEl.innerHTML = '<span class="dcs-status-dot dcs-danger"></span> <b>' + summary.vulnerable + '</b> vulnerable out of <b>' + summary.total + '</b>.';
    else statusEl.innerHTML = '<span class="dcs-status-dot dcs-safe"></span> No issues. <b>' + summary.total + '</b> packages analyzed.';
    resultsEl.innerHTML = buildSummaryBadges(summary) + buildFindingsHTML(findings, repoInfo);
    bindResultEvents(response, repoInfo);
  }

  function displayMultiRepoResults(allFindings, repoSummaries, owner) {
    var resultsEl = document.getElementById('dcs-results');
    if (!resultsEl) return;
    var vuln = allFindings.filter(function(f) { return f.vulnerable; });
    var summary = { total: allFindings.length, vulnerable: vuln.length, critical: vuln.filter(function(f){return f.severity==='critical';}).length, high: vuln.filter(function(f){return f.severity==='high';}).length, medium: vuln.filter(function(f){return f.severity==='medium';}).length };
    var html = buildSummaryBadges(summary);

    var vulnRepos = repoSummaries.filter(function(r) { return r.vulnerable > 0; });
    if (vulnRepos.length > 0) {
      html += '<div class="dcs-section"><div class="dcs-section-title">\u26A0 Repos with Vulnerabilities</div>';
      for (var vri = 0; vri < vulnRepos.length; vri++) {
        var vr = vulnRepos[vri];
        html += '<div style="display:flex;justify-content:space-between;padding:4px 8px;font-size:12px;background:rgba(248,81,73,0.06);border-bottom:1px solid rgba(48,54,61,0.3);">' +
          '<a href="https://github.com/' + escapeHtml(owner) + '/' + escapeHtml(vr.repo) + '" target="_blank" style="color:#58a6ff;text-decoration:none;">' + escapeHtml(vr.repo) + '</a>' +
          '<span style="color:#f85149;font-weight:600;">' + vr.vulnerable + ' vuln / ' + vr.packages + ' pkgs</span></div>';
      }
      html += '</div>';
    }
    html += buildFindingsHTML(allFindings, { owner: owner });
    html += '<div class="dcs-actions"><button class="dcs-btn dcs-btn-export" id="dcs-export-btn">Export All (JSON)</button><button class="dcs-btn dcs-btn-export" id="dcs-export-csv-btn">Export All (CSV)</button></div>';
    resultsEl.innerHTML = html;
    bindResultEvents({ findings: allFindings, summary: summary, repoSummaries: repoSummaries, owner: owner }, { owner: owner });
  }

  function buildSummaryBadges(s) {
    var h = '<div class="dcs-summary">';
    if (s.critical > 0) h += '<span class="dcs-badge dcs-badge-critical">' + s.critical + ' Critical</span>';
    if (s.high > 0) h += '<span class="dcs-badge dcs-badge-high">' + s.high + ' High</span>';
    if (s.medium > 0) h += '<span class="dcs-badge dcs-badge-medium">' + s.medium + ' Medium</span>';
    h += '<span class="dcs-badge dcs-badge-info">' + s.total + ' Total</span></div>';
    return h;
  }

  function buildFindingsHTML(findings, repoInfo) {
    var html = '';
    var vuln = findings.filter(function(f) { return f.vulnerable; });
    var safe = findings.filter(function(f) { return !f.vulnerable; });
    if (vuln.length > 0) {
      html += '<div class="dcs-section"><div class="dcs-section-title">\u26A0 Vulnerable Packages</div>';
      for (var vi = 0; vi < vuln.length; vi++) {
        var f = vuln[vi];
        html += '<div class="dcs-finding dcs-finding-' + f.severity + '">' +
          '<div class="dcs-finding-header"><span class="dcs-severity-tag dcs-severity-' + f.severity + '">' + f.severity.toUpperCase() + '</span>' +
          '<span class="dcs-pkg-name">' + escapeHtml(f.name) + '</span>' +
          '<span class="dcs-eco-tag" style="background:' + (f.registryInfo ? f.registryInfo.color : '#666') + '">' + (f.registryInfo ? f.registryInfo.name : f.ecosystem) + '</span></div>' +
          '<div class="dcs-finding-details">' +
          (f.repoName ? '<div class="dcs-detail-row"><span class="dcs-label">Repo:</span> <a href="' + escapeHtml(f.repoUrl || '#') + '" target="_blank" class="dcs-file-link">' + escapeHtml(f.repoName) + '</a></div>' : '') +
          '<div class="dcs-detail-row"><span class="dcs-label">File:</span> <code>' + escapeHtml(f.filePath) + '</code></div>' +
          '<div class="dcs-detail-row"><span class="dcs-label">Section:</span> <code>' + escapeHtml(f.section) + '</code></div>' +
          '<div class="dcs-detail-row"><span class="dcs-label">Version:</span> <code>' + escapeHtml(f.version) + '</code></div>' +
          '<div class="dcs-detail-row dcs-reason"><span class="dcs-label">Issue:</span> ' + escapeHtml(f.reason) + '</div>' +
          (f.recommendation ? '<div class="dcs-detail-row"><span class="dcs-label">Fix:</span> ' + escapeHtml(f.recommendation) + '</div>' : '') +
          (f.pocRegistryUrl ? '<div class="dcs-poc-box"><div class="dcs-poc-title">POC Information</div>' +
            '<div class="dcs-detail-row"><span class="dcs-label">Register at:</span> <a href="' + escapeHtml(f.pocRegistryUrl) + '" target="_blank">' + escapeHtml(f.pocRegistryUrl) + '</a></div>' +
            '<div class="dcs-detail-row"><span class="dcs-label">Publish:</span> <code>' + escapeHtml(f.pocPublishCmd) + '</code></div></div>' : '') +
          '</div></div>';
      }
      html += '</div>';
    }
    if (safe.length > 0) {
      html += '<div class="dcs-section"><div class="dcs-section-title dcs-collapsible" id="dcs-safe-toggle">\u2713 Safe Packages (' + safe.length + ') <span class="dcs-chevron">\u25B8</span></div>' +
        '<div class="dcs-safe-list" id="dcs-safe-list" style="display:none;">';
      for (var si = 0; si < safe.length; si++) {
        var sf = safe[si];
        html += '<div class="dcs-safe-item">' +
          (sf.repoName ? '<span style="font-size:9px;color:#8b949e;margin-right:2px;">' + escapeHtml(sf.repoName) + '/</span>' : '') +
          '<span class="dcs-eco-tag" style="background:' + (sf.registryInfo ? sf.registryInfo.color : '#666') + ';font-size:10px;">' + (sf.registryInfo ? sf.registryInfo.name : sf.ecosystem) + '</span>' +
          '<span>' + escapeHtml(sf.name) + '</span><span class="dcs-safe-check">\u2713</span></div>';
      }
      html += '</div></div>';
    }
    return html;
  }

  function bindResultEvents(response, repoInfo) {
    var toggle = document.getElementById('dcs-safe-toggle');
    if (toggle) toggle.addEventListener('click', function() {
      var list = document.getElementById('dcs-safe-list');
      var chev = toggle.querySelector('.dcs-chevron');
      if (list.style.display === 'none') { list.style.display = 'block'; chev.textContent = '\u25BE'; }
      else { list.style.display = 'none'; chev.textContent = '\u25B8'; }
    });
    var expJ = document.getElementById('dcs-export-btn');
    if (expJ) expJ.addEventListener('click', function() {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' }));
      a.download = 'depconfusion-' + (repoInfo.owner || 'scan') + '-' + Date.now() + '.json'; a.click();
    });
    var expC = document.getElementById('dcs-export-csv-btn');
    if (expC) expC.addEventListener('click', function() {
      var csv = 'Severity,Package,Ecosystem,Repo,File,Section,Version,Vulnerable,Reason,Registry URL\n';
      var fl = response.findings || [];
      for (var ci = 0; ci < fl.length; ci++) {
        var cf = fl[ci];
        csv += cf.severity + ',' + csvEscape(cf.name) + ',' + cf.ecosystem + ',' + csvEscape(cf.repoName||'') + ',' + csvEscape(cf.filePath) + ',' + csvEscape(cf.section) + ',' + csvEscape(cf.version) + ',' + cf.vulnerable + ',' + csvEscape(cf.reason||'') + ',' + (cf.pocRegistryUrl||'') + '\n';
      }
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'depconfusion-' + (repoInfo.owner || 'scan') + '-' + Date.now() + '.csv'; a.click();
    });
  }

  function escapeHtml(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }
  function csvEscape(s) { return s ? '"' + s.replace(/"/g,'""') + '"' : ''; }

  // ═════════════════════════════════════════════════════════
  //  Init
  // ═════════════════════════════════════════════════════════

  function init() {
    var info = parseGitHubPage();
    if (!info) return;
    if (info.type === 'repo' || info.type === 'tree' || info.type === 'blob' || info.type === 'org-repos' || info.type === 'user-repos') {
      createFloatingButton(info);
    }
  }

  var lastUrl = location.href;
  var observer = new MutationObserver(function() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      var existing = document.getElementById('dcs-float-btn');
      if (existing) existing.remove();
      if (scannerPanel) { scannerPanel.remove(); scannerPanel = null; }
      abortScan = true; isScanning = false;
      setTimeout(init, 500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
