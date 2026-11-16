export interface TonConnectWallet {
  account: {
    address: string;
    chain: string;
    publicKey?: string;
    walletStateInit?: string;
  };
  connectItems?: {
    tonProof?:
      | { name: 'ton_proof'; proof: { timestamp: number | string; domain: { lengthBytes: number; value: string }; signature: string; payload: string } }
      | { name: 'ton_proof'; error: { code: number; message?: string } };
  };
}

interface TonConnectUIInstance {
  wallet: TonConnectWallet | null;
  account: { address: string; chain: string; publicKey?: string; walletStateInit?: string } | null;
  setConnectionNetwork(network: string): void;
  setConnectRequestParameters(parameters: null | { state: 'loading' } | { state: 'ready'; value: { tonProof: string } }): void;
  onStatusChange(callback: (wallet: TonConnectWallet | null) => void): () => void;
  openModal(): Promise<void>;
  disconnect(): Promise<void>;
  sendTransaction(request: {
    validUntil: number;
    network: string;
    messages: Array<{
      address: string;
      amount: string;
      payload: string;
    }>;
  }): Promise<{ boc: string }>;
}

interface TonConnectUIConstructor {
  new (options: {
    manifestUrl: string;
    uiPreferences?: { theme: 'DARK' | 'LIGHT' };
  }): TonConnectUIInstance;
}

declare global {
  interface Window {
    TON_CONNECT_UI?: {
      TonConnectUI: TonConnectUIConstructor;
    };
  }
}

let tonConnectUI: TonConnectUIInstance | null = null;
let tonConnectScriptPromise: Promise<void> | null = null;

export async function loadTonConnectUI(): Promise<TonConnectUIInstance> {
  if (window.TON_CONNECT_UI?.TonConnectUI) return getTonConnectUI();

  if (!tonConnectScriptPromise) {
    tonConnectScriptPromise = new Promise<void>((resolve, reject) => {
      // If the global is absent, discard any stale or failed script element.
      // A fresh element makes retries reliable even when an earlier load event
      // completed before this module attached its listeners.
      document.querySelector<HTMLScriptElement>('script[data-zord-ton-connect]')?.remove();
      const activeScript = document.createElement('script');
      const cleanup = () => {
        activeScript.removeEventListener('load', onLoad);
        activeScript.removeEventListener('error', onError);
      };
      const onLoad = () => {
        cleanup();
        if (window.TON_CONNECT_UI?.TonConnectUI) {
          activeScript.dataset.loaded = 'true';
          resolve();
        } else {
          activeScript.remove();
          reject(new Error('TON Connect loaded but its interface was unavailable. Please retry.'));
        }
      };
      const onError = () => {
        cleanup();
        activeScript.remove();
        reject(new Error('TON Connect could not be downloaded. Check your connection and retry.'));
      };

      activeScript.addEventListener('load', onLoad, { once: true });
      activeScript.addEventListener('error', onError, { once: true });
      if (!activeScript.parentElement) {
        activeScript.src = 'https://unpkg.com/@tonconnect/ui@5.0.1/dist/tonconnect-ui.min.js';
        activeScript.async = true;
        activeScript.dataset.zordTonConnect = 'true';
        document.head.appendChild(activeScript);
      }
    }).catch((error: unknown) => {
      tonConnectScriptPromise = null;
      throw error;
    });
  }

  await tonConnectScriptPromise;
  return getTonConnectUI();
}

export function getTonConnectUI(): TonConnectUIInstance {
  if (!window.TON_CONNECT_UI?.TonConnectUI) {
    throw new Error('TON Connect did not load. Reopen the Mini App and try again.');
  }

  if (!tonConnectUI) {
    tonConnectUI = new window.TON_CONNECT_UI.TonConnectUI({
      // Load the manifest from this deployment (Preview or Production).
      // Its "url" field stays on the canonical domain used by server proof checks.
      manifestUrl: new URL('/tonconnect-manifest.json', window.location.origin).toString(),
      uiPreferences: { theme: 'DARK' },
    });
    tonConnectUI.setConnectionNetwork('-239');
  }

  return tonConnectUI;
}

/**
 * Encodes a standard TON text comment (opcode 0) into a single-cell BOC.
 * The payload is attached to the native TON transfer so the existing
 * server-side payment verifier can match the unique payment reference.
 */
export function encodeTonCommentPayload(comment: string): string {
  const textBytes = new TextEncoder().encode(comment);

  // TON cells hold at most 1023 bits. Keep this simple comment in one cell.
  if (textBytes.length > 120) {
    throw new Error('The payment reference is too long for a TON comment.');
  }

  const commentData = new Uint8Array(4 + textBytes.length);
  commentData.set(textBytes, 4); // The first four bytes are the zero comment opcode.

  const cell = new Uint8Array(2 + commentData.length);
  cell[0] = 0; // No references, ordinary cell, level 0.
  cell[1] = commentData.length * 2; // d2 for a byte-aligned bitstring.
  cell.set(commentData, 2);

  // Generic BOC header: no index, no CRC32C, one root and one cell.
  const boc = new Uint8Array(11 + cell.length);
  boc.set([0xb5, 0xee, 0x9c, 0x72, 0x01, 0x01, 0x01, 0x01, 0x00], 0);
  boc[9] = cell.length;
  boc[10] = 0; // Root cell index.
  boc.set(cell, 11);

  let binary = '';
  for (const byte of boc) binary += String.fromCharCode(byte);
  return btoa(binary);
}
