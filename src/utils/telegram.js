export const sendToBot = async (env, message, parseMode = 'HTML') => {
  if (!env.TG_BOT_TOKEN || !env.TG_MANAGE) {
    return;
  }
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: env.TG_MANAGE,
    text: message,
    parse_mode: parseMode
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('Telegram send error:', e);
  }
};
