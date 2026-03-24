// ============================================================
// DepConfusion Scanner — Background Service Worker
// v2.0 — Scans ALL loaded resources (JS, CSS, HTML, maps, etc.)
// ============================================================

const REGISTRIES = {
  npm: {
    name: 'npm',
    url: 'https://registry.npmjs.org/',
    registerUrl: 'https://www.npmjs.com/signup',
    publishCmd: 'npm publish',
    color: '#CB3837'
  },
  pypi: {
    name: 'PyPI',
    url: 'https://pypi.org/pypi/',
    registerUrl: 'https://pypi.org/account/register/',
    publishCmd: 'twine upload dist/*',
    color: '#3776AB'
  },
  rubygems: {
    name: 'RubyGems',
    url: 'https://rubygems.org/api/v1/gems/',
    registerUrl: 'https://rubygems.org/sign_up',
    publishCmd: 'gem push',
    color: '#CC342D'
  },
  nuget: {
    name: 'NuGet',
    url: 'https://api.nuget.org/v3-flatcontainer/',
    registerUrl: 'https://www.nuget.org/users/account/LogOn',
    publishCmd: 'dotnet nuget push',
    color: '#004880'
  },
  crates: {
    name: 'crates.io',
    url: 'https://crates.io/api/v1/crates/',
    registerUrl: 'https://crates.io/',
    publishCmd: 'cargo publish',
    color: '#E43717'
  },
  packagist: {
    name: 'Packagist',
    url: 'https://repo.packagist.org/p2/',
    registerUrl: 'https://packagist.org/register/',
    publishCmd: 'composer publish',
    color: '#F28D1A'
  },
  maven: {
    name: 'Maven Central',
    url: 'https://search.maven.org/solrsearch/select?q=a:',
    registerUrl: 'https://central.sonatype.com/',
    publishCmd: 'mvn deploy',
    color: '#C71A36'
  },
  go: {
    name: 'Go Modules',
    url: 'https://proxy.golang.org/',
    registerUrl: 'https://pkg.go.dev/',
    publishCmd: 'go publish (tag + push)',
    color: '#00ADD8'
  }
};

const DEPENDENCY_FILE_PATTERNS = {
  npm: { regex: /package\.json$|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/i },
  pypi: { regex: /requirements.*\.txt$|setup\.py$|setup\.cfg$|Pipfile$|pyproject\.toml$|poetry\.lock$/i },
  rubygems: { regex: /Gemfile$|Gemfile\.lock$|\.gemspec$/i },
  nuget: { regex: /\.csproj$|\.fsproj$|\.vbproj$|packages\.config$|\.nuspec$|Directory\.Packages\.props$/i },
  crates: { regex: /Cargo\.toml$|Cargo\.lock$/i },
  packagist: { regex: /composer\.json$|composer\.lock$/i },
  maven: { regex: /pom\.xml$|build\.gradle(\.kts)?$/i },
  go: { regex: /go\.mod$|go\.sum$/i }
};


// ═══════════════════════════════════════════════════════════
//  Deep Content Scanners — JS / CSS / HTML / JSON / SourceMap
// ═══════════════════════════════════════════════════════════

function extractImportsFromJS(content, filePath) {
  const packages = [];
  const seen = new Set();
  const builtins = new Set([
    'fs','path','os','url','http','https','crypto','stream','util','events',
    'child_process','cluster','dns','net','tls','dgram','readline','repl','vm','zlib',
    'assert','buffer','console','constants','domain','module','process','punycode',
    'querystring','string_decoder','timers','tty','v8','worker_threads','perf_hooks',
    'window','document','globalThis','self','navigator','location'
  ]);

  function add(name, section) {
    name = name.trim();
    if (!name || name.startsWith('.') || name.startsWith('/') || name.startsWith('http')) return;
    if (name.startsWith('@')) return;
    const pkgName = name.split('/')[0];
    if (!pkgName || pkgName.length < 2 || builtins.has(pkgName)) return;
    const key = pkgName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    packages.push({ name: pkgName, version: 'detected', section, ecosystem: 'npm', filePath });
  }

  let m;
  // ES imports
  const r1 = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((m = r1.exec(content)) !== null) add(m[1], 'es-import');
  // Dynamic import
  const r2 = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = r2.exec(content)) !== null) add(m[1], 'dynamic-import');
  // CommonJS require
  const r3 = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = r3.exec(content)) !== null) add(m[1], 'require');
  // AMD define
  const r4 = /define\s*\(\s*\[([^\]]+)\]/g;
  while ((m = r4.exec(content)) !== null) {
    const deps = m[1].match(/['"]([^'"]+)['"]/g);
    if (deps) deps.forEach(d => add(d.replace(/['"]/g, ''), 'amd-define'));
  }
  // Webpack chunk
  const r5 = /webpackChunkName:\s*['"]([^'"]+)['"]/g;
  while ((m = r5.exec(content)) !== null) add(m[1], 'webpack-chunk');
  // __webpack_require__
  const r6 = /__webpack_require__\s*\(\s*['"]([a-zA-Z][a-zA-Z0-9._-]+)['"]\s*\)/g;
  while ((m = r6.exec(content)) !== null) add(m[1], 'webpack-require');
  // Webpack module comments: ./node_modules/PKG
  const r7 = /\/\*!\*+!?\\\s*!?\*+\s+\.\/node_modules\/([^\s/*]+)/g;
  while ((m = r7.exec(content)) !== null) add(m[1], 'webpack-module-comment');
  // node_modules paths embedded anywhere
  const r8 = /node_modules\/(@?[a-zA-Z0-9][\w.-]*(?:\/[a-zA-Z0-9][\w.-]*)?)/g;
  while ((m = r8.exec(content)) !== null) add(m[1], 'node_modules-path');
  // Source map references
  const r9 = /\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)/g;
  while ((m = r9.exec(content)) !== null) {
    packages.push({ name: m[1], version: 'sourcemap-ref', section: 'sourceMappingURL', ecosystem: '_sourcemap', filePath, isSourceMap: true });
  }
  // CDN URLs
  const cdns = [
    /unpkg\.com\/(@?[a-zA-Z0-9][\w.-]*(?:\/[a-zA-Z0-9][\w.-]*)?)/g,
    /cdn\.jsdelivr\.net\/npm\/(@?[a-zA-Z0-9][\w.-]*(?:\/[a-zA-Z0-9][\w.-]*)?)/g,
    /cdnjs\.cloudflare\.com\/ajax\/libs\/([a-zA-Z0-9][\w.-]*)/g,
    /cdn\.skypack\.dev\/(@?[a-zA-Z0-9][\w.-]*)/g,
    /esm\.sh\/(@?[a-zA-Z0-9][\w.-]*)/g,
    /esm\.run\/(@?[a-zA-Z0-9][\w.-]*)/g,
    /ga\.jspm\.io\/npm:(@?[a-zA-Z0-9][\w.-]*)/g,
    /deno\.land\/x\/([a-zA-Z0-9][\w.-]*)/g,
  ];
  for (const pat of cdns) { while ((m = pat.exec(content)) !== null) add(m[1], 'cdn-reference'); }
  // Bower
  const r10 = /bower_components\/([a-zA-Z0-9][\w.-]*)/g;
  while ((m = r10.exec(content)) !== null) add(m[1], 'bower-component');
  // License comments
  const r11 = /@(?:license|module|package)\s+([a-zA-Z0-9][\w.-]*)/gi;
  while ((m = r11.exec(content)) !== null) add(m[1], 'license-comment');
  // Vite virtual
  const r12 = /from\s+['"]virtual:([^'"]+)['"]/g;
  while ((m = r12.exec(content)) !== null) add(m[1], 'vite-virtual');

  return packages;
}

function extractFromCSS(content, filePath) {
  const packages = [];
  const seen = new Set();
  function add(name, section) {
    name = name.trim();
    if (!name || name.startsWith('.') || name.startsWith('/') || name.startsWith('@')) return;
    const pkgName = name.split('/')[0];
    if (!pkgName || pkgName.length < 2) return;
    if (seen.has(pkgName.toLowerCase())) return;
    seen.add(pkgName.toLowerCase());
    packages.push({ name: pkgName, version: 'detected', section, ecosystem: 'npm', filePath });
  }
  let m;
  const r1 = /@import\s+['"](?:~|node_modules\/)([^'"]+)['"]/g;
  while ((m = r1.exec(content)) !== null) add(m[1], 'css-import');
  const r2 = /url\s*\(\s*['"]?(https?:\/\/[^'")\s]+)['"]?\s*\)/g;
  while ((m = r2.exec(content)) !== null) {
    const cd = m[1].match(/(?:unpkg\.com|cdn\.jsdelivr\.net\/npm|cdnjs\.cloudflare\.com\/ajax\/libs)\/(@?[a-zA-Z0-9][\w.-]*)/);
    if (cd) add(cd[1], 'css-cdn-url');
  }
  const r3 = /node_modules\/(@?[a-zA-Z0-9][\w.-]*(?:\/[a-zA-Z0-9][\w.-]*)?)/g;
  while ((m = r3.exec(content)) !== null) add(m[1], 'css-node_modules-path');
  const r4 = /\/\*[#@]\s*sourceMappingURL\s*=\s*(\S+)\s*\*\//g;
  while ((m = r4.exec(content)) !== null) {
    packages.push({ name: m[1], version: 'sourcemap-ref', section: 'css-sourceMappingURL', ecosystem: '_sourcemap', filePath, isSourceMap: true });
  }
  return packages;
}

function extractFromHTML(content, filePath) {
  const packages = [];
  const seen = new Set();
  function add(name, section) {
    name = name.trim();
    if (!name || name.startsWith('.') || name.startsWith('/') || name.startsWith('@')) return;
    const pkgName = name.split('/')[0];
    if (!pkgName || pkgName.length < 2) return;
    if (seen.has(pkgName.toLowerCase())) return;
    seen.add(pkgName.toLowerCase());
    packages.push({ name: pkgName, version: 'detected', section, ecosystem: 'npm', filePath });
  }
  let m;
  // <script src="CDN/PKG">
  const r1 = /<script[^>]+src\s*=\s*['"]([^'"]+)['"]/gi;
  while ((m = r1.exec(content)) !== null) {
    const url = m[1];
    const cd = url.match(/(?:unpkg\.com|cdn\.jsdelivr\.net\/npm|cdnjs\.cloudflare\.com\/ajax\/libs|cdn\.skypack\.dev|esm\.sh)\/(@?[a-zA-Z0-9][\w.-]*)/);
    if (cd) add(cd[1], 'html-script-cdn');
    const nm = url.match(/node_modules\/(@?[a-zA-Z0-9][\w.-]*)/);
    if (nm) add(nm[1], 'html-script-node_modules');
  }
  // <link href="CDN/PKG">
  const r2 = /<link[^>]+href\s*=\s*['"]([^'"]+)['"]/gi;
  while ((m = r2.exec(content)) !== null) {
    const cd = m[1].match(/(?:unpkg\.com|cdn\.jsdelivr\.net\/npm|cdnjs\.cloudflare\.com\/ajax\/libs)\/(@?[a-zA-Z0-9][\w.-]*)/);
    if (cd) add(cd[1], 'html-link-cdn');
  }
  // <script type="importmap">
  const r3 = /<script[^>]+type\s*=\s*['"]importmap['"][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = r3.exec(content)) !== null) {
    try {
      const map = JSON.parse(m[1]);
      if (map.imports) for (const [key, val] of Object.entries(map.imports)) {
        add(key, 'importmap');
        const cd = val.match(/(?:unpkg\.com|cdn\.jsdelivr\.net\/npm|cdnjs\.cloudflare\.com\/ajax\/libs)\/(@?[a-zA-Z0-9][\w.-]*)/);
        if (cd) add(cd[1], 'importmap-cdn');
      }
      if (map.scopes) for (const [, imports] of Object.entries(map.scopes)) {
        for (const [key] of Object.entries(imports)) add(key, 'importmap-scope');
      }
    } catch (e) {}
  }
  // data-* attributes
  const r4 = /data-(?:module|component|plugin|package|require)\s*=\s*['"]([^'"]+)['"]/gi;
  while ((m = r4.exec(content)) !== null) add(m[1], 'html-data-attr');
  // Inline scripts
  const r5 = /<script(?:\s[^>]*)?>(?!\s*<)([\s\S]*?)<\/script>/gi;
  while ((m = r5.exec(content)) !== null) {
    if (m[1].trim().length > 20) packages.push(...extractImportsFromJS(m[1], filePath + ' (inline-script)'));
  }
  // Inline styles
  const r6 = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = r6.exec(content)) !== null) {
    if (m[1].trim().length > 20) packages.push(...extractFromCSS(m[1], filePath + ' (inline-style)'));
  }
  return packages;
}

function extractFromJSON(content, filePath) {
  const packages = [];
  try {
    const json = JSON.parse(content);
    const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    for (const s of sections) {
      if (json[s]) for (const [name, ver] of Object.entries(json[s])) {
        if (name.startsWith('@')) continue;
        if (typeof ver === 'string' && (ver.startsWith('http') || ver.startsWith('git') || ver.startsWith('file:'))) continue;
        packages.push({ name, version: typeof ver === 'string' ? ver : 'unknown', section: s, ecosystem: 'npm', filePath });
      }
    }
    // Webpack stats modules
    if (json.modules && Array.isArray(json.modules)) {
      for (const mod of json.modules) {
        if (mod.name && typeof mod.name === 'string') {
          const nm = mod.name.match(/node_modules\/(@?[a-zA-Z0-9][\w.-]*)/);
          if (nm && !nm[1].startsWith('@')) packages.push({ name: nm[1], version: 'webpack-stats', section: 'webpack-module', ecosystem: 'npm', filePath });
        }
      }
    }
    // General node_modules refs in any JSON
    const str = JSON.stringify(json);
    const seen = new Set();
    const r = /node_modules\/(@?[a-zA-Z0-9][\w.-]*)/g;
    let m;
    while ((m = r.exec(str)) !== null) {
      if (!m[1].startsWith('@') && !seen.has(m[1])) { seen.add(m[1]); packages.push({ name: m[1], version: 'manifest', section: 'build-manifest', ecosystem: 'npm', filePath }); }
    }
  } catch (e) {}
  return packages;
}

function extractFromSourceMap(content, filePath) {
  const packages = [];
  try {
    const map = JSON.parse(content);
    if (map.sources && Array.isArray(map.sources)) {
      const seen = new Set();
      for (const src of map.sources) {
        const nm = src.match(/node_modules\/(@?[a-zA-Z0-9][\w.-]*(?:\/[a-zA-Z0-9][\w.-]*)?)/);
        if (nm) {
          const name = nm[1].startsWith('@') ? nm[1] : nm[1].split('/')[0];
          if (!name.startsWith('@') && !seen.has(name)) { seen.add(name); packages.push({ name, version: 'sourcemap', section: 'sourcemap-sources', ecosystem: 'npm', filePath }); }
        }
      }
    }
  } catch (e) {}
  return packages;
}

function extractFromSVG(content, filePath) {
  const packages = [];
  const r = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = r.exec(content)) !== null) {
    if (m[1].trim().length > 10) packages.push(...extractImportsFromJS(m[1], filePath + ' (svg-script)'));
  }
  return packages;
}


// ═══════════════════════════════════════════════════════════
//  File Type Router
// ═══════════════════════════════════════════════════════════

function getFileType(url, contentType) {
  const lower = (url || '').toLowerCase();
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('javascript') || ct.includes('ecmascript') || lower.match(/\.m?[jt]sx?(\?|$)/i)) return 'js';
  if (ct.includes('css') || lower.match(/\.css(\?|$)/i)) return 'css';
  if (ct.includes('html') || lower.match(/\.html?(\?|$)/i)) return 'html';
  if (ct.includes('json') || lower.match(/\.json(\?|$)/i)) return 'json';
  if (lower.match(/\.map(\?|$)/i)) return 'sourcemap';
  if (ct.includes('svg') || lower.match(/\.svg(\?|$)/i)) return 'svg';
  if (ct.includes('xml') || lower.match(/\.xml(\?|$)/i)) return 'html';
  return 'unknown';
}

function extractFromLoadedResource(content, filePath, fileType) {
  switch (fileType) {
    case 'js': return extractImportsFromJS(content, filePath);
    case 'css': return extractFromCSS(content, filePath);
    case 'html': return extractFromHTML(content, filePath);
    case 'json': return extractFromJSON(content, filePath);
    case 'sourcemap': return extractFromSourceMap(content, filePath);
    case 'svg': return extractFromSVG(content, filePath);
    case 'unknown':
      if (content.match(/\b(?:import|require|define|module\.exports)\b/)) return extractImportsFromJS(content, filePath);
      if (content.match(/<(?:html|head|body|script|link|div)\b/i)) return extractFromHTML(content, filePath);
      if (content.trim().startsWith('{') || content.trim().startsWith('[')) return extractFromJSON(content, filePath);
      return extractImportsFromJS(content, filePath);
    default: return [];
  }
}


// ═══════════════════════════════════════════════════════════
//  Original Dependency File Extractors
// ═══════════════════════════════════════════════════════════

function extractNpmPackages(content, filePath) {
  const packages = [];
  try {
    const json = JSON.parse(content);
    for (const s of ['dependencies','devDependencies','peerDependencies','optionalDependencies']) {
      if (json[s]) for (const [name, ver] of Object.entries(json[s])) {
        if (name.startsWith('@')) continue;
        if (typeof ver === 'string' && (ver.startsWith('http') || ver.startsWith('git') || ver.startsWith('file:'))) continue;
        packages.push({ name, version: typeof ver === 'string' ? ver : 'unknown', section: s, ecosystem: 'npm', filePath });
      }
    }
  } catch (e) {
    const lines = content.split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*"?([a-z0-9@][a-z0-9._-]*)(?:@|"?\s*:\s*")/i);
      if (m && m[1] && !m[1].startsWith('@')) packages.push({ name: m[1], version: 'lock', section: 'lockfile', ecosystem: 'npm', filePath });
    }
  }
  return packages;
}

function extractPypiPackages(content, filePath) {
  const packages = [];
  if (filePath.match(/requirements.*\.txt$/i)) {
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('-')) continue;
      const m = t.match(/^([A-Za-z0-9_.-]+)/);
      if (m) packages.push({ name: m[1], version: t.replace(m[1], '').trim() || 'any', section: 'requirements', ecosystem: 'pypi', filePath });
    }
  } else if (filePath.match(/setup\.(py|cfg)$/i)) {
    for (const m of content.matchAll(/['"]([A-Za-z0-9_.-]+)(?:[><=!~]+[^'"]*)?['"]/g)) {
      if (m[1].length > 1 && !['python','setuptools','wheel'].includes(m[1].toLowerCase()))
        packages.push({ name: m[1], version: 'any', section: 'setup', ecosystem: 'pypi', filePath });
    }
  } else if (filePath.match(/pyproject\.toml$|Pipfile$/i)) {
    for (const m of content.matchAll(/(?:^|\n)\s*([A-Za-z0-9_.-]+)\s*[=><]/gm)) {
      if (!['python','name','version','description','readme','license','requires-python','build-backend'].includes(m[1].toLowerCase()))
        packages.push({ name: m[1], version: 'any', section: 'toml/pipfile', ecosystem: 'pypi', filePath });
    }
  }
  return packages;
}

function extractRubyPackages(content, filePath) {
  const packages = [];
  let m; const r = /gem\s+['"]([a-zA-Z0-9_-]+)['"]/g;
  while ((m = r.exec(content)) !== null) packages.push({ name: m[1], version: 'any', section: 'gemfile', ecosystem: 'rubygems', filePath });
  return packages;
}

function extractNugetPackages(content, filePath) {
  const packages = [];
  let m;
  const r1 = /PackageReference\s+Include\s*=\s*"([^"]+)"(?:\s+Version\s*=\s*"([^"]+)")?/gi;
  while ((m = r1.exec(content)) !== null) packages.push({ name: m[1], version: m[2] || 'any', section: 'PackageReference', ecosystem: 'nuget', filePath });
  const r2 = /package\s+id\s*=\s*"([^"]+)"(?:\s+version\s*=\s*"([^"]+)")?/gi;
  while ((m = r2.exec(content)) !== null) packages.push({ name: m[1], version: m[2] || 'any', section: 'packages.config', ecosystem: 'nuget', filePath });
  return packages;
}

function extractCargoPackages(content, filePath) {
  const packages = [];
  for (const regex of [/\[dependencies\]([\s\S]*?)(?:\[|$)/, /\[dev-dependencies\]([\s\S]*?)(?:\[|$)/, /\[build-dependencies\]([\s\S]*?)(?:\[|$)/]) {
    const section = content.match(regex);
    if (section) for (const line of section[1].split('\n')) {
      const m = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
      if (m) packages.push({ name: m[1], version: 'any', section: 'Cargo.toml', ecosystem: 'crates', filePath });
    }
  }
  return packages;
}

function extractComposerPackages(content, filePath) {
  const packages = [];
  try {
    const json = JSON.parse(content);
    for (const s of ['require','require-dev']) if (json[s]) for (const [name, ver] of Object.entries(json[s])) {
      if (name.includes('/') || name === 'php') continue;
      packages.push({ name, version: ver, section: s, ecosystem: 'packagist', filePath });
    }
  } catch (e) {}
  return packages;
}

function extractMavenPackages(content, filePath) {
  const packages = [];
  let m;
  const r1 = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]+)<\/version>)?/g;
  while ((m = r1.exec(content)) !== null) packages.push({ name: `${m[1]}:${m[2]}`, version: m[3] || 'any', section: 'maven', ecosystem: 'maven', filePath });
  const r2 = /(?:implementation|api|compile|testImplementation|runtimeOnly)\s+['"]([^:'"]+):([^:'"]+)(?::([^'"]+))?['"]/g;
  while ((m = r2.exec(content)) !== null) packages.push({ name: `${m[1]}:${m[2]}`, version: m[3] || 'any', section: 'gradle', ecosystem: 'maven', filePath });
  return packages;
}

function extractGoPackages(content, filePath) {
  const packages = [];
  if (!filePath.match(/go\.mod$/i)) return packages;
  let inReq = false;
  for (const line of content.split('\n')) {
    if (line.trim() === 'require (') { inReq = true; continue; }
    if (line.trim() === ')') { inReq = false; continue; }
    if (inReq || line.trim().startsWith('require ')) {
      const m = line.trim().match(/^(?:require\s+)?([^\s]+)\s+([^\s]+)/);
      if (m) packages.push({ name: m[1], version: m[2], section: 'go.mod', ecosystem: 'go', filePath });
    }
  }
  return packages;
}

const EXTRACTORS = { npm: extractNpmPackages, pypi: extractPypiPackages, rubygems: extractRubyPackages, nuget: extractNugetPackages, crates: extractCargoPackages, packagist: extractComposerPackages, maven: extractMavenPackages, go: extractGoPackages };


// ═══════════════════════════════════════════════════════════
//  Registry Checkers
// ═══════════════════════════════════════════════════════════

async function checkNpmRegistry(n) {
  try {
    const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(n)}`);
    if (r.status === 404) return { exists: false, claimable: true };
    if (r.ok) { const d = await r.json(); return { exists: true, claimable: false, latestVersion: d['dist-tags']?.latest, maintainers: d.maintainers?.length || 0 }; }
    return { exists: false, claimable: true };
  } catch { return { exists: null, claimable: null, error: 'Network error' }; }
}
async function checkPypiRegistry(n) {
  try { const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(n)}/json`); return r.status === 404 ? { exists: false, claimable: true } : r.ok ? { exists: true, claimable: false } : { exists: false, claimable: true }; } catch { return { exists: null, claimable: null, error: 'Network error' }; }
}
async function checkRubyGemsRegistry(n) {
  try { const r = await fetch(`https://rubygems.org/api/v1/gems/${encodeURIComponent(n)}.json`); return r.status === 404 ? { exists: false, claimable: true } : r.ok ? { exists: true, claimable: false } : { exists: false, claimable: true }; } catch { return { exists: null, claimable: null, error: 'Network error' }; }
}
async function checkNugetRegistry(n) {
  try { const r = await fetch(`https://api.nuget.org/v3-flatcontainer/${encodeURIComponent(n.toLowerCase())}/index.json`); return r.status === 404 ? { exists: false, claimable: true } : r.ok ? { exists: true, claimable: false } : { exists: false, claimable: true }; } catch { return { exists: null, claimable: null, error: 'Network error' }; }
}
async function checkCratesRegistry(n) {
  try { const r = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(n)}`); return r.status === 404 ? { exists: false, claimable: true } : r.ok ? { exists: true, claimable: false } : { exists: false, claimable: true }; } catch { return { exists: null, claimable: null, error: 'Network error' }; }
}
async function genericRegistryCheck(n, eco) { return { exists: null, claimable: null, error: `Registry check not implemented for ${eco}` }; }

const REGISTRY_CHECKERS = { npm: checkNpmRegistry, pypi: checkPypiRegistry, rubygems: checkRubyGemsRegistry, nuget: checkNugetRegistry, crates: checkCratesRegistry, packagist: n => genericRegistryCheck(n,'packagist'), maven: n => genericRegistryCheck(n,'maven'), go: n => genericRegistryCheck(n,'go') };


// ═══════════════════════════════════════════════════════════
//  Analysis Engine
// ═══════════════════════════════════════════════════════════

function isLikelyScopedOrPrivate(name) {
  if (name.startsWith('@')) return true;
  return [/^internal[-_]/i,/[-_]internal$/i,/^private[-_]/i,/[-_]private$/i,/^corp[-_]/i,/[-_]corp$/i,/^company[-_]/i,/^my[-_]/i,/^local[-_]/i,/^custom[-_]/i,/^org[-_]/i,/^enterprise[-_]/i,/^proprietary[-_]/i].some(p => p.test(name));
}

async function analyzePackages(packages, onProgress) {
  const results = [];
  const checked = new Set();
  let idx = 0;
  const realPackages = packages.filter(p => p.ecosystem !== '_sourcemap');

  for (const pkg of realPackages) {
    const key = `${pkg.ecosystem}:${pkg.name}`;
    if (checked.has(key)) continue;
    checked.add(key);
    idx++;
    if (onProgress) onProgress({ current: idx, total: realPackages.length, package: pkg.name });

    const checker = REGISTRY_CHECKERS[pkg.ecosystem];
    if (!checker) continue;

    const rr = await checker(pkg.name);
    const isInternal = isLikelyScopedOrPrivate(pkg.name);
    const ri = REGISTRIES[pkg.ecosystem];
    const finding = { ...pkg, registryResult: rr, isLikelyInternal: isInternal, vulnerable: false, severity: 'info', registryInfo: ri };

    if (rr.claimable === true) {
      finding.vulnerable = true;
      finding.severity = isInternal ? 'critical' : 'high';
      finding.reason = `Package "${pkg.name}" does NOT exist on ${ri.name}. An attacker could register it to perform dependency confusion.`;
      finding.recommendation = `Register "${pkg.name}" on ${ri.name} as a placeholder or use scoped packages / namespaces.`;
      finding.pocRegistryUrl = ri.registerUrl;
      finding.pocPublishCmd = ri.publishCmd;
    } else if (rr.exists === true && isInternal) {
      finding.vulnerable = true;
      finding.severity = 'medium';
      finding.reason = `Package "${pkg.name}" looks like an internal name but EXISTS on ${ri.name}. Verify it's the legitimate package and not a squatted name.`;
      finding.recommendation = `Confirm ownership on ${ri.name}. Pin exact versions. Use scoped packages.`;
    } else if (rr.exists === true) {
      finding.severity = 'info';
      finding.reason = `Package "${pkg.name}" exists on ${ri.name}. Appears to be a public package.`;
    }
    results.push(finding);
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}


// ═══════════════════════════════════════════════════════════
//  Message Handlers
// ═══════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_CONTENT') { handleAnalyzeContent(message, sender, sendResponse); return true; }
  if (message.type === 'ANALYZE_LOADED_RESOURCES') { handleAnalyzeLoadedResources(message, sender, sendResponse); return true; }
  if (message.type === 'ANALYZE_GITHUB') { handleAnalyzeGitHub(message, sender, sendResponse); return true; }
  if (message.type === 'GET_STATUS') { sendResponse({ status: 'ready' }); return false; }
});

async function handleAnalyzeContent(message, sender, sendResponse) {
  const { files } = message;
  const allPackages = [];
  for (const file of files) {
    let matched = false;
    for (const [eco, patterns] of Object.entries(DEPENDENCY_FILE_PATTERNS)) {
      if (patterns.regex.test(file.path)) {
        const ext = EXTRACTORS[eco];
        if (ext) { allPackages.push(...ext(file.content, file.path)); matched = true; }
      }
    }
    if (!matched && file.content) {
      allPackages.push(...extractFromLoadedResource(file.content, file.path, getFileType(file.path, '')));
    }
  }
  if (allPackages.length === 0) { sendResponse({ findings: [], summary: { total: 0, vulnerable: 0 }, loadedResources: { total: files.length, scanned: files.length } }); return; }
  const findings = await analyzePackages(allPackages, p => { chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', ...p }).catch(() => {}); });
  const vf = findings.filter(f => f.vulnerable);
  const result = { findings, summary: { total: findings.length, vulnerable: vf.length, critical: vf.filter(f => f.severity==='critical').length, high: vf.filter(f => f.severity==='high').length, medium: vf.filter(f => f.severity==='medium').length, ecosystems: [...new Set(findings.map(f => f.ecosystem))] }, loadedResources: { total: files.length, scanned: files.length } };
  chrome.storage.local.set({ lastScan: result, lastScanTime: Date.now() });
  sendResponse(result);
}

async function handleAnalyzeLoadedResources(message, sender, sendResponse) {
  const { resources, pageContent, pageUrl } = message;
  const allPackages = [];
  const resourceStats = { total: 0, fetched: 0, failed: 0, skipped: 0, sourceMapsFetched: 0, byType: {} };

  // 1. Analyze page HTML
  if (pageContent) allPackages.push(...extractFromHTML(pageContent, pageUrl || 'page.html'));

  // 2. Filter fetchable resources
  const fetchable = (resources || []).filter(r => {
    const url = r.url || '';
    if (url.match(/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|otf|mp4|webm|mp3|ogg|wav|avif|bmp|tiff?)(\?|#|$)/i) && !url.match(/\.svg(\?|#|$)/i)) { resourceStats.skipped++; return false; }
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('chrome-extension:') || url.startsWith('moz-extension:')) { resourceStats.skipped++; return false; }
    return true;
  });
  resourceStats.total = fetchable.length;

  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', current: 0, total: resourceStats.total, package: 'Fetching loaded resources…' }).catch(() => {});

  // 3. Fetch all in batches of 6
  for (let i = 0; i < fetchable.length; i += 6) {
    const batch = fetchable.slice(i, i + 6);
    const results = await Promise.allSettled(batch.map(async (res) => {
      try {
        const resp = await fetch(res.url, { credentials: 'omit', cache: 'force-cache', signal: AbortSignal.timeout(10000) });
        if (!resp.ok) { resourceStats.failed++; return []; }
        const ct = resp.headers.get('content-type') || '';
        if (ct.match(/image|font|audio|video|octet-stream|application\/pdf/i) && !ct.includes('svg')) { resourceStats.skipped++; return []; }
        const text = await resp.text();
        if (!text || text.length < 10) { resourceStats.skipped++; return []; }
        resourceStats.fetched++;
        const ft = getFileType(res.url, ct);
        resourceStats.byType[ft] = (resourceStats.byType[ft] || 0) + 1;
        const pkgs = extractFromLoadedResource(text, res.url, ft);
        // Also check if resource is a known dependency file
        const fn = res.url.split('/').pop().split('?')[0];
        for (const [eco, pat] of Object.entries(DEPENDENCY_FILE_PATTERNS)) {
          if (pat.regex.test(fn)) { const ex = EXTRACTORS[eco]; if (ex) pkgs.push(...ex(text, res.url)); }
        }
        // Follow source maps
        const smRefs = pkgs.filter(p => p.ecosystem === '_sourcemap' && p.isSourceMap);
        for (const sm of smRefs) {
          try {
            let smUrl = sm.name;
            if (!smUrl.startsWith('http')) { smUrl = res.url.substring(0, res.url.lastIndexOf('/') + 1) + smUrl; }
            if (smUrl.startsWith('data:')) continue;
            const smResp = await fetch(smUrl, { credentials: 'omit', cache: 'force-cache', signal: AbortSignal.timeout(8000) });
            if (smResp.ok) { const smText = await smResp.text(); pkgs.push(...extractFromSourceMap(smText, smUrl)); resourceStats.sourceMapsFetched++; }
          } catch (e) {}
        }
        return pkgs.filter(p => p.ecosystem !== '_sourcemap');
      } catch (e) { resourceStats.failed++; return []; }
    }));

    for (const r of results) { if (r.status === 'fulfilled' && r.value.length > 0) allPackages.push(...r.value); }
    chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', current: Math.min(i + 6, fetchable.length), total: resourceStats.total, package: `Fetched ${resourceStats.fetched}/${resourceStats.total} resources…` }).catch(() => {});
    await new Promise(r => setTimeout(r, 50));
  }

  if (allPackages.length === 0) { sendResponse({ findings: [], summary: { total: 0, vulnerable: 0 }, resourceStats }); return; }

  // Deduplicate
  const deduped = []; const seen = new Set();
  for (const pkg of allPackages) { const key = `${pkg.ecosystem}:${pkg.name}`; if (!seen.has(key)) { seen.add(key); deduped.push(pkg); } }

  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', current: 0, total: deduped.length, package: `Checking ${deduped.length} unique packages against registries…` }).catch(() => {});

  const findings = await analyzePackages(deduped, p => { chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', ...p }).catch(() => {}); });
  const vf = findings.filter(f => f.vulnerable);
  const result = { findings, summary: { total: findings.length, vulnerable: vf.length, critical: vf.filter(f => f.severity==='critical').length, high: vf.filter(f => f.severity==='high').length, medium: vf.filter(f => f.severity==='medium').length, ecosystems: [...new Set(findings.map(f => f.ecosystem))] }, resourceStats };
  chrome.storage.local.set({ lastScan: result, lastScanTime: Date.now() });
  sendResponse(result);
}

async function handleAnalyzeGitHub(message, sender, sendResponse) {
  const { files } = message;
  const fileContents = [];
  for (const file of files) {
    if (!file.downloadUrl) continue;
    try { const r = await fetch(file.downloadUrl); if (r.ok) fileContents.push({ path: file.path, content: await r.text() }); } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  handleAnalyzeContent({ files: fileContents }, sender, sendResponse);
}


// ═══════════════════════════════════════════════════════════
//  Badge Management
// ═══════════════════════════════════════════════════════════

function updateBadge(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastScan?.newValue?.summary) updateBadge(changes.lastScan.newValue.summary.vulnerable);
});
