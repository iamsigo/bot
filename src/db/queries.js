const now = () => new Date().toISOString();

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(results.map(r => [r.key, r.value]));
}

export async function getSetting(db, key, fallback = '') {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row?.value ?? fallback;
}

export async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind(key, String(value)).run();
}

export async function getUser(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(Number(id)).first();
}

export async function upsertUser(db, from, chatId = from.id) {
  const id = Number(from.id);
  const existing = await getUser(db, id);
  if (existing) {
    await db.prepare(`UPDATE users SET chat_id=?, username=?, first_name=?, last_name=?, language_code=? WHERE id=?`)
      .bind(Number(chatId), from.username || null, from.first_name || null, from.last_name || null, from.language_code || null, id).run();
    return getUser(db, id);
  }
  await db.prepare(`INSERT INTO users(id,chat_id,username,first_name,last_name,language_code,status,tags,created_at,last_message_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, Number(chatId), from.username || null, from.first_name || null, from.last_name || null, from.language_code || null, 'active', '[]', now(), null).run();
  return getUser(db, id);
}

export async function touchUserMessage(db, userId) {
  await db.prepare('UPDATE users SET last_message_at=?, unread_count=unread_count+1 WHERE id=?').bind(now(), Number(userId)).run();
}

export async function clearUnread(db, userId) {
  await db.prepare('UPDATE users SET unread_count=0 WHERE id=?').bind(Number(userId)).run();
}

export async function getActiveAdmins(db) {
  const { results } = await db.prepare("SELECT * FROM admins WHERE is_active=1 ORDER BY role='super_admin' DESC, id").all();
  return results;
}

export async function getAdmin(db, id) {
  return db.prepare('SELECT * FROM admins WHERE id=?').bind(Number(id)).first();
}

export async function upsertBootstrappedAdmin(db, id, role = 'super_admin', displayName = 'مدیر ارشد') {
  const existing = await getAdmin(db, id);
  if (existing) {
    if (existing.role !== 'super_admin' && role === 'super_admin') {
      await db.prepare('UPDATE admins SET role=\'super_admin\', is_active=1 WHERE id=?').bind(Number(id)).run();
    } else if (!existing.is_active) {
      await db.prepare('UPDATE admins SET is_active=1 WHERE id=?').bind(Number(id)).run();
    }
    return getAdmin(db, id);
  }
  await db.prepare('INSERT INTO admins(id,chat_id,display_name,role,is_active,created_at) VALUES(?,?,?,?,1,?)')
    .bind(Number(id), Number(id), displayName || `مدیر ${id}`, role, now()).run();
  return getAdmin(db, id);
}

export async function createAdmin(db, id, chatId, name, addedBy) {
  await db.prepare(`INSERT INTO admins(id,chat_id,display_name,role,is_active,added_by,created_at) VALUES(?,?,?,'admin',1,?,?)`)
    .bind(Number(id), Number(chatId), name || `مدیر ${id}`, Number(addedBy), now()).run();
  return getAdmin(db, id);
}

export async function removeAdmin(db, id) {
  await db.prepare('UPDATE admins SET is_active=0 WHERE id=? AND role<>\'super_admin\'').bind(Number(id)).run();
}

export async function findAdmins(db, { limit = 50, offset = 0 } = {}) {
  return db.prepare('SELECT * FROM admins ORDER BY is_active DESC, role DESC, created_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all();
}

export async function listUsers(db, { q = '', status = '', assigned = '', tag = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const binds = [];
  if (q) {
    where.push('(CAST(id AS TEXT) LIKE ? OR username LIKE ? OR first_name LIKE ? OR last_name LIKE ?)');
    const s = `%${q.slice(0, 80)}%`;
    binds.push(s, s, s, s);
  }
  if (status === 'blocked' || status === 'active') { where.push('status=?'); binds.push(status); }
  if (assigned === 'unassigned') where.push('assigned_admin_id IS NULL');
  if (assigned === 'assigned') where.push('assigned_admin_id IS NOT NULL');
  if (tag) { where.push('tags LIKE ?'); binds.push(`%"${tag.replaceAll('"', '')}"%`); }
  const sql = `SELECT u.*, a.display_name AS admin_name FROM users u LEFT JOIN admins a ON a.id=u.assigned_admin_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(u.last_message_at,u.created_at) DESC LIMIT ? OFFSET ?`;
  binds.push(Number(limit), Number(offset));
  return db.prepare(sql).bind(...binds).all();
}

export async function countUsers(db, { q = '', status = '' } = {}) {
  const where = [], binds = [];
  if (q) { const s = `%${q.slice(0,80)}%`; where.push('(CAST(id AS TEXT) LIKE ? OR username LIKE ? OR first_name LIKE ? OR last_name LIKE ?)'); binds.push(s,s,s,s); }
  if (status) { where.push('status=?'); binds.push(status); }
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`).bind(...binds).first();
  return Number(row?.count || 0);
}

export async function getUserMessages(db, userId, limit = 200, offset = 0) {
  return db.prepare('SELECT * FROM messages WHERE user_id=? ORDER BY created_at ASC LIMIT ? OFFSET ?').bind(Number(userId), limit, offset).all();
}

export async function findMessageByRelayedId(db, relayedMessageId) {
  return db.prepare('SELECT * FROM messages WHERE relayed_message_id=? ORDER BY id DESC LIMIT 1').bind(Number(relayedMessageId)).first();
}

export async function insertMessage(db, data) {
  const result = await db.prepare(`INSERT INTO messages(direction,user_id,admin_id,source_chat_id,source_message_id,relayed_message_id,content_type,text_content,file_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(data.direction, Number(data.userId), data.adminId ? Number(data.adminId) : null, data.sourceChatId ? Number(data.sourceChatId) : null, data.sourceMessageId ? Number(data.sourceMessageId) : null, data.relayedMessageId ? Number(data.relayedMessageId) : null, data.contentType, data.textContent || null, data.fileId || null, now()).run();
  return result.meta?.last_row_id;
}

export async function setAssignment(db, userId, adminId) {
  await db.prepare('UPDATE users SET assigned_admin_id=? WHERE id=? AND status=\'active\'').bind(Number(adminId), Number(userId)).run();
}

export async function releaseAssignment(db, userId, adminId) {
  await db.prepare('UPDATE users SET assigned_admin_id=NULL WHERE id=? AND assigned_admin_id=?').bind(Number(userId), Number(adminId)).run();
}

export async function setUserStatus(db, userId, status) {
  await db.prepare('UPDATE users SET status=? WHERE id=?').bind(status, Number(userId)).run();
}

export async function updateUserTags(db, userId, tags) {
  const safe = Array.from(new Set((Array.isArray(tags) ? tags : []).map(v => String(v).trim().slice(0, 30)).filter(Boolean))).slice(0, 10);
  await db.prepare('UPDATE users SET tags=? WHERE id=?').bind(JSON.stringify(safe), Number(userId)).run();
}

export async function updateUserPriority(db, userId, priority) {
  await db.prepare('UPDATE users SET priority=? WHERE id=?').bind(priority ? 1 : 0, Number(userId)).run();
}

export async function getDashboardStats(db) {
  const [messages, open, activeAdmins, unassigned] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM messages WHERE created_at >= datetime('now','start of day')").first(),
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE status='active' AND last_message_at IS NOT NULL").first(),
    db.prepare('SELECT COUNT(*) AS count FROM admins WHERE is_active=1').first(),
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE status='active' AND assigned_admin_id IS NULL AND last_message_at IS NOT NULL").first()
  ]);
  return { messages: Number(messages?.count||0), open: Number(open?.count||0), activeAdmins: Number(activeAdmins?.count||0), unassigned: Number(unassigned?.count||0) };
}

export async function getDailyVolume(db, days = 14) {
  return db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS count FROM messages WHERE created_at >= datetime('now', ?) GROUP BY substr(created_at,1,10) ORDER BY day ASC`).bind(`-${Number(days)} days`).all();
}

export async function getAvgResponseTime(db, days = 14) {
  const rows = await db.prepare(`
    SELECT u.id AS user_id,
      AVG((julianday(a.created_at) - julianday(u.created_at)) * 86400.0) AS seconds
    FROM messages u JOIN messages a ON a.user_id=u.user_id
    WHERE u.direction='user_to_admin' AND a.direction='admin_to_user' AND a.created_at > u.created_at
      AND u.created_at >= datetime('now', ?)
    GROUP BY u.id
  `).bind(`-${Number(days)} days`).all();
  const vals = rows.results.map(r => Number(r.seconds)).filter(Number.isFinite);
  return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
}

export async function getCanned(db, limit = 100) {
  return db.prepare('SELECT * FROM canned_responses ORDER BY title LIMIT ?').bind(limit).all();
}

export async function getCannedById(db, id) { return db.prepare('SELECT * FROM canned_responses WHERE id=?').bind(Number(id)).first(); }
export async function createCanned(db, data) { return db.prepare('INSERT INTO canned_responses(shortcut,title,body_text,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(data.shortcut,data.title,data.bodyText,Number(data.createdBy),now(),now()).run(); }
export async function updateCanned(db, id, data) { return db.prepare('UPDATE canned_responses SET shortcut=?,title=?,body_text=?,updated_at=? WHERE id=?').bind(data.shortcut,data.title,data.bodyText,now(),Number(id)).run(); }
export async function deleteCanned(db, id) { return db.prepare('DELETE FROM canned_responses WHERE id=?').bind(Number(id)).run(); }

export async function createInvite(db, token, createdBy, expiresAt) {
  await db.prepare('INSERT INTO admin_invites(token,created_by,created_at,expires_at) VALUES(?,?,?,?)').bind(token,Number(createdBy),now(),expiresAt).run();
}
export async function consumeInvite(db, token, userId) {
  const row = await db.prepare('SELECT * FROM admin_invites WHERE token=?').bind(token).first();
  if (!row || row.used_by || new Date(row.expires_at).getTime() < Date.now()) return null;
  await db.prepare('UPDATE admin_invites SET used_by=? WHERE token=? AND used_by IS NULL').bind(Number(userId), token).run();
  return row;
}

export async function wasUpdateProcessed(db, updateId) { return Boolean(await db.prepare('SELECT 1 FROM processed_updates WHERE update_id=?').bind(Number(updateId)).first()); }
export async function markUpdateProcessed(db, updateId) {
  await db.prepare('INSERT OR IGNORE INTO processed_updates(update_id,processed_at) VALUES(?,?)').bind(Number(updateId),now()).run();
}

export async function createBroadcastJob(db, createdBy, segment, textContent, fileId, contentType, totalCount) {
  const r = await db.prepare('INSERT INTO broadcast_jobs(created_by,segment,message_text,file_id,content_type,status,total_count,created_at) VALUES(?,?,?,?,?,\'running\',?,?)').bind(Number(createdBy),segment,textContent||null,fileId||null,contentType||null,Number(totalCount),now()).run();
  return r.meta?.last_row_id;
}
export async function finishBroadcast(db, id, sent, failed) { await db.prepare("UPDATE broadcast_jobs SET status='finished',sent_count=?,failed_count=?,finished_at=? WHERE id=?").bind(sent,failed,now(),Number(id)).run(); }

export async function getBroadcastJob(db, id) { return db.prepare('SELECT * FROM broadcast_jobs WHERE id=?').bind(Number(id)).first(); }
export async function advanceBroadcastJob(db, id, cursor, sent, failed, done) {
  await db.prepare(`UPDATE broadcast_jobs SET cursor=?,sent_count=?,failed_count=?,status=?,finished_at=CASE WHEN ?=1 THEN ? ELSE finished_at END WHERE id=?`)
    .bind(Number(cursor),Number(sent),Number(failed),done?'finished':'running',done?1:0,done?new Date().toISOString():null,Number(id)).run();
}
export async function setBroadcastSource(db, id, chatId, messageId) {
  await db.prepare('UPDATE broadcast_jobs SET source_chat_id=?,source_message_id=? WHERE id=?').bind(Number(chatId),Number(messageId),Number(id)).run();
}
