import { answerCallbackQuery, copyMessage, editMessageReplyMarkup, sendMessage } from '../telegram/api.js';
import { getAdmin, getUser, findMessageByRelayedId, setAssignment, releaseAssignment, setUserStatus, updateUserTags, updateUserPriority, getCanned, insertMessage } from '../db/queries.js';
import { TEXT, esc } from '../utils/i18n.js';
import { bootstrapAdminIfNeeded, isSuperId } from './commandHandler.js';

export async function handleAdminReply(env, msg) {
  const admin = await bootstrapAdminIfNeeded(env, msg.from);
  if (!admin || !admin.is_active) return false;
  if (msg.chat.type !== 'private') return false;
  if (String(msg.text || '').startsWith('/')) return false;

  let mapping = null;
  const replied = msg.reply_to_message;
  if (replied) {
    mapping = await findMessageByRelayedId(env.DB, replied.message_id);
    if (mapping && Number(mapping.admin_id) !== Number(admin.id)) mapping = null;
  }

  // After an admin presses «پاسخ دادن», the next ordinary message is treated
  // as the reply even if Telegram did not turn it into a reply-to message.
  if (!mapping) {
    const activeUserId = await env.KV.get(`active_reply:${admin.id}`);
    if (activeUserId) {
      const activeUser = await getUser(env.DB, Number(activeUserId));
      if (activeUser && activeUser.status !== 'blocked' && Number(activeUser.assigned_admin_id) === Number(admin.id)) {
        const latest = await env.DB.prepare(
          "SELECT * FROM messages WHERE user_id=? AND direction='user_to_admin' ORDER BY id DESC LIMIT 1"
        ).bind(Number(activeUser.id)).first();
        if (latest) mapping = latest;
      }
    }
  }

  if (!mapping) return false;

  const user = await getUser(env.DB, mapping.user_id);
  if (!user || user.status === 'blocked') {
    await env.KV.delete(`active_reply:${admin.id}`);
    await sendMessage(env, msg.chat.id, 'این گفتگو دیگر فعال نیست.');
    return true;
  }

  try {
    const copied = await copyMessage(env, user.chat_id, msg.chat.id, msg.message_id);
    const text = msg.text || msg.caption || '';
    const contentType = msg.text ? 'text' : msg.photo ? 'photo' : msg.video ? 'video' : msg.voice ? 'voice' : msg.document ? 'document' : msg.animation ? 'animation' : msg.audio ? 'audio' : msg.sticker ? 'sticker' : msg.location ? 'location' : msg.contact ? 'contact' : msg.poll ? 'poll' : 'unknown';
    const fileId = msg.photo?.at(-1)?.file_id || msg.video?.file_id || msg.voice?.file_id || msg.document?.file_id || msg.animation?.file_id || msg.audio?.file_id || msg.sticker?.file_id || null;
    await insertMessage(env.DB, { direction:'admin_to_user', userId:user.id, adminId:admin.id, sourceChatId:msg.chat.id, sourceMessageId:msg.message_id, relayedMessageId:copied.message_id, contentType, textContent:text, fileId });
    // Keep the selected conversation active so the admin can send several
    // consecutive messages without having to press «پاسخ دادن» each time.
    await env.KV.put(`active_reply:${admin.id}`, String(user.id), { expirationTtl: 3600 });
    await sendMessage(env, msg.chat.id, TEXT.replySent);
  } catch (error) {
    await sendMessage(env, msg.chat.id, `ارسال پاسخ ناموفق بود: ${esc(error.message || 'خطای تلگرام')}`);
  }
  return true;
}

export async function handleAdminCallback(env, query) {
  const admin = await bootstrapAdminIfNeeded(env, query.from);
  const data = String(query.data || '');
  if (!admin || !admin.is_active) { await answerCallbackQuery(env, query.id, TEXT.notAdmin, true); return true; }
  const mapping = query.message ? await findMessageByRelayedId(env.DB, query.message.message_id) : null;

  if (data === 'claim' && mapping) {
    const user = await getUser(env.DB, mapping.user_id);
    if (!user || user.status === 'blocked') { await answerCallbackQuery(env, query.id, 'این گفتگو مسدود شده است.', true); return true; }
    if (user.assigned_admin_id && Number(user.assigned_admin_id) !== Number(admin.id)) {
      const owner = await getAdmin(env.DB, user.assigned_admin_id);
      await answerCallbackQuery(env, query.id, owner ? TEXT.assigned(owner.display_name) : 'این گفتگو توسط مدیر دیگری گرفته شده است.', true);
      return true;
    }
    await setAssignment(env.DB, user.id, admin.id);
    await env.KV.put(`active_reply:${admin.id}`, String(user.id), { expirationTtl: 3600 });
    await editMessageReplyMarkup(env, query.message.chat.id, query.message.message_id, { inline_keyboard: [[{text:TEXT.release,callback_data:'release'},{text:TEXT.block,callback_data:'block'}],[{text:'پاسخ‌های آماده',callback_data:'canned'}]] });
    await answerCallbackQuery(env, query.id, 'گفتگو به شما واگذار شد ✅');
    await sendMessage(env, admin.chat_id, '✅ گفتگو فعال شد. پیام بعدی شما برای همین کاربر ارسال می‌شود.');
    return true;
  }
  if (data === 'release' && mapping) {
    const user = await getUser(env.DB, mapping.user_id);
    if (!user || Number(user.assigned_admin_id) !== Number(admin.id)) { await answerCallbackQuery(env, query.id, 'این گفتگو متعلق به شما نیست.', true); return true; }
    await releaseAssignment(env.DB, user.id, admin.id);
    await env.KV.delete(`active_reply:${admin.id}`);
    await editMessageReplyMarkup(env, query.message.chat.id, query.message.message_id, { inline_keyboard: [[{text:TEXT.claim,callback_data:'claim'},{text:TEXT.block,callback_data:'block'}],[{text:'پاسخ‌های آماده',callback_data:'canned'}]] });
    await answerCallbackQuery(env, query.id, 'گفتگو آزاد شد.');
    await sendMessage(env, admin.chat_id, 'گفتگو آزاد شد و دوباره در صف پشتیبانی قرار گرفت.');
    return true;
  }
  if (data === 'block' && mapping) {
    const user = await getUser(env.DB, mapping.user_id);
    if (!user) return true;
    await setUserStatus(env.DB, user.id, 'blocked');
    await answerCallbackQuery(env, query.id, 'کاربر مسدود شد.');
    try { await sendMessage(env, user.chat_id, 'متأسفانه دسترسی شما به این ربات مسدود شده است.'); } catch {}
    return true;
  }
  if (data === 'unblock:user' || data.startsWith('unblock:')) {
    const userId = Number(data.split(':')[1]);
    await setUserStatus(env.DB, userId, 'active');
    await answerCallbackQuery(env, query.id, 'رفع مسدودی انجام شد.');
    return true;
  }
  if (data === 'canned' && mapping) {
    const canned = await getCanned(env.DB, 12);
    const rows = canned.results.map(c => ([{ text: c.title.slice(0, 48), callback_data:`canned_send:${c.id}:${mapping.user_id}` }]));
    await sendMessage(env, admin.chat_id, rows.length ? 'یک پاسخ آماده انتخاب کنید:' : 'هنوز پاسخ آماده‌ای ثبت نشده است.', rows.length ? { reply_markup:{inline_keyboard:rows} } : {});
    await answerCallbackQuery(env, query.id);
    return true;
  }
  if (data.startsWith('canned_send:')) {
    const [, cannedId, userId] = data.split(':');
    const canned = await env.DB.prepare('SELECT * FROM canned_responses WHERE id=?').bind(Number(cannedId)).first();
    const user = await getUser(env.DB, Number(userId));
    if (!canned || !user) { await answerCallbackQuery(env, query.id, TEXT.genericError, true); return true; }
    await sendMessage(env, user.chat_id, canned.body_text);
    await insertMessage(env.DB, { direction:'admin_to_user', userId:user.id, adminId:admin.id, sourceChatId:admin.chat_id, sourceMessageId:null, relayedMessageId:null, contentType:'text', textContent:canned.body_text });
    await answerCallbackQuery(env, query.id, TEXT.replySent);
    return true;
  }
  return false;
}
