interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
}

export function initTelegram() {
  const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  webApp?.ready();
  webApp?.expand();
}
