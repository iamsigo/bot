import { getAdmin, getSettings, upsertBootstrappedAdmin, createInvite, getActiveAdmins } from '../db/queries.js';
import { sendMessage, answerCallbackQuery, telegram, setChatMenuButton } from '../telegram/api.js';
import { TEXT } from '../utils/i18n.js';

function superIds(env) { return String(env.SUPER_ADMIN_IDS || '').split(',').map(v => Number(v.trim())).filter(Boolean); }
export function isSuperId(env, id) { return superIds(env).includes(Number(id)); }

export async function bootstrapAdminIfNeeded(env, from) {
  if (isSuperId(env, from.id)) { const admin = await upsertBootstrappedAdmin(env.DB, from.id, 'super_admin', `${from.first_name || ''} ${from.last_name || ''}`.trim() || `مدیر ${from.id}`); await ensureMiniAppMenu(env, from.id); return admin; }
  const admin = await getAdmin(env.DB, from.id); if (admin?.is_active) await ensureMiniAppMenu(env, from.id); return admin;
}

export async function ensureMiniAppMenu(env, chatId) {
  const base = env.APP_URL || `https://${env.WORKER_HOST || 'REPLACE_WITH_WORKER_HOST'}`;
  if (base.includes('REPLACE_WITH')) return;
  const appUrl = `${base.replace(/\/$/, '')}/app-v8`;
  try { await setChatMenuButton(env, chatId, 'پنل مدیریت', appUrl); } catch {}
}

export async function handleCommand(env, msg) {
  const text = String(msg.text || '').trim();
  if (!text.startsWith('/')) return false;
  const [cmd, arg] = text.split(/\s+/, 2);
  const admin = await bootstrapAdminIfNeeded(env, msg.from);

  if (cmd === '/start') {
    await sendMessage(env, msg.chat.id, admin ? 'سلام 👋 پنل پشتیبانی آماده است. برای آمار از /stats و برای لینک دعوت از /invite استفاده کنید.' : TEXT.welcome);
    return true;
  }
  if (cmd === '/stats') {
    if (!admin) { await sendMessage(env, msg.chat.id, TEXT.notAdmin); return true; }
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM messages WHERE created_at >= datetime('now','start of day')").first();
    const open = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE status='active' AND last_message_at IS NOT NULL").first();
    const unassigned = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE status='active' AND assigned_admin_id IS NULL AND last_message_at IS NOT NULL").first();
    await sendMessage(env, msg.chat.id, `📊 آمار امروز\nپیام‌ها: ${row?.count || 0}\nگفتگوهای باز: ${open?.count || 0}\nبدون مدیر: ${unassigned?.count || 0}`);
    return true;
  }
  if (cmd === '/admins') {
    if (!admin || admin.role !== 'super_admin') { await sendMessage(env, msg.chat.id, TEXT.notAdmin); return true; }
    const { results } = await env.DB.prepare('SELECT * FROM admins ORDER BY is_active DESC, role DESC, display_name').all();
    const rows = results.map(a => ([{ text: `${a.is_active ? '🟢' : '⚪'} ${a.display_name} — ${a.role === 'super_admin' ? 'مدیر ارشد' : 'مدیر'}`, callback_data: 'noop' }, ...(a.role !== 'super_admin' ? [{ text: 'حذف', callback_data: `admin_remove:${a.id}` }] : [])]));
    await sendMessage(env, msg.chat.id, results.length ? 'مدیران فعلی:' : 'هنوز مدیری ثبت نشده است.', rows.length ? { reply_markup: { inline_keyboard: rows } } : {});
    return true;
  }
  if (cmd === '/invite') {
    if (!admin || admin.role !== 'super_admin') { await sendMessage(env, msg.chat.id, TEXT.notAdmin); return true; }
    const token = crypto.randomUUID().replaceAll('-', '');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await createInvite(env.DB, token, admin.id, expires);
    const bot = env.BOT_USERNAME || (await telegram(env, 'getMe', {})).username;
    const url = `https://t.me/${bot}?start=invite_${token}`;
    await sendMessage(env, msg.chat.id, TEXT.inviteCreated(url));
    return true;
  }
  if (cmd === '/panel') {
    if (!admin) { await sendMessage(env, msg.chat.id, TEXT.notAdmin); return true; }
    await ensureMiniAppMenu(env, msg.chat.id);
    await sendMessage(env, msg.chat.id, 'پنل مدیریت داخل همین ربات آماده است. از دکمه «پنل مدیریت» در پایین صفحه استفاده کنید.', { reply_markup: { inline_keyboard: [[{ text: '🛠️ باز کردن پنل مدیریت', web_app: { url: `${(env.APP_URL || '').replace(/\/$/, '')}/app-v8` } }]] } });
    return true;
  }
  if (cmd === '/away') {
    if (!admin) { await sendMessage(env, msg.chat.id, TEXT.notAdmin); return true; }
    const settings = await getSettings(env.DB); const next = settings.away_mode === '1' ? '0' : '1';
    await env.DB.prepare("INSERT INTO settings(key,value) VALUES('away_mode',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(next).run();
    await sendMessage(env, msg.chat.id, next === '1' ? 'حالت آفلاین فعال شد.' : 'حالت آفلاین غیرفعال شد.');
    return true;
  }
  if (cmd === '/help') {
    await sendMessage(env, msg.chat.id, 'دستورات مدیر:\n/stats آمار امروز\n/admins فهرست مدیران\n/invite ساخت لینک دعوت مدیر\n/away تغییر حالت آفلاین\n/panel اطلاعات پنل');
    return true;
  }
  return true;
}

export async function handleStartPayload(env, msg, payload) {
  if (!payload?.startsWith('invite_')) return false;
  const token = payload.slice(7);
  const existingSuper = isSuperId(env, msg.from.id);
  const invite = await (await import('../db/queries.js')).consumeInvite(env.DB, token, msg.from.id);
  if (!invite) { await sendMessage(env, msg.chat.id, TEXT.inviteInvalid); return true; }
  const existing = await getAdmin(env.DB, msg.from.id);
  if (!existing) {
    await (await import('../db/queries.js')).createAdmin(env.DB, msg.from.id, msg.chat.id, `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || `مدیر ${msg.from.id}`, invite.created_by);
  } else {
    await env.DB.prepare('UPDATE admins SET is_active=1, chat_id=?, display_name=? WHERE id=?').bind(msg.chat.id, `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || existing.display_name, msg.from.id).run();
  }
  await ensureMiniAppMenu(env, msg.chat.id);
  await sendMessage(env, msg.chat.id, TEXT.inviteAccepted);
  return true;
}

export async function handleAdminCallback(env, query) {
  const data = String(query.data || '');
  const admin = await bootstrapAdminIfNeeded(env, query.from);
  if (data === 'noop') { await answerCallbackQuery(env, query.id); return true; }
  if (!admin) { await answerCallbackQuery(env, query.id, TEXT.notAdmin, true); return true; }
  if (data.startsWith('admin_remove:')) {
    if (admin.role !== 'super_admin') { await answerCallbackQuery(env, query.id, TEXT.notAdmin, true); return true; }
    const target = Number(data.split(':')[1]);
    if (isSuperId(env, target)) { await answerCallbackQuery(env, query.id, 'مدیر ارشد اصلی را نمی‌توان حذف کرد.', true); return true; }
    await env.DB.prepare("UPDATE admins SET is_active=0 WHERE id=? AND role='admin'").bind(target).run();
    await answerCallbackQuery(env, query.id, 'مدیر غیرفعال شد.');
    return true;
  }
  return false;
}
