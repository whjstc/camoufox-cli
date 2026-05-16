# camoufox-cli

Anti-detect browser CLI & Skills for AI agents, powered by [Camoufox](https://github.com/daijro/camoufox).

### Highlights

- C++-level fingerprint spoofing via Camoufox (canvas, WebGL, audio, screen metrics, fonts)
- Accessibility-tree snapshots with `@ref` element targeting
- DevTools-style analysis capture for network requests, console logs, page errors, and WebSockets
- Session isolation with cookie import/export
- Shell commands, no code generation

### Works with

OpenClaw, Claude Code, Cursor, Codex, and any agent that can run shell commands.

## Install

Tell your AI agent (e.g. OpenClaw):

> Install this CLI and skills from https://github.com/Bin-Huang/camoufox-cli

Or install manually:

```bash
npm install -g camoufox-cli
camoufox-cli install              # Download browser
```

Or with pip:

```bash
pipx install camoufox-cli
camoufox-cli install              # Download browser
```

On Linux, install system dependencies with:

```bash
camoufox-cli install --with-deps
```

### Agent Skill

```bash
# Add skills for AI agents (Claude Code, Cursor, Codex, etc.)
npx skills add Bin-Huang/camoufox-cli
```

## Quick Start

```bash
camoufox-cli open https://example.com    # Launch browser & navigate
camoufox-cli snapshot -i                  # Interactive elements only
# - link "More information..." [ref=e1]
camoufox-cli click @e1                    # Click by ref
camoufox-cli close                        # Done
```

Analyze a site like a lightweight DevTools capture:

```bash
camoufox-cli --headed --session audit analyze https://example.com \
  --wait 8000 \
  --headers \
  --body-limit 4000 \
  --output analysis.json
```

## Commands

### Navigation

```bash
camoufox-cli open <url>                   # Navigate to URL (starts daemon if needed)
camoufox-cli back                         # Go back
camoufox-cli forward                      # Go forward
camoufox-cli reload                       # Reload page
camoufox-cli url                          # Print current URL
camoufox-cli title                        # Print page title
camoufox-cli close                        # Close browser and stop daemon
```

### Snapshot

```bash
camoufox-cli snapshot                     # Full accessibility tree
camoufox-cli snapshot -i                  # Interactive elements only
camoufox-cli snapshot -s "css-selector"   # Scoped to CSS selector
```

Output format:

```
- heading "Example Domain" [level=1] [ref=e1]
- paragraph [ref=e2]
  - link "More information..." [ref=e3]
```

### Interaction

```bash
camoufox-cli click @e1                    # Click element
camoufox-cli fill @e3 "search query"      # Clear + type into input
camoufox-cli type @e3 "append text"       # Type without clearing
camoufox-cli select @e5 "option text"     # Select dropdown option
camoufox-cli check @e6                    # Toggle checkbox
camoufox-cli hover @e2                    # Hover over element
camoufox-cli press Enter                  # Press keyboard key
camoufox-cli press "Control+a"            # Key combination
```

### Data Extraction

```bash
camoufox-cli text @e1                     # Get text content of element
camoufox-cli text body                    # Get all page text
camoufox-cli eval "document.title"        # Execute JavaScript
camoufox-cli analyze <url>                # Capture network, console, page errors, WebSockets
camoufox-cli screenshot                   # Screenshot (JSON with base64)
camoufox-cli screenshot page.png          # Screenshot to file
camoufox-cli screenshot --full page.png   # Full page screenshot
```

### Website Analysis

Use `analyze` when an agent needs to inspect how a page loads, which requests fire, what fails, or what appears in the browser console.

```bash
camoufox-cli analyze https://example.com
camoufox-cli --json analyze https://example.com --wait 5000
camoufox-cli analyze https://example.com --headers --body-limit 4000 --output analysis.json
```

Captured event types:

- `request`: method, URL, resource type, optional headers and post body
- `response`: URL, status, status text, resource type, service-worker flag, optional headers
- `requestfailed`: failed URL and browser failure text
- `console`: browser console level, text, and source location
- `pageerror`: uncaught page errors and stack
- `websocket`: opened WebSocket URL

Options:

```bash
--wait <ms>           Wait after DOMContentLoaded before ending capture (default 3000)
--headers             Include request and response headers
--body-limit <chars>  Include truncated request post bodies
--output <file.json>  Save full analysis JSON
```

### Scroll & Wait

```bash
camoufox-cli scroll down                  # Scroll down 500px
camoufox-cli scroll up 1000               # Scroll up 1000px
camoufox-cli wait 2000                    # Wait milliseconds
camoufox-cli wait @e1                     # Wait for element to appear
camoufox-cli wait --url "*/dashboard"     # Wait for URL pattern
```

### Tabs

```bash
camoufox-cli tabs                         # List open tabs
camoufox-cli switch 2                     # Switch to tab by index
camoufox-cli close-tab                    # Close current tab
```

### Sessions

```bash
camoufox-cli sessions                     # List active sessions
camoufox-cli --session work open <url>    # Use named session
camoufox-cli close --all                  # Close all sessions
```

### Cookies

```bash
camoufox-cli cookies                      # Dump cookies as JSON
camoufox-cli cookies import file.json     # Import cookies
camoufox-cli cookies export file.json     # Export cookies
```

## Flags

```
--session <name>       Named session (default: "default")
--headed               Show browser window (default: headless)
--timeout <seconds>    Daemon idle timeout (default: 1800)
--json                 Output as JSON
--persistent [path]    Persistent identity + browser profile (default: ~/.camoufox-cli/profiles/<session>)
--proxy <url>          Proxy server (http:// or https://; auth: http://user:pass@host:port)
--no-geoip             Disable automatic GeoIP spoofing (auto-enabled with --proxy)
--locale <tag>         Force browser locale (e.g. "en-US" or "en-US,zh-CN")
--timezone <tz>        Force browser timezone (e.g. "America/Los_Angeles")
```

## Persistent Identity

Without `--persistent`, every launch gets a fresh random fingerprint. With `--persistent`, a `camoufox-cli.json` file is written next to the browser profile. Fingerprint, OS, and canvas/font seeds are generated on the first launch and frozen afterwards; locale and proxy-derived timezone/geolocation are also saved and refreshed when you pass those flags again.

```bash
# First launch: generates and stores identity
camoufox-cli --persistent ~/.camoufox-cli/profiles/alice open https://example.com

# Later launches: same fingerprint, cookies, and device identity
camoufox-cli --persistent ~/.camoufox-cli/profiles/alice open https://example.com
```

Frozen until the directory is deleted:

- Fingerprint (UA, canvas, WebGL, fonts, navigator properties)
- OS
- Canvas/font noise seeds

Stored and refreshed from command-line intent:

- `--locale`: updates the stored locale when passed.
- `--proxy` with GeoIP enabled: re-derives timezone/geolocation from the proxy IP.
- `--timezone`: overrides the launch timezone for JS sessions when passed.

`--proxy` and `--no-geoip` themselves are per-launch settings, so pass them each time they should apply. To reset an identity, remove that profile directory.

## Architecture

```
CLI (camoufox-cli)  ──Unix socket──▶  Daemon (Python)  ──Playwright──▶  Camoufox (Firefox)
```

The CLI sends JSON commands to a long-running daemon process via Unix socket. The daemon manages the Camoufox browser instance and maintains the ref registry between commands. The daemon auto-starts on the first command and auto-stops after 30 minutes of inactivity.

## Related

- [google-analytics-cli](https://github.com/Bin-Huang/google-analytics-cli) -- Google Analytics CLI & Skills for AI agents (and humans)
- [google-search-console-cli](https://github.com/Bin-Huang/google-search-console-cli) -- Google Search Console CLI & Skills for AI agents (and humans)
- [youtube-analytics-cli](https://github.com/Bin-Huang/youtube-analytics-cli) -- YouTube Analytics CLI & Skills for AI agents (and humans)
- [x-analytics-cli](https://github.com/Bin-Huang/x-analytics-cli) -- X Analytics CLI & Skills for AI agents (and humans)
- [google-ads-open-cli](https://github.com/Bin-Huang/google-ads-open-cli) -- Google Ads CLI & Skills for AI agents (and humans)
- [meta-ads-open-cli](https://github.com/Bin-Huang/meta-ads-open-cli) -- Meta Ads CLI & Skills for AI agents (and humans)
- [microsoft-ads-cli](https://github.com/Bin-Huang/microsoft-ads-cli) -- Microsoft Ads CLI & Skills for AI agents (and humans)
- [amazon-ads-open-cli](https://github.com/Bin-Huang/amazon-ads-open-cli) -- Amazon Ads CLI & Skills for AI agents (and humans)
- [tiktok-ads-cli](https://github.com/Bin-Huang/tiktok-ads-cli) -- TikTok Ads CLI & Skills for AI agents (and humans)
- [linkedin-ads-cli](https://github.com/Bin-Huang/linkedin-ads-cli) -- LinkedIn Ads CLI & Skills for AI agents (and humans)
- [x-ads-cli](https://github.com/Bin-Huang/x-ads-cli) -- X Ads CLI & Skills for AI agents (and humans)
- [snapchat-ads-cli](https://github.com/Bin-Huang/snapchat-ads-cli) -- Snapchat Ads CLI & Skills for AI agents (and humans)
- [pinterest-ads-cli](https://github.com/Bin-Huang/pinterest-ads-cli) -- Pinterest Ads CLI & Skills for AI agents (and humans)
- [reddit-ads-cli](https://github.com/Bin-Huang/reddit-ads-cli) -- Reddit Ads CLI & Skills for AI agents (and humans)
- [spotify-ads-cli](https://github.com/Bin-Huang/spotify-ads-cli) -- Spotify Ads CLI & Skills for AI agents (and humans)
- [apple-ads-cli](https://github.com/Bin-Huang/apple-ads-cli) -- Apple Ads CLI & Skills for AI agents (and humans)
## License

MIT
