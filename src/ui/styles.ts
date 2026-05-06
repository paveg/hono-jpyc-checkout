import type { ThemeOptions } from '../types'

export function renderStyles(theme: ThemeOptions = {}): string {
  // Sanitize primaryColor against CSS injection: allow only hex / rgb / named colors.
  const primary = sanitizeColor(theme.primaryColor) ?? '#1a73e8'
  return `
    :root {
      color-scheme: light dark;
      --primary: ${primary};
      --bg: #ffffff;
      --fg: #111111;
      --muted: #6b7280;
      --border: #e5e7eb;
      --card-bg: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0e14;
        --fg: #f3f4f6;
        --muted: #9ca3af;
        --border: #1f2937;
        --card-bg: #11151c;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 32px 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    }
    .merchant {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--muted);
      margin-bottom: 24px;
    }
    .merchant img { height: 24px; width: auto; }
    .amount {
      font-size: 48px;
      font-weight: 700;
      text-align: center;
      letter-spacing: -0.02em;
    }
    .amount-sub {
      font-size: 14px;
      color: var(--muted);
      text-align: center;
      margin-top: 4px;
    }
    .meta { margin: 24px 0; font-size: 13px; color: var(--muted); }
    .meta-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .meta-row strong { color: var(--fg); font-weight: 500; }
    button.primary {
      width: 100%;
      padding: 14px;
      font-size: 16px;
      font-weight: 600;
      color: white;
      background: var(--primary);
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      transition: opacity 0.15s ease;
    }
    button.primary:hover { opacity: 0.9; }
    button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .status {
      margin-top: 12px;
      font-size: 13px;
      color: var(--muted);
      text-align: center;
      min-height: 1.6em;
    }
    .status.error { color: #dc2626; }
    .footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--muted);
      text-align: center;
    }
    .copy-btn {
      width: auto;
      padding: 2px 8px;
      font-size: 11px;
      background: transparent;
      color: var(--primary);
      border: 1px solid var(--primary);
      border-radius: 4px;
      cursor: pointer;
    }
  `.trim()
}

function sanitizeColor(input: string | undefined): string | null {
  if (!input) return null
  // Allow only hex (#rgb/#rrggbb), rgb()/rgba(), and named colors (alphanumerics).
  if (/^#[0-9a-fA-F]{3,8}$/.test(input)) return input
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(input)) return input
  if (/^[a-zA-Z]+$/.test(input)) return input
  return null
}
