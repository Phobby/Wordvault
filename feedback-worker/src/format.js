// The messages the developer reads. The time is the receiver's own clock, shown for Istanbul;
// what the sender's clock says is never used.

const TYPE_NAMES = { bug: '🐞 Hata', idea: '💡 Öneri', other: '💬 Diğer' };
const FEATURE_NAMES = { bubble: 'Çeviri baloncuğu', captions: 'Altyazılar', quiz: 'Flash card / quiz', sync: 'Senkronizasyon', settings: 'Ayarlar', other: 'Diğer' };

/** Telegram's limit for one message is 4096 characters; this leaves room for the markup. */
const TELEGRAM_MAX = 3800;
const DISCORD_MAX = 1900;

/** For Telegram's HTML mode: these three are all it asks to be escaped. */
export const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** For Discord: nothing the sender wrote may turn into markup, a link preview or a mention. */
export const escapeMarkdown = (text) => String(text).replace(/([\\*_~`|>#\[\]()@:-])/g, '\\$1');

const clip = (text, max) => ([...text].length > max ? `${[...text].slice(0, max - 1).join('')}…` : text);

/** "13.10.2026 14:35" in Istanbul. */
export function istanbulTime(now) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).replace(',', '');
}

function techLines(tech) {
  if (!tech) return [];
  const browser = [tech.browser, tech.browserVersion].filter(Boolean).join(' ');
  const engine = tech.engine && !tech.engine.startsWith(`${tech.browser} `) ? ` (${tech.engine})` : '';
  const lines = [[`${browser}${engine}`, tech.os, tech.extensionVersion && `Wordvault ${tech.extensionVersion}`, tech.uiLanguage && `dil: ${tech.uiLanguage}`].filter(Boolean).join(' · ')];
  if (tech.features) {
    const on = Object.keys(tech.features).filter((name) => tech.features[name]);
    const off = Object.keys(tech.features).filter((name) => !tech.features[name]);
    lines.push(`Açık: ${on.join(', ') || '-'}`, `Kapalı: ${off.join(', ') || '-'}`);
  }
  if (tech.syncMode) lines.push(`Senkron: ${tech.syncMode}`);
  return lines;
}

/**
 * @param {Object} feedback  As returned by validate().
 * @param {Date} now  The receiver's clock.
 * @param {'html' | 'markdown'} flavour
 * @returns {string[]} One message, or two when error records came along.
 */
export function formatMessages(feedback, now, flavour = 'html') {
  const html = flavour === 'html';
  const escape = html ? escapeHtml : escapeMarkdown;
  const bold = (text) => (html ? `<b>${text}</b>` : `**${text}**`);
  const code = (text) => (html ? `<pre>${escapeHtml(text)}</pre>` : `\`\`\`\n${text.replace(/```/g, "'''")}\n\`\`\``);
  const max = html ? TELEGRAM_MAX : DISCORD_MAX;

  const head = [`${bold(TYPE_NAMES[feedback.type])} · ${escape(FEATURE_NAMES[feedback.feature])}`, `🕒 ${istanbulTime(now)} (İstanbul)`];
  const tail = [];
  if (feedback.email) tail.push(`✉️ ${escape(feedback.email)}`);
  const tech = techLines(feedback.tech).map(escape);
  if (tech.length > 0) tail.push(`🧩 ${tech.join('\n')}`);
  if (feedback.errors?.length) tail.push(`📎 ${feedback.errors.length} hata kaydı sonraki mesajda`);
  const messages = [clip([head.join('\n'), escape(feedback.message), tail.join('\n')].filter(Boolean).join('\n\n'), max)];

  if (feedback.errors?.length) {
    // Shortened: the newest first, as many as fit into one message.
    let text = '';
    for (const record of [...feedback.errors].reverse()) {
      const entry = `${istanbulTime(new Date(record.at))} [${record.feature}] ${record.message}${record.stack ? `\n${record.stack.split('\n').slice(0, 2).join('\n')}` : ''}\n\n`;
      if (text.length + entry.length > max - 200) break;
      text += entry;
    }
    messages.push(`${bold('Hata kayıtları')} (${feedback.errors.length})\n${code(text.trim() || '…')}`);
  }
  return messages;
}
