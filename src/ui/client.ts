export interface ClientBootstrap {
  sessionId: string
  amount: string
  receivingAddress: string
  jpycContract: string
  chainIdHex: string
  successUrl: string
  cancelUrl: string
  apiPrefix: string
}

export function renderClientScript(bootstrap: ClientBootstrap): string {
  // Escape angle brackets in JSON to prevent breaking out of <script>.
  const safeJson = JSON.stringify(bootstrap).replace(/</g, '\\u003c')
  return `
(function () {
  const cfg = ${safeJson};
  const $ = (sel) => document.querySelector(sel);

  function setStatus(text, isError) {
    const el = $('.status');
    el.textContent = text;
    el.className = 'status' + (isError ? ' error' : '');
  }
  function setButton(text, disabled) {
    const btn = $('button.primary');
    btn.textContent = text;
    btn.disabled = !!disabled;
  }

  async function ensureChain() {
    const current = await window.ethereum.request({ method: 'eth_chainId' });
    if (current === cfg.chainIdHex) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: cfg.chainIdHex }],
      });
    } catch (e) {
      throw new Error('Please switch your wallet to Polygon network.');
    }
  }

  async function connect() {
    if (!window.ethereum) {
      setStatus('No wallet detected. Install MetaMask or another Web3 wallet.', true);
      return;
    }
    try {
      setButton('Connecting...', true);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const from = accounts[0];
      await ensureChain();
      const res = await fetch(cfg.apiPrefix + '/' + cfg.sessionId + '/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromAddress: from }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body && body.error && body.error.message) || 'Failed to register sender address');
      }
      setStatus('Wallet connected: ' + from.slice(0, 6) + '...' + from.slice(-4));
      setButton('Send ' + cfg.amount + ' JPYC', false);
      $('button.primary').onclick = () => send(from);
    } catch (e) {
      setStatus(e.message || String(e), true);
      setButton('Connect Wallet', false);
    }
  }

  function encodeTransfer(to, amount) {
    const selector = '0xa9059cbb';
    const toClean = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const value = BigInt(amount) * (10n ** 18n);
    const valueHex = value.toString(16).padStart(64, '0');
    return selector + toClean + valueHex;
  }

  async function send(from) {
    try {
      setButton('Sending...', true);
      const data = encodeTransfer(cfg.receivingAddress, cfg.amount);
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: from, to: cfg.jpycContract, data: data }],
      });
      setStatus('Transaction submitted. Confirming on-chain...');
      await pollVerify(txHash);
    } catch (e) {
      setStatus(e.message || 'Transaction declined.', true);
      setButton('Send ' + cfg.amount + ' JPYC', false);
    }
  }

  function reasonText(reason) {
    switch (reason) {
      case 'tx_reverted': return 'Transaction failed on-chain.';
      case 'sender_mismatch': return 'Sender mismatch. Send from the wallet you connected.';
      case 'recipient_mismatch': return 'Recipient mismatch. Contact the merchant.';
      case 'amount_mismatch': return 'Wrong amount sent.';
      default: return 'Verification failed.';
    }
  }

  async function pollVerify(txHash) {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const res = await fetch(cfg.apiPrefix + '/' + cfg.sessionId + '/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: txHash }),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.paid) {
          setStatus('Payment confirmed!');
          setButton('Redirecting...', true);
          window.location.href = cfg.successUrl;
          return;
        }
        if (body.reason === 'insufficient_confirmations') {
          const c = (body.progress && body.progress.confirmed) || 0;
          const r = (body.progress && body.progress.required) || 8;
          setStatus('Confirming on-chain... ' + c + '/' + r);
        } else if (body.reason === 'tx_not_mined') {
          setStatus('Waiting for transaction to be mined...');
        } else {
          setStatus(reasonText(body.reason), true);
          setButton('Try again', false);
          return;
        }
      } else if (res.status === 502) {
        setStatus('Verifying... (RPC retry)');
      } else {
        const body = await res.json().catch(() => ({}));
        setStatus((body && body.error && body.error.message) || 'Verification failed.', true);
        setButton('Try again', false);
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    setStatus('Verification timed out. Please refresh and try again.', true);
    setButton('Refresh', false);
    $('button.primary').onclick = () => window.location.reload();
  }

  $('button.primary').onclick = connect;
  $('.copy-btn').onclick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(cfg.receivingAddress);
    const el = $('.copy-btn');
    const orig = el.textContent;
    el.textContent = 'Copied';
    setTimeout(() => { el.textContent = orig; }, 1200);
  };
})();
`.trim()
}
