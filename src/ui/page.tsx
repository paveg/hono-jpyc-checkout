import { raw } from 'hono/html'
import type { Session, ThemeOptions } from '../types'
import { type ClientBootstrap, renderClientScript } from './client'
import { renderStyles } from './styles'

export interface PageProps {
  session: Session
  bootstrap: ClientBootstrap
  theme: ThemeOptions
}

// Security: raw() is safe here because (a) styles only interpolate
// theme.primaryColor after sanitizeColor() in renderStyles, and (b) the
// script interpolates the bootstrap object after JSON.stringify replace
// "<" -> "\\u003c" preventing </script> breakout. Do not call raw() on
// any value derived from untrusted input without a similar audit.
export function CheckoutPage({ session, bootstrap, theme }: PageProps) {
  const styles = renderStyles(theme)
  const script = renderClientScript(bootstrap)
  const merchantName = theme.merchantName ?? 'Merchant'
  const truncated = `${session.receivingAddress.slice(0, 6)}...${session.receivingAddress.slice(-4)}`

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`Checkout — ${merchantName}`}</title>
        <style>{raw(styles)}</style>
      </head>
      <body>
        <div class="card">
          <div class="merchant">
            {theme.logo ? <img src={theme.logo} alt="" /> : null}
            <span>{merchantName}</span>
          </div>
          <div class="amount">¥{session.amount}</div>
          <div class="amount-sub">= {session.amount} JPYC</div>
          <div class="meta">
            <div class="meta-row">
              <span>Order</span>
              <strong>{session.orderId}</strong>
            </div>
            <div class="meta-row">
              <span>Pay to</span>
              <strong>
                {truncated} <button type="button" class="copy-btn">Copy</button>
              </strong>
            </div>
            <div class="meta-row">
              <span>Network</span>
              <strong>Polygon</strong>
            </div>
          </div>
          <button type="button" class="primary">Connect Wallet</button>
          <div class="status" />
          <div class="footer">Powered by hono-jpyc-checkout</div>
        </div>
        <script>{raw(script)}</script>
      </body>
    </html>
  )
}
