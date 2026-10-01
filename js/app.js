/* ============================================================
   TASKFLOW v2 — ENGINE
   ============================================================ */
'use strict';

/* Configuración de la nube.
   Copia js/config.example.js a js/config.js y pon ahí tus valores.
   js/config.js está en .gitignore y NUNCA se sube al repositorio.
   La llave "anon" es pública por diseño: la seguridad real viene del login
   (Supabase Auth) y de las políticas RLS en la base de datos. */
const APP_CONFIG = (typeof window !== 'undefined' && window.APP_CONFIG) || {};
const TF_DEFAULT_URL = APP_CONFIG.SUPABASE_URL || '';
const TF_DEFAULT_ANON_KEY = APP_CONFIG.SUPABASE_ANON_KEY || '';

/* ============ STORAGE ============ */
const DB = {
  TASKS: 'tf3_tasks',
  HISTORY: 'tf3_history',
  GUIDES: 'tf3_guides',
  load(k){ try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  save(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); if (k === 'tf3_tasks') { try { localStorage.setItem('tf3_tasks_backup', localStorage.getItem(k)); localStorage.setItem('tf3_tasks_backup_at', String(Date.now())); } catch {} } if (k==='tf3_tasks'||k==='tf3_history'||k==='tf3_guides'){ try { localStorage.setItem('tf3_local_modified', new Date().toISOString()); } catch {} if (typeof scheduleCloudPush==='function') scheduleCloudPush(); } return true; } catch(e){ handleStorageError(e); return false; } },
  // Distinguish "key is absent" (new user) from "key exists but unreadable" (corruption)
  keyExists(k){ return localStorage.getItem(k) !== null; },
  raw(k){ return localStorage.getItem(k); },
};

/* ============ CLOUD SYNC (Supabase) ============
   Optional cloud backup. If configured, tasks sync automatically.
   Config is stored in localStorage so the user pastes it once. */
const CLOUD = {
  get url(){ return localStorage.getItem('tf3_cloud_url') || TF_DEFAULT_URL; },
  get key(){ return localStorage.getItem('tf3_cloud_key') || TF_DEFAULT_ANON_KEY || ''; },
  // --- AUTH state ---
  get token(){ return localStorage.getItem('tf3_auth_token') || ''; },
  get refreshToken(){ return localStorage.getItem('tf3_auth_refresh') || ''; },
  get authUserId(){ return localStorage.getItem('tf3_auth_uid') || ''; },
  get authEmail(){ return localStorage.getItem('tf3_auth_email') || ''; },
  get isLoggedIn(){ return !!(this.token && this.authUserId); },
  get userId(){
    // When logged in, the slot is the authenticated user's id (private per account).
    if (this.authUserId) return this.authUserId;
    // Fallback for legacy (pre-auth) data
    let id = localStorage.getItem('tf3_cloud_userid');
    if (!id){ id = 'taskflow-main-user'; localStorage.setItem('tf3_cloud_userid', id); }
    return id;
  },
  get configured(){ return !!(this.url && this.key); },
  set(url, key){
    localStorage.setItem('tf3_cloud_url', url.trim().replace(/\/$/,''));
    localStorage.setItem('tf3_cloud_key', key.trim());
  },
  clear(){
    localStorage.removeItem('tf3_cloud_url');
    localStorage.removeItem('tf3_cloud_key');
  },
  saveSession(session){
    if (!session) return;
    try {
      if (session.access_token) localStorage.setItem('tf3_auth_token', session.access_token);
      if (session.refresh_token) localStorage.setItem('tf3_auth_refresh', session.refresh_token);
      const u = session.user || {};
      if (u.id) localStorage.setItem('tf3_auth_uid', u.id);
      if (u.email) localStorage.setItem('tf3_auth_email', u.email);
    } catch {}
  },
  clearSession(){
    localStorage.removeItem('tf3_auth_token');
    localStorage.removeItem('tf3_auth_refresh');
    localStorage.removeItem('tf3_auth_uid');
    localStorage.removeItem('tf3_auth_email');
  },
  // Sign up a new account
  async signUp(email, password){
    if (!this.configured) return { ok:false, msg:'Falta configurar la nube' };
    try {
      const res = await fetch(`${this.url}/auth/v1/signup`, {
        method:'POST',
        headers:{ 'apikey': this.key, 'Content-Type':'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { ok:false, msg: data.msg || data.error_description || data.error || 'No se pudo crear la cuenta' };
      // Supabase may or may not return a session on signup (depends on email confirm setting)
      if (data.access_token){ this.saveSession(data); return { ok:true, session:true }; }
      if (data.user && data.session){ this.saveSession(data.session); return { ok:true, session:true }; }
      // No session = email confirmation required
      return { ok:true, session:false };
    } catch(e){ return { ok:false, msg:'No se pudo conectar' }; }
  },
  // Log in
  async signIn(email, password){
    if (!this.configured) return { ok:false, msg:'Falta configurar la nube' };
    try {
      const res = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
        method:'POST',
        headers:{ 'apikey': this.key, 'Content-Type':'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { ok:false, msg: data.msg || data.error_description || data.error || 'Correo o contraseña incorrectos' };
      this.saveSession(data);
      return { ok:true };
    } catch(e){ return { ok:false, msg:'No se pudo conectar' }; }
  },
  // Refresh an expired token
  async refreshSession(){
    if (!this.refreshToken) return false;
    try {
      const res = await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
        method:'POST',
        headers:{ 'apikey': this.key, 'Content-Type':'application/json' },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.saveSession(data);
      return true;
    } catch(e){ return false; }
  },
  async signOut(){
    try {
      await fetch(`${this.url}/auth/v1/logout`, { method:'POST', headers: this.authHeaders() });
    } catch {}
    this.clearSession();
  },
  // Headers for authenticated data requests (uses the user's token)
  authHeaders(){
    const bearer = this.token || this.key;
    return {
      'apikey': this.key,
      'Authorization': `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    };
  },
  headers(){ return this.authHeaders(); },
  async push(){
    if (!this.configured) return false;
    try {
      const stamp = new Date().toISOString();
      const payload = {
        user_id: this.userId,
        data: JSON.stringify({
          tasks: DB.load(DB.TASKS) || [],
          history: DB.load(DB.HISTORY) || [],
          guides: DB.load(DB.GUIDES) || [],
          deleted: JSON.parse(localStorage.getItem('tf3_deleted')||'[]'),
          savedAt: stamp,
        }),
        updated_at: stamp,
      };
      let res = await fetch(`${this.url}/rest/v1/taskflow_data?on_conflict=user_id`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(payload),
      });
      // If token expired, refresh once and retry
      if (res.status === 401 && this.refreshToken){
        const ok = await this.refreshSession();
        if (ok) res = await fetch(`${this.url}/rest/v1/taskflow_data?on_conflict=user_id`, { method:'POST', headers:this.authHeaders(), body:JSON.stringify(payload) });
      }
      if (res.ok){ try { localStorage.setItem('tf3_last_sync', stamp); } catch {} }
      return res.ok;
    } catch(e){ console.warn('Cloud push failed', e); return false; }
  },
  async pull(){
    if (!this.configured) return null;
    try {
      let res = await fetch(`${this.url}/rest/v1/taskflow_data?user_id=eq.${this.userId}&select=data,updated_at`, {
        headers: this.authHeaders(),
      });
      if (res.status === 401 && this.refreshToken){
        const ok = await this.refreshSession();
        if (ok) res = await fetch(`${this.url}/rest/v1/taskflow_data?user_id=eq.${this.userId}&select=data,updated_at`, { headers:this.authHeaders() });
      }
      if (!res.ok) return null;
      const rows = await res.json();
      if (rows && rows.length && rows[0].data){
        const parsed = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
        parsed._cloudUpdatedAt = rows[0].updated_at || parsed.savedAt || null;
        return parsed;
      }
      return null;
    } catch(e){ console.warn('Cloud pull failed', e); return null; }
  },
  async test(){
    if (!this.configured) return { ok:false, msg:'Faltan datos de conexión' };
    try {
      const res = await fetch(`${this.url}/rest/v1/taskflow_data?limit=1`, { headers: this.authHeaders() });
      if (res.ok) return { ok:true, msg:'Conexión exitosa' };
      if (res.status === 404) return { ok:false, msg:'La tabla no existe todavía (revisa el paso de crear la tabla)' };
      if (res.status === 401) return { ok:false, msg:'La llave (key) no es correcta' };
      return { ok:false, msg:`Error ${res.status}` };
    } catch(e){ return { ok:false, msg:'No se pudo conectar (revisa la URL)' }; }
  }
};

let _cloudTimer = null;
let _cloudStatus = 'idle';
function scheduleCloudPush(){
  if (!CLOUD.configured) return;
  if (_cloudTimer) clearTimeout(_cloudTimer);
  _cloudTimer = setTimeout(async () => {
    setCloudStatus('syncing');
    const ok = await CLOUD.push();
    setCloudStatus(ok ? 'ok' : 'error');
  }, 1500);
}
function setCloudStatus(s){
  _cloudStatus = s;
  const dot = document.getElementById('cloud-status');
  if (!dot) return;
  const map = {
    idle: { c:'var(--text-4)', t:'' },
    syncing: { c:'var(--amber)', t:'Guardando…' },
    ok: { c:'var(--green)', t:'Guardado en la nube' },
    error: { c:'var(--red)', t:'Error al guardar' },
    offline: { c:'var(--text-4)', t:'Sin nube' },
  };
  const m = map[s] || map.idle;
  dot.style.background = m.c;
  dot.title = m.t;
}

/* Rolling backups so a bad write can never lose everything.
   We keep the last good copy of tasks under a separate key, plus a timestamp. */
function backupTasks(){
  try {
    const cur = localStorage.getItem(DB.TASKS);
    if (cur && cur.length > 2){
      localStorage.setItem('tf3_tasks_backup', cur);
      localStorage.setItem('tf3_tasks_backup_at', String(Date.now()));
    }
  } catch {}
}
function restoreTasksBackup(){
  try {
    const b = localStorage.getItem('tf3_tasks_backup');
    if (b){ const parsed = JSON.parse(b); if (Array.isArray(parsed)) return parsed; }
  } catch {}
  return null;
}

/* When storage is full, prune the junk (old notified flags + stale drafts) automatically */
function handleStorageError(e){
  try {
    // Clear the biggest offenders that are safe to lose
    localStorage.removeItem('tf3_notified');
    // Remove all in-progress drafts older than 45 days
    const cutoff = Date.now() - 45*24*60*60*1000;
    const toRemove = [];
    for (let i=0;i<localStorage.length;i++){
      const key = localStorage.key(i);
      if (key && key.startsWith('tf3_draft_')) toRemove.push(key);
    }
    // Drafts don't carry timestamps in the key, so we keep recent ones by re-checking against tasks below.
    // Safe approach: only remove drafts whose date part is older than cutoff.
    toRemove.forEach(key => {
      const m = key.match(/(\d{4}-\d{2}-\d{2})$/);
      if (m){
        const d = new Date(m[1]);
        if (!isNaN(d) && d.getTime() < cutoff) localStorage.removeItem(key);
      }
    });
  } catch {}
}

/* ============ STATE ============ */
const S = {
  tasks: [], history: [], guides: [],
  editingId: null, detailId: null, detailDate: null,
  filter: 'all', search: '', guideSearch: '',
  calMode: 'month', calCursor: new Date(), calSelected: null,
  formTemplate: null, checklistDraft: [], formGuideRef: null, formPresetDate: null,
  detailGuideId: null, guideEditMode: false, viewingGuideId: null, guideFromTask: false,
};

/* ============ TEMPLATES ============ */
/* Plantillas de ejemplo: procesos administrativos genéricos.
   Cada una arma campos guiados + checklist + enlaza su guía. */
const TEMPLATES = {
  blank: {
    emoji: '📝', name: 'En blanco', desc: 'Empieza de cero',
    guided: [],
    checklist: ['']
  },
  factura: {
    emoji: '🧾', name: 'Procesar factura', desc: 'Solicitud y registro',
    guideRef: 'guide-factura',
    guided: [
      { key: 'proveedor', icon: '🏢', label: '¿De qué proveedor / qué es?', type: 'input', placeholder: 'Ej: Papelería, servicio de internet…' },
      { key: 'tipo', icon: '💳', label: '¿Transferencia o efectivo?', type: 'input', placeholder: 'Ej: Transferencia (adjuntar comprobante)' },
      { key: 'notas', icon: '💡', label: 'Notas / caso especial', type: 'textarea', placeholder: 'Ej: Es un servicio recurrente…' },
    ],
    checklist: ['Factura impresa y verificada', 'Crear la solicitud en el sistema', 'Revisar los datos heredados', 'Imprimir la solicitud', 'Firmar y sellar', 'Pasar al responsable', 'Obtener el visto bueno', 'Registrar el pago y archivar']
  },
  recibo: {
    emoji: '🧾', name: 'Emitir recibo', desc: 'Ingresos y cobros',
    guideRef: null,
    guided: [
      { key: 'origen', icon: '💰', label: '¿De qué es el recibo?', type: 'input', placeholder: 'Ej: Pago de cliente, cuota mensual…' },
      { key: 'fuente', icon: '🔢', label: 'Origen de los fondos', type: 'input', placeholder: 'Ej: Ventas / Servicios' },
    ],
    checklist: ['Preparar el recibo en el sistema', 'Verificar datos', 'Imprimir', 'Verificar firma']
  },
  ordenes: {
    emoji: '📋', name: 'Órdenes de compra', desc: 'Proceso semanal',
    guideRef: 'guide-ordenes',
    guided: [
      { key: 'notas', icon: '💡', label: 'Notas', type: 'textarea', placeholder: 'Ej: Quién revisa, fechas…' },
    ],
    checklist: ['Preguntar al equipo si entregó sus facturas', 'Generar las órdenes y actualizar los libros', 'Pasar al responsable para revisión', 'Con el visto bueno, imprimir', 'Recoger firmas', 'Obtener la aprobación final', 'Archivar + adjuntar la copia al expediente']
  },
  registro: {
    emoji: '💻', name: 'Registro contable', desc: 'Asiento en el sistema',
    guideRef: 'guide-conciliacion',
    guided: [
      { key: 'origen', icon: '📄', label: '¿Registro de qué?', type: 'input', placeholder: 'Ej: Pago recibido, cuota mensual…' },
      { key: 'fuente', icon: '🔢', label: 'Cuenta', type: 'input', placeholder: 'Ej: Cuenta A / Cuenta B' },
    ],
    checklist: ['Abrir el sistema contable', 'Identificar la cuenta correcta', 'Buscar un registro anterior parecido y copiar', 'Verificar datos', 'Guardar el registro']
  },
  deposito: {
    emoji: '🏦', name: 'Depósito', desc: 'Bancos, boletas',
    guideRef: 'guide-deposito',
    guided: [
      { key: 'tipo', icon: '🏛️', label: '¿Qué tipo de depósito?', type: 'input', placeholder: 'Ej: Banco A, Cliente B…' },
      { key: 'notas', icon: '💡', label: 'Documentación que lleva', type: 'textarea', placeholder: 'Ej: lleva una constancia adjunta…' },
    ],
    checklist: ['Identificar el tipo de depósito', 'Preparar la documentación del caso', 'Endosar o separar si aplica', 'Enviar a depositar', 'Recibir boletas y anotar el número']
  },
  activo: {
    emoji: '📦', name: 'Registrar activo', desc: 'Inventario de bienes',
    guideRef: 'guide-activo',
    guided: [
      { key: 'bien', icon: '📦', label: '¿Qué bien es?', type: 'input', placeholder: 'Ej: Computadora, mobiliario…' },
      { key: 'responsable', icon: '👤', label: 'Responsable', type: 'input', placeholder: 'Ej: A quién se le asigna' },
    ],
    checklist: ['Reunir la factura de compra', 'Registrar el bien en el inventario', 'Revisar dos veces antes de guardar', 'Obtener la aprobación del responsable', 'Generar el comprobante de ingreso', 'Asignar al responsable', 'Etiqueta + fotos + expediente', 'Actualizar el inventario']
  },
  aviso: {
    emoji: '📣', name: 'Aviso / Coordinación', desc: 'Llamadas, WhatsApp',
    guideRef: null,
    guided: [
      { key: 'aquien', icon: '👥', label: '¿A quién avisar?', type: 'input', placeholder: 'Ej: Proveedores, grupo WhatsApp…' },
      { key: 'mensaje', icon: '💬', label: '¿Qué avisar?', type: 'textarea', placeholder: 'Ej: Enviar las facturas pendientes…' },
    ],
    checklist: ['Hacer el aviso', 'Confirmar recepción']
  },
  revision: {
    emoji: '🔍', name: 'Revisión', desc: 'Correo, pendientes',
    guideRef: null,
    guided: [
      { key: 'what', icon: '👀', label: '¿Qué revisas?', type: 'textarea', placeholder: 'Ej: Correo, notificaciones, pagos…' },
    ],
    checklist: ['Abrir sistema/correo', 'Revisar pendientes', 'Atender urgentes', 'Marcar para seguimiento']
  },
};

/* ============ DATE HELPERS ============ */
const pad = n => String(n).padStart(2,'0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const parseD = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
const DAYS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const DAYS_FULL = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const fmtShort = s => { const d=parseD(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fmtFull = s => { const d=parseD(s); return `${DAYS_FULL[d.getDay()]} ${d.getDate()} de ${MONTHS_FULL[d.getMonth()]}`; };

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ============ RECURRENCE ENGINE ============ */
function lastDayOfMonth(s){ const d=parseD(s); return new Date(d.getFullYear(),d.getMonth()+1,0).getDate(); }

function occursOn(task, ds){
  if (task.disabled) return false;
  const d = parseD(ds);
  const rec = task.recurrence;

  if (rec === 'daily') return true;

  if (rec === 'weekly'){
    const days = task.weekDays && task.weekDays.length ? task.weekDays : [1];
    return days.includes(d.getDay());
  }

  if (rec === 'biweekly'){
    const dom = d.getDate(); const last = lastDayOfMonth(ds);
    if ((task.biweeklyMode||'1-15') === '1-15') return dom === 1 || dom === 15;
    return dom === 15 || dom === last;
  }

  if (rec === 'monthly'){
    const td = Math.min(task.monthDay||1, lastDayOfMonth(ds));
    return d.getDate() === td;
  }

  if (rec === 'quarterly') return intervalMatch(task, ds, 3);
  if (rec === 'fourmonths') return intervalMatch(task, ds, 4);
  if (rec === 'custom') return task.customDate === ds;

  return false;
}

function intervalMatch(task, ds, months){
  const created = parseD(task.createdAt || today());
  const d = parseD(ds);
  if (d < created) return false;
  const monthsDiff = (d.getFullYear()-created.getFullYear())*12 + (d.getMonth()-created.getMonth());
  return monthsDiff % months === 0 && d.getDate() === created.getDate();
}

function completedOn(taskId, ds){
  return S.history.some(h => h.taskId === taskId && h.date === ds);
}

/* ============ DERIVED LISTS ============ */
function tasksOnDate(ds){
  return S.tasks.filter(t => occursOn(t, ds));
}

function overdueTasks(){
  const t = today();
  const res = [];
  // Hard floor: never look back more than 60 days for performance
  const hardFloor = new Date(); hardFloor.setDate(hardFloor.getDate()-60);
  const hardFloorStr = dstr(hardFloor);

  for (const task of S.tasks){
    if (task.disabled) continue;
    // A task can only be overdue from its OWN creation date onward.
    // This prevents "phantom" overdue tasks from dates before the task existed.
    const taskStart = task.createdAt && task.createdAt > hardFloorStr ? task.createdAt : hardFloorStr;
    // Walk from the task's start up to (but not including) today
    let cur = parseD(taskStart);
    const tDate = parseD(t);
    while (cur < tDate){
      const ds = dstr(cur);
      if (occursOn(task, ds) && !completedOn(task.id, ds)){
        const ex = res.find(r => r.task.id === task.id);
        if (!ex) res.push({ task, date: ds });
        else if (ds > ex.date) ex.date = ds; // keep the most recent missed date
      }
      cur.setDate(cur.getDate()+1);
    }
  }
  // Sort newest missed date first
  res.sort((a,b) => b.date.localeCompare(a.date));
  return res;
}

/* ============ CHECKLIST PROGRESS ============ */
function getChecklistState(taskId, ds){
  const h = S.history.find(x => x.taskId === taskId && x.date === ds);
  if (h && h.checklist) return h.checklist;
  // draft (in-progress, not completed)
  const draftKey = `tf3_draft_${taskId}_${ds}`;
  try { const raw = localStorage.getItem(draftKey); if (raw) return JSON.parse(raw); } catch {}
  return null;
}
function saveChecklistDraft(taskId, ds, checkedArr){
  const draftKey = `tf3_draft_${taskId}_${ds}`;
  try { localStorage.setItem(draftKey, JSON.stringify(checkedArr)); } catch {}
}
function clearChecklistDraft(taskId, ds){
  try { localStorage.removeItem(`tf3_draft_${taskId}_${ds}`); } catch {}
}

/* ============ TAGS / LABELS ============ */
const REC_LABEL = { daily:'Diaria', weekly:'Semanal', biweekly:'Quincenal', monthly:'Mensual', quarterly:'Trimestral', fourmonths:'4 Meses', custom:'Manual' };
const tagHtml = rec => `<span class="tag ${rec}">${REC_LABEL[rec]||rec}</span>`;

/* ============ TASK CARD ============ */
function taskCard(task, ds, opts={}){
  const done = completedOn(task.id, ds);
  const isOverdue = opts.overdue;

  const clCount = (task.checklist||[]).length;
  const clState = getChecklistState(task.id, ds);
  const clDone = clState ? clState.filter(Boolean).length : 0;
  // "In progress" = has a draft with at least 1 step checked, but not completed
  const inProgress = !done && clCount > 0 && clDone > 0;

  const card = document.createElement('div');
  card.className = `task-card ${done?'done':''} ${isOverdue?'overdue-card':''} ${inProgress?'in-progress':''}`;

  const pct = clCount > 0 ? Math.round((done?clCount:clDone)/clCount*100) : 0;
  const stepsInfo = clCount > 0
    ? `<span class="tc-steps">${inProgress?'▶':'☑'} ${done?clCount:clDone}/${clCount}</span>` : '';

  const dueInfo = isOverdue
    ? `<span class="tc-due late">${fmtShort(ds)}</span>`
    : (opts.showDate && ds !== today() ? `<span class="tc-due">${fmtShort(ds)}</span>` : '');

  const timeInfo = task.notifTime && !done ? `<span class="tc-time">${task.notifTime}</span>` : '';
  const connectInfo = task.connectNote ? `<span class="tc-connect">🔗</span>` : '';
  const guideInfo = task.guideRef ? `<span class="tc-connect">📖</span>` : '';
  const progressBar = inProgress ? `<div class="tc-progress"><div class="tc-progress-fill" style="width:${pct}%"></div></div>` : '';
  const inProgressBadge = inProgress ? `<span class="tc-inprogress-badge">En progreso</span>` : '';

  card.innerHTML = `
    <div class="pbar ${task.priority||'medium'}"></div>
    <button class="check ${done?'on':''}" aria-label="Completar"></button>
    <div class="tc-body">
      <div class="tc-name ${done?'strike':''}">${esc(task.name)}</div>
      <div class="tc-meta">
        ${tagHtml(task.recurrence)}
        ${stepsInfo}
        ${inProgressBadge}
        ${dueInfo}
        ${timeInfo}
        ${connectInfo}
        ${guideInfo}
      </div>
      ${progressBar}
    </div>
    <svg class="tc-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
  `;

  card.querySelector('.check').addEventListener('click', e => {
    e.stopPropagation();
    toggleComplete(task.id, ds);
  });
  card.addEventListener('click', () => openDetail(task.id, ds));
  return card;
}

/* ============ RENDER: TODAY ============ */
function renderToday(){
  const t = today();
  const h = new Date().getHours();
  const greet = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('hero-greeting').textContent = greet;
  document.getElementById('hero-date').textContent = fmtFull(t);

  const list = tasksOnDate(t);
  const done = list.filter(x => completedOn(x.id, t));
  const pending = list.filter(x => !completedOn(x.id, t));

  // Progress ring
  const total = list.length;
  const ratio = total ? done.length/total : 0;
  const circ = 2 * Math.PI * 52;
  document.getElementById('ring-fill').style.strokeDashoffset = circ * (1 - ratio);
  document.getElementById('progress-num').textContent = `${done.length}/${total}`;
  document.getElementById('hero-sub').textContent = total === 0
    ? 'Sin tareas para hoy'
    : pending.length === 0 ? '¡Todo completado! 🎉'
    : `${pending.length} pendiente${pending.length>1?'s':''}`;

  // Today list
  const tl = document.getElementById('today-list');
  const te = document.getElementById('today-empty');
  tl.innerHTML = '';
  if (total === 0){ te.classList.remove('hidden'); }
  else {
    te.classList.add('hidden');
    [...pending, ...done].forEach(task => tl.appendChild(taskCard(task, t)));
  }

  // Overdue
  const ov = overdueTasks();
  const banner = document.getElementById('overdue-banner');
  const ovList = document.getElementById('overdue-list');
  if (ov.length){
    banner.classList.remove('hidden');
    document.getElementById('overdue-count').textContent = `${ov.length} tarea${ov.length>1?'s':''} rezagada${ov.length>1?'s':''}`;
    ovList.innerHTML = '';
    ov.forEach(({task,date}) => ovList.appendChild(taskCard(task, date, {overdue:true})));
  } else {
    banner.classList.add('hidden');
    ovList.classList.add('hidden');
    banner.classList.remove('open');
  }

  // Nav badge
  const badge = document.getElementById('nav-badge');
  badge.classList.toggle('hidden', pending.length === 0 && ov.length === 0);
}

/* ============ RENDER: CALENDAR ============ */
function renderCalendar(){
  if (S.calMode === 'month') renderMonth();
  else renderWeek();
}

function renderMonth(){
  document.getElementById('cal-month').classList.remove('hidden');
  document.getElementById('cal-week').classList.add('hidden');

  const cur = S.calCursor;
  const year = cur.getFullYear(), month = cur.getMonth();
  document.getElementById('cal-period').textContent = `${MONTHS_FULL[month]} ${year}`;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const first = new Date(year, month, 1);
  let startDow = first.getDay(); // 0=Sun
  startDow = startDow === 0 ? 6 : startDow - 1; // make Monday=0
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const t = today();

  // Leading empty
  for (let i=0;i<startDow;i++){
    const e = document.createElement('div');
    e.className = 'cal-cell empty';
    grid.appendChild(e);
  }

  for (let d=1; d<=daysInMonth; d++){
    const ds = `${year}-${pad(month+1)}-${pad(d)}`;
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (ds === t) cell.classList.add('today');
    if (ds === S.calSelected) cell.classList.add('selected');

    const dayTasks = tasksOnDate(ds);
    // priority dots (max 4)
    let dots = '';
    const shown = dayTasks.slice(0,4);
    shown.forEach(task => { dots += `<span class="cell-dot ${task.priority||'medium'}"></span>`; });
    const more = dayTasks.length > 4 ? `<span class="cell-more">+${dayTasks.length-4}</span>` : '';

    cell.innerHTML = `<span class="cell-num">${d}</span><div class="cell-dots">${dots}${more}</div>`;
    cell.addEventListener('click', () => {
      S.calSelected = ds;
      renderMonth();
      renderDayDetail(ds);
    });
    grid.appendChild(cell);
  }

  if (!S.calSelected || parseD(S.calSelected).getMonth() !== month){
    // auto-select today if in this month, else first
    if (parseD(t).getMonth() === month && parseD(t).getFullYear() === year){ S.calSelected = t; }
  }
  if (S.calSelected) renderDayDetail(S.calSelected);
}

function renderWeek(){
  document.getElementById('cal-month').classList.add('hidden');
  document.getElementById('cal-week').classList.remove('hidden');

  const cur = new Date(S.calCursor);
  // get Monday of current week
  let dow = cur.getDay(); dow = dow === 0 ? 6 : dow-1;
  const monday = new Date(cur); monday.setDate(cur.getDate()-dow);

  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
  document.getElementById('cal-period').textContent =
    `${monday.getDate()} ${MONTHS[monday.getMonth()]} – ${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`;

  const wk = document.getElementById('cal-week');
  wk.innerHTML = '';
  const t = today();

  for (let i=0;i<7;i++){
    const d = new Date(monday); d.setDate(monday.getDate()+i);
    const ds = dstr(d);
    const dayTasks = tasksOnDate(ds);

    const el = document.createElement('div');
    el.className = `week-day ${ds===t?'today':''}`;
    let tasksHtml = '';
    if (dayTasks.length){
      dayTasks.forEach(task => {
        const done = completedOn(task.id, ds);
        tasksHtml += `<div class="week-task"><span class="week-task-dot ${task.priority||'medium'}"></span><span style="${done?'text-decoration:line-through;opacity:0.5':''}">${esc(task.name)}</span></div>`;
      });
    } else {
      tasksHtml = '<div class="week-empty">Sin tareas</div>';
    }
    el.innerHTML = `
      <div class="week-day-head">
        <span class="week-day-name">${DAYS_FULL[d.getDay()]} ${d.getDate()}</span>
        <span class="week-day-count">${dayTasks.length}</span>
      </div>
      ${tasksHtml}
    `;
    el.addEventListener('click', () => { S.calSelected = ds; renderDayDetail(ds); switchCalDetailVisible(true); });
    wk.appendChild(el);
  }
  // hide day detail in week mode (tasks already shown inline)
  document.getElementById('cal-day-detail').classList.add('hidden');
}

function switchCalDetailVisible(show){
  document.getElementById('cal-day-detail').classList.toggle('hidden', !show);
}

function renderDayDetail(ds){
  document.getElementById('cal-day-detail').classList.remove('hidden');
  document.getElementById('cal-day-title').textContent =
    ds === today() ? 'Hoy' : fmtFull(ds);
  const list = document.getElementById('cal-day-list');
  const empty = document.getElementById('cal-day-empty');
  list.innerHTML = '';
  const dayTasks = tasksOnDate(ds);
  if (dayTasks.length === 0){ empty.classList.remove('hidden'); }
  else {
    empty.classList.add('hidden');
    const done = dayTasks.filter(x => completedOn(x.id, ds));
    const pend = dayTasks.filter(x => !completedOn(x.id, ds));
    [...pend, ...done].forEach(task => list.appendChild(taskCard(task, ds, {showDate:false})));
  }
  // "Add task here" button
  let addBtn = document.getElementById('cal-day-add');
  if (!addBtn){
    addBtn = document.createElement('button');
    addBtn.id = 'cal-day-add';
    addBtn.className = 'cal-day-add';
    addBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Agregar tarea a este día`;
    document.getElementById('cal-day-detail').appendChild(addBtn);
  }
  addBtn.onclick = () => openForm(null, ds);
}

/* ============ RENDER: TASKS ============ */
function renderTasks(){
  const cont = document.getElementById('tasks-list');
  const empty = document.getElementById('tasks-empty');
  cont.innerHTML = '';
  const q = S.search.toLowerCase().trim();

  let list = S.tasks.filter(t => !t.disabled);
  if (S.filter !== 'all') list = list.filter(t => t.recurrence === S.filter);
  if (q) list = list.filter(t =>
    t.name.toLowerCase().includes(q) ||
    (t.guided && Object.values(t.guided).some(v => (v||'').toLowerCase().includes(q))) ||
    (t.checklist && t.checklist.some(s => (s||'').toLowerCase().includes(q)))
  );

  if (list.length === 0){ empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  list.sort((a,b)=>a.name.localeCompare(b.name,'es'));
  const t = today();
  list.forEach(task => {
    const done = completedOn(task.id, t);
    const card = document.createElement('div');
    card.className = 'task-card';
    const clCount = (task.checklist||[]).length;
    card.innerHTML = `
      <div class="pbar ${task.priority||'medium'}"></div>
      <div class="tc-body" style="padding-left:2px">
        <div class="tc-name">${esc(task.name)}</div>
        <div class="tc-meta">
          ${tagHtml(task.recurrence)}
          ${clCount?`<span class="tc-steps">☑ ${clCount} pasos</span>`:''}
          ${done?'<span class="tag weekly">✓ Hoy</span>':''}
        </div>
      </div>
      <svg class="tc-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
    `;
    card.addEventListener('click', () => openDetail(task.id, t));
    cont.appendChild(card);
  });
}

/* ============ RENDER: HISTORY ============ */
function renderHistory(){
  const cont = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const stats = document.getElementById('history-stats');
  cont.innerHTML = '';

  if (S.history.length === 0){
    empty.classList.remove('hidden');
    stats.innerHTML = '';
    return;
  }
  empty.classList.add('hidden');

  // Stats
  const t = today();
  const thisWeek = S.history.filter(h => {
    const d = parseD(h.date); const now = new Date();
    const diff = (now - d)/(1000*60*60*24);
    return diff <= 7;
  }).length;
  const thisMonth = S.history.filter(h => h.date.slice(0,7) === t.slice(0,7)).length;
  stats.innerHTML = `
    <div class="stat-card"><div class="stat-num">${S.history.length}</div><div class="stat-label">Total</div></div>
    <div class="stat-card"><div class="stat-num">${thisWeek}</div><div class="stat-label">Esta semana</div></div>
    <div class="stat-card"><div class="stat-num">${thisMonth}</div><div class="stat-label">Este mes</div></div>
  `;

  const sorted = [...S.history].sort((a,b)=> (b.completedAt||b.date).localeCompare(a.completedAt||a.date));
  const byDate = {};
  sorted.forEach(h => { (byDate[h.date] = byDate[h.date]||[]).push(h); });

  Object.keys(byDate).sort((a,b)=>b.localeCompare(a)).forEach(date => {
    const head = document.createElement('div');
    head.className = 'hist-day-head';
    head.textContent = date === t ? 'Hoy' : fmtShort(date);
    cont.appendChild(head);
    byDate[date].forEach(h => {
      const task = S.tasks.find(x => x.id === h.taskId);
      if (!task) return;
      const card = document.createElement('div');
      card.className = 'task-card done';
      card.innerHTML = `
        <div class="check on" style="pointer-events:none"></div>
        <div class="tc-body"><div class="tc-name strike">${esc(task.name)}</div><div class="tc-meta">${tagHtml(task.recurrence)}</div></div>
      `;
      cont.appendChild(card);
    });
  });
}

/* ============ COMPLETE TOGGLE ============ */
function toggleComplete(taskId, ds){
  const task = S.tasks.find(t => t.id === taskId);
  const idx = S.history.findIndex(h => h.taskId === taskId && h.date === ds);
  if (idx >= 0){
    S.history.splice(idx, 1);
    clearChecklistDraft(taskId, ds);
    toast('Marcada como pendiente ↩');
  } else {
    const clCount = (task.checklist||[]).length;
    S.history.push({
      taskId, date: ds, completedAt: new Date().toISOString(),
      checklist: clCount ? new Array(clCount).fill(true) : null
    });
    clearChecklistDraft(taskId, ds);
    toast('¡Completada! ✓');
    confettiBurst();
  }
  DB.save(DB.HISTORY, S.history);
  renderAll();
}

/* ============ DETAIL ============ */
function openDetail(taskId, ds){
  const task = S.tasks.find(t => t.id === taskId);
  if (!task) return;
  S.detailId = taskId; S.detailDate = ds || today();

  document.getElementById('detail-title').textContent = task.name;

  // Chips
  const meta = document.getElementById('detail-meta');
  const prioLabel = {low:'Baja',medium:'Media',high:'Alta'}[task.priority||'medium'];
  meta.innerHTML = `${tagHtml(task.recurrence)}
    <span class="tag ${task.priority==='high'?'monthly':task.priority==='low'?'weekly':'biweekly'}">Prioridad ${prioLabel}</span>
    <span class="tag custom">🕐 ${task.notifTime||'08:00'}</span>`;

  // Connection note (linked tasks across days)
  const connectEl = document.getElementById('detail-connect');
  if (task.connectNote){
    connectEl.textContent = task.connectNote;
    connectEl.classList.remove('hidden');
  } else {
    connectEl.classList.add('hidden');
  }

  // Linked guide button
  const guideLink = document.getElementById('detail-guide-link');
  if (task.guideRef && S.guides.find(g => g.id === task.guideRef)){
    S.detailGuideId = task.guideRef;
    guideLink.classList.remove('hidden');
  } else {
    S.detailGuideId = null;
    guideLink.classList.add('hidden');
  }

  // Move-to-day (only for one-time tasks)
  const moveBox = document.getElementById('detail-move');
  const moveInput = document.getElementById('detail-move-date');
  if (task.recurrence === 'custom'){
    moveBox.classList.remove('hidden');
    moveInput.value = task.customDate || S.detailDate;
    moveInput.onchange = () => {
      const newDate = moveInput.value;
      if (!newDate) return;
      task.customDate = newDate;
      DB.save(DB.TASKS, S.tasks);
      toast(`Movida a ${fmtShort(newDate)} ✓`);
      closeDetail();
      renderAll();
      if (!document.getElementById('view-calendar').classList.contains('hidden')) renderCalendar();
    };
  } else {
    moveBox.classList.add('hidden');
  }

  // Guided info
  const gdiv = document.getElementById('detail-guided');
  gdiv.innerHTML = '';
  if (task.guided && Object.keys(task.guided).length){
    const tmpl = TEMPLATES[task.templateKey] || null;
    Object.entries(task.guided).forEach(([key,val]) => {
      if (!val) return;
      let label = key, icon = '📌';
      if (tmpl){ const f = tmpl.guided.find(g=>g.key===key); if (f){ label=f.label; icon=f.icon; } }
      gdiv.innerHTML += `<div class="dg-item"><div class="dg-label">${icon} ${esc(label)}</div><div class="dg-value">${esc(val)}</div></div>`;
    });
  }

  // Checklist (interactive)
  const cl = task.checklist || [];
  const checkWrap = document.getElementById('detail-checklist');
  const progWrap = document.getElementById('detail-progress-wrap');
  checkWrap.innerHTML = '';

  if (cl.length){
    progWrap.classList.remove('hidden');
    let clState = getChecklistState(taskId, S.detailDate);
    if (!clState || clState.length !== cl.length) clState = new Array(cl.length).fill(false);

    cl.forEach((step, i) => {
      const item = document.createElement('div');
      item.className = `dc-item ${clState[i]?'checked':''}`;
      item.innerHTML = `<div class="dc-check"></div><div class="dc-text">${esc(step)}</div>`;
      item.addEventListener('click', () => {
        clState[i] = !clState[i];
        item.classList.toggle('checked', clState[i]);
        updateDetailProgress(cl.length, clState);
        // save draft or completion
        const allDone = clState.every(Boolean);
        const isComplete = completedOn(taskId, S.detailDate);
        if (isComplete){
          // update stored checklist
          const h = S.history.find(x=>x.taskId===taskId && x.date===S.detailDate);
          if (h){ h.checklist = [...clState]; DB.save(DB.HISTORY, S.history); }
        } else {
          saveChecklistDraft(taskId, S.detailDate, [...clState]);
          if (allDone){
            // auto-complete!
            toggleComplete(taskId, S.detailDate);
            closeDetail();
            return;
          }
        }
        // live update count on cards behind
        renderToday();
      });
      checkWrap.appendChild(item);
    });
    updateDetailProgress(cl.length, clState);
  } else {
    progWrap.classList.add('hidden');
  }

  // History
  const hist = S.history.filter(h => h.taskId === taskId)
    .sort((a,b)=>(b.completedAt||b.date).localeCompare(a.completedAt||a.date)).slice(0,8);
  const hsec = document.getElementById('detail-history');
  const hlist = document.getElementById('detail-hist-list');
  hlist.innerHTML = '';
  if (hist.length){
    hsec.classList.remove('hidden');
    hist.forEach(h => {
      const row = document.createElement('div');
      row.className = 'dh-row';
      row.textContent = fmtShort(h.date);
      hlist.appendChild(row);
    });
  } else hsec.classList.add('hidden');

  // Done button
  const doneToday = completedOn(taskId, S.detailDate);
  const btn = document.getElementById('detail-done');
  btn.textContent = doneToday ? '↩ Marcar pendiente' : '✓ Completar';
  btn.className = doneToday ? 'btn-ghost' : 'btn-fill';

  document.getElementById('detail-overlay').classList.remove('hidden');
}

function updateDetailProgress(total, state){
  const done = state.filter(Boolean).length;
  document.getElementById('detail-progress-fill').style.width = `${(done/total)*100}%`;
  document.getElementById('detail-progress-text').textContent = `${done} de ${total} pasos`;
}

function closeDetail(){
  document.getElementById('detail-overlay').classList.add('hidden');
  S.detailId = null;
}

/* ============ FORM ============ */
function openForm(taskId, presetDate){
  S.editingId = taskId || null;
  S.formTemplate = null;
  S.formGuideRef = null;
  S.formPresetDate = presetDate || null;
  S.checklistDraft = [];

  if (taskId){
    // EDIT — skip template step
    const task = S.tasks.find(t => t.id === taskId);
    document.getElementById('form-title').textContent = 'Editar tarea';
    document.getElementById('btn-delete').classList.remove('hidden');
    goFormStep(2);
    fillForm(task);
  } else {
    document.getElementById('form-title').textContent = presetDate ? `Nueva tarea · ${fmtShort(presetDate)}` : 'Nueva tarea';
    document.getElementById('btn-delete').classList.add('hidden');
    renderTemplates();
    goFormStep(1);
  }
  document.getElementById('form-overlay').classList.remove('hidden');
}

function renderTemplates(){
  const grid = document.getElementById('template-grid');
  grid.innerHTML = '';
  Object.entries(TEMPLATES).forEach(([key, t]) => {
    const card = document.createElement('div');
    card.className = 'tmpl-card';
    card.innerHTML = `<div class="tmpl-emoji">${t.emoji}</div><div class="tmpl-name">${t.name}</div><div class="tmpl-desc">${t.desc}</div>`;
    card.addEventListener('click', () => {
      S.formTemplate = key;
      applyTemplate(key);
      goFormStep(2);
    });
    grid.appendChild(card);
  });
}

function applyTemplate(key){
  const tmpl = TEMPLATES[key];
  // Reset form
  document.getElementById('task-name').value = '';
  document.getElementById('task-time').value = '08:00';
  document.getElementById('monthly-day').value = '1';
  document.getElementById('custom-date').value = S.formPresetDate || today();
  setRec(S.formPresetDate ? 'custom' : 'daily');
  setPrio('medium');
  document.querySelectorAll('.day-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.seg[data-bi="1-15"]').classList.add('active');
  document.querySelectorAll('.seg[data-bi]').forEach(s=>s.classList.toggle('active', s.dataset.bi==='1-15'));

  // Remember the guide this template links to
  S.formGuideRef = tmpl.guideRef || null;

  // Guided fields
  renderGuidedFields(tmpl.guided, {});

  // Checklist starter
  S.checklistDraft = [...(tmpl.checklist.length?tmpl.checklist:[''])];
  renderChecklistBuilder();
}

function renderGuidedFields(fields, values){
  const cont = document.getElementById('guided-fields');
  cont.innerHTML = '';
  if (!fields || !fields.length) return;
  fields.forEach(f => {
    const wrap = document.createElement('div');
    wrap.className = 'guided-field';
    const val = values[f.key] || '';
    const input = f.type === 'textarea'
      ? `<textarea data-gkey="${f.key}" placeholder="${esc(f.placeholder)}" rows="2">${esc(val)}</textarea>`
      : `<input type="text" data-gkey="${f.key}" placeholder="${esc(f.placeholder)}" value="${esc(val)}" />`;
    wrap.innerHTML = `<label><span class="gf-icon">${f.icon}</span> ${esc(f.label)}</label>${input}`;
    cont.appendChild(wrap);
  });
}

function renderChecklistBuilder(){
  const cont = document.getElementById('checklist-builder');
  cont.innerHTML = '';
  S.checklistDraft.forEach((step, i) => {
    const item = document.createElement('div');
    item.className = 'cl-item';
    item.innerHTML = `
      <div class="cl-num">${i+1}</div>
      <input class="cl-input" type="text" value="${esc(step)}" placeholder="Describe el paso…" data-idx="${i}" />
      <button class="cl-remove" data-idx="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    `;
    item.querySelector('.cl-input').addEventListener('input', e => {
      S.checklistDraft[i] = e.target.value;
    });
    item.querySelector('.cl-remove').addEventListener('click', () => {
      S.checklistDraft.splice(i, 1);
      if (S.checklistDraft.length === 0) S.checklistDraft = [''];
      renderChecklistBuilder();
    });
    cont.appendChild(item);
  });
}

function fillForm(task){
  document.getElementById('task-name').value = task.name || '';
  document.getElementById('task-time').value = task.notifTime || '08:00';
  document.getElementById('monthly-day').value = task.monthDay || 1;
  document.getElementById('custom-date').value = task.customDate || today();

  setRec(task.recurrence || 'daily');
  setPrio(task.priority || 'medium');

  // weekdays
  document.querySelectorAll('#cfg-weekly .day-btn').forEach(b => {
    b.classList.toggle('active', (task.weekDays||[]).includes(parseInt(b.dataset.day)));
  });
  // biweekly
  document.querySelectorAll('.seg[data-bi]').forEach(s => s.classList.toggle('active', s.dataset.bi === (task.biweeklyMode||'1-15')));

  // guided
  const tmpl = TEMPLATES[task.templateKey];
  renderGuidedFields(tmpl ? tmpl.guided : [], task.guided || {});

  // checklist
  S.checklistDraft = (task.checklist && task.checklist.length) ? [...task.checklist] : [''];
  renderChecklistBuilder();
}

function collectGuided(){
  const obj = {};
  document.querySelectorAll('[data-gkey]').forEach(el => {
    obj[el.dataset.gkey] = el.value.trim();
  });
  return obj;
}

function saveForm(){
  const name = document.getElementById('task-name').value.trim();
  if (!name){ toast('⚠ Ponle un nombre a la tarea'); return; }

  const checklist = S.checklistDraft.map(s=>s.trim()).filter(Boolean);
  const weekDays = [...document.querySelectorAll('#cfg-weekly .day-btn.active')].map(b=>parseInt(b.dataset.day));
  const biMode = document.querySelector('.seg[data-bi].active')?.dataset.bi || '1-15';

  const existing = S.editingId ? S.tasks.find(t=>t.id===S.editingId) : null;
  const task = {
    id: S.editingId || uid(),
    name,
    templateKey: existing ? existing.templateKey : S.formTemplate,
    guided: collectGuided(),
    checklist,
    recurrence: currentRec,
    priority: currentPrio,
    notifTime: document.getElementById('task-time').value,
    weekDays,
    biweeklyMode: biMode,
    monthDay: parseInt(document.getElementById('monthly-day').value) || 1,
    customDate: document.getElementById('custom-date').value,
    connectNote: existing ? existing.connectNote : undefined,
    guideRef: existing ? existing.guideRef : (S.formGuideRef || undefined),
    createdAt: existing ? existing.createdAt : today(),
  };

  if (S.editingId){
    const i = S.tasks.findIndex(t=>t.id===S.editingId);
    S.tasks[i] = task;
    toast('Tarea actualizada ✓');
  } else {
    S.tasks.push(task);
    toast('Tarea creada ✓');
  }
  DB.save(DB.TASKS, S.tasks);
  closeForm();
  renderAll();
  scheduleAlarms();
}

function deleteTask(){
  if (!S.editingId) return;
  if (!confirm('¿Eliminar esta tarea? No se puede deshacer.')) return;
  // Record a tombstone so cloud merge won't resurrect it
  try {
    const deleted = JSON.parse(localStorage.getItem('tf3_deleted')||'[]');
    if (!deleted.includes(S.editingId)){ deleted.push(S.editingId); localStorage.setItem('tf3_deleted', JSON.stringify(deleted)); }
  } catch {}
  S.tasks = S.tasks.filter(t => t.id !== S.editingId);
  DB.save(DB.TASKS, S.tasks);
  closeForm();
  toast('Tarea eliminada');
  renderAll();
}

function closeForm(){
  document.getElementById('form-overlay').classList.add('hidden');
  S.editingId = null;
}

function goFormStep(n){
  document.getElementById('form-step-1').classList.toggle('active', n===1);
  document.getElementById('form-step-1').classList.toggle('hidden', n!==1);
  document.getElementById('form-step-2').classList.toggle('active', n===2);
  document.getElementById('form-step-2').classList.toggle('hidden', n!==2);
  document.getElementById('btn-save').classList.toggle('hidden', n!==2);
  document.getElementById('form-back').classList.toggle('hidden', !(n===2 && !S.editingId));
}

/* ============ FORM CONTROLS ============ */
let currentRec = 'daily', currentPrio = 'medium';
function setRec(rec){
  currentRec = rec;
  document.querySelectorAll('.rec-btn').forEach(b => b.classList.toggle('active', b.dataset.rec===rec));
  document.getElementById('cfg-weekly').classList.toggle('hidden', rec!=='weekly');
  document.getElementById('cfg-biweekly').classList.toggle('hidden', rec!=='biweekly');
  document.getElementById('cfg-monthly').classList.toggle('hidden', rec!=='monthly');
  document.getElementById('cfg-custom').classList.toggle('hidden', rec!=='custom');
}
function setPrio(p){
  currentPrio = p;
  document.querySelectorAll('.prio-s').forEach(b => b.classList.toggle('active', b.dataset.prio===p));
}

/* ============ NAVIGATION ============ */
function switchView(view){
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view===view));
  document.querySelectorAll('.view').forEach(v => {
    const on = v.id === `view-${view}`;
    v.classList.toggle('active', on);
    v.classList.toggle('hidden', !on);
  });
  if (view==='today') renderToday();
  if (view==='calendar') renderCalendar();
  if (view==='tasks') renderTasks();
  if (view==='history') renderHistory();
  if (view==='guides') renderGuides();
}

function renderAll(){
  renderToday(); renderTasks(); renderHistory();
  if (!document.getElementById('view-calendar').classList.contains('hidden')) renderCalendar();
}

/* ============ NOTIFICATIONS ============ */
async function requestNotif(){
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}
function updateNotifBtn(){
  const btn = document.getElementById('btn-notify');
  if (!('Notification' in window)){ btn.style.display='none'; return; }
  btn.classList.toggle('on', Notification.permission === 'granted');
}

/* Fire a notification through SW (preferred on Android) or fallback to direct */
async function fireNotification(title, body, tag){
  if (Notification.permission !== 'granted') return;
  try {
    if ('serviceWorker' in navigator){
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, {
        body, icon:'icons/icon-192.png', badge:'icons/icon-192.png',
        tag, renotify:false, requireInteraction:false,
        vibrate:[80,40,80],
      });
      return;
    }
  } catch {}
  try { new Notification(title, { body, icon:'icons/icon-192.png', tag }); } catch {}
}

function scheduleAlarms(){
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (window._timers) window._timers.forEach(clearTimeout);
  window._timers = [];
  const now = new Date();
  const t = today();
  S.tasks.forEach(task => {
    if (!occursOn(task, t) || completedOn(task.id, t)) return;
    const [h,m] = (task.notifTime||'08:00').split(':').map(Number);
    const at = new Date(); at.setHours(h,m,0,0);
    const diff = at - now;
    if (diff > 0 && diff < 86400000){
      window._timers.push(setTimeout(() => {
        if (completedOn(task.id, t)) return;
        fireNotification('📋 TaskFlow', task.name, `t-${task.id}-${t}`);
        markNotified(task.id, t);
      }, diff));
    }
  });
}

/* Track which notifications already fired (avoid duplicates) */
function markNotified(taskId, ds){
  try {
    const key = 'tf3_notified';
    const set = JSON.parse(localStorage.getItem(key) || '{}');
    set[`${taskId}_${ds}`] = true;
    localStorage.setItem(key, JSON.stringify(set));
  } catch {}
}
function wasNotified(taskId, ds){
  try {
    const set = JSON.parse(localStorage.getItem('tf3_notified') || '{}');
    return !!set[`${taskId}_${ds}`];
  } catch { return false; }
}

/* On app open: fire any notifications whose time already passed today but weren't sent
   (handles the case where the app was closed at the scheduled time) */
function checkMissedNotifications(){
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const t = today();
  let fired = 0;
  S.tasks.forEach(task => {
    if (!occursOn(task, t) || completedOn(task.id, t)) return;
    if (wasNotified(task.id, t)) return;
    const [h,m] = (task.notifTime||'08:00').split(':').map(Number);
    const at = new Date(); at.setHours(h,m,0,0);
    // If the scheduled time already passed today and we haven't notified, fire a gentle reminder
    if (now >= at && fired < 3){
      fireNotification('📋 Pendiente de hoy', task.name, `miss-${task.id}-${t}`);
      markNotified(task.id, t);
      fired++;
    }
  });
}

/* ============ TOAST + CONFETTI ============ */
let toastT;
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(()=>t.classList.add('hidden'), 2600);
}

function confettiBurst(){
  const colors = ['#7C3AED','#4F46E5','#34D399','#FBBF24','#FB7185'];
  for (let i=0;i<18;i++){
    const c = document.createElement('div');
    const size = 6 + Math.random()*5;
    c.style.cssText = `position:fixed;width:${size}px;height:${size}px;background:${colors[i%colors.length]};border-radius:2px;left:50%;top:40%;z-index:3000;pointer-events:none;`;
    document.body.appendChild(c);
    const angle = (Math.PI*2*i)/18 + Math.random();
    const vel = 80 + Math.random()*120;
    const dx = Math.cos(angle)*vel, dy = Math.sin(angle)*vel - 60;
    c.animate([
      { transform:'translate(-50%,-50%) rotate(0)', opacity:1 },
      { transform:`translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 200}px)) rotate(${Math.random()*720}deg)`, opacity:0 }
    ], { duration: 900+Math.random()*400, easing:'cubic-bezier(0.2,0.6,0.4,1)' }).onfinish = () => c.remove();
  }
}

/* ============ SEED ============ */
function seed(){
  if (DB.load(DB.TASKS)) return;
  // Recurring tasks start counting as overdue from YESTERDAY (not before)
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
  const yStr = dstr(yesterday);
  // Carga el flujo de ejemplo desde seed-data.js
  const raw = (typeof buildSeedTasks === 'function') ? buildSeedTasks(uid, today()) : [];
  S.tasks = raw.map(d => ({
    weekDays: [], biweeklyMode: '1-15', customDate: today(), monthDay: 1,
    ...d,
    id: uid(),
    // custom (one-time) tasks keep today; recurring ones start from yesterday
    createdAt: d.recurrence === 'custom' ? today() : yStr,
  }));
  DB.save(DB.TASKS, S.tasks);
}

function seedGuides(){
  if (DB.load(DB.GUIDES)) { S.guides = DB.load(DB.GUIDES); return; }
  S.guides = (typeof GUIDES_SEED !== 'undefined') ? JSON.parse(JSON.stringify(GUIDES_SEED)) : [];
  DB.save(DB.GUIDES, S.guides);
}

/* ============ GUIDES RENDER ============ */
function renderGuides(){
  const cont = document.getElementById('guides-list');
  cont.innerHTML = '';
  const q = S.guideSearch.toLowerCase().trim();

  let list = S.guides;
  if (q){
    list = list.filter(g =>
      g.name.toLowerCase().includes(q) ||
      g.category.toLowerCase().includes(q) ||
      g.steps.some(s => (s.text||'').toLowerCase().includes(q) || (s.note||'').toLowerCase().includes(q)) ||
      (g.cases||[]).some(c => c.title.toLowerCase().includes(q) || c.body.toLowerCase().includes(q))
    );
  }

  if (list.length === 0){
    cont.innerHTML = `<div class="empty-state-sm"><p>${q?'No se encontró nada':'No hay guías todavía'}</p></div>`;
    return;
  }

  list.forEach(g => {
    const card = document.createElement('div');
    card.className = 'guide-card';
    card.innerHTML = `
      <div class="guide-card-icon ${g.color||'violet'}">${g.emoji||'📖'}</div>
      <div class="guide-card-body">
        <div class="guide-card-name">${esc(g.name)}</div>
        <div class="guide-card-meta">
          <span class="guide-card-cat">${esc(g.category||'General')}</span>
          <span>${g.steps.length} pasos${(g.cases&&g.cases.length)?` · ${g.cases.length} casos`:''}</span>
        </div>
      </div>
      <svg class="guide-card-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
    `;
    card.addEventListener('click', () => openGuide(g.id));
    cont.appendChild(card);
  });
}

function openGuide(guideId, fromTask=false){
  const g = S.guides.find(x => x.id === guideId);
  if (!g) return;
  S.viewingGuideId = guideId;
  S.guideEditMode = false;
  S.guideFromTask = fromTask;

  document.getElementById('guide-title').textContent = 'Guía';
  document.getElementById('guide-back').classList.toggle('hidden', !fromTask);

  const meta = document.getElementById('guide-meta');
  meta.innerHTML = `
    <div class="guide-meta-icon ${g.color||'violet'}" style="background:var(--${g.color==='violet'?'accent-soft':g.color+'-soft'})">${g.emoji||'📖'}</div>
    <div class="guide-meta-text">
      <div class="guide-meta-name">${esc(g.name)}</div>
      <div class="guide-meta-cat">${esc(g.category||'General')}</div>
    </div>
  `;
  document.getElementById('guide-edit-toggle').classList.remove('active');
  document.getElementById('guide-edit-toggle').textContent = '✏️ Editar';

  renderGuideSteps(g);
  renderGuideCases(g);

  document.getElementById('guide-overlay').classList.remove('hidden');
}

function renderGuideSteps(g){
  const cont = document.getElementById('guide-steps');
  cont.innerHTML = '';
  g.steps.forEach((step, i) => {
    const el = document.createElement('div');
    if (S.guideEditMode){
      el.className = 'gstep editing';
      el.innerHTML = `
        <div class="gstep-edit-row">
          <div class="gstep-num">${i+1}</div>
          <input class="gstep-edit-input" value="${esc(step.text)}" data-field="text" data-idx="${i}" placeholder="Paso…" />
          <div class="gstep-move-btns">
            <button class="gstep-move up" data-idx="${i}" ${i===0?'disabled':''}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="18 15 12 9 6 15"/></svg></button>
            <button class="gstep-move down" data-idx="${i}" ${i===g.steps.length-1?'disabled':''}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></button>
          </div>
          <button class="gstep-del" data-idx="${i}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <input class="gstep-edit-input" value="${esc(step.note||'')}" data-field="note" data-idx="${i}" placeholder="Nota o advertencia (opcional)…" style="font-size:13px" />
      `;
      el.querySelectorAll('.gstep-edit-input').forEach(inp => {
        inp.addEventListener('input', e => {
          const idx = parseInt(e.target.dataset.idx);
          g.steps[idx][e.target.dataset.field] = e.target.value;
        });
      });
      el.querySelector('.gstep-del').addEventListener('click', () => {
        g.steps.splice(i,1);
        saveGuides(); renderGuideSteps(g);
      });
      el.querySelector('.gstep-move.up').addEventListener('click', () => {
        if (i>0){ [g.steps[i-1],g.steps[i]]=[g.steps[i],g.steps[i-1]]; saveGuides(); renderGuideSteps(g); }
      });
      el.querySelector('.gstep-move.down').addEventListener('click', () => {
        if (i<g.steps.length-1){ [g.steps[i+1],g.steps[i]]=[g.steps[i],g.steps[i+1]]; saveGuides(); renderGuideSteps(g); }
      });
    } else {
      el.className = 'gstep';
      const noteClass = step.note && (step.note.includes('⚠') || step.note.includes('⏰') || step.note.includes('📝')) ? '' : 'plain';
      el.innerHTML = `
        <div class="gstep-num">${i+1}</div>
        <div class="gstep-body">
          <div class="gstep-text">${esc(step.text)}</div>
          ${step.note ? `<div class="gstep-note ${noteClass}">${esc(step.note)}</div>` : ''}
        </div>
      `;
    }
    cont.appendChild(el);
  });

  if (S.guideEditMode){
    const addBtn = document.createElement('button');
    addBtn.className = 'add-step-btn';
    addBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Agregar paso`;
    addBtn.addEventListener('click', () => {
      g.steps.push({ text:'', note:'' });
      saveGuides(); renderGuideSteps(g);
    });
    cont.appendChild(addBtn);
  }
}

function renderGuideCases(g){
  const cont = document.getElementById('guide-cases');
  cont.innerHTML = '';
  if (!g.cases) g.cases = [];

  if (S.guideEditMode){
    const label = document.createElement('div');
    label.className = 'mini-label';
    label.style.cssText = 'margin: 18px 0 12px';
    label.textContent = 'Casos especiales y notas';
    cont.appendChild(label);

    g.cases.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'gcase editing';
      el.innerHTML = `
        <input class="gcase-edit-title" value="${esc(c.title)}" placeholder="Título del caso…" data-idx="${i}" data-field="title" />
        <textarea class="gcase-edit-body" placeholder="Descripción del caso…" data-idx="${i}" data-field="body">${esc(c.body)}</textarea>
        <button class="gcase-del" data-idx="${i}">✕ Borrar caso</button>
      `;
      el.querySelectorAll('[data-field]').forEach(inp => {
        inp.addEventListener('input', e => {
          g.cases[parseInt(e.target.dataset.idx)][e.target.dataset.field] = e.target.value;
        });
      });
      el.querySelector('.gcase-del').addEventListener('click', () => {
        g.cases.splice(i,1); saveGuides(); renderGuideCases(g);
      });
      cont.appendChild(el);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-case-btn';
    addBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Agregar caso especial`;
    addBtn.addEventListener('click', () => {
      g.cases.push({ title:'', body:'' }); saveGuides(); renderGuideCases(g);
    });
    cont.appendChild(addBtn);
    return;
  }

  // Read mode
  if (!g.cases.length) return;
  const label = document.createElement('div');
  label.className = 'mini-label';
  label.style.cssText = 'margin: 6px 0 12px';
  label.textContent = 'Casos especiales y notas';
  cont.appendChild(label);
  g.cases.forEach(c => {
    if (!c.title && !c.body) return;
    const el = document.createElement('div');
    el.className = 'gcase';
    el.innerHTML = `<div class="gcase-title">${esc(c.title)}</div><div class="gcase-body">${esc(c.body)}</div>`;
    cont.appendChild(el);
  });
}

function saveGuides(){
  // Stamp the currently-edited guide so cloud merge keeps the newest version
  if (S.viewingGuideId){
    const g = S.guides.find(x => x.id === S.viewingGuideId);
    if (g) g.updatedAt = new Date().toISOString();
  }
  DB.save(DB.GUIDES, S.guides);
}

function toggleGuideEdit(){
  S.guideEditMode = !S.guideEditMode;
  const btn = document.getElementById('guide-edit-toggle');
  btn.classList.toggle('active', S.guideEditMode);
  btn.textContent = S.guideEditMode ? '✓ Listo' : '✏️ Editar';
  const g = S.guides.find(x => x.id === S.viewingGuideId);
  if (g){ renderGuideSteps(g); renderGuideCases(g); }
}

function closeGuide(){
  document.getElementById('guide-overlay').classList.add('hidden');
  S.viewingGuideId = null; S.guideEditMode = false;
  renderGuides();
}

function createNewGuide(){
  const name = prompt('Nombre de la nueva guía:');
  if (!name || !name.trim()) return;
  const g = {
    id: 'guide-' + uid(), emoji: '📖', name: name.trim(),
    category: 'General', color: 'violet',
    steps: [{ text:'', note:'' }], cases: [],
    updatedAt: new Date().toISOString()
  };
  S.guides.push(g);
  saveGuides();
  renderGuides();
  openGuide(g.id);
  toggleGuideEdit();
}


/* ============ MIGRATION: overdue fix ============ */
/* One-time fix for users who already have tasks saved.
   DISABLED: this used to rewrite createdAt on every recurring task, which caused
   phantom overdue entries after re-deploys. Kept as a no-op for safety. */
function migrateOverdueFix(){ /* intentionally disabled */ }

/* Keep localStorage from ever filling up (the real cause of data loss).
   Runs on every startup: trims the notified-log and removes stale drafts. */
function pruneJunk(){
  try {
    // 1) Trim tf3_notified to only the last 10 days of entries
    const raw = localStorage.getItem('tf3_notified');
    if (raw){
      const set = JSON.parse(raw);
      const keep = {};
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-10);
      const cutoffStr = dstr(cutoff);
      Object.keys(set).forEach(k => {
        const m = k.match(/(\d{4}-\d{2}-\d{2})$/);
        if (m && m[1] >= cutoffStr) keep[k] = true;
      });
      localStorage.setItem('tf3_notified', JSON.stringify(keep));
    }

    // 2) Remove drafts for dates older than 60 days OR for tasks that no longer exist
    const validIds = new Set(S.tasks.map(t => t.id));
    const cutoff2 = new Date(); cutoff2.setDate(cutoff2.getDate()-60);
    const cutoff2Str = dstr(cutoff2);
    const toRemove = [];
    for (let i=0;i<localStorage.length;i++){
      const key = localStorage.key(i);
      if (key && key.startsWith('tf3_draft_')){
        const m = key.match(/tf3_draft_(.+)_(\d{4}-\d{2}-\d{2})$/);
        if (m){
          const taskId = m[1], dateStr = m[2];
          if (dateStr < cutoff2Str || !validIds.has(taskId)) toRemove.push(key);
        }
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch {}
}

/* ============ MANUAL BACKUP (export/import) ============ */
function exportBackup(){
  try {
    const data = {
      app: 'TaskFlow',
      version: 3,
      exportedAt: new Date().toISOString(),
      tasks: DB.load(DB.TASKS) || [],
      history: DB.load(DB.HISTORY) || [],
      guides: DB.load(DB.GUIDES) || [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0,10);
    a.href = url; a.download = `TaskFlow_respaldo_${date}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    toast('Respaldo descargado ✓');
  } catch(e){ toast('Error al exportar'); console.error(e); }
}

function importBackup(file){
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || !Array.isArray(data.tasks)){ toast('⚠ Archivo no válido'); return; }
      const count = data.tasks.length;
      if (!confirm(`Este respaldo tiene ${count} tareas. ¿Restaurar? Esto reemplazará las tareas actuales.`)) return;
      // Backup current before overwriting, just in case
      backupTasks();
      DB.save(DB.TASKS, data.tasks);
      if (Array.isArray(data.history)) DB.save(DB.HISTORY, data.history);
      if (Array.isArray(data.guides)) DB.save(DB.GUIDES, data.guides);
      S.tasks = data.tasks;
      S.history = data.history || [];
      S.guides = data.guides || S.guides;
      document.getElementById('backup-overlay').classList.add('hidden');
      toast(`${count} tareas restauradas ✓`);
      renderAll();
    } catch(err){ toast('⚠ No se pudo leer el archivo'); console.error(err); }
  };
  reader.readAsText(file);
}

/* Load the 5 known rezagados from 11/08 (recovered from memory) */
function loadRecovery(){
  const yesterday = '2026-08-11';
  const recovered = [
    { name:'Completar firmas del listado de entrega', templateKey:'blank', recurrence:'custom', customDate: yesterday, priority:'high', notifTime:'08:00', guided:{}, checklist:['Reunir el listado','Conseguir las firmas que faltan'] },
    { name:'Preparar listado de uniformes', templateKey:'blank', recurrence:'custom', customDate: yesterday, priority:'medium', notifTime:'08:00', guided:{}, checklist:['Elaborar el listado de tallas'] },
    { name:'Coordinar traslado de equipo', templateKey:'blank', recurrence:'custom', customDate: yesterday, priority:'high', notifTime:'08:00', guided:{ what:'Coordinar con el área de logística' }, checklist:['Coordinar con logística','Trasladar el equipo'] },
    { name:'Devolver bienes enviados por error', templateKey:'blank', recurrence:'custom', customDate: yesterday, priority:'high', notifTime:'08:00', guided:{ notes:'Se recibieron por error, hay que devolverlos' }, checklist:['Identificar los bienes','Coordinar la devolución'] },
    { name:'Toma de inventario', templateKey:'blank', recurrence:'daily', priority:'medium', notifTime:'08:00', guided:{ what:'Tarea diaria' }, checklist:['Hacer la toma de inventario del día'] },
    { name:'Dar seguimiento a cobro pendiente', templateKey:'blank', recurrence:'custom', customDate: yesterday, priority:'high', notifTime:'08:00', guided:{ notes:'Cliente de ejemplo' }, checklist:['Verificar el estado','Gestionar el cobro','Emitir el documento'] },
  ];
  // Don't duplicate: skip any recovery task whose name already exists
  const existingNames = new Set(S.tasks.map(t => (t.name||'').toLowerCase().trim()));
  const toAdd = recovered.filter(d => !existingNames.has(d.name.toLowerCase().trim()));
  const newTasks = toAdd.map(d => ({
    weekDays:[], biweeklyMode:'1-15', customDate: today(), monthDay:1,
    ...d,
    id: uid(),
    createdAt: d.recurrence === 'custom' ? yesterday : '2026-08-11',
  }));
  if (newTasks.length === 0){ toast('Esas tareas ya están cargadas'); return; }
  // Add them to whatever exists (don't wipe)
  S.tasks = [...newTasks, ...S.tasks];
  DB.save(DB.TASKS, S.tasks);
  const bo = document.getElementById('backup-overlay');
  if (bo) bo.classList.add('hidden');
  toast(`${newTasks.length} tareas cargadas ✓`);
  renderAll();
}

/* Full reset: wipe everything and start truly empty (no demo tasks) */
function resetApp(){
  const msg = '¿Borrar TODAS las tareas y empezar completamente limpio?\n\nEsto NO se puede deshacer. Si tienes algo que guardar, cancela y descarga un respaldo primero.';
  if (!confirm(msg)) return;
  // Second confirm for safety
  if (!confirm('¿Seguro? Se borrará todo y la app quedará vacía para que metas tus tareas reales.')) return;
  try {
    // Remove every app key
    const keysToRemove = [];
    for (let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if (k && k.startsWith('tf3_')) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    // Mark that the user chose a clean start, so seed() does NOT run and refill demos
    localStorage.setItem('tf3_tasks', '[]');
    localStorage.setItem('tf3_clean_start', '1');
  } catch {}
  S.tasks = [];
  S.history = [];
  // keep guides available but reset to defaults
  S.guides = (typeof GUIDES_SEED !== 'undefined') ? JSON.parse(JSON.stringify(GUIDES_SEED)) : [];
  try { DB.save(DB.GUIDES, S.guides); } catch {}
  document.getElementById('backup-overlay').classList.add('hidden');
  toast('App reiniciada — empieza a agregar tus tareas ✓');
  renderAll();
}

/* ============ AUTHENTICATION GATE ============ */
function showLoginScreen(){
  document.getElementById('splash').classList.add('fade');
  document.getElementById('app').classList.add('hidden');
  const ls = document.getElementById('login-screen');
  ls.classList.remove('hidden');

  // If cloud isn't configured yet, show the config section first
  if (!CLOUD.configured){
    document.getElementById('login-form-fields').classList.add('hidden');
    document.getElementById('login-config').classList.remove('hidden');
  } else {
    document.getElementById('login-form-fields').classList.remove('hidden');
    document.getElementById('login-config').classList.add('hidden');
  }
}

function hideLoginScreen(){
  document.getElementById('login-screen').classList.add('hidden');
}

async function handleLogin(){
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  const msg = document.getElementById('login-msg');
  if (!email || !pass){ msg.textContent = '⚠ Escribe correo y contraseña'; msg.style.color = 'var(--amber, #fbbf24)'; return; }

  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.style.opacity = '0.6';
  msg.style.color = 'var(--text-3, #8b95a9)';
  msg.textContent = 'Entrando…';

  const result = await CLOUD.signIn(email, pass);

  btn.disabled = false; btn.style.opacity = '1';
  if (!result.ok){
    msg.style.color = 'var(--red, #fb7185)';
    msg.textContent = '✗ ' + (result.msg || 'Correo o contraseña incorrectos');
    return;
  }

  msg.style.color = 'var(--green, #10b981)';
  msg.textContent = '✓ ¡Listo!';
  hideLoginScreen();
  bootApp();
}

function handleLogout(){
  if (!confirm('¿Cerrar sesión? Tendrás que volver a entrar con tu correo y contraseña.')) return;
  CLOUD.signOut().then(() => {
    location.reload();
  });
}

/* ============ INIT ============ */
function init(){
  setupLoginListeners();
  // SIEMPRE exigir sesión. Sin login no se entra NUNCA (ni en incógnito ni con el link).
  if (!CLOUD.isLoggedIn){
    setTimeout(() => showLoginScreen(), 600);
    return;
  }
  bootApp();
}

function setupLoginListeners(){
  const byId = id => document.getElementById(id);
  byId('login-btn').addEventListener('click', handleLogin);
  byId('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  byId('login-config-save').addEventListener('click', async () => {
    const url = byId('login-url').value.trim();
    const key = byId('login-key').value.trim();
    const m = byId('login-config-msg');
    if (!url || !key){ m.textContent = '⚠ Llena los dos campos'; m.style.color = 'var(--amber, #fbbf24)'; return; }
    CLOUD.set(url, key);
    m.style.color = 'var(--text-3, #8b95a9)'; m.textContent = 'Probando…';
    const r = await CLOUD.test();
    if (!r.ok){ m.textContent = '✗ ' + r.msg; m.style.color = 'var(--red, #fb7185)'; return; }
    byId('login-config').classList.add('hidden');
    byId('login-form-fields').classList.remove('hidden');
    byId('login-sub').textContent = 'Inicia sesión para ver tus tareas';
  });
}

function bootApp(){
  // --- SAFE LOAD: never seed over existing-but-unreadable data ---
  let loadedTasks = DB.load(DB.TASKS);
  const tasksKeyPresent = DB.keyExists(DB.TASKS);

  if (loadedTasks === null && tasksKeyPresent){
    // The key EXISTS but failed to parse = corruption. Do NOT seed.
    // Try the backup first.
    const backup = restoreTasksBackup();
    if (backup && backup.length){
      loadedTasks = backup;
      // re-save the recovered data as the live copy
      try { localStorage.setItem(DB.TASKS, JSON.stringify(backup)); } catch {}
      setTimeout(() => toast('Se recuperaron tus tareas desde un respaldo'), 1200);
    } else {
      // No backup available: keep an empty list rather than overwriting with demo tasks
      loadedTasks = [];
      setTimeout(() => toast('No se pudieron leer las tareas guardadas'), 1200);
    }
  }

  S.tasks = loadedTasks || [];
  S.history = DB.load(DB.HISTORY) || [];

  // Only seed when this is genuinely a fresh install (key never existed)
  // AND the user hasn't explicitly done a clean start.
  const cleanStart = localStorage.getItem('tf3_clean_start') === '1';
  if (S.tasks.length === 0 && !tasksKeyPresent && !cleanStart){
    seed();
  }
  seedGuides();
  // NOTE: migrateOverdueFix intentionally NOT called anymore (see below)

  // Make a backup of the good state we just loaded, and prune junk on every start
  backupTasks();
  pruneJunk();

  // --- CLOUD SYNC on startup: MERGE local + cloud (never lose a task from either side) ---
  if (CLOUD.configured){
    setCloudStatus('syncing');
    CLOUD.pull().then(cloud => {
      if (cloud && Array.isArray(cloud.tasks)){
        // MERGE strategy: union of local and cloud tasks by id.
        // For tasks that exist in both, keep the more recently updated one.
        // A task is only ever removed by an explicit delete (tracked in a tombstone list), never by sync.
        const localTasks = DB.load(DB.TASKS) || [];
        const cloudTasks = cloud.tasks || [];
        const deleted = new Set(JSON.parse(localStorage.getItem('tf3_deleted')||'[]').concat(cloud.deleted||[]));

        const byId = {};
        // seed with cloud
        cloudTasks.forEach(t => { if (t && t.id) byId[t.id] = t; });
        // overlay local, keeping newer where both exist
        localTasks.forEach(t => {
          if (!t || !t.id) return;
          const existing = byId[t.id];
          if (!existing){ byId[t.id] = t; }
          else {
            const te = existing.updatedAt || existing.createdAt || '';
            const tl = t.updatedAt || t.createdAt || '';
            byId[t.id] = (tl >= te) ? t : existing;
          }
        });
        // drop any explicitly-deleted tasks
        let merged = Object.values(byId).filter(t => !deleted.has(t.id));

        // Merge history similarly (union by taskId+date)
        const localHist = DB.load(DB.HISTORY) || [];
        const cloudHist = Array.isArray(cloud.history) ? cloud.history : [];
        const histKey = h => `${h.taskId||h.name||''}_${h.date||''}`;
        const histMap = {};
        cloudHist.concat(localHist).forEach(h => { if (h) histMap[histKey(h)] = h; });
        const mergedHist = Object.values(histMap);

        // Merge GUIDES by id (union, newest wins) — same strategy as tasks.
        // Previously this did "S.guides = cloud.guides" which WIPED locally-added guides on reload.
        const localGuides = DB.load(DB.GUIDES) || [];
        const cloudGuides = Array.isArray(cloud.guides) ? cloud.guides : [];
        const guidesDeleted = new Set(
          JSON.parse(localStorage.getItem('tf3_guides_deleted')||'[]').concat(cloud.guidesDeleted||[])
        );
        const gById = {};
        cloudGuides.forEach(g => { if (g && g.id) gById[g.id] = g; });
        localGuides.forEach(g => {
          if (!g || !g.id) return;
          const ex = gById[g.id];
          if (!ex){ gById[g.id] = g; }
          else {
            const te = ex.updatedAt || 0;
            const tl = g.updatedAt || 0;
            gById[g.id] = (tl >= te) ? g : ex;
          }
        });
        let mergedGuides = Object.values(gById).filter(g => !guidesDeleted.has(g.id));
        if (mergedGuides.length) S.guides = mergedGuides;

        S.tasks = merged;
        S.history = mergedHist;
        try {
          localStorage.setItem(DB.TASKS, JSON.stringify(S.tasks));
          localStorage.setItem(DB.HISTORY, JSON.stringify(S.history));
          localStorage.setItem(DB.GUIDES, JSON.stringify(S.guides));
        } catch {}
        renderAll();
        setCloudStatus('ok');
        // Push the merged result back so the cloud also has the union
        CLOUD.push();
      } else {
        // Cloud is empty (first time): push current local data up
        setCloudStatus('syncing');
        CLOUD.push().then(ok => setCloudStatus(ok?'ok':'error'));
      }
    }).catch(() => setCloudStatus('error'));
  } else {
    setCloudStatus('offline');
  }

  setTimeout(() => {
    document.getElementById('splash').classList.add('fade');
    document.getElementById('app').classList.remove('hidden');
    renderAll();
    updateNotifBtn();
    scheduleAlarms();
    checkMissedNotifications();
  }, 950);

  // Nav
  document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', ()=>switchView(n.dataset.view)));
  document.getElementById('nav-fab').addEventListener('click', ()=>openForm());

  // History button (top bar)
  document.getElementById('btn-history').addEventListener('click', () => switchView('history'));

  // Backup
  document.getElementById('btn-backup').addEventListener('click', () => document.getElementById('backup-overlay').classList.remove('hidden'));
  document.getElementById('backup-close').addEventListener('click', () => document.getElementById('backup-overlay').classList.add('hidden'));
  document.getElementById('backup-overlay').addEventListener('click', e => { if (e.target.id==='backup-overlay') document.getElementById('backup-overlay').classList.add('hidden'); });
  document.getElementById('do-export').addEventListener('click', exportBackup);
  document.getElementById('do-import').addEventListener('change', e => { if (e.target.files && e.target.files[0]) importBackup(e.target.files[0]); e.target.value=''; });
  document.getElementById('do-reset').addEventListener('click', resetApp);
  document.getElementById('do-recovery').addEventListener('click', loadRecovery);

  // Cloud config
  const cloudUrl = document.getElementById('cloud-url');
  const cloudKey = document.getElementById('cloud-key');
  const cloudMsg = document.getElementById('cloud-msg');
  const cloudDisc = document.getElementById('cloud-disconnect');
  function refreshCloudUI(){
    cloudUrl.value = CLOUD.url;
    cloudKey.value = CLOUD.key;
    const label = document.getElementById('cloud-state-label');
    const syncActions = document.getElementById('cloud-sync-actions');
    const syncHint = document.getElementById('cloud-sync-hint');
    const acctStatus = document.getElementById('account-status');
    const acctEmail = document.getElementById('account-email');
    if (CLOUD.configured){
      label.textContent = '● Conectado';
      label.style.color = 'var(--green)';
      cloudDisc.classList.remove('hidden');
      // When logged in, show account + hide the manual device-merge stuff (auth handles it)
      if (CLOUD.isLoggedIn){
        acctStatus.classList.remove('hidden');
        acctEmail.textContent = CLOUD.authEmail || '(cuenta)';
        syncActions.classList.add('hidden');
        syncHint.classList.add('hidden');
        document.getElementById('cloud-merge').classList.add('hidden');
      } else {
        acctStatus.classList.add('hidden');
        syncActions.classList.remove('hidden');
        syncHint.classList.remove('hidden');
        document.getElementById('cloud-merge').classList.remove('hidden');
      }
    } else {
      label.textContent = '○ No conectado';
      label.style.color = 'var(--text-3)';
      cloudDisc.classList.add('hidden');
      syncActions.classList.add('hidden');
      syncHint.classList.add('hidden');
      acctStatus.classList.add('hidden');
      document.getElementById('cloud-merge').classList.add('hidden');
    }
  }
  // Logout button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  document.getElementById('cloud-test').addEventListener('click', async () => {
    if (!cloudUrl.value.trim() || !cloudKey.value.trim()){ cloudMsg.textContent = '⚠ Llena los dos campos primero'; cloudMsg.style.color='var(--amber)'; return; }
    CLOUD.set(cloudUrl.value, cloudKey.value);
    cloudMsg.textContent = 'Probando…'; cloudMsg.style.color='var(--text-3)';
    const r = await CLOUD.test();
    cloudMsg.textContent = (r.ok?'✓ ':'✗ ') + r.msg;
    cloudMsg.style.color = r.ok ? 'var(--green)' : 'var(--red)';
  });
  document.getElementById('cloud-save').addEventListener('click', async () => {
    if (!cloudUrl.value.trim() || !cloudKey.value.trim()){ cloudMsg.textContent = '⚠ Llena los dos campos primero'; cloudMsg.style.color='var(--amber)'; return; }
    CLOUD.set(cloudUrl.value, cloudKey.value);
    cloudMsg.textContent = 'Conectando…'; cloudMsg.style.color='var(--text-3)';
    const r = await CLOUD.test();
    if (!r.ok){ cloudMsg.textContent = '✗ ' + r.msg; cloudMsg.style.color='var(--red)'; return; }
    // On connect: pull cloud data if exists, else push local
    const cloud = await CLOUD.pull();
    if (cloud && Array.isArray(cloud.tasks) && cloud.tasks.length){
      if (confirm(`La nube ya tiene ${cloud.tasks.length} tareas guardadas. ¿Usar esas? (Cancelar = subir las de este teléfono)`)){
        S.tasks = cloud.tasks; S.history = cloud.history||[]; if(cloud.guides&&cloud.guides.length) S.guides=cloud.guides;
        try { localStorage.setItem(DB.TASKS, JSON.stringify(S.tasks)); localStorage.setItem(DB.HISTORY, JSON.stringify(S.history)); localStorage.setItem(DB.GUIDES, JSON.stringify(S.guides)); } catch {}
        renderAll();
      } else {
        await CLOUD.push();
      }
    } else {
      await CLOUD.push();
    }
    cloudMsg.textContent = '✓ ¡Conectado! Tus tareas ahora se guardan solas en la nube.';
    cloudMsg.style.color = 'var(--green)';
    setCloudStatus('ok');
    refreshCloudUI();
  });
  cloudDisc.addEventListener('click', () => {
    if (!confirm('¿Desconectar la nube? Tus tareas seguirán en este teléfono pero ya no se guardarán en internet.')) return;
    CLOUD.clear();
    setCloudStatus('offline');
    cloudMsg.textContent = 'Nube desconectada';
    cloudMsg.style.color = 'var(--text-3)';
    refreshCloudUI();
  });
  // refresh cloud UI when opening the modal
  document.getElementById('btn-backup').addEventListener('click', refreshCloudUI);

  // Force upload this device's tasks to the cloud
  document.getElementById('cloud-force-push').addEventListener('click', async () => {
    if (!CLOUD.configured){ toast('Conecta la nube primero'); return; }
    if (!confirm('¿Subir las tareas de ESTE dispositivo a la nube? Reemplazará lo que haya en la nube con lo de aquí.')) return;
    cloudMsg.textContent = 'Subiendo…'; cloudMsg.style.color='var(--text-3)';
    const ok = await CLOUD.push();
    cloudMsg.textContent = ok ? '✓ Tareas subidas a la nube. Ahora en el otro dispositivo toca "Bajar de la nube".' : '✗ No se pudo subir';
    cloudMsg.style.color = ok ? 'var(--green)' : 'var(--red)';
    setCloudStatus(ok?'ok':'error');
  });

  // Merge all devices into one shared cloud slot
  document.getElementById('cloud-merge').addEventListener('click', async () => {
    if (!CLOUD.configured){ toast('Conecta la nube primero'); return; }
    const isGood = confirm('¿Este dispositivo tiene las tareas BUENAS (las que quieres conservar en todos)?\n\nAceptar = sí, este manda.\nCancelar = no, este las recibe.');
    // Switch to the shared slot
    localStorage.setItem('tf3_cloud_userid', 'taskflow-main-user');
    cloudMsg.textContent = 'Uniendo dispositivos…'; cloudMsg.style.color='var(--text-3)';
    if (isGood){
      // This device pushes its (good) tasks into the shared slot
      const ok = await CLOUD.push();
      cloudMsg.textContent = ok ? '✓ Listo. En tus OTROS dispositivos, abre este mismo menú y toca "Unir" eligiendo Cancelar (para que reciban).' : '✗ No se pudo subir';
      cloudMsg.style.color = ok ? 'var(--green)' : 'var(--red)';
    } else {
      // This device pulls from the shared slot
      const cloud = await CLOUD.pull();
      if (cloud && Array.isArray(cloud.tasks)){
        S.tasks = cloud.tasks;
        S.history = Array.isArray(cloud.history) ? cloud.history : [];
        if (Array.isArray(cloud.guides) && cloud.guides.length) S.guides = cloud.guides;
        try {
          localStorage.setItem(DB.TASKS, JSON.stringify(S.tasks));
          localStorage.setItem(DB.HISTORY, JSON.stringify(S.history));
          localStorage.setItem(DB.GUIDES, JSON.stringify(S.guides));
        } catch {}
        renderAll();
        cloudMsg.textContent = `✓ Este dispositivo ahora tiene las ${cloud.tasks.length} tareas compartidas.`;
        cloudMsg.style.color = 'var(--green)';
      } else {
        cloudMsg.textContent = 'La nube compartida está vacía. Primero une el dispositivo que tiene las tareas buenas (eligiendo Aceptar).';
        cloudMsg.style.color = 'var(--amber)';
      }
    }
    setCloudStatus('ok');
  });

  // Guides
  document.getElementById('guides-search').addEventListener('input', e => { S.guideSearch = e.target.value; renderGuides(); });
  document.getElementById('new-guide-btn').addEventListener('click', createNewGuide);
  document.getElementById('guide-close').addEventListener('click', closeGuide);
  document.getElementById('guide-overlay').addEventListener('click', e => { if (e.target.id==='guide-overlay') closeGuide(); });
  document.getElementById('guide-edit-toggle').addEventListener('click', toggleGuideEdit);
  document.getElementById('guide-back').addEventListener('click', () => {
    document.getElementById('guide-overlay').classList.add('hidden');
    S.viewingGuideId = null; S.guideEditMode = false;
    // re-open the task detail we came from
    if (S.detailId) document.getElementById('detail-overlay').classList.remove('hidden');
  });

  // Detail → guide link
  document.getElementById('detail-guide-link').addEventListener('click', () => {
    if (!S.detailGuideId) return;
    document.getElementById('detail-overlay').classList.add('hidden');
    openGuide(S.detailGuideId, true);
  });

  // Notify
  document.getElementById('btn-notify').addEventListener('click', async () => {
    if (Notification.permission === 'denied'){
      toast('⚠ Notificaciones bloqueadas en el navegador');
      alert('Las notificaciones están bloqueadas.\n\nPara activarlas en Android:\n1. Mantén presionado el ícono de TaskFlow\n2. Información de la app → Notificaciones\n3. Actívalas\n\nO en Chrome: candado junto a la dirección → Notificaciones → Permitir');
      return;
    }
    const ok = await requestNotif(); updateNotifBtn();
    if (ok){
      scheduleAlarms();
      // Fire an immediate test so the user SEES it works
      await fireNotification('🔔 ¡Notificaciones activadas!', 'Te avisaré a la hora de cada tarea. Esta es una prueba.', 'test-notif');
      toast('Notificaciones activadas 🔔');
    } else {
      toast('Permiso no concedido');
    }
  });

  // Overdue toggle
  document.getElementById('overdue-banner').addEventListener('click', () => {
    const list = document.getElementById('overdue-list');
    const banner = document.getElementById('overdue-banner');
    list.classList.toggle('hidden');
    banner.classList.toggle('open');
  });

  // Calendar controls
  document.querySelectorAll('.cal-mode').forEach(b => b.addEventListener('click', () => {
    S.calMode = b.dataset.mode;
    document.querySelectorAll('.cal-mode').forEach(x=>x.classList.toggle('active', x===b));
    renderCalendar();
  }));
  document.getElementById('cal-prev').addEventListener('click', () => {
    if (S.calMode==='month') S.calCursor.setMonth(S.calCursor.getMonth()-1);
    else S.calCursor.setDate(S.calCursor.getDate()-7);
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    if (S.calMode==='month') S.calCursor.setMonth(S.calCursor.getMonth()+1);
    else S.calCursor.setDate(S.calCursor.getDate()+7);
    renderCalendar();
  });
  document.getElementById('cal-today-btn').addEventListener('click', () => {
    S.calCursor = new Date(); S.calSelected = today(); renderCalendar();
  });

  // Form controls
  document.getElementById('form-close').addEventListener('click', closeForm);
  document.getElementById('form-overlay').addEventListener('click', e => { if (e.target.id==='form-overlay') closeForm(); });
  document.getElementById('form-back').addEventListener('click', () => goFormStep(1));
  document.getElementById('btn-save').addEventListener('click', saveForm);
  document.getElementById('btn-delete').addEventListener('click', deleteTask);
  document.getElementById('add-step-btn').addEventListener('click', () => {
    S.checklistDraft.push(''); renderChecklistBuilder();
    const inputs = document.querySelectorAll('.cl-input');
    if (inputs.length) inputs[inputs.length-1].focus();
  });

  document.querySelectorAll('.rec-btn').forEach(b => b.addEventListener('click', ()=>setRec(b.dataset.rec)));
  document.querySelectorAll('.prio-s').forEach(b => b.addEventListener('click', ()=>setPrio(b.dataset.prio)));
  document.querySelectorAll('#cfg-weekly .day-btn').forEach(b => b.addEventListener('click', ()=>b.classList.toggle('active')));
  document.querySelectorAll('.seg[data-bi]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.seg[data-bi]').forEach(x=>x.classList.toggle('active', x===b));
  }));

  // Detail
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-overlay').addEventListener('click', e => { if (e.target.id==='detail-overlay') closeDetail(); });
  document.getElementById('detail-edit').addEventListener('click', () => { const id=S.detailId; closeDetail(); openForm(id); });
  document.getElementById('detail-done').addEventListener('click', () => {
    if (!S.detailId) return;
    toggleComplete(S.detailId, S.detailDate);
    closeDetail();
  });

  // Search + filter
  document.getElementById('search-input').addEventListener('input', e => { S.search=e.target.value; renderTasks(); });
  document.querySelectorAll('.filter-chips .chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('.filter-chips .chip').forEach(x=>x.classList.remove('active'));
    c.classList.add('active'); S.filter=c.dataset.filter; renderTasks();
  }));

  document.addEventListener('keydown', e => { if (e.key==='Escape'){ closeForm(); closeDetail(); } });

  // Re-check alarms + missed notifications whenever app regains focus
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden){
      scheduleAlarms();
      checkMissedNotifications();
      renderToday();
    }
  });

  // SW
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});

  // Add SVG gradient def for ring (needs to exist in DOM)
  const svgNS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(svgNS,'defs');
  const grad = document.createElementNS(svgNS,'linearGradient');
  grad.id = 'ringGrad'; grad.setAttribute('x1','0'); grad.setAttribute('y1','0'); grad.setAttribute('x2','120'); grad.setAttribute('y2','120');
  const s1 = document.createElementNS(svgNS,'stop'); s1.setAttribute('offset','0'); s1.setAttribute('stop-color','#7C3AED');
  const s2 = document.createElementNS(svgNS,'stop'); s2.setAttribute('offset','1'); s2.setAttribute('stop-color','#34D399');
  grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad);
  document.querySelector('.progress-ring').prepend(defs);
}

document.addEventListener('DOMContentLoaded', init);
