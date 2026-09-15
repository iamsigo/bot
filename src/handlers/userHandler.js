import { TEXT } from '../utils/i18n.js';
import { rateLimit } from '../utils/rateLimit.js';
import { isWithinBusinessHours } from '../utils/dates.js';
import { copyMessage, sendMessage } from '../telegram/api.js';
import { upsertUser, getUser, touchUserMessage, getActiveAdmins, insertMessage, setUserStatus, getSettings } from '../db/queries.js';

function contentInfo(msg) {
  if (msg.text) return { type: 'text', text: msg.text };
  if (msg.photo?.length) return { type: 'photo', fileId: msg.photo.at(-1).file_id, text: msg.caption || '' };
  if (msg.video) return { type: 'video', fileId: msg.video.file_id, text: msg.caption || '' };
  if (msg.voice) return { type: 'voice', fileId: msg.voice.file_id, text: msg.caption || '' };
  if (msg.video_note) return { type: 'video_note', fileId: msg.video_note.file_id, text: '' };
  if (msg.document) return { type: 'document', fileId: msg.document.file_id, text: msg.caption || '' };
  if (msg.audio) return { type: 'audio', fileId: msg.audio.file_id, text: msg.caption || '' };
  if (msg.animation) return { type: 'animation', fileId: msg.animation.file_id, text: msg.caption || '' };
  if (msg.sticker) return { type: 'sticker', fileId: msg.sticker.file_id, text: '' };
  if (msg.location) return { type: 'location', text: `${msg.location.latitude},${msg.location.longitude}` };
  if (msg.contact) return { type: 'contact', text: `${msg.contact.phone_number} — ${msg.contact.first_name}` };
  if (msg.poll) return { type: 'poll', text: msg.poll.question };
  return { type: 'unknown', text: '' };
}

const keyboard = (assigned = false) => ({ inline_keyboard: [[
  { text: assigned ? TEXT.release : TEXT.claim, callback_data: assigned ? 'release' : 'claim' },
  { text: TEXT.block, callback_data: 'block' }
], [{ text: 'پاسخ‌های آماده', callback_data: 'canned' }]] });

export async function handleUserMessage(env, msg) {
  const from = msg.from;
  const user = await upsertUser(env.DB, from, msg.chat.id);
  if (user.status === 'blocked') { await sendMessage(env, msg.chat.id, TEXT.blocked); return; }

  const limit = await rateLimit(env, from.id);
  if (!limit.allowed) { await sendMessage(env, msg.chat.id, 'پیام‌های شما بیش از حد مجاز است؛ لطفاً کمی بعد دوباره تلاش کنید.'); return; }

  const info = contentInfo(msg);
  await touchUserMessage(env.DB, user.id);
  const settings = await getSettings(env.DB);
  const activeAdmins = await getActiveAdmins(env.DB);
  const assignedId = user.assigned_admin_id;
  const recipients = assignedId ? activeAdmins.filter(a => Number(a.id) === Number(assignedId)) : activeAdmins;

  const copyTargets = recipients.length ? recipients : activeAdmins;
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || String(from.id);
  const notice = TEXT.newTicket(name, from.username);
  const assigned = Boolean(assignedId);

  if (!copyTargets.length) {
    await insertMessage(env.DB, { direction:'user_to_admin', userId:user.id, adminId:null, sourceChatId:msg.chat.id, sourceMessageId:msg.message_id, relayedMessageId:null, contentType:info.type, textContent:info.text, fileId:info.fileId });
    await sendMessage(env, msg.chat.id, settings.away_message || TEXT.away);
    return;
  }

  for (const admin of copyTargets) {
    try {
      const header = await sendMessage(env, admin.chat_id, `${notice}\n${assigned ? `👤 مسئول گفتگو: ${admin.display_name}` : 'لطفاً در صورت پاسخگویی، گفتگو را دریافت کنید.'}`, { disable_notification: true });
      const copied = await copyMessage(env, admin.chat_id, msg.chat.id, msg.message_id, { reply_markup: keyboard(assigned) });
      await insertMessage(env.DB, { direction:'user_to_admin', userId:user.id, adminId:admin.id, sourceChatId:msg.chat.id, sourceMessageId:msg.message_id, relayedMessageId:copied.message_id, contentType:info.type, textContent:info.text, fileId:info.fileId });
      void header;
    } catch {
      // One unavailable admin must not prevent delivery to other active admins.
    }
  }

  const online = isWithinBusinessHours(settings) && settings.away_mode !== '1' && activeAdmins.some(a => a.is_away !== 1);
  if (settings.auto_ack === '1') {
    // Always acknowledge a successfully received user message when auto-ack is enabled.
    // When support is offline, use the configured away message instead.
    await sendMessage(env, msg.chat.id, online ? (settings.ack_message || TEXT.ack) : (settings.away_message || TEXT.away));
  }
}

export async function blockUser(env, userId) {
  await setUserStatus(env.DB, userId, 'blocked');
}
