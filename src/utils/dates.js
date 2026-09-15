export function jalali(dateInput, locale = 'fa-IR-u-ca-persian', timeZone = 'Asia/Tehran') {
  const d = new Date(dateInput);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(d);
}

export function todayIso() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function isWithinBusinessHours(settings, now = new Date()) {
  if (settings.business_hours_enabled !== '1') return true;
  const tz = settings.timezone || 'Asia/Tehran';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const current = Number(map.hour) * 60 + Number(map.minute);
  const [sh, sm] = String(settings.business_hours_start || '09:00').split(':').map(Number);
  const [eh, em] = String(settings.business_hours_end || '17:00').split(':').map(Number);
  const start = sh * 60 + sm, end = eh * 60 + em;
  return start <= end ? current >= start && current < end : current >= start || current < end;
}
