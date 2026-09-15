const API = (token) => `https://api.telegram.org/bot${token}`;

export async function telegram(env, method, body) {
  const response = await fetch(`${API(env.BOT_TOKEN)}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  let data;
  try { data = await response.json(); } catch { data = { ok: false, description: 'پاسخ نامعتبر از تلگرام' }; }
  if (!response.ok || !data.ok) {
    const err = new Error(data?.description || `Telegram API ${method} failed`);
    err.telegram = data;
    err.status = response.status;
    throw err;
  }
  return data.result;
}

export function copyMessage(env, chatId, fromChatId, messageId, extra = {}) {
  return telegram(env, 'copyMessage', { chat_id: Number(chatId), from_chat_id: Number(fromChatId), message_id: Number(messageId), ...extra });
}
export function sendMessage(env, chatId, text, extra = {}) {
  return telegram(env, 'sendMessage', { chat_id: Number(chatId), text, ...extra });
}
export function editMessageReplyMarkup(env, chatId, messageId, replyMarkup) {
  return telegram(env, 'editMessageReplyMarkup', { chat_id: Number(chatId), message_id: Number(messageId), reply_markup: replyMarkup });
}
export function answerCallbackQuery(env, callbackQueryId, text = '', showAlert = false) {
  return telegram(env, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert });
}
export function editMessageText(env, chatId, messageId, text, extra = {}) {
  return telegram(env, 'editMessageText', { chat_id: Number(chatId), message_id: Number(messageId), text, ...extra });
}
export function sendPhoto(env, chatId, fileId, caption = '', extra = {}) { return telegram(env, 'sendPhoto', { chat_id:Number(chatId), photo:fileId, caption, ...extra }); }
export function sendVideo(env, chatId, fileId, caption = '', extra = {}) { return telegram(env, 'sendVideo', { chat_id:Number(chatId), video:fileId, caption, ...extra }); }
export function sendAudio(env, chatId, fileId, caption = '', extra = {}) { return telegram(env, 'sendAudio', { chat_id:Number(chatId), audio:fileId, caption, ...extra }); }
export function sendVoice(env, chatId, fileId, caption = '', extra = {}) { return telegram(env, 'sendVoice', { chat_id:Number(chatId), voice:fileId, caption, ...extra }); }
export function sendDocument(env, chatId, fileId, caption = '', extra = {}) { return telegram(env, 'sendDocument', { chat_id:Number(chatId), document:fileId, caption, ...extra }); }
export function sendAnimation(env, chatId, fileId, caption = '', extra = {}) { return telegram(env, 'sendAnimation', { chat_id:Number(chatId), animation:fileId, caption, ...extra }); }
export function sendSticker(env, chatId, fileId, extra = {}) { return telegram(env, 'sendSticker', { chat_id:Number(chatId), sticker:fileId, ...extra }); }
export function sendLocation(env, chatId, latitude, longitude, extra = {}) { return telegram(env, 'sendLocation', { chat_id:Number(chatId), latitude, longitude, ...extra }); }
export function sendContact(env, chatId, phoneNumber, firstName, extra = {}) { return telegram(env, 'sendContact', { chat_id:Number(chatId), phone_number:phoneNumber, first_name:firstName, ...extra }); }
export function sendPoll(env, chatId, question, options, extra = {}) { return telegram(env, 'sendPoll', { chat_id:Number(chatId), question, options: JSON.stringify(options), ...extra }); }

export async function uploadMedia(env, chatId, field, file, caption = '') {
  const data = new FormData();
  data.append('chat_id', String(chatId));
  data.append(field, file, file.name || 'upload');
  if (caption) data.append('caption', caption);
  const response = await fetch(`${API(env.BOT_TOKEN)}/send${field[0].toUpperCase()+field.slice(1)}`, { method:'POST', body:data });
  const json = await response.json();
  if (!response.ok || !json.ok) { const e = new Error(json?.description || 'ارسال فایل ناموفق بود'); e.telegram=json; throw e; }
  return json.result;
}

export async function getMe(env) { return telegram(env, 'getMe', {}); }
export async function deleteMessage(env, chatId, messageId) { return telegram(env, 'deleteMessage', { chat_id:Number(chatId), message_id:Number(messageId) }); }
export async function setWebhook(env, url) { return telegram(env, 'setWebhook', { url, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message','callback_query'], drop_pending_updates: false }); }

export function setChatMenuButton(env, chatId, text, url) {
  const body = { menu_button: { type: 'web_app', text, web_app: { url } } };
  if (chatId != null) body.chat_id = Number(chatId);
  return telegram(env, 'setChatMenuButton', body);
}
