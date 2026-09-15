import { wasUpdateProcessed, markUpdateProcessed, getUser } from '../db/queries.js';
import { handleUserMessage } from '../handlers/userHandler.js';
import { handleAdminReply, handleAdminCallback } from '../handlers/adminHandler.js';
import { handleCommand, handleStartPayload, bootstrapAdminIfNeeded } from '../handlers/commandHandler.js';
import { answerCallbackQuery } from './api.js';

export async function handleTelegramWebhook(c) {
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (!secret || secret !== c.env.WEBHOOK_SECRET) return c.json({ ok:false }, 401);
  let update;
  try { update = await c.req.json(); } catch { return c.json({ok:false},400); }
  if (!update?.update_id) return c.json({ok:true});
  if (await wasUpdateProcessed(c.env.DB, update.update_id)) return c.json({ok:true});
  await markUpdateProcessed(c.env.DB, update.update_id);
  c.executionCtx.waitUntil(processUpdate(c.env, update));
  return c.json({ok:true});
}

async function processUpdate(env, update) {
  try {
    if (update.callback_query) {
      const handled = await handleAdminCallback(env, update.callback_query);
      if (!handled) await answerCallbackQuery(env, update.callback_query.id);
      return;
    }
    const msg = update.message;
    if (!msg?.from || msg.from.is_bot) return;
    if (msg.chat.type === 'private' && String(msg.text||'').startsWith('/start')) {
      const payload = String(msg.text||'').split(/\s+/,2)[1] || '';
      if (payload && await handleStartPayload(env,msg,payload)) return;
      const admin = await bootstrapAdminIfNeeded(env,msg.from);
      if (!admin) {
        const user = await (await import('../db/queries.js')).upsertUser(env.DB,msg.from,msg.chat.id);
        if (user.status === 'blocked') { const {sendMessage}=await import('./api.js'); await sendMessage(env,msg.chat.id,(await (await import('../db/queries.js')).getSetting(env.DB,'blocked_message','متأسفانه دسترسی شما به این ربات مسدود شده است.'))); return; }
        const { sendMessage }=await import('./api.js'); const welcome=await (await import('../db/queries.js')).getSetting(env.DB,'welcome_message','سلام 👋 به پشتیبانی خوش اومدید! پیام، عکس، ویدیو یا صدای خودتون رو همینجا بفرستید، یکی از همکاران ما در اسرع وقت پاسخ می‌ده.'); await sendMessage(env,msg.chat.id,welcome); return;
      }
      if (await handleCommand(env,msg)) return;
    }
    if (msg.chat.type === 'private') {
      if (await handleAdminReply(env,msg)) return;
      const admin = await bootstrapAdminIfNeeded(env,msg.from);
      if (admin?.is_active && String(msg.text||'').startsWith('/')) { if (await handleCommand(env,msg)) return; }
    }
    await handleUserMessage(env,msg);
  } catch (error) {
    console.error('update processing failed', error);
  }
}
