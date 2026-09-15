import { Hono } from 'hono';
import { getAdmin, findAdmins, getDashboardStats, listUsers, countUsers, getUser, getUserMessages, clearUnread, getCanned, createCanned, updateCanned, deleteCanned, setAssignment, releaseAssignment, setUserStatus, updateUserTags, updateUserPriority, getSettings, setSetting, createInvite, createBroadcastJob, getBroadcastJob, setBroadcastSource, advanceBroadcastJob, insertMessage, getDailyVolume, getAvgResponseTime } from '../db/queries.js';
import { telegram, sendMessage, copyMessage, uploadMedia, deleteMessage, setChatMenuButton } from '../telegram/api.js';
import { isSuperId } from '../handlers/commandHandler.js';
import { requireMiniAppAdmin } from '../utils/telegramWebAppAuth.js';

export const panel = new Hono();

function jsonError(c, message, status = 400) { return c.json({ ok: false, error: message }, status); }
function safeText(value, max = 4096) { return String(value ?? '').trim().slice(0, max); }

const APP_JS_V7 = "\nconst view=document.getElementById('view'),tabs=document.getElementById('tabs'),title=document.getElementById('title'),subtitle=document.getElementById('subtitle');let tg=null,initData='',me=null,section='dashboard',currentUser=null;\nconst esc=s=>String(s??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#039;'}[m]));\nfunction toast(s){const el=document.getElementById('toast');el.textContent=s;el.style.display='block';setTimeout(()=>el.style.display='none',2500)}\nfunction headers(){return initData?{'Authorization':'tma '+initData}:{}\n}\nasync function api(path,opt={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);try{const res=await fetch(path,{...opt,signal:controller.signal,headers:{...headers(),...(opt.headers||{})}});if(!res.ok){let d={};try{d=await res.json()}catch{}throw new Error(d.error||('خطای HTTP '+res.status))}return await res.json()}catch(e){if(e.name==='AbortError')throw new Error('ارتباط با سرور بیش از حد طول کشید. اتصال اینترنت یا Worker را بررسی کنید.');throw e}finally{clearTimeout(timer)}}\nfunction tab(id,label){return '<button class=\"'+(section===id?'active':'')+'\" onclick=\"go(\\''+id+'\\')\">'+label+'</button>'}\nfunction renderTabs(){tabs.innerHTML=tab('dashboard','داشبورد')+tab('conversations','گفتگوها')+tab('canned','پاسخ‌های آماده')+((me?.admin?.role==='super_admin')?tab('admins','مدیران'):'')+tab('broadcast','اطلاع‌رسانی')+tab('stats','آمار')+tab('settings','تنظیمات')}\nasync function boot(){\n  subtitle.textContent='در حال اتصال به Telegram… · نسخه ۸.۱';\n  tg=await loadTelegramBridge();\n  try{tg.ready();tg.expand();}catch{}\n  initData=String(tg.initData||'');\n  if(!initData) throw new Error('اطلاعات احراز هویت Telegram دریافت نشد. پنل را ببندید و دوباره از داخل ربات باز کنید.');\n  subtitle.textContent='در حال بررسی دسترسی…';\n  const r=await api('/api/admin/me');\n  me=r;subtitle.textContent='سلام '+esc(r.admin.display_name);renderTabs();await go('dashboard');\n}\nasync function go(s){section=s;renderTabs();currentUser=null;try{if(s==='dashboard')return dashboard();if(s==='conversations')return conversations();if(s==='canned')return canned();if(s==='admins')return admins();if(s==='broadcast')return broadcast();if(s==='stats')return stats();if(s==='settings')return settings()}catch(e){view.innerHTML='<div class=\"card empty\">'+esc(e.message)+'</div>'}}\nasync function dashboard(){const r=await api('/api/dashboard');view.innerHTML='<div class=\"grid\"><div class=\"card stat\"><b>'+r.stats.messages+'</b><span>پیام امروز</span></div><div class=\"card stat\"><b>'+r.stats.open+'</b><span>گفتگوی باز</span></div><div class=\"card stat\"><b>'+r.stats.unassigned+'</b><span>بدون مدیر</span></div><div class=\"card stat\"><b>'+r.stats.activeAdmins+'</b><span>مدیر فعال</span></div></div><div class=\"card\"><div class=\"section-title\">دسترسی سریع</div><div class=\"toolbar\"><button class=\"btn\" onclick=\"go(&#39;conversations&#39;)\">گفتگوها</button><button class=\"btn secondary\" onclick=\"go(&#39;broadcast&#39;)\">اطلاع‌رسانی</button></div></div>'}\nasync function conversations(page=1){const r=await api('/api/conversations?page='+page);view.innerHTML='<div class=\"card\"><div class=\"toolbar\"><input class=\"input\" id=\"search\" placeholder=\"جستجو نام، نام کاربری یا شناسه\"><select id=\"assigned\"><option value=\"\">همه</option><option value=\"unassigned\">بدون مدیر</option><option value=\"assigned\">دارای مدیر</option></select><button class=\"btn\" onclick=\"searchConversations()\">جستجو</button></div></div><div id=\"convlist\" class=\"list\">'+(r.items.length?r.items.map(u=>'<button class=\"item\" onclick=\"openConv('+u.id+')\"><div class=\"row\"><strong>'+esc([u.first_name,u.last_name].filter(Boolean).join(' ')||u.username||u.id)+'</strong><span class=\"pill '+(u.status==='blocked'?'red':'green')+'\">'+(u.status==='blocked'?'مسدود':'فعال')+'</span></div><span class=\"preview\">'+esc(u.unread_count?('🔔 '+u.unread_count+' خوانده‌نشده'):((u.tags||'')))+'</span></button>').join(''):'<div class=\"card empty\">گفتگویی پیدا نشد.</div>')+'</div><div class=\"toolbar\"><button class=\"btn secondary\" onclick=\"conversations('+Math.max(1,page-1)+')\">قبلی</button><button class=\"btn secondary\" onclick=\"conversations(' + (page+1) + ')\" '+(r.items.length<r.pageSize?'disabled':'')+'>بعدی</button></div>'}\nasync function searchConversations(){const q=encodeURIComponent(document.getElementById('search').value||'');const a=encodeURIComponent(document.getElementById('assigned').value||'');const r=await api('/api/conversations?q='+q+'&assigned='+a);document.getElementById('convlist').innerHTML=r.items.length?r.items.map(u=>'<button class=\"item\" onclick=\"openConv('+u.id+')\"><div class=\"row\"><strong>'+esc([u.first_name,u.last_name].filter(Boolean).join(' ')||u.username||u.id)+'</strong><span class=\"pill\">'+esc(u.admin_name||'بدون مدیر')+'</span></div><span class=\"preview\">'+esc(u.username?'@'+u.username:'شناسه '+u.id)+'</span></button>').join(''):'<div class=\"card empty\">نتیجه‌ای پیدا نشد.</div>'}\nasync function openConv(id){currentUser=id;const r=await api('/api/conversations/'+id);title.textContent='گفتگو';tabs.innerHTML='<button class=\"btn secondary\" onclick=\"go(\\'conversations\\')\">← بازگشت</button>';const name=[r.user.first_name,r.user.last_name].filter(Boolean).join(' ')||r.user.username||r.user.id;view.innerHTML='<div class=\"card\"><div class=\"row\"><div><strong>'+esc(name)+'</strong><div class=\"muted\">'+esc(r.user.username?'@'+r.user.username:'شناسه '+r.user.id)+'</div></div><span class=\"pill '+(r.user.priority?'red':'')+'\">'+(r.user.priority?'فوری':'عادی')+'</span></div><div class=\"toolbar\" style=\"margin-top:8px\"><button class=\"btn small\" onclick=\"claim('+id+')\">پاسخ دادن</button><button class=\"btn secondary small\" onclick=\"release('+id+')\">آزاد کردن</button><button class=\"btn danger small\" onclick=\"'+(r.user.status==='blocked'?'unblockUser('+id+')':'blockUser('+id+')')+'\">'+(r.user.status==='blocked'?'رفع مسدودی':'مسدود')+'</button><button class=\"btn secondary small\" onclick=\"downloadExport('+id+')\">خروجی CSV</button></div></div><div id=\"thread\" class=\"thread\">'+r.messages.map(m=>'<div class=\"msg '+(m.direction==='user_to_admin'?'user':'admin')+'\"><div class=\"meta\">'+esc(m.direction==='user_to_admin'?'کاربر':'مدیر')+' · '+esc(m.content_type)+'</div><div>'+esc(m.text_content||('['+m.content_type+']'))+'</div></div>').join('')+'</div><div class=\"card\"><textarea id=\"reply\" placeholder=\"پاسخ شما…\"></textarea><div class=\"toolbar\" style=\"margin-top:7px\"><input id=\"media\" type=\"file\" accept=\"image/*,video/*,audio/*,.pdf,.doc,.docx,.zip\" class=\"input\"><button class=\"btn\" onclick=\"sendReply('+id+')\">ارسال پاسخ</button></div></div>'}\nasync function claim(id){await api('/api/conversations/'+id+'/claim',{method:'POST'});toast('گفتگو به شما واگذار شد.');openConv(id)} async function release(id){await api('/api/conversations/'+id+'/release',{method:'POST'});toast('گفتگو آزاد شد.');openConv(id)} async function blockUser(id){if(!confirm('این کاربر مسدود شود؟'))return;await api('/api/conversations/'+id+'/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:'blocked'})});toast('کاربر مسدود شد.');openConv(id)} async function unblockUser(id){if(!confirm('مسدودی این کاربر برداشته شود؟'))return;await api('/api/conversations/'+id+'/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:'active'})});toast('رفع مسدودی انجام شد.');openConv(id)}\nasync function downloadExport(id){const res=await fetch('/api/conversations/'+id+'/export',{headers:headers()});if(!res.ok){toast('دانلود ناموفق بود.');return}const blob=await res.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='conversation-'+id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}\nasync function sendReply(id){const fd=new FormData();fd.append('text',document.getElementById('reply').value||'');const f=document.getElementById('media').files[0];if(f)fd.append('media',f);try{await api('/api/conversations/'+id+'/reply',{method:'POST',body:fd});toast('✅ پاسخ ارسال شد.');openConv(id)}catch(e){toast(e.message)}}\nasync function canned(){const r=await api('/api/canned');view.innerHTML='<div class=\"card\"><div class=\"section-title\">پاسخ جدید</div><input id=\"cs\" class=\"input\" placeholder=\"میانبر\"><input id=\"ct\" class=\"input\" style=\"margin-top:7px\" placeholder=\"عنوان\"><textarea id=\"cb\" style=\"margin-top:7px\" placeholder=\"متن پاسخ\"></textarea><button class=\"btn\" style=\"margin-top:7px\" onclick=\"addCanned()\">ثبت</button></div><div class=\"list\">'+r.items.map(x=>'<div class=\"card\"><div class=\"row\"><strong>'+esc(x.title)+'</strong><button class=\"btn danger small\" onclick=\"delCanned('+x.id+')\">حذف</button></div><div class=\"muted\">'+esc(x.shortcut)+'</div><div style=\"margin-top:5px\">'+esc(x.body_text)+'</div></div>').join('')+'</div>'} async function addCanned(){await api('/api/canned',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({shortcut:document.getElementById('cs').value,title:document.getElementById('ct').value,body_text:document.getElementById('cb').value})});toast('ذخیره شد.');canned()} async function delCanned(id){await api('/api/canned/'+id,{method:'DELETE'});toast('حذف شد.');canned()}\nasync function admins(){if(me.admin.role!=='super_admin')return;const r=await api('/api/admins');view.innerHTML='<div class=\"card\"><button class=\"btn\" onclick=\"invite()\">ساخت لینک دعوت</button><div id=\"invite\"></div></div><div class=\"list\">'+r.admins.map(a=>'<div class=\"card\"><div class=\"row\"><div><strong>'+esc(a.display_name)+'</strong><div class=\"muted\">'+esc(a.role==='super_admin'?'مدیر ارشد':'مدیر')+' · '+a.id+'</div></div>'+((a.role==='admin')?'<button class=\"btn danger small\" onclick=\"removeAdmin('+a.id+')\">حذف</button>':'')+'</div></div>').join('')+'</div>'} async function invite(){const r=await api('/api/admins/invite',{method:'POST'});document.getElementById('invite').innerHTML='<div class=\"card\"><div class=\"muted\">لینک دعوت ۲۴ ساعته</div><input class=\"input\" value=\"'+esc(r.url)+'\" readonly><button class=\"btn secondary\" style=\"margin-top:7px\" onclick=\"navigator.clipboard?.writeText('+JSON.stringify(r.url)+');toast(\\'کپی شد.\\')\">کپی لینک</button></div>'} async function removeAdmin(id){await api('/api/admins/'+id+'/remove',{method:'POST'});toast('مدیر غیرفعال شد.');admins()}\nasync function broadcast(){view.innerHTML='<div class=\"card\"><div class=\"section-title\">اطلاع‌رسانی همگانی</div><select id=\"seg\" class=\"input\"><option value=\"all\">همه کاربران فعال</option><option value=\"30d\">فعال در ۳۰ روز اخیر</option></select><textarea id=\"bt\" style=\"margin-top:7px\" placeholder=\"متن اطلاع‌رسانی\"></textarea><input id=\"bm\" type=\"file\" class=\"input\" style=\"margin-top:7px\" accept=\"image/*,video/*,audio/*,.pdf,.doc,.docx,.zip\"><button class=\"btn\" style=\"margin-top:7px\" onclick=\"startBroadcast()\">شروع ارسال</button><div id=\"bprog\" style=\"margin-top:10px\"></div></div>'} async function startBroadcast(){const fd=new FormData();fd.append('segment',document.getElementById('seg').value);fd.append('text',document.getElementById('bt').value||'');const f=document.getElementById('bm').files[0];if(f)fd.append('media',f);const r=await api('/api/broadcast/start',{method:'POST',body:fd});let done=false;while(!done){const b=await api('/api/broadcast/batch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({job_id:r.jobId})});document.getElementById('bprog').innerHTML='<div class=\"muted\">ارسال: '+b.sent+' موفق، '+b.failed+' ناموفق از '+b.total+'</div><div class=\"bar\"><i style=\"width:'+Math.min(100,Math.round((b.cursor/Math.max(1,b.total))*100))+'%\"></i></div>';done=b.done;if(!done)await new Promise(x=>setTimeout(x,350))}toast('ارسال اطلاع‌رسانی تمام شد.')}\nasync function stats(){const r=await api('/api/stats');const max=Math.max(1,...r.volume.map(x=>Number(x.count)));view.innerHTML='<div class=\"card\"><div class=\"section-title\">حجم پیام در ۱۴ روز اخیر</div>'+r.volume.map(x=>'<div style=\"margin:8px 0\"><div class=\"row\"><span>'+esc(x.day)+'</span><span>'+x.count+'</span></div><div class=\"bar\"><i style=\"width:'+Math.round(Number(x.count)/max*100)+'%\"></i></div></div>').join('')+'</div><div class=\"card\"><strong>'+Math.round(r.avgResponseSeconds/60)+'</strong><div class=\"muted\">میانگین زمان پاسخ (دقیقه)</div></div>'}\nasync function settings(){const r=await api('/api/settings');const s=r.settings;view.innerHTML='<div class=\"card\"><label><input type=\"checkbox\" id=\"away\" '+(s.away_mode==='1'?'checked':'')+'> حالت آفلاین</label><br><label><input type=\"checkbox\" id=\"ack\" '+(s.auto_ack==='1'?'checked':'')+'> تأیید خودکار دریافت پیام</label><br><label><input type=\"checkbox\" id=\"bh\" '+(s.business_hours_enabled==='1'?'checked':'')+'> ساعات کاری</label><input class=\"input\" id=\"start\" style=\"margin-top:10px\" value=\"'+esc(s.business_hours_start||'09:00')+'\" placeholder=\"شروع\"><input class=\"input\" id=\"end\" style=\"margin-top:7px\" value=\"'+esc(s.business_hours_end||'17:00')+'\" placeholder=\"پایان\"></div><div class=\"card\"><div class=\"section-title\">متن خوش‌آمدگویی</div><textarea id=\"welcome\">'+esc(s.welcome_message||'')+'</textarea><div class=\"section-title\">پیام دریافت شد</div><textarea id=\"ackmsg\">'+esc(s.ack_message||'')+'</textarea><div class=\"section-title\">پیام آفلاین</div><textarea id=\"awaymsg\">'+esc(s.away_message||'')+'</textarea><button class=\"btn\" style=\"margin-top:8px\" onclick=\"saveSettings()\">ذخیره تنظیمات</button></div>'} async function saveSettings(){const body={away_mode:document.getElementById('away').checked,auto_ack:document.getElementById('ack').checked,business_hours_enabled:document.getElementById('bh').checked,business_hours_start:document.getElementById('start').value,business_hours_end:document.getElementById('end').value,welcome_message:document.getElementById('welcome').value,ack_message:document.getElementById('ackmsg').value,away_message:document.getElementById('awaymsg').value};await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});toast('تنظیمات ذخیره شد.')}\nasync function loadTelegramBridge(){\n  if(window.Telegram?.WebApp) return window.Telegram.WebApp;\n  return await new Promise((resolve,reject)=>{\n    const existing=document.querySelector('script[data-telegram-webapp]');\n    if(existing){\n      const started=Date.now();\n      const poll=()=>{\n        if(window.Telegram?.WebApp) return resolve(window.Telegram.WebApp);\n        if(Date.now()-started>7000) return reject(new Error('کتابخانه رسمی Telegram در پنل بارگذاری نشد. پنل را ببندید و دوباره از داخل ربات باز کنید.'));\n        setTimeout(poll,100);\n      };\n      poll();\n      return;\n    }\n    const script=document.createElement('script');\n    script.src='https://telegram.org/js/telegram-web-app.js?63';\n    script.async=true;\n    script.dataset.telegramWebapp='1';\n    const timer=setTimeout(()=>{script.remove();reject(new Error('ارتباط با سرویس Telegram برای راه‌اندازی پنل برقرار نشد.'))},7000);\n    script.onload=()=>{clearTimeout(timer); if(window.Telegram?.WebApp) resolve(window.Telegram.WebApp); else reject(new Error('Telegram WebApp API در دسترس نشد.'))};\n    script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('بارگذاری کتابخانه Telegram ناموفق بود. اتصال اینترنت را بررسی کنید.'))};\n    document.head.appendChild(script);\n  });\n}\n\n(async()=>{try{await boot()}catch(e){subtitle.textContent='خطا در راه‌اندازی پنل';view.innerHTML='<div class=\"card empty\"><strong>پنل مدیریت آماده نشد.</strong><br><br>'+esc(e.message)+'</div>'}})();\n";

const serveMiniApp = (c) => { c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); c.header('Pragma', 'no-cache'); c.header('Expires', '0'); return c.html(MiniAppPage()); };
panel.get('/app', serveMiniApp);
panel.get('/app-v6', serveMiniApp);
panel.get('/app-v8', serveMiniApp);
panel.get('/app-v8.js', (c) => { c.header('Content-Type', 'application/javascript; charset=UTF-8'); c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); return c.body(APP_JS_V7); });
panel.get('/login', (c) => c.redirect('/app'));
panel.all('/login/*', (c) => c.redirect('/app'));
panel.all('/logout', (c) => c.redirect('/app'));

async function auth(c) {
  return requireMiniAppAdmin(c);
}

panel.get('/api/admin/me', async (c) => {
  const session = await auth(c);
  if (!session) return jsonError(c, 'دسترسی از داخل پنل تلگرام معتبر نیست.', 401);
  const settings = await getSettings(c.env.DB);
  return c.json({ ok: true, admin: session.admin, telegramUser: session.telegramUser, settings });
});

panel.get('/api/dashboard', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  return c.json({ ok: true, stats: await getDashboardStats(c.env.DB) });
});

panel.get('/api/conversations', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const page = Math.max(1, Number(c.req.query('page') || 1));
  const q = safeText(c.req.query('q'), 80);
  const status = ['active', 'blocked'].includes(c.req.query('status')) ? c.req.query('status') : '';
  const assigned = ['assigned', 'unassigned'].includes(c.req.query('assigned')) ? c.req.query('assigned') : '';
  const tag = safeText(c.req.query('tag'), 30);
  const limit = 30;
  const [items, total] = await Promise.all([
    listUsers(c.env.DB, { q, status, assigned, tag, limit, offset: (page - 1) * limit }),
    countUsers(c.env.DB, { q, status })
  ]);
  return c.json({ ok: true, page, pageSize: limit, total, items: items.results });
});

panel.get('/api/conversations/:id', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return jsonError(c, 'شناسه نامعتبر.', 400);
  const [user, messages, canned] = await Promise.all([
    getUser(c.env.DB, id), getUserMessages(c.env.DB, id, 200, 0), getCanned(c.env.DB, 50)
  ]);
  if (!user) return jsonError(c, 'گفتگو پیدا نشد.', 404);
  await clearUnread(c.env.DB, id);
  return c.json({ ok: true, user, messages: messages.results, canned: canned.results });
});

panel.post('/api/conversations/:id/claim', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const id = Number(c.req.param('id')); const user = await getUser(c.env.DB, id);
  if (!user) return jsonError(c, 'گفتگو پیدا نشد.', 404);
  if (user.status === 'blocked') return jsonError(c, 'این گفتگو مسدود شده است.', 409);
  if (user.assigned_admin_id && Number(user.assigned_admin_id) !== Number(session.admin.id)) return jsonError(c, 'این گفتگو توسط مدیر دیگری در حال رسیدگی است.', 409);
  await setAssignment(c.env.DB, id, session.admin.id);
  return c.json({ ok: true });
});

panel.post('/api/conversations/:id/release', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  await releaseAssignment(c.env.DB, Number(c.req.param('id')), session.admin.id);
  return c.json({ ok: true });
});

panel.post('/api/conversations/:id/status', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const body = await c.req.json().catch(() => ({}));
  const status = body.status === 'blocked' ? 'blocked' : 'active';
  await setUserStatus(c.env.DB, Number(c.req.param('id')), status);
  return c.json({ ok: true, status });
});

panel.post('/api/conversations/:id/tags', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const body = await c.req.json().catch(() => ({}));
  await updateUserTags(c.env.DB, Number(c.req.param('id')), Array.isArray(body.tags) ? body.tags : []);
  await updateUserPriority(c.env.DB, Number(c.req.param('id')), Boolean(body.priority));
  return c.json({ ok: true });
});

panel.post('/api/conversations/:id/reply', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const id = Number(c.req.param('id'));
  const user = await getUser(c.env.DB, id);
  if (!user || user.status === 'blocked') return jsonError(c, 'این گفتگو در دسترس نیست.', 404);
  if (user.assigned_admin_id && Number(user.assigned_admin_id) !== Number(session.admin.id)) return jsonError(c, 'ابتدا گفتگو را به خودتان اختصاص دهید.', 409);

  const contentType = c.req.header('content-type') || '';
  let text = ''; let file = null;
  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    text = safeText(body.text, 4096);
    if (body.media instanceof File && body.media.size > 0) file = body.media;
  } else {
    const body = await c.req.json().catch(() => ({}));
    text = safeText(body.text, 4096);
  }
  if (!text && !file) return jsonError(c, 'پیام خالی است.', 400);

  let result; let ct = 'text'; let fileId = null;
  if (file) {
    const type = file.type || '';
    const field = type.startsWith('image/') ? 'photo' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'document';
    result = await uploadMedia(c.env, user.chat_id, field, file, text);
    ct = field;
    fileId = field === 'photo' ? result.photo?.at(-1)?.file_id || null : result[field]?.file_id || null;
  } else {
    result = await sendMessage(c.env, user.chat_id, text);
  }
  await insertMessage(c.env.DB, {
    direction: 'admin_to_user', userId: user.id, adminId: session.admin.id,
    sourceChatId: session.admin.chat_id, sourceMessageId: null,
    relayedMessageId: result.message_id, contentType: ct, textContent: text, fileId
  });
  return c.json({ ok: true, message_id: result.message_id });
});

panel.get('/api/conversations/:id/export', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const user = await getUser(c.env.DB, Number(c.req.param('id'))); if (!user) return jsonError(c, 'گفتگو پیدا نشد.', 404);
  const rows = await getUserMessages(c.env.DB, user.id, 5000, 0);
  const lines = [['تاریخ', 'جهت', 'مدیر', 'نوع', 'متن'].join(',')];
  for (const r of rows.results) lines.push([r.created_at, r.direction, r.admin_id || '', r.content_type, String(r.text_content || '').replaceAll('"', '""')].map((v) => `"${v}"`).join(','));
  return new Response('\ufeff' + lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="conversation-${user.id}.csv"` } });
});

panel.get('/api/admins', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  if (session.admin.role !== 'super_admin') return jsonError(c, 'فقط مدیر ارشد دسترسی دارد.', 403);
  return c.json({ ok: true, admins: (await findAdmins(c.env.DB, { limit: 100, offset: 0 })).results });
});

panel.post('/api/admins/invite', async (c) => {
  const session = await auth(c); if (!session || session.admin.role !== 'super_admin') return jsonError(c, 'فقط مدیر ارشد دسترسی دارد.', 403);
  const token = crypto.randomUUID().replaceAll('-', '');
  await createInvite(c.env.DB, token, session.admin.id, new Date(Date.now() + 86400000).toISOString());
  const bot = c.env.BOT_USERNAME || (await telegram(c.env, 'getMe', {})).username;
  return c.json({ ok: true, url: `https://t.me/${bot}?start=invite_${token}` });
});

panel.post('/api/admins/:id/remove', async (c) => {
  const session = await auth(c); if (!session || session.admin.role !== 'super_admin') return jsonError(c, 'فقط مدیر ارشد دسترسی دارد.', 403);
  const target = Number(c.req.param('id'));
  if (isSuperId(c.env, target)) return jsonError(c, 'مدیر ارشد اصلی را نمی‌توان حذف کرد.', 409);
  await c.env.DB.prepare("UPDATE admins SET is_active=0 WHERE id=? AND role='admin'").bind(target).run();
  return c.json({ ok: true });
});

panel.get('/api/canned', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  return c.json({ ok: true, items: (await getCanned(c.env.DB, 100)).results });
});

panel.post('/api/canned', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const b = await c.req.json().catch(() => ({}));
  const shortcut = safeText(b.shortcut, 50), title = safeText(b.title, 100), bodyText = safeText(b.body_text, 4096);
  if (!shortcut || !title || !bodyText) return jsonError(c, 'اطلاعات پاسخ آماده کامل نیست.');
  await createCanned(c.env.DB, { shortcut, title, bodyText, createdBy: session.admin.id });
  return c.json({ ok: true });
});

panel.put('/api/canned/:id', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const b = await c.req.json().catch(() => ({}));
  await updateCanned(c.env.DB, Number(c.req.param('id')), { shortcut: safeText(b.shortcut, 50), title: safeText(b.title, 100), bodyText: safeText(b.body_text, 4096) });
  return c.json({ ok: true });
});

panel.delete('/api/canned/:id', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  await deleteCanned(c.env.DB, Number(c.req.param('id'))); return c.json({ ok: true });
});

panel.get('/api/settings', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  return c.json({ ok: true, settings: await getSettings(c.env.DB) });
});

panel.put('/api/settings', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const b = await c.req.json().catch(() => ({}));
  for (const key of ['away_mode', 'auto_ack', 'business_hours_enabled']) await setSetting(c.env.DB, key, b[key] ? '1' : '0');
  for (const key of ['welcome_message', 'ack_message', 'away_message', 'business_hours_start', 'business_hours_end']) if (b[key] !== undefined) await setSetting(c.env.DB, key, safeText(b[key], 4096));
  return c.json({ ok: true, settings: await getSettings(c.env.DB) });
});

panel.get('/api/stats', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  return c.json({ ok: true, volume: (await getDailyVolume(c.env.DB, 14)).results, avgResponseSeconds: await getAvgResponseTime(c.env.DB, 14) });
});

panel.post('/api/broadcast/start', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const contentType = c.req.header('content-type') || '';
  let segment = 'all', text = '', file = null;
  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody(); segment = body.segment === '30d' ? '30d' : 'all'; text = safeText(body.text, 4096); if (body.media instanceof File && body.media.size) file = body.media;
  } else { const body = await c.req.json().catch(() => ({})); segment = body.segment === '30d' ? '30d' : 'all'; text = safeText(body.text, 4096); }
  const countRow = segment === '30d'
    ? await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE status='active' AND last_message_at >= datetime('now','-30 days')").first()
    : await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE status='active'").first();
  const total = Number(countRow?.count || 0);
  if (!total) return jsonError(c, 'کاربری برای ارسال پیدا نشد.', 409);
  const jobId = await createBroadcastJob(c.env.DB, session.admin.id, segment, text, null, null, total);
  if (file) {
    const field = (file.type || '').startsWith('image/') ? 'photo' : (file.type || '').startsWith('video/') ? 'video' : (file.type || '').startsWith('audio/') ? 'audio' : 'document';
    const staged = await uploadMedia(c.env, session.admin.chat_id, field, file, text.slice(0, 1024));
    await setBroadcastSource(c.env.DB, jobId, session.admin.chat_id, staged.message_id);
  }
  return c.json({ ok: true, jobId, total });
});

panel.post('/api/broadcast/batch', async (c) => {
  const session = await auth(c); if (!session) return jsonError(c, 'دسترسی غیرمجاز.', 401);
  const body = await c.req.json().catch(() => ({})); const job = await getBroadcastJob(c.env.DB, Number(body.job_id));
  if (!job || Number(job.created_by) !== Number(session.admin.id) || job.status === 'finished') return jsonError(c, 'ارسال پیدا نشد.', 404);
  const batchSize = 20;
  const query = job.segment === '30d'
    ? "SELECT id,chat_id FROM users WHERE status='active' AND last_message_at >= datetime('now','-30 days') ORDER BY id LIMIT ? OFFSET ?"
    : "SELECT id,chat_id FROM users WHERE status='active' ORDER BY id LIMIT ? OFFSET ?";
  const rows = await c.env.DB.prepare(query).bind(batchSize, Number(job.cursor)).all();
  let sent = Number(job.sent_count), failed = Number(job.failed_count);
  for (const user of rows.results) {
    try {
      if (job.source_chat_id && job.source_message_id) await copyMessage(c.env, user.chat_id, job.source_chat_id, job.source_message_id);
      else await sendMessage(c.env, user.chat_id, job.message_text || '');
      sent++;
    } catch { failed++; }
  }
  const cursor = Number(job.cursor) + rows.results.length; const done = cursor >= Number(job.total_count);
  await advanceBroadcastJob(c.env.DB, job.id, cursor, sent, failed, done);
  if (done && job.source_chat_id && job.source_message_id) { try { await deleteMessage(c.env, job.source_chat_id, job.source_message_id); } catch {} }
  return c.json({ ok: true, done, sent, failed, total: Number(job.total_count), cursor });
});

function MiniAppPage() {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#111827"><title>پشتیبانی</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet"><style>
:root{--bg:#f5f7fb;--card:#fff;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#2563eb;--danger:#dc2626;--ok:#16a34a}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Vazirmatn,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Tahoma,sans-serif}button,input,textarea,select{font:inherit}button{cursor:pointer}.app{min-height:100vh;padding:env(safe-area-inset-top) 12px env(safe-area-inset-bottom)}.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(12px);padding:10px 2px}.top h1{font-size:20px;margin:0}.top p{margin:3px 0;color:var(--muted);font-size:12px}.tabs{display:flex;gap:6px;overflow:auto;padding:7px 0}.tabs button{border:0;background:var(--card);color:var(--muted);padding:9px 11px;border-radius:12px;white-space:nowrap;box-shadow:0 1px 3px #00000010}.tabs button.active{background:var(--accent);color:#fff}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;margin:8px 0;box-shadow:0 1px 4px #00000008}.stat b{font-size:24px;display:block}.stat span,.muted{color:var(--muted);font-size:12px}.row{display:flex;align-items:center;justify-content:space-between;gap:8px}.pill{display:inline-flex;align-items:center;padding:4px 7px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:11px}.pill.green{background:#ecfdf5;color:#166534}.pill.red{background:#fef2f2;color:#991b1b}.list{display:grid;gap:8px}.item{border:1px solid var(--line);background:var(--card);border-radius:14px;padding:10px;text-align:right;width:100%}.item:active{transform:scale(.99)}.preview{color:var(--muted);font-size:12px;margin-top:4px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.toolbar{display:flex;gap:7px;flex-wrap:wrap}.toolbar>*{flex:1;min-width:110px}.input,textarea,select{width:100%;border:1px solid var(--line);background:var(--card);border-radius:12px;padding:10px;outline:none}.input:focus,textarea:focus,select:focus{border-color:var(--accent)}textarea{min-height:110px;resize:vertical}.btn{border:0;border-radius:11px;padding:10px 12px;background:var(--accent);color:#fff}.btn.secondary{background:#eef2f7;color:#0f172a}.btn.danger{background:var(--danger)}.btn.ok{background:var(--ok)}.btn.small{padding:7px 9px;font-size:12px}.thread{display:grid;gap:7px}.msg{max-width:88%;padding:9px 11px;border-radius:14px;border:1px solid var(--line);background:var(--card)}.msg.user{margin-left:auto;background:#eff6ff;border-color:#dbeafe}.msg.admin{margin-right:auto}.msg .meta{font-size:10px;color:var(--muted);margin-bottom:4px}.empty{text-align:center;padding:32px;color:var(--muted)}.hidden{display:none!important}.bar{height:9px;background:#e2e8f0;border-radius:999px;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent)}.toast{position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom) + 12px);z-index:20;background:#111827;color:#fff;padding:11px 13px;border-radius:12px;display:none}.section-title{font-size:14px;font-weight:700;margin:14px 2px 7px}.kv{display:grid;grid-template-columns:1fr 1fr;gap:7px}.kv>div{background:var(--card);padding:9px;border-radius:12px;border:1px solid var(--line)}
</style></head><body><div class="app"><div class="top"><h1 id="title">پنل مدیریت</h1><p id="subtitle">نسخه ۸ · در حال راه‌اندازی…</p><div class="tabs" id="tabs"></div></div><main id="view"></main></div><div id="toast" class="toast"></div><script src="/app-v8.js" defer></script></body></html>`;
}
