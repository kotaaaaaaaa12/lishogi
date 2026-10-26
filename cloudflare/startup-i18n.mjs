const messages = {
  en: {
    locale: 'en', title: 'Starting Shogi · Getting ready', brand: 'Shogi',
    heading: 'Getting your board ready.', intro: 'Your board will open as soon as it is ready.',
    badge: 'Your board is waking up', retry: 'Try again', details: 'Show details',
    auto: 'Opens automatically when ready', stepsLabel: 'Startup stages',
    steps: ['Wake up', 'Restore', 'Get ready'],
    errorHeading: 'The board needs a moment.',
    errorIntro: 'The server could not finish starting. You can try again below.',
    errorBadge: 'Startup paused', errorStatus: 'Unable to start the server.',
    errorAuto: 'Waiting for the server to recover',
    connecting: 'Connecting to the server…', reconnect: 'Reconnecting to the server…',
    reconnectAuto: 'We will check again automatically',
    noscriptBefore: 'Automatic refresh needs JavaScript. ',
    noscriptLink: 'Reload this page', noscriptAfter: ' to check again.',
    stages: {
      idle: 'Waking up the server…', 'container-port': 'Waking up the server…',
      'database-ready': 'Preparing saved games…', 'container-status': 'Preparing saved games…',
      'backup-load': 'Finding saved games…', 'database-restore': 'Restoring saved games…',
      'application-initialize': 'Setting up your board…',
      'initial-backup': 'Saving a fresh checkpoint…', 'checkpoint-schedule': 'Finishing startup…',
      'final-backup': 'Saving your progress…', 'idle-shutdown': 'Finishing the previous session…',
      ready: 'Your board is ready.',
    },
  },
  ja: {
    locale: 'ja', title: '将棋 · 起動中', brand: '将棋',
    heading: '対局の準備中', intro: '準備ができると、自動でページが開きます。',
    badge: 'サーバーを起動しています', retry: '再試行', details: '詳細を表示',
    auto: '準備ができると自動で開きます', stepsLabel: '起動の進行状況',
    steps: ['起動', '復元', '準備'],
    errorHeading: '起動できませんでした',
    errorIntro: 'サーバーの起動が完了しませんでした。下のボタンから再試行できます。',
    errorBadge: '起動を中断しました', errorStatus: 'サーバーを起動できませんでした。',
    errorAuto: 'サーバーの復旧を待っています',
    connecting: 'サーバーに接続しています…', reconnect: 'サーバーに再接続しています…',
    reconnectAuto: '自動で再確認します',
    noscriptBefore: '自動更新にはJavaScriptが必要です。',
    noscriptLink: 'ページを再読み込み', noscriptAfter: 'して、もう一度確認してください。',
    stages: {
      idle: 'サーバーを起動しています…', 'container-port': 'サーバーを起動しています…',
      'database-ready': '保存データを準備しています…', 'container-status': '保存データを準備しています…',
      'backup-load': '保存データを探しています…', 'database-restore': '保存データを復元しています…',
      'application-initialize': '対局の準備をしています…',
      'initial-backup': '最初のバックアップを保存しています…', 'checkpoint-schedule': '起動を完了しています…',
      'final-backup': 'データを保存しています…', 'idle-shutdown': '前のセッションを終了しています…',
      ready: '対局の準備ができました。',
    },
  },
};

export function startupMessages(locale) {
  return locale === 'ja' ? messages.ja : messages.en;
}

export function startupLocale(acceptLanguage = '') {
  const preferences = String(acceptLanguage || '').split(',').map((entry, index) => {
    const [tag, ...parameters] = entry.trim().toLowerCase().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    const weight = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return {tag, weight, index};
  }).filter(({tag, weight}) => tag && Number.isFinite(weight) && weight > 0 && weight <= 1)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  // Use the preferred browser language; other languages fall back to English.
  return /^ja(?:-|$)/.test(preferences[0]?.tag || '') ? 'ja' : 'en';
}
