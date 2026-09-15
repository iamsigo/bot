import { Hono } from 'hono';
import { handleTelegramWebhook } from './telegram/webhook.js';
import { panel } from './admin-panel/routes.js';

const app = new Hono();
app.get('/health', c => c.json({ ok: true, service: 'telegram-support-bot', time: new Date().toISOString() }));
app.post('/telegram/webhook', handleTelegramWebhook);
app.route('/', panel);
app.get('/', c => c.redirect('/app'));
app.get('/robots.txt', c => c.text('User-agent: *\nDisallow: /'));
app.notFound(c => c.json({ ok: false, error: 'یافت نشد' }, 404));
app.onError((err, c) => { console.error(err); return c.json({ ok: false, error: 'خطای داخلی' }, 500); });
export default app;
