interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  initData: string;
  initDataUnsafe: {
    user?: TelegramUser;
    start_param?: string;
  };
}

interface TelegramWindow {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
}

function getWebApp(): TelegramWebApp | undefined {
  return (window as unknown as TelegramWindow).Telegram?.WebApp;
}

export function initTelegram() {
  const webApp = getWebApp();
  webApp?.ready();
  webApp?.expand();
}

export function getTelegramInitData(): string {
  return getWebApp()?.initData ?? "";
}

export function getTelegramStartParam(): string | null {
  const webApp = getWebApp();
  if (webApp?.initDataUnsafe?.start_param) {
    return webApp.initDataUnsafe.start_param;
  }
  try {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const startParam = hashParams.get("tgWebAppStartParam");
    if (startParam) return startParam;

    const queryParams = new URLSearchParams(window.location.search);
    return queryParams.get("startapp") ?? queryParams.get("tgWebAppStartParam");
  } catch {
    return null;
  }
}

export type { TelegramUser };
