<h1 align="center">DepConfusion Scanner</h1>

<p align="center">
  <b>Browser Extension for Detecting Dependency Confusion Vulnerabilities</b><br>
  <sub>Chrome &amp; Firefox &bull; 8 Ecosystems &bull; GitHub Deep Integration &bull; All Loaded Resources Scan</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/manifest-v3-blue" alt="Manifest V3"/>
  <img src="https://img.shields.io/badge/chrome-supported-green" alt="Chrome"/>
  <img src="https://img.shields.io/badge/firefox-supported-orange" alt="Firefox"/>
  <img src="https://img.shields.io/badge/ecosystems-8-purple" alt="8 Ecosystems"/>
  <img src="https://img.shields.io/badge/license-MIT-brightgreen" alt="MIT License"/>
</p>

---

## What is Dependency Confusion?

Dependency confusion (also called **namespace confusion** or **substitution attack**) exploits how package managers resolve dependencies. When a project references an **internal/private package name** that doesn't exist on the **public registry**, an attacker can register that name on the public registry with a higher version number. The package manager may then pull the attacker's malicious package instead of the intended internal one.

**This attack has affected major companies** including Apple, Microsoft, PayPal, Shopify, Netflix, Tesla, and Uber — as disclosed by security researcher Alex Birsan in 2021.

This extension scans for packages referenced in manifests and source code that **do not exist on public registries** — meaning they are **claimable** and represent real attack surface. For each vulnerable package, it provides the **exact file location**, **registry to register on**, and the **publish command** needed for a proof-of-concept.

---

## Features

### 🔍 Three Scan Modes

| Mode | Description |
|------|-------------|
| **All Loaded Resources** | Fetches & analyzes every JS, CSS, HTML, JSON, SVG, and source map loaded by any page — including third-party CDNs and cross-origin assets |
| **Page Source Only** | Analyzes visible code blocks, inline scripts, import maps, and `<script>` tags on the current page |
| **Manual Input** | Paste any dependency file content (package.json, requirements.txt, etc.) for direct analysis |

### 🌐 8 Package Ecosystem Support

| Ecosystem | Files Detected | Registry Checked | Registry Check |
|-----------|---------------|-----------------|----------------|
| **npm** | `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | registry.npmjs.org | ✅ Full |
| **PyPI** | `requirements.txt`, `setup.py`, `setup.cfg`, `Pipfile`, `pyproject.toml`, `poetry.lock` | pypi.org | ✅ Full |
| **RubyGems** | `Gemfile`, `Gemfile.lock`, `*.gemspec` | rubygems.org | ✅ Full |
| **NuGet** | `*.csproj`, `*.fsproj`, `*.vbproj`, `packages.config`, `*.nuspec`, `Directory.Packages.props` | api.nuget.org | ✅ Full |
| **crates.io** | `Cargo.toml`, `Cargo.lock` | crates.io | ✅ Full |
| **Packagist** | `composer.json`, `composer.lock` | packagist.org | ⚠️ Basic |
| **Maven** | `pom.xml`, `build.gradle`, `build.gradle.kts` | search.maven.org | ⚠️ Basic |
| **Go Modules** | `go.mod`, `go.sum` | proxy.golang.org | ⚠️ Basic |

### 🐙 GitHub Deep Integration

| Page Type | What Happens |
|-----------|-------------|
| `github.com/user/repo` | Single repo scan — discovers all dep files recursively via tree API |
| `github.com/user/repo/blob/branch/path` | Single file + full repo scan |
| `github.com/orgs/orgname/repositories` | **Scans ALL repositories** under the organization |
| `github.com/orgs/orgname` | Same — detects org page, enumerates and scans all repos |
| `github.com/username?tab=repositories` | **Scans ALL repositories** for that user |
| `github.com/username` | Detects user profile, scans all repos |

**Multi-repo scan features:**
- Enumerates all repos via GitHub API with full pagination (100/page)
- Live progress list showing per-repo status (pending → scanning → ✓/⚠)
- Stop button to abort mid-scan while keeping already-scanned results
- Aggregated results with "Repos with Vulnerabilities" breakdown
- Skips archived repositories automatically
- Falls back to DOM scraping if API is rate-limited
- Exports single JSON/CSV covering all repos

### 🕵️ Deep Resource Analysis Engine

When scanning loaded resources, the extension analyzes every file type with specialized extractors:

| File Type | What It Extracts |
|-----------|-----------------|
| **JavaScript** | ES `import`, CommonJS `require()`, AMD `define()`, dynamic `import()`, `__webpack_require__`, webpack module comments, `node_modules/` paths, CDN refs (unpkg, jsdelivr, cdnjs, skypack, esm.sh, esm.run, jspm, deno.land), bower components, license/banner comments, vite virtual modules |
| **CSS** | `@import ~pkg` (node_modules), CDN `url()` refs, `node_modules/` paths in comments, source map refs |
| **HTML** | `<script src>` CDN refs, `<link href>` CDN refs, `<script type="importmap">` full parsing, `data-module/component/plugin` attributes, then delegates inline `<script>` → JS parser, inline `<style>` → CSS parser |
| **JSON** | `package.json` dependencies, webpack stats modules, build manifests with `node_modules/` refs, vite manifests |
| **Source Maps** | Parses `.sources[]` array to extract every `node_modules/` package reference |
| **SVG** | Extracts embedded `<script>` blocks → delegates to JS parser |

**Source map following**: If a JS/CSS file references a `.map` file, the extension fetches and parses it to discover the complete dependency tree from the original source.

### 📊 Vulnerability Intelligence

For each finding, the extension reports:

- **Severity** — Critical / High / Medium / Info
- **Exact file path** — Full path to the file where the dependency is declared
- **Repo name** — Which repository (in multi-repo scans)
- **Package name** — The exact package identifier
- **Version constraint** — The version or range specified
- **Manifest section** — Which section (dependencies, devDependencies, require, etc.)
- **Detection source** — How it was found (es-import, require, cdn-reference, sourcemap, etc.)
- **Registry status** — Exists / does not exist / claimable / network error
- **POC registration URL** — Direct signup link to the registry (npmjs.com/signup, pypi.org/account/register, etc.)
- **Publish command** — The exact command to claim the name (`npm publish`, `twine upload dist/*`, etc.)
- **Fix recommendation** — How to remediate (register placeholder, use scoped packages, pin versions)

---

## Installation

### Chrome

1. Download or clone this repository
2. Open `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `depconfusion-scanner` folder
6. The shield icon appears in your toolbar

### Firefox

#### Temporary (for testing)
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from the `depconfusion-scanner` folder

#### Permanent (requires signing)
1. Package: `cd depconfusion-scanner && zip -r ../depconfusion.zip .`
2. Submit to [addons.mozilla.org](https://addons.mozilla.org/) for signing
3. Install the signed `.xpi`

---

## Usage

### 1. Scan Any Web Page (All Loaded Resources)

This is the most powerful mode — it fetches and analyzes **every resource** the browser loaded.

1. Navigate to any web application
2. Click the extension icon in the toolbar
3. **"All Loaded Resources"** is selected by default
4. Click **Start Deep Scan**
5. The extension will:
   - Collect every resource via `performance.getEntriesByType('resource')`
   - Also discover `<script src>`, `<link href>`, `<link rel="modulepreload">`, iframes
   - Guess source map URLs (appending `.map` to JS/CSS files)
   - Fetch each resource in batches of 6 (skipping binary files)
   - Deep-parse every file type with specialized extractors
   - Follow source maps to discover all original source dependencies
   - Deduplicate packages across all files
   - Check each unique package against its public registry
   - Display results with full details and POC information

### 2. Scan a Single GitHub Repository

1. Navigate to any GitHub repository (e.g., `https://github.com/user/repo`)
2. Click the **purple shield button** (bottom-right corner)
3. Click **Scan** in the panel
4. The scanner auto-detects the default branch, discovers all dependency files recursively, fetches their contents, and analyzes every package

### 3. Scan ALL Repos for a User or Organization

1. Navigate to any of these pages:
   - `https://github.com/orgs/example/repositories`
   - `https://github.com/orgs/example`
   - `https://github.com/username?tab=repositories`
   - `https://github.com/username`
2. Click the **purple shield button** (bottom-right corner)
3. Click **Scan All Repos**
4. Watch the live progress as each repo is scanned
5. Use the **Stop** button if needed — results are preserved
6. Review the aggregated report and export as JSON/CSV

### 4. Manual Input

1. Click the extension icon
2. Select **"Manual Input"** mode
3. Paste your manifest content
4. Set the filename (e.g., `package.json`, `requirements.txt`, `Cargo.toml`)
5. Click **Start Deep Scan**

---

## How Severity is Determined

| Severity | Condition | Risk |
|----------|-----------|------|
| **CRITICAL** | Package does NOT exist on public registry AND has an internal-looking name (`company-utils`, `internal-auth`, `corp-logger`, `private-api`, `enterprise-core`) | Very high — clearly a private package name an attacker could claim |
| **HIGH** | Package does NOT exist on public registry (claimable by anyone) | High — could be a private package or a typo; either way it's claimable |
| **MEDIUM** | Package EXISTS on registry but has an internal-looking name | Moderate — could be a squatted name; verify ownership |
| **INFO** | Package exists on public registry, appears to be a legitimate public package | Low — normal public dependency |

**Internal name detection heuristics:**
Packages matching patterns like `internal-*`, `*-internal`, `private-*`, `*-private`, `corp-*`, `*-corp`, `company-*`, `my-*`, `local-*`, `custom-*`, `org-*`, `enterprise-*`, `proprietary-*`.

---

## Settings

Access via the gear icon in the popup:

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-scan GitHub repos | Off | Automatically start scanning when you open a repo page |
| Skip scoped packages | On | Ignore `@org/package` style names (they're namespace-protected) |
| Internal name heuristic | On | Flag packages with names matching internal naming patterns |
| Request delay | 200ms | Delay between registry API calls to avoid rate limiting |

---

## File Structure

```
depconfusion-scanner/
├── manifest.json              # Extension manifest (MV3, Chrome + Firefox)
├── background.js              # Service worker: extractors, registry checkers, analysis engine
├── popup.html                 # Extension popup UI
├── popup.css                  # Popup styles
├── popup.js                   # Popup logic + injected content scripts
├── README.md                  # This file
├── LICENSE                    # MIT License
├── icons/
│   ├── icon16.png             # Toolbar icon
│   ├── icon48.png             # Extension page icon
│   └── icon128.png            # Chrome Web Store icon
└── lib/
    ├── github-analyzer.js     # GitHub content script (auto-injected on github.com)
    └── github-overlay.css     # GitHub overlay panel styles
```

---

## Known Limitations

### GitHub API Rate Limits

| Situation | Rate Limit | Impact |
|-----------|-----------|--------|
| Unauthenticated API calls | 60 requests/hour | Limits repos/files you can scan per hour |
| Org with 50+ repos | ~3 API calls per repo (info + tree + contents) | May hit the 60/hour limit mid-scan |
| Very large repos (10k+ files) | 1 tree request may return truncated results | Some dependency files may be missed |

**Workaround**: The extension uses your browser session cookies for `raw.githubusercontent.com` fetches (which are not rate-limited in the same way). The API rate limit primarily affects the tree discovery step. If rate-limited, the extension falls back to DOM scraping where possible.

**Note**: GitHub does not currently expose an authenticated API via browser extensions without a Personal Access Token. A future version could add PAT support in settings for higher rate limits.

### Registry Checker Limitations

| Registry | Status | Limitation |
|----------|--------|-----------|
| npm | ✅ Full | Fully supported — checks existence and returns maintainer count |
| PyPI | ✅ Full | Fully supported |
| RubyGems | ✅ Full | Fully supported |
| NuGet | ✅ Full | Fully supported |
| crates.io | ✅ Full | Fully supported |
| Packagist | ⚠️ Stub | Registry check returns "not implemented" — packages are extracted but not verified against packagist.org |
| Maven Central | ⚠️ Stub | Registry check returns "not implemented" — packages are extracted but not verified against Maven Central |
| Go Modules | ⚠️ Stub | Registry check returns "not implemented" — Go module paths are URLs, not registry names, so the concept of "claiming" is different |

**Why these 3 are stubs**: Packagist uses vendor/package namespacing (like `laravel/framework`) which makes dependency confusion less likely. Maven uses groupId:artifactId which is also namespaced. Go modules use full URL paths (`github.com/user/pkg`) making confusion impractical. These ecosystems are still parsed and extracted — the registry availability check just isn't implemented.

### Parsing & Extraction Limitations

- **Lock files can produce noise**: `yarn.lock` and `package-lock.json` contain hundreds of transitive dependencies. The extension deduplicates them, but results may include many packages you don't directly control.
- **Minified/obfuscated JS**: The JS extractor detects `require()`, `import`, `node_modules/` paths, and CDN URLs. Heavily obfuscated bundles that inline all dependencies without string references won't be detected.
- **Webpack chunk IDs**: In production builds, webpack often replaces package names with numeric IDs. The extension catches module path comments and `__webpack_require__` calls with string arguments, but purely numeric chunk IDs can't be resolved to package names.
- **CSS-in-JS**: Packages referenced only through CSS-in-JS libraries (styled-components, emotion) as JavaScript imports are detected, but CSS generated at runtime won't be.
- **Dynamic requires**: `require(variable)` where the package name is computed at runtime cannot be statically detected.
- **Private registries not checked**: The extension only queries public registries. If your org uses Artifactory, Nexus, GitHub Packages, GitLab Package Registry, AWS CodeArtifact, or Azure Artifacts as a private registry, those are not checked. A package that exists on your private registry but not on the public one will be flagged as vulnerable (false positive in that context).
- **Scoped packages are skipped**: `@org/package` names are automatically skipped because they're namespace-protected on npm. This is correct behavior but means scoped packages won't appear in results at all.

### Browser & Permission Limitations

- **CORS restrictions**: Some cross-origin resources may fail to fetch if the server doesn't send appropriate CORS headers. The extension uses `credentials: 'omit'` for loaded-resource fetches to maximize compatibility, but some resources may still be blocked.
- **Content Security Policy (CSP)**: Pages with strict CSP may block the injected content script from running on GitHub. This is rare but possible on enterprise GitHub instances.
- **Extension service worker lifecycle**: Chrome's Manifest V3 service workers can be terminated after 5 minutes of inactivity. For very large scans (hundreds of packages), the service worker may restart. The extension handles this gracefully, but progress may reset.
- **Firefox differences**: Firefox treats `browser_specific_settings` in the manifest for the extension ID. The UI and functionality are identical, but some minor CSS differences may exist.

### Multi-Repo Scan Limitations

- **Archived repos are skipped**: Intentional — archived repos are read-only and unlikely to be actively deployed.
- **Forked repos are included**: Forks are scanned because they may have modified dependency files. If you don't want fork results, filter them in the exported JSON/CSV.
- **Private repos**: If you're authenticated on GitHub, the extension will see your private repos in the API listing. However, fetching file contents from private repos requires your session cookies to be sent (the extension does this via `credentials: 'include'`). If fetch still fails, the repo will show "0 fetched" in the progress list.
- **GitHub Enterprise**: The extension is hardcoded to `github.com`. It does not work on `github.yourcompany.com` or other GitHub Enterprise Server instances. Custom domain support would require a settings page for base URL configuration.
- **Pagination limit**: The GitHub API returns up to 100 repos per page. The extension paginates automatically, but if a user/org has 1000+ repos, the enumeration alone may consume significant API rate limit.
- **No parallel repo scanning**: Repos are scanned sequentially (one at a time) to respect rate limits. Scanning 100 repos can take 10-30 minutes depending on repository sizes.

### False Positives & False Negatives

**Common false positives:**
- Packages that exist on a private registry but not on the public one (the extension can't know about your private registry)
- Package names extracted from JS comments, license banners, or documentation strings that aren't actual dependencies
- Webpack chunk names that happen to look like package names but are just internal labels

**Common false negatives:**
- Dependencies only referenced via numeric webpack chunk IDs
- Dynamic `require(computedString)` calls
- Dependencies injected at build time and not present in any manifest or source code
- Git submodule dependencies
- System-level packages (apt, brew, rpm) — only language-level package managers are supported

---

## Security & Privacy

- ✅ **All analysis happens locally** in your browser — no data is sent to any third-party server
- ✅ **Read-only operations** — the extension never writes to repositories, registries, or any external service
- ✅ **No telemetry** — no analytics, tracking, or usage data collection
- ✅ **No account required** — works without any API keys or authentication tokens
- ✅ **Open source** — all code is auditable in this repository
- ⚠️ The extension makes **HTTP requests to public registries** (npmjs.org, pypi.org, etc.) to check package existence — these requests are visible to those registries
- ⚠️ The extension makes **HTTP requests to GitHub's API** — these requests count against the public rate limit

---

## Ethical Use & Disclaimer

This tool is designed for **defensive security research** and **authorized security assessments** only.

**Intended use cases:**
- Security teams auditing their own organization's dependencies
- Bug bounty researchers with authorized scope
- Developers checking their own projects for dependency confusion risk
- DevSecOps teams integrating dependency confusion checks into their workflow

**DO NOT use this tool to:**
- Register packages on public registries with malicious intent
- Perform unauthorized security assessments
- Exploit dependency confusion vulnerabilities without explicit permission

The POC information (registry URLs, publish commands) is provided for **authorized proof-of-concept testing** only. Registering packages with malicious code on public registries is illegal in most jurisdictions and violates the terms of service of all major package registries.

**The authors are not responsible for any misuse of this tool.**

---

## License

MIT License — see [LICENSE](LICENSE) for details.

Use responsibly. This tool is intended for defensive security research and authorized security assessments only.

---

<p align="center">
  <sub>Built for the security community. If this tool helps you, consider giving it a ⭐</sub>
</p>
