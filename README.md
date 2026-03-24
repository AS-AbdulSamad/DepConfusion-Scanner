# DepConfusion Scanner — Browser Extension

A comprehensive browser extension (Chrome & Firefox) that detects **dependency confusion** vulnerabilities by analyzing source code, package manifests, and dependency trees in real-time — on any web page and across entire GitHub repositories.

---

## What is Dependency Confusion?

Dependency confusion (also called namespace confusion or substitution attack) exploits how package managers resolve dependencies. When a project references an **internal/private package name** that doesn't exist on the **public registry**, an attacker can register that name on the public registry with a higher version number. The package manager may then pull the attacker's malicious package instead.

This extension scans for packages referenced in manifests that **do not exist** on public registries — meaning they are **claimable** and represent real attack surface.

---

## Features

### Multi-Ecosystem Support (8 ecosystems)
| Ecosystem | Files Detected | Registry Checked |
|-----------|---------------|-----------------|
| **npm** | `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | registry.npmjs.org |
| **PyPI** | `requirements.txt`, `setup.py`, `setup.cfg`, `Pipfile`, `pyproject.toml`, `poetry.lock` | pypi.org |
| **RubyGems** | `Gemfile`, `Gemfile.lock`, `*.gemspec` | rubygems.org |
| **NuGet** | `*.csproj`, `*.fsproj`, `*.vbproj`, `packages.config`, `*.nuspec` | api.nuget.org |
| **crates.io** | `Cargo.toml`, `Cargo.lock` | crates.io |
| **Packagist** | `composer.json`, `composer.lock` | packagist.org |
| **Maven** | `pom.xml`, `build.gradle`, `build.gradle.kts` | search.maven.org |
| **Go** | `go.mod`, `go.sum` | proxy.golang.org |

### GitHub Deep Integration
- **Recursive repository scanning** via GitHub's git tree API
- Discovers ALL dependency files across every directory
- Works on repo root pages, tree views, and individual blob pages
- Floating shield icon appears on every GitHub repo page
- SPA-aware — works with GitHub's client-side navigation
- Export scan results as JSON or CSV

### Page Source Analysis
- Detects dependency manifests in `<script>` tags, import maps, and code blocks
- Works on any web page (documentation sites, package viewers, code review tools)
- Manual input mode for pasting dependency files directly

### Vulnerability Intelligence
For each finding, the extension reports:
- **Severity** (Critical / High / Medium / Info)
- **Exact file path** where the dependency is declared
- **Package name** and version constraint
- **Which section** of the manifest (dependencies, devDependencies, etc.)
- **Registry status** (exists / does not exist / claimable)
- **POC registration URL** — direct link to sign up on the registry
- **Publish command** — the command needed to claim the package

---

## Installation

### Chrome (Developer Mode)
1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `depconfusion-scanner` folder
5. The shield icon appears in your toolbar

### Firefox (Temporary Add-on)
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from the `depconfusion-scanner` folder
4. The shield icon appears in your toolbar

### Firefox (Permanent — requires signing)
1. Package as `.zip`: `cd depconfusion-scanner && zip -r ../depconfusion.zip .`
2. Submit to [addons.mozilla.org](https://addons.mozilla.org/) for signing
3. Install the signed `.xpi` file

---

## Usage

### 1. GitHub Repository Scanning
1. Navigate to any GitHub repository (e.g., `https://github.com/user/repo`)
2. Click the **purple shield button** in the bottom-right corner
3. Click **Scan** in the panel that appears
4. The scanner will:
   - Recursively discover all dependency files via GitHub's API
   - Fetch raw content of each file
   - Extract every package name from every manifest
   - Check each package against its public registry
   - Display results with severity ratings and POC details

### 2. Current Page Scanning
1. Navigate to any page containing dependency file content
2. Click the extension icon in the toolbar
3. Select **"Current Page Sources"** mode
4. Click **Start Scan**
5. The extension injects a content script to find dependency data in page source

### 3. Manual Input
1. Click the extension icon
2. Select **"Manual Input"** mode
3. Paste your `package.json`, `requirements.txt`, or any other manifest content
4. Enter the filename (so the parser knows which format to use)
5. Click **Start Scan**

---

## How Severity is Determined

| Severity | Condition |
|----------|-----------|
| **CRITICAL** | Package does NOT exist on public registry AND has an internal-looking name (e.g., `company-utils`, `internal-auth`) |
| **HIGH** | Package does NOT exist on public registry (claimable by anyone) |
| **MEDIUM** | Package exists on registry but has an internal-looking name — could be a squatted name |
| **INFO** | Package exists on public registry and appears to be a legitimate public package |

---

## File Structure

```
depconfusion-scanner/
├── manifest.json            # Extension manifest (MV3, Chrome + Firefox)
├── background.js            # Service worker: package extraction + registry checks
├── popup.html               # Extension popup UI
├── popup.css                # Popup styles
├── popup.js                 # Popup logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── lib/
    ├── github-analyzer.js   # GitHub content script (auto-injected)
    └── github-overlay.css   # GitHub overlay panel styles
```

---

## Settings

Access via the gear icon in the popup:

- **Auto-scan GitHub repos** — Automatically start scanning when you open a repo page
- **Skip scoped packages** — Ignore `@org/package` style names (default: on)
- **Internal name heuristic** — Flag packages with names matching internal patterns like `company-*`, `internal-*`, `private-*`
- **Request delay** — Milliseconds between registry API calls (default: 200ms) to avoid rate limiting

---

## Security Notes

- The extension only makes **read-only** requests to public registry APIs
- No data is sent to any third-party server
- All analysis happens locally in your browser
- GitHub API requests are unauthenticated (rate-limited to 60/hr for tree API)
- For higher rate limits on private repos, the extension would need a GitHub token (not implemented — add via settings if needed)

---

## Limitations

- Private/internal registries (Artifactory, Nexus, GitHub Packages) are not checked — the extension only queries public registries
- GitHub API rate limit of 60 requests/hour for unauthenticated users
- Very large repositories may hit API limits on recursive tree fetching
- Lock files (yarn.lock, package-lock.json) may produce many duplicate package names
- The Packagist, Maven, and Go registry checks are basic/limited

---

## License

MIT — Use responsibly. This tool is intended for **defensive security research** and **authorized security assessments** only.
