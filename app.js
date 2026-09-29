// ===================================================================
//  โปรแกรมบัญชี POPLUCK — ตรรกะหลัก
// ===================================================================
import { categorize, HINTS } from './categorize.mjs';
import { decide } from './jev.mjs';

const SUPABASE_URL  = 'https://klgtxupwfsbyraoiyhhs.supabase.co';
const SUPABASE_ANON = 'sb_publishable_oucf4DJN_W_0aHYB3RoMvQ_64lkwFLe';
const OLLAMA = 'http://127.0.0.1:11434';
const MODEL  = 'qwen3:8b';
const VAT_RATE = 0.07;

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ---------- สถานะ ----------
const S = {
  page:'dash', period:'', settings:null,
  accounts:[], categories:[], vendors:[], txns:[], wht:[], assets:[],
  me:null,
  jevReady:false,
};

// ---------- ตัวช่วย ----------
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const B = n => (+n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
const B0 = n => (+n||0).toLocaleString('th-TH',{maximumFractionDigits:0});
const TH_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const dTH = d => { if(!d) return '—'; const x=new Date(d+'T00:00:00');
  return `${x.getDate()} ${TH_M[x.getMonth()]} ${x.getFullYear()+543-2500>0?String(x.getFullYear()+543).slice(2):x.getFullYear()+543}`; };
const today = () => new Date().toISOString().slice(0,10);
const ym = d => String(d).slice(0,7);

// ---------- ช่องกรอกตัวเลขแบบมีคอมมาอัตโนมัติ ----------
// type="number" ใส่คอมมาไม่ได้ตามสเปกเบราว์เซอร์ จึงใช้ช่องข้อความแล้วจัดรูปแบบเอง
function fmtMoneyStr(v){
  let s = String(v).replace(/[^\d.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, 2);
  let [a, b] = s.split('.');
  a = (a || '').replace(/^0+(?=\d)/, '');
  a = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return b !== undefined ? a + '.' + b : a;
}

// อ่านค่าตัวเลขจากช่องที่มีคอมมา
const numOf = el => +String(el?.value || '').replace(/,/g, '') || 0;

function attachMoney(el){
  if (!el || el.dataset.money) return;
  el.dataset.money = '1';
  el.type = 'text';
  el.inputMode = 'decimal';
  el.autocomplete = 'off';
  const run = () => {
    // นับจำนวนตัวเลขก่อนเคอร์เซอร์ไว้ เพื่อวางเคอร์เซอร์กลับที่เดิมหลังใส่คอมมา
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret).replace(/[^\d.]/g, '').length;
    el.value = fmtMoneyStr(el.value);
    let pos = 0, seen = 0;
    while (pos < el.value.length && seen < before) {
      if (/[\d.]/.test(el.value[pos])) seen++;
      pos++;
    }
    try { el.setSelectionRange(pos, pos); } catch(e) {}
  };
  el.addEventListener('input', run);
  el.addEventListener('focus', ()=>{ if(el.value==='0') el.value=''; });
  el.addEventListener('blur',  ()=>{ if(el.value==='') el.value='0'; });
  if (el.value !== '') run();
}

// เปลี่ยนทุกช่องตัวเลขใน element ที่กำหนดให้มีคอมมา
const moneyAll = (root=document) =>
  [...root.querySelectorAll('input[data-money-field]')].forEach(attachMoney);

let toastT;
function toast(msg, err=false){
  const t=$('#toast'); t.textContent=msg; t.className='on'+(err?' err':'');
  clearTimeout(toastT); toastT=setTimeout(()=>t.className='',2800);
}

async function api(fn, what='ทำรายการ'){
  try { const {data,error}=await fn(); if(error) throw error; return data; }
  catch(e){ console.error(e); toast(`${what}ไม่สำเร็จ: ${e.message||e}`, true); throw e; }
}

// ---------- ใบเสร็จ ----------
const RCPT_BUCKET = 'receipts';
const MAX_RCPT = 10 * 1024 * 1024;   // 10 MB

// ย่อรูปก่อนอัปโหลด — รูปจากมือถือ 4MB เหลือ ~300KB พื้นที่ฟรี 1GB จะอยู่ได้นานขึ้นมาก
async function shrinkImage(file, maxPx = 1600, quality = 0.82){
  if (!file.type.startsWith('image/') || file.type === 'image/heic' || file.type === 'image/heif')
    return file;   // HEIC วาดลง canvas ไม่ได้ทุกเบราว์เซอร์ ส่งไฟล์เดิมไปเลย
  try{
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  }catch(e){ return file; }
}

async function uploadReceipt(file, txnId){
  const small = await shrinkImage(file);
  if (small.size > MAX_RCPT) throw new Error('ไฟล์ใหญ่เกิน 10 MB');
  const ext  = (small.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${new Date().getFullYear()}/${txnId}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(RCPT_BUCKET)
    .upload(path, small, { contentType: small.type, upsert: false });
  if (error) throw error;
  return path;
}

// ถังเป็นส่วนตัว ต้องขอลิงก์ชั่วคราว (อายุ 5 นาที) ทุกครั้งที่จะเปิดดู
async function openReceipt(path){
  const { data, error } = await sb.storage.from(RCPT_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return toast('เปิดใบเสร็จไม่ได้: ' + (error?.message || 'ไม่พบไฟล์'), true);
  window.open(data.signedUrl, '_blank', 'noopener');
}

async function removeReceipt(path){
  try{ await sb.storage.from(RCPT_BUCKET).remove([path]); }catch(e){}
}

// ---------- ล็อกอิน ----------
$('#loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const btn=$('#lgBtn'), err=$('#loginErr');
  btn.disabled=true; btn.textContent='กำลังเข้าสู่ระบบ…'; err.textContent='';
  const {error}=await sb.auth.signInWithPassword({
    email:$('#lgEmail').value.trim(), password:$('#lgPass').value });
  btn.disabled=false; btn.textContent='เข้าสู่ระบบ';
  if(error){ err.textContent = /Invalid login/i.test(error.message)
      ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : error.message; return; }
  start();
});

// ---------- โหมดสว่าง/มืด ----------
const SUN='<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
const MOON='<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
function curTheme(){
  try{ const t=localStorage.getItem('poplk-acc-theme'); if(t) return t; }catch(e){}
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function paintThemeIcon(){
  const i=$('#themeIcon'); if(i) i.innerHTML = curTheme()==='dark' ? SUN : MOON;
}
$('#themeBtn')?.addEventListener('click',()=>{
  const next = curTheme()==='dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try{ localStorage.setItem('poplk-acc-theme', next); }catch(e){}
  paintThemeIcon();
  toast(next==='dark' ? 'โหมดมืด' : 'โหมดสว่าง');
});
paintThemeIcon();

$('#logout').addEventListener('click', async ()=>{
  await sb.auth.signOut(); location.reload();
});

// ---------- เริ่มโปรแกรม ----------
async function start(){
  $('#login').classList.add('hide');
  $('#app').classList.remove('hide');
  await loadAll();
  paintMe();
  buildPeriods();
  render();
  checkJev();
}

function paintMe(){
  const f = $('.nav-foot'); if(!f || !S.me) return;
  f.insertAdjacentHTML('afterbegin', `
    <div style="padding:4px 9px 10px;font-size:11.5px;line-height:1.5">
      <div style="color:var(--sb-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
           title="${esc(S.me.email||'')}">${esc(S.me.email||'')}</div>
      <span style="display:inline-block;margin-top:4px;padding:1.5px 8px;border-radius:20px;
        font-size:10.5px;font-weight:600;
        background:${isOwner()?'rgba(198,145,70,.2)':'rgba(255,255,255,.08)'};
        color:${isOwner()?'var(--gold)':'var(--sb-ink-2)'}">
        ${isOwner()?'เจ้าของกิจการ':'ฝ่ายบัญชี'}</span>
    </div>`);
}

async function checkJev(){
  try{
    const r = await fetch(`${OLLAMA}/api/tags`, {signal:AbortSignal.timeout(1500)});
    S.jevReady = r.ok;
  }catch{ S.jevReady = false; }
}

async function loadAll(){
  // ใครกำลังใช้งาน และมีสิทธิ์ระดับไหน
  const { data:{ user } } = await sb.auth.getUser();
  const { data:mem } = await sb.from('acc_members')
    .select('email,full_name,role').eq('user_id', user?.id).maybeSingle();
  S.me = mem ? { ...mem, id:user.id } : null;
  if(!S.me){ noAccess(user?.email); throw new Error('ไม่มีสิทธิ์'); }

  const [st,ac,ca,ve,tx,wh,as] = await Promise.all([
    sb.from('acc_settings').select('*').eq('id',1).single(),
    sb.from('acc_accounts').select('*').order('sort_order'),
    sb.from('acc_categories').select('*').order('sort_order'),
    sb.from('acc_vendors').select('*').order('name'),
    sb.from('acc_transactions').select('*').order('txn_date',{ascending:false}).limit(3000),
    sb.from('acc_wht').select('*').order('pay_date',{ascending:false}),
    sb.from('acc_assets').select('*').order('acquired_date',{ascending:false}),
  ]);
  S.settings=st.data||{}; S.accounts=ac.data||[]; S.categories=ca.data||[];
  S.vendors=ve.data||[]; S.txns=tx.data||[]; S.wht=wh.data||[]; S.assets=as.data||[];
}

const isOwner = () => S.me?.role === 'owner';

function noAccess(email){
  $('#app').classList.add('hide');
  $('#login').classList.remove('hide');
  $('#loginForm').innerHTML = `
    <div class="login-logo" style="background:linear-gradient(145deg,#E4483C,#FF8078)">!</div>
    <h1>ยังไม่ได้รับสิทธิ์เข้าระบบ</h1>
    <p class="sub">บัญชี <b>${esc(email||'')}</b> ล็อกอินได้ แต่ยังไม่ได้ถูกเพิ่มเข้าทะเบียนผู้ใช้
    ของระบบบัญชี — ติดต่อเจ้าของกิจการให้เพิ่มสิทธิ์ให้ก่อน</p>
    <button type="button" id="naOut">ออกจากระบบ</button>`;
  $('#naOut').onclick = async ()=>{ await sb.auth.signOut(); location.reload(); };
}

// ---------- ช่วงเวลา ----------
function buildPeriods(){
  const sel=$('#periodSel'); const now=new Date();
  const years=new Set([now.getFullYear()]);
  S.txns.forEach(t=>years.add(+t.txn_date.slice(0,4)));
  const ys=[...years].sort((a,b)=>b-a);
  let html='';
  ys.forEach(y=>{
    html+=`<option value="${y}">ทั้งปี ${y+543}</option>`;
    for(let m=12;m>=1;m--){
      const k=`${y}-${String(m).padStart(2,'0')}`;
      if(y===now.getFullYear() && m>now.getMonth()+1) continue;
      html+=`<option value="${k}">${TH_M[m-1]} ${y+543}</option>`;
    }
  });
  sel.innerHTML=html;
  S.period = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  sel.value = S.period;
  sel.onchange = ()=>{ S.period=sel.value; render(); };
}

const inPeriod = d => S.period.length===4 ? String(d).startsWith(S.period)
                                          : ym(d)===S.period;
const periodTxns = () => S.txns.filter(t=>inPeriod(t.txn_date));
// ช่วงเวลาก่อนหน้า ใช้เทียบว่าดีขึ้นหรือแย่ลง
function prevPeriod(){
  if(S.period.length===4) return String(+S.period-1);
  const y=+S.period.slice(0,4), m=+S.period.slice(5,7);
  const d=new Date(y, m-2, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
const txnsOf = key => S.txns.filter(t =>
  key.length===4 ? t.txn_date.startsWith(key) : ym(t.txn_date)===key);

// คืนแท็กเปอร์เซ็นต์เทียบช่วงก่อน — goodUp=true คือเพิ่มขึ้นแล้วดี
function trendTag(now, before, goodUp=true){
  if(!before) return '';
  const diff=(now-before)/Math.abs(before)*100;
  if(!isFinite(diff) || Math.abs(diff)<0.5)
    return '<span class="trend flat">เท่าเดิม</span>';
  const up=diff>0, good = goodUp ? up : !up;
  const arrow = up
    ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
  return `<span class="trend ${good?'up':'down'}">${arrow}${Math.abs(diff).toFixed(0)}%</span>`;
}

// ---------- เงินสำรองจ่ายกรรมการ ----------
const dirAcct   = () => S.accounts.find(a=>a.kind==='director');
const isTransfer= t => (catById(t.category_id)?.tax_line)==='transfer';

// เงินที่บริษัทยังค้างคืนกรรมการ (นับทุกช่วงเวลา ไม่ใช่เฉพาะเดือนที่เลือก)
function dirOwed(){
  const a=dirAcct(); if(!a) return 0;
  return S.txns.filter(t=>t.account_id===a.id)
    .reduce((s,t)=> s + (t.direction==='out' ? +t.paid_amount : -+t.paid_amount), 0);
}

const catById = id => S.categories.find(c=>c.id===id);
const acctById = id => S.accounts.find(a=>a.id===id);

// ---------- เมนู ----------
const TITLES={dash:'แดชบอร์ด',income:'รายรับ',expense:'รายจ่าย',wht:'ภาษีหัก ณ ที่จ่าย',
  calendar:'ปฏิทินภาษี',assets:'ทรัพย์สิน',reports:'รายงาน',settings:'ตั้งค่า'};

$$('.nav-item').forEach(b=>b.addEventListener('click',()=>{
  S.page=b.dataset.page;
  $$('.nav-item').forEach(x=>x.classList.toggle('on',x===b));
  $('#pageTitle').textContent=TITLES[S.page];
  $('#side').classList.remove('open'); $('#scrim')?.remove();
  render();
}));

$('#menuBtn').addEventListener('click',()=>{
  const s=$('#side'); s.classList.add('open');
  const sc=document.createElement('div'); sc.id='scrim';
  sc.onclick=()=>{s.classList.remove('open');sc.remove();};
  document.body.appendChild(sc);
});

function render(){
  const c=$('#content');
  ({dash:pgDash,income:pgIncome,expense:pgExpense,wht:pgWht,
    calendar:pgCalendar,assets:pgAssets,reports:pgReports,settings:pgSettings})[S.page](c);
  moneyAll(c);
}

// ---------- ไอคอนว่าง ----------
const EMPTY = (txt,sub='') => `<div class="empty">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 17H7A5 5 0 0 1 7 7h1M15 7h2a5 5 0 0 1 0 10h-1M8 12h8"/></svg>
  <div>${esc(txt)}</div>${sub?`<div style="font-size:12.5px;margin-top:4px">${esc(sub)}</div>`:''}</div>`;

// ===================================================================
//  แดชบอร์ด
// ===================================================================
function pgDash(el){
  const tx=periodTxns();
  const real= tx.filter(t=>!isTransfer(t));
  const inc = real.filter(t=>t.direction==='in').reduce((s,t)=>s+ +t.amount,0);
  const cost= real.filter(t=>t.direction==='out').reduce((s,t)=>s+ +t.amount + +t.vat_amount,0);
  const profit = inc-cost;
  const whtDue = S.wht.filter(w=>inPeriod(w.pay_date) && !w.filed)
                      .reduce((s,w)=>s+ +w.tax_amount,0);

  // รายได้สะสมทั้งปี เทียบเพดาน VAT
  const yr = S.period.slice(0,4);
  const yrInc = S.txns.filter(t=>t.direction==='in' && t.txn_date.startsWith(yr))
                      .reduce((s,t)=>s+ +t.amount,0);
  const cap = +(S.settings.vat_threshold||1800000);
  const pct = Math.min(100, yrInc/cap*100);
  const gColor = pct>=100?'var(--red)':pct>=80?'var(--amber)':'var(--green)';

  // เงินคงเหลือในบัญชี
  // เงินสดจริงในมือ — ไม่นับบัญชีเงินสำรองจ่ายกรรมการ เพราะนั่นเป็นหนี้ ไม่ใช่เงินสด
  const cashIds = S.accounts.filter(a=>a.kind!=='director').map(a=>a.id);
  const cash = S.accounts.filter(a=>a.kind!=='director')
      .reduce((s,a)=>s+ +a.opening_balance,0)
    + S.txns.filter(t=>cashIds.includes(t.account_id))
      .reduce((s,t)=>s + (t.direction==='in' ? +t.paid_amount : -+t.paid_amount),0);

  let vatAlert='';
  if(!S.settings.vat_registered && pct>=80){
    vatAlert = `<div class="alert ${pct>=100?'dang':'warn'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
      <div><b>${pct>=100?'รายได้เกินเพดาน VAT แล้ว':'รายได้ใกล้ถึงเพดาน VAT'}</b>
      ปี ${+yr+543} ทำได้ ${B0(yrInc)} บาท จากเพดาน ${B0(cap)} บาท
      ${pct>=100 ? '— ต้องยื่นจดทะเบียน VAT ภายใน 30 วันนับจากวันที่รายได้เกิน ไม่งั้นมีเบี้ยปรับ'
                 : '— เตรียมเอกสารจด VAT ไว้ได้แล้ว พอเกินต้องจดภายใน 30 วัน'}</div></div>`;
  }

  // เทียบกับช่วงก่อนหน้า
  const pv   = txnsOf(prevPeriod());
  const pvr  = pv.filter(t=>!isTransfer(t));
  const pInc = pvr.filter(t=>t.direction==='in').reduce((s,t)=>s+ +t.amount,0);
  const pCost= pvr.filter(t=>t.direction==='out').reduce((s,t)=>s+ +t.amount + +t.vat_amount,0);
  const pvLabel = S.period.length===4 ? 'ปีก่อน' : 'เดือนก่อน';

  el.innerHTML = vatAlert + `
  <div class="kpis">
    <div class="kpi in"><div class="lbl"><span class="dot" style="background:var(--green)"></span>รายรับ</div>
      <div class="val">${B(inc)}</div>
      <div class="sub">${trendTag(inc, pInc, true)} เทียบ${pvLabel}</div></div>
    <div class="kpi out"><div class="lbl"><span class="dot" style="background:var(--red)"></span>รายจ่าย (รวม VAT ที่จ่าย)</div>
      <div class="val">${B(cost)}</div>
      <div class="sub">${trendTag(cost, pCost, false)} เทียบ${pvLabel}</div></div>
    <div class="kpi"><div class="lbl">กำไรขั้นต้น</div>
      <div class="val" style="color:${profit>=0?'var(--green)':'var(--red)'}">${B(profit)}</div>
      <div class="sub">${inc?((profit/inc*100).toFixed(1)+'% ของรายรับ'):'ยังไม่มีรายรับ'}</div></div>
    <div class="kpi"><div class="lbl">เงินสดคงเหลือจริง</div>
      <div class="val">${B(cash)}</div>
      <div class="sub">${cashIds.length} บัญชี${dirOwed()>0?` · ค้างคืนกรรมการ ${B0(dirOwed())}`:''}</div></div>
  </div>

  <div class="grid2" style="margin-bottom:20px">
    <div class="card"><div class="card-h"><h2>รายได้สะสมปี ${+yr+543}</h2>
      <span class="hint">${S.settings.vat_registered?'จด VAT แล้ว':'ยังไม่จด VAT'}</span></div>
      <div class="card-b">
        <div style="display:flex;align-items:baseline;gap:8px">
          <span class="num" style="font-size:26px;font-weight:600">${B0(yrInc)}</span>
          <span style="color:var(--ink-3);font-size:13px">/ ${B0(cap)} บาท</span></div>
        <div class="gauge"><span style="width:${pct}%;background:${gColor}"></span></div>
        <div class="gauge-legend"><span>${pct.toFixed(1)}% ของเพดาน</span>
          <span>เหลืออีก ${B0(Math.max(0,cap-yrInc))} บาท</span></div>
      </div></div>

    <div class="card"><div class="card-h"><h2>ภาษีที่ต้องยื่นเดือนถัดไป</h2></div>
      <div class="card-b" style="padding-top:8px">${dueList(3)}</div></div>
  </div>

  ${(()=>{ const owed=dirOwed(); if(Math.abs(owed)<0.005) return '';
    return `<div class="card" style="margin-bottom:20px"><div class="card-h">
      <h2>เจ้าหนี้กรรมการ</h2>
      <span class="hint">เงินที่กรรมการสำรองจ่ายไปก่อน บริษัทต้องคืน</span>
      <button class="btn btn-p" id="dirRepay">คืนเงินกรรมการ</button></div>
      <div class="card-b" style="display:flex;align-items:center;gap:22px;flex-wrap:wrap">
        <div><div style="font-size:12.5px;color:var(--ink-2)">ยอดค้างคืน</div>
          <div class="num" style="font-size:27px;font-weight:600;color:var(--amber);letter-spacing:-.035em">${B(owed)}</div></div>
        <div style="flex:1;min-width:230px;font-size:12.5px;color:var(--ink-2);line-height:1.6">
          ยอดนี้เป็น<b>หนี้ในงบดุล ไม่ใช่ค่าใช้จ่าย</b> — ค่าใช้จ่ายถูกบันทึกไปแล้วตอนกรรมการจ่าย
          ตอนคืนเงินกดปุ่มด้านบน ระบบจะล้างหนี้ให้ <b>ไม่ลงรายจ่ายซ้ำ</b>
        </div></div></div>`; })()}

  <div class="card"><div class="card-h"><h2>รายรับ–รายจ่าย 12 เดือนล่าสุด</h2></div>
    <div class="card-b">${chart12()}</div></div>

  <div class="card" style="margin-top:20px"><div class="card-h"><h2>รายการล่าสุด</h2>
    <span class="hint">${whtDue>0?`ยังไม่ยื่น ภ.ง.ด. ${B(whtDue)} บาท`:''}</span></div>
    ${txnTable(real.slice(0,10), false)}</div>`;

  $('#dirRepay')?.addEventListener('click', repayModal);
  $$('[data-rcpt]',el).forEach(b=>b.onclick=()=>openReceipt(b.dataset.rcpt));
}

function chart12(){
  const now=new Date(); const months=[];
  for(let i=11;i>=0;i--){ const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`); }
  const data=months.map(k=>{
    const t=S.txns.filter(x=>ym(x.txn_date)===k);
    return {k, in:t.filter(x=>x.direction==='in').reduce((s,x)=>s+ +x.amount,0),
               out:t.filter(x=>x.direction==='out').reduce((s,x)=>s+ +x.amount + +x.vat_amount,0)};
  });
  const max=Math.max(1,...data.map(d=>Math.max(d.in,d.out)));
  const thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  return `<div class="chart">${data.map(d=>{
    const m=+d.k.slice(5,7);
    return `<div class="bar-col${d.k===thisMonth?' now':''}"><div class="bar-stack">
      <div class="bar in"  style="height:${d.in/max*100}%"  title="รายรับ ${B(d.in)}"></div>
      <div class="bar out" style="height:${d.out/max*100}%" title="รายจ่าย ${B(d.out)}"></div>
    </div><div class="bar-lbl">${TH_M[m-1]}</div></div>`;}).join('')}</div>
  <div class="legend"><span><i style="background:var(--green)"></i>รายรับ</span>
    <span><i style="background:var(--red)"></i>รายจ่าย</span></div>`;
}

// ===================================================================
//  ตารางรายการ
// ===================================================================
function txnTable(rows, editable=true){
  if(!rows.length) return EMPTY('ยังไม่มีรายการในช่วงนี้','กดปุ่มด้านบนเพื่อเพิ่มรายการแรก');
  return `<div class="tw"><table><thead><tr>
    <th>วันที่</th><th>รายละเอียด</th><th>หมวด</th>
    <th class="r">ยอดตามบิล</th><th class="r">VAT</th><th class="r">หัก ณ ที่จ่าย</th>
    <th class="r">เงินเข้า/ออกจริง</th>${editable?'<th></th>':''}</tr></thead><tbody>
    ${rows.map(t=>{const c=catById(t.category_id);return `<tr>
      <td style="white-space:nowrap">${dTH(t.txn_date)}</td>
      <td><div>${esc(t.description)}</div>
        ${t.doc_no?`<div style="font-size:11.5px;color:var(--ink-3)">เลขที่ ${esc(t.doc_no)}</div>`:''}
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:3px">
        ${t.source==='order'?'<span class="tag b">จากออเดอร์</span>':''}
        ${t.receipt_url
          ? `<button class="tag g" style="cursor:pointer;border:none" data-rcpt="${esc(t.receipt_url)}"
               title="เปิดดูใบเสร็จ">📎 ใบเสร็จ</button>`
          : (t.direction==='out' && t.source!=='order'
              ? '<span class="tag a" title="ยังไม่ได้แนบหลักฐาน">ไม่มีใบเสร็จ</span>' : '')}
        </div></td>
      <td><span class="tag n">${esc(c?.name||'—')}</span></td>
      <td class="n">${B(t.amount)}</td>
      <td class="n" style="color:${+t.vat_amount?'var(--ink-2)':'var(--ink-3)'}">${+t.vat_amount?B(t.vat_amount):'—'}</td>
      <td class="n" style="color:${+t.wht_amount?'var(--amber)':'var(--ink-3)'}">${+t.wht_amount?B(t.wht_amount):'—'}</td>
      <td class="n" style="font-weight:600;color:${t.direction==='in'?'var(--green)':'var(--red)'}">
        ${t.direction==='in'?'+':'−'}${B(t.paid_amount)}</td>
      ${editable?`<td class="r" style="white-space:nowrap">
        <button class="btn btn-sm" data-edit="${t.id}">แก้</button>
        ${isOwner()?`<button class="btn btn-sm btn-d" data-del="${t.id}">ลบ</button>`:''}</td>`:''}
    </tr>`;}).join('')}</tbody></table></div>`;
}

function wireTxnTable(el, dir){
  $$('[data-rcpt]',el).forEach(b=>b.onclick=()=>openReceipt(b.dataset.rcpt));
  $$('[data-edit]',el).forEach(b=>b.onclick=()=>
    txnModal(dir, S.txns.find(t=>t.id==b.dataset.edit)));
  $$('[data-del]',el).forEach(b=>b.onclick=async()=>{
    const t=S.txns.find(x=>x.id==b.dataset.del);
    if(!confirm(`ลบรายการ "${t.description}" ?\nถ้ามีหนังสือรับรองหัก ณ ที่จ่ายผูกอยู่ จะถูกลบด้วย`)) return;
    await api(()=>sb.from('acc_transactions').delete().eq('id',t.id),'ลบรายการ');
    await loadAll(); render(); toast('ลบรายการแล้ว');
  });
}

// ===================================================================
//  รายรับ / รายจ่าย
// ===================================================================
function pgIncome(el){
  const rows=periodTxns().filter(t=>t.direction==='in' && !isTransfer(t));
  const sum=rows.reduce((s,t)=>s+ +t.amount,0);
  el.innerHTML=`
  <div class="card"><div class="card-h">
    <h2>รายรับ</h2><span class="hint">รวม ${B(sum)} บาท</span>
    <button class="btn" id="sync">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
      ดึงจากออเดอร์</button>
    <button class="btn btn-p" id="add">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>
      เพิ่มรายรับ</button></div>
    ${txnTable(rows)}</div>`;
  $('#add').onclick=()=>txnModal('in');
  $('#sync').onclick=async()=>{
    const d=await api(()=>sb.rpc('acc_sync_orders'),'ดึงออเดอร์');
    await loadAll(); render();
    toast(d?.added ? `ดึงเข้ามา ${d.added} ออเดอร์` : 'ไม่มีออเดอร์ใหม่ที่เก็บเงินแล้ว');
  };
  wireTxnTable(el,'in');
}

function pgExpense(el){
  const rows=periodTxns().filter(t=>t.direction==='out' && !isTransfer(t));
  const sum=rows.reduce((s,t)=>s+ +t.amount + +t.vat_amount,0);
  const vat=rows.reduce((s,t)=>s+ +t.vat_amount,0);
  const noRcpt = rows.filter(t=>!t.receipt_url && t.source!=='order');
  el.innerHTML=`
  ${noRcpt.length?`<div class="alert warn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
    <div><b>ยังไม่ได้แนบใบเสร็จ ${noRcpt.length} รายการ</b>
    สรรพากรขอดูหลักฐานตอนตรวจ ถ้าไม่มีใบเสร็จอาจถูกตัดออกจากรายจ่าย ทำให้ต้องจ่ายภาษีเพิ่ม
    — กด "แก้" ที่รายการนั้นแล้วแนบไฟล์ได้เลย</div></div>`:''}
  ${vat>0?`<div class="alert info">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    <div><b>VAT ที่จ่ายไปในช่วงนี้ ${B(vat)} บาท</b>
    บริษัทยังไม่จด VAT จึงขอคืนไม่ได้ — ระบบรวมเป็นต้นทุนให้แล้ว ถ้าจด VAT เมื่อไหร่ ยอดนี้จะขอคืนได้</div></div>`:''}
  <div class="card"><div class="card-h">
    <h2>รายจ่าย</h2><span class="hint">รวม ${B(sum)} บาท</span>
    <button class="btn btn-p" id="add">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>
      เพิ่มรายจ่าย</button></div>
    ${txnTable(rows)}</div>`;
  $('#add').onclick=()=>txnModal('out');
  wireTxnTable(el,'out');
}

// ---------- Modal รายการ ----------
function modal(title, body, footer){
  const host=$('#modalHost');
  host.innerHTML=`<div class="mask"><div class="modal">
    <div class="modal-h"><h3>${esc(title)}</h3>
      <button class="x" aria-label="ปิด"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="modal-b">${body}</div>
    <div class="modal-f">${footer}</div></div></div>`;
  moneyAll(host);
  const close=()=>host.innerHTML='';
  $('.x',host).onclick=close;
  $('.mask',host).onclick=e=>{ if(e.target===$('.mask',host)) close(); };
  return {close, el:host};
}

function txnModal(dir, t=null){
  const cats=S.categories.filter(c=>c.direction===dir);
  const isOut = dir==='out';
  const m = modal(
    (t?'แก้ไข':'เพิ่ม') + (isOut?'รายจ่าย':'รายรับ'),
    `<div class="grid2">
      <div class="f"><label>วันที่ <span class="req">*</span></label>
        <input type="date" id="fDate" value="${t?.txn_date||today()}"></div>
      <div class="f"><label>บัญชีเงิน</label><select id="fAcct">
        ${S.accounts.map(a=>`<option value="${a.id}" ${t?.account_id===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}
      </select></div></div>

    <div class="f"><label>รายละเอียด <span class="req">*</span></label>
      <input id="fDesc" value="${esc(t?.description||'')}" placeholder="${isOut?'เช่น ค่ายิงแอดเฟซบุ๊ก เดือนกันยายน':'เช่น ขายผ่านไลฟ์'}">
      ${isOut?'<div class="help" id="fHint">พิมพ์แล้วระบบจะเดาหมวดและอัตราหัก ณ ที่จ่ายให้</div>':''}</div>

    <div class="grid2">
      <div class="f"><label>หมวด <span class="req">*</span></label><select id="fCat">
        ${cats.map(c=>`<option value="${c.id}" data-wht="${c.wht_rate??''}" ${t?.category_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
      </select></div>
      <div class="f"><label>ยอดตามบิล (ก่อน VAT) <span class="req">*</span></label>
        <input data-money-field id="fAmt" value="${t?.amount??''}" placeholder="0.00"></div></div>

    ${isOut?`
    <div class="grid2">
      <div class="f"><label>VAT 7% ที่จ่ายไป</label>
        <div class="f-row"><input data-money-field id="fVat" value="${t?.vat_amount??0}">
          <button class="btn btn-sm" id="fVatCalc" type="button">คิด 7%</button></div>
        <div class="help">ขอคืนไม่ได้ ถือเป็นต้นทุน</div></div>
      <div class="f"><label>หักภาษี ณ ที่จ่าย</label>
        <div class="f-row">
          <select id="fWhtRate" style="flex:1">
            <option value="">ไม่หัก</option>
            <option value="1">1% ค่าขนส่ง</option>
            <option value="2">2% ค่าโฆษณา</option>
            <option value="3">3% ค่าบริการ/รับจ้างทำของ</option>
            <option value="5">5% ค่าเช่า</option>
          </select>
          <input data-money-field id="fWht" style="width:120px" value="${t?.wht_amount??0}"></div>
        <div class="help" id="whtHelp">เงินส่วนนี้ไม่จ่ายให้ผู้ขาย ต้องนำส่งสรรพากร</div></div></div>

    <div class="f"><label>ผู้รับเงิน</label>
      <div class="f-row">
        <select id="fVendor" style="flex:1"><option value="">— ไม่ระบุ —</option>
          ${S.vendors.map(v=>`<option value="${v.id}" ${t?.vendor_id===v.id?'selected':''}>${esc(v.name)} (${v.entity_type==='person'?'บุคคล':'นิติบุคคล'})</option>`).join('')}
        </select>
        <button class="btn btn-sm" id="fNewVendor" type="button">+ เพิ่ม</button></div>
      <div class="help">ต้องระบุถ้ามีหัก ณ ที่จ่าย — ใช้ออกหนังสือรับรอง 50 ทวิ</div></div>`:''}

    <div class="grid2">
      <div class="f"><label>เลขที่เอกสาร</label>
        <input id="fDoc" value="${esc(t?.doc_no||'')}" placeholder="เลขที่ใบเสร็จ/ใบกำกับ"></div>
      <div class="f"><label>${isOut?'เงินที่จ่ายจริง':'เงินที่รับจริง'}</label>
        <input id="fPaid" readonly class="num" value="${B(t?.paid_amount||0)}"></div></div>
    <div class="f"><label>ใบเสร็จ / หลักฐานการจ่าย</label>
      <div id="fRcptBox"></div>
      <input type="file" id="fRcptFile" accept="image/*,application/pdf" style="display:none">
      <div class="help">ถ่ายรูปใบเสร็จหรือแนบ PDF ก็ได้ — รูปจะถูกย่อให้อัตโนมัติ
        ${isOut?'· สรรพากรขอดูหลักฐานตอนตรวจ ควรแนบทุกรายการ':''}</div></div>
    <div class="f"><label>หมายเหตุ</label><input id="fNote" value="${esc(t?.note||'')}"></div>`,
    `<button class="btn" id="mCancel">ยกเลิก</button>
     <button class="btn btn-p" id="mSave">${t?'บันทึกการแก้ไข':'บันทึก'}</button>`);

  const g=id=>$('#'+id), num=id=>numOf(g(id));
  const recalc=()=>{
    const a=num('fAmt'), v=isOut?num('fVat'):0, w=isOut?num('fWht'):0;
    g('fPaid').value=B(a+v-w);
  };
  ['fAmt'].forEach(i=>g(i).oninput=recalc);

  if(isOut){
    ['fVat','fWht'].forEach(i=>g(i).oninput=recalc);
    // เติมค่าให้ช่องพร้อมจัดคอมมา (ตั้ง .value ตรง ๆ ตัวจัดรูปแบบจะไม่ทำงาน)
    const setMoney=(id,v)=>{ g(id).value = fmtMoneyStr((+v||0).toFixed(2)); };
    g('fVatCalc').onclick=()=>{ setMoney('fVat', num('fAmt')*VAT_RATE); recalc(); };
    const applyRate=()=>{ const r=+g('fWhtRate').value||0;
      setMoney('fWht', r ? num('fAmt')*r/100 : 0); recalc(); };
    g('fWhtRate').onchange=applyRate;
    g('fAmt').addEventListener('input',()=>{ if(+g('fWhtRate').value) applyRate(); });
    g('fCat').onchange=()=>{ const r=g('fCat').selectedOptions[0]?.dataset.wht;
      if(r){ g('fWhtRate').value=String(+r); applyRate(); } };
    if(t?.wht_amount>0 && t?.amount>0)
      g('fWhtRate').value=String(Math.round(+t.wht_amount/+t.amount*100));
    g('fNewVendor').onclick=()=>vendorModal(()=>{ m.close(); txnModal(dir,t); });

    // ---- Jev: เดาหมวดจากรายละเอียด ----
    let timer;
    g('fDesc').addEventListener('input',()=>{
      clearTimeout(timer);
      const txt=g('fDesc').value.trim();
      if(txt.length<4) return;
      timer=setTimeout(async()=>{
        const names=cats.map(c=>c.name);
        const r=await categorize(txt,names, S.jevReady?{decide,ollama:OLLAMA,model:MODEL}:null);
        const hit=cats.find(c=>c.name===r.category);
        if(!hit||r.by==='fallback') return;
        g('fCat').value=hit.id;
        if(hit.wht_rate){ g('fWhtRate').value=String(+hit.wht_rate); applyRate(); }
        $('#fHint').innerHTML=`<span style="color:var(--gold-2)">เดาให้ว่า “${esc(hit.name)}”`
          + (hit.wht_rate?` หัก ${+hit.wht_rate}%`:'')
          + `</span> — ${r.by==='keyword'?'จากคำสำคัญ':'จาก Jev '+r.ms+'ms'} · แก้ได้ถ้าไม่ตรง`;
      },350);
    });
  }
  recalc();

  // ---- ใบเสร็จ ----
  let rcptPath = t?.receipt_url || '';   // ไฟล์ที่เก็บไว้แล้ว
  let rcptNew  = null;                   // ไฟล์ใหม่ที่เพิ่งเลือก (ยังไม่อัป)
  let rcptDrop = false;                  // สั่งลบไฟล์เดิม
  const paintRcpt = ()=>{
    const box = $('#fRcptBox');
    if(rcptNew){
      box.innerHTML = `<div class="f-row" style="align-items:center">
        <span class="tag b" style="max-width:100%;overflow:hidden;text-overflow:ellipsis">
          ${esc(rcptNew.name)} · ${(rcptNew.size/1024).toFixed(0)} KB</span>
        <button class="btn btn-sm btn-d" type="button" id="rcptClear">เอาออก</button></div>`;
      $('#rcptClear').onclick = ()=>{ rcptNew=null; $('#fRcptFile').value=''; paintRcpt(); };
    } else if(rcptPath && !rcptDrop){
      box.innerHTML = `<div class="f-row" style="align-items:center">
        <span class="tag g">แนบไว้แล้ว</span>
        <button class="btn btn-sm" type="button" id="rcptView">เปิดดู</button>
        <button class="btn btn-sm" type="button" id="rcptSwap">เปลี่ยนไฟล์</button>
        ${isOwner()?'<button class="btn btn-sm btn-d" type="button" id="rcptDel">ลบ</button>':''}</div>`;
      $('#rcptView').onclick = ()=>openReceipt(rcptPath);
      $('#rcptSwap').onclick = ()=>$('#fRcptFile').click();
      const d=$('#rcptDel'); if(d) d.onclick = ()=>{ rcptDrop=true; paintRcpt(); };
    } else {
      box.innerHTML = `<button class="btn" type="button" id="rcptPick">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        แนบใบเสร็จ</button>`;
      $('#rcptPick').onclick = ()=>$('#fRcptFile').click();
    }
  };
  $('#fRcptFile').onchange = e=>{
    const f = e.target.files?.[0]; if(!f) return;
    if(f.size > MAX_RCPT) return toast('ไฟล์ใหญ่เกิน 10 MB', true);
    rcptNew = f; rcptDrop = false; paintRcpt();
  };
  paintRcpt();

  $('#mCancel').onclick=m.close;
  $('#mSave').onclick=async()=>{
    const desc=g('fDesc').value.trim(), amt=num('fAmt');
    if(!desc) return toast('กรอกรายละเอียดก่อน',true);
    if(amt<=0) return toast('กรอกยอดเงินก่อน',true);
    const vat=isOut?num('fVat'):0, wht=isOut?num('fWht'):0;
    if(isOut && wht>0 && !g('fVendor').value)
      return toast('มีหัก ณ ที่จ่าย ต้องระบุผู้รับเงินเพื่อออกหนังสือรับรอง',true);

    const row={ txn_date:g('fDate').value, direction:dir,
      category_id:+g('fCat').value, account_id:+g('fAcct').value,
      vendor_id: isOut && g('fVendor').value ? +g('fVendor').value : null,
      description:desc, amount:amt, vat_amount:vat, wht_amount:wht,
      paid_amount:amt+vat-wht, doc_no:g('fDoc').value.trim(), note:g('fNote').value.trim() };

    let txnId=t?.id;
    if(t) await api(()=>sb.from('acc_transactions').update(row).eq('id',t.id),'บันทึก');
    else { const d=await api(()=>sb.from('acc_transactions').insert(row).select().single(),'บันทึก');
           txnId=d.id; }

    // สร้าง/อัปเดตหนังสือรับรองหัก ณ ที่จ่าย
    if(isOut){
      await sb.from('acc_wht').delete().eq('txn_id',txnId);
      if(wht>0){
        const v=S.vendors.find(x=>x.id==g('fVendor').value);
        const cat=catById(+g('fCat').value);
        await api(()=>sb.from('acc_wht').insert({
          txn_id:txnId, pay_date:row.txn_date,
          vendor_name:v?.name||'', vendor_tax_id:v?.tax_id||'', vendor_address:v?.address||'',
          entity_type:v?.entity_type||'company',
          form_type: v?.entity_type==='person' ? 'PND3' : 'PND53',
          income_type: cat?.name||'ค่าบริการ',
          base_amount:amt, rate:+g('fWhtRate').value||(amt?wht/amt*100:0), tax_amount:wht,
        }),'บันทึกหนังสือรับรอง');
      }
    }
    // ---- จัดการไฟล์ใบเสร็จ หลังได้ id ของรายการแล้ว ----
    try{
      let finalPath = rcptDrop ? '' : rcptPath;
      if(rcptNew){
        $('#mSave').textContent = 'กำลังอัปโหลดใบเสร็จ…';
        const up = await uploadReceipt(rcptNew, txnId);
        if(rcptPath) await removeReceipt(rcptPath);   // เปลี่ยนไฟล์ = ลบของเก่าทิ้ง
        finalPath = up;
      } else if(rcptDrop && rcptPath){
        await removeReceipt(rcptPath);
      }
      if(finalPath !== (t?.receipt_url || ''))
        await sb.from('acc_transactions').update({ receipt_url: finalPath }).eq('id', txnId);
    }catch(e){
      console.error(e);
      toast('บันทึกรายการแล้ว แต่แนบใบเสร็จไม่สำเร็จ: ' + (e.message||e), true);
    }

    m.close(); await loadAll(); render();
    toast(t?'บันทึกการแก้ไขแล้ว':'บันทึกรายการแล้ว');
  };
}

// ---------- คืนเงินกรรมการ ----------
// สร้าง 2 รายการคู่กัน: เงินออกจากบัญชีบริษัท + ล้างหนี้ฝั่งกรรมการ
// ทั้งคู่เป็นหมวด transfer จึงไม่โผล่ในงบกำไรขาดทุนและไม่นับเป็นรายจ่าย
function repayModal(){
  const owed = dirOwed();
  const dir  = dirAcct();
  const from = S.accounts.filter(a=>a.kind!=='director');
  const cOut = S.categories.find(c=>c.tax_line==='transfer' && c.direction==='out');
  const cIn  = S.categories.find(c=>c.tax_line==='transfer' && c.direction==='in');
  if(!dir || !cOut || !cIn) return toast('ยังไม่ได้ตั้งค่าบัญชีเงินสำรองจ่ายกรรมการ', true);

  const m = modal('คืนเงินกรรมการ',
    `<div class="alert info" style="margin:0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      <div><b>นี่คือการล้างหนี้ ไม่ใช่รายจ่าย</b>
      ค่าใช้จ่ายถูกบันทึกไปแล้วตอนกรรมการจ่าย รายการนี้จะไม่เข้างบกำไรขาดทุน
      และ<b>ไม่ต้องหักภาษี ณ ที่จ่าย</b> เพราะเป็นการคืนหนี้ ไม่ใช่เงินได้ของกรรมการ</div></div>

    <div class="grid2">
      <div class="f"><label>วันที่คืน</label><input type="date" id="rDate" value="${today()}"></div>
      <div class="f"><label>จ่ายจากบัญชี</label><select id="rFrom">
        ${from.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}
      </select></div></div>

    <div class="f"><label>จำนวนเงินที่คืน <span class="req">*</span></label>
      <div class="f-row">
        <input data-money-field id="rAmt" value="${owed.toFixed(2)}">
        <button class="btn btn-sm" type="button" id="rAll">คืนทั้งหมด</button></div>
      <div class="help">ยอดค้างคืนทั้งหมด ${B(owed)} บาท · คืนบางส่วนได้</div></div>

    <div class="f"><label>หมายเหตุ / เลขที่สลิป</label>
      <input id="rNote" placeholder="เช่น โอนคืนตามมติที่ประชุม 1/2569">
      <div class="help">แนะนำให้โอนเข้าบัญชีกรรมการ อย่าคืนเป็นเงินสด จะได้มีหลักฐาน</div></div>`,
    `<button class="btn" id="rCancel">ยกเลิก</button>
     <button class="btn btn-p" id="rSave">บันทึกการคืนเงิน</button>`);

  $('#rAll').onclick = ()=>{ $('#rAmt').value = fmtMoneyStr(owed.toFixed(2)); };
  $('#rCancel').onclick = m.close;
  $('#rSave').onclick = async ()=>{
    const amt = numOf($('#rAmt'));
    if(amt <= 0)    return toast('กรอกจำนวนเงินก่อน', true);
    if(amt > owed + 0.005) return toast(`คืนได้ไม่เกินยอดค้าง ${B(owed)} บาท`, true);
    const d = $('#rDate').value, note = $('#rNote').value.trim();

    await api(()=>sb.from('acc_transactions').insert([
      { txn_date:d, direction:'out', category_id:cOut.id, account_id:+$('#rFrom').value,
        description:'คืนเงินสำรองจ่ายกรรมการ', amount:amt, paid_amount:amt, note },
      { txn_date:d, direction:'in',  category_id:cIn.id,  account_id:dir.id,
        description:'รับคืนเงินสำรองจ่าย', amount:amt, paid_amount:amt, note },
    ]), 'บันทึกการคืนเงิน');

    m.close(); await loadAll(); render();
    toast(`คืนเงินกรรมการ ${B(amt)} บาทแล้ว`);
  };
}

function vendorModal(done){
  const m=modal('เพิ่มผู้รับเงิน',
    `<div class="f"><label>ชื่อ <span class="req">*</span></label><input id="vName" placeholder="ชื่อบุคคลหรือชื่อบริษัท"></div>
     <div class="grid2">
      <div class="f"><label>ประเภท</label><select id="vType">
        <option value="company">นิติบุคคล — ยื่น ภ.ง.ด.53</option>
        <option value="person">บุคคลธรรมดา — ยื่น ภ.ง.ด.3</option></select></div>
      <div class="f"><label>เลขประจำตัวผู้เสียภาษี</label><input id="vTax" placeholder="13 หลัก"></div></div>
     <div class="f"><label>ที่อยู่</label><textarea id="vAddr" rows="2"></textarea></div>`,
    `<button class="btn" id="vCancel">ยกเลิก</button><button class="btn btn-p" id="vSave">บันทึก</button>`);
  $('#vCancel').onclick=m.close;
  $('#vSave').onclick=async()=>{
    const name=$('#vName').value.trim(); if(!name) return toast('กรอกชื่อก่อน',true);
    await api(()=>sb.from('acc_vendors').insert({name, entity_type:$('#vType').value,
      tax_id:$('#vTax').value.trim(), address:$('#vAddr').value.trim()}),'บันทึกผู้รับเงิน');
    await loadAll(); m.close(); toast('เพิ่มผู้รับเงินแล้ว'); done?.();
  };
}

// ===================================================================
//  ภาษีหัก ณ ที่จ่าย
// ===================================================================
function pgWht(el){
  const rows=S.wht.filter(w=>inPeriod(w.pay_date));
  const p3=rows.filter(w=>w.form_type==='PND3'), p53=rows.filter(w=>w.form_type==='PND53');
  const sum=a=>a.reduce((s,w)=>s+ +w.tax_amount,0);
  const unfiled=rows.filter(w=>!w.filed);

  el.innerHTML=`
  ${unfiled.length?`<div class="alert warn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
    <div><b>ยังไม่ได้ยื่น ${unfiled.length} รายการ รวม ${B(sum(unfiled))} บาท</b>
    ต้องยื่นภายในวันที่ 7 ของเดือนถัดไป (ยื่นออนไลน์ได้ถึงวันที่ 15) เกินกำหนดมีค่าปรับ</div></div>`:''}

  <div class="kpis">
    <div class="kpi"><div class="lbl">ภ.ง.ด.3 — จ่ายให้บุคคลธรรมดา</div>
      <div class="val">${B(sum(p3))}</div><div class="sub">${p3.length} รายการ</div></div>
    <div class="kpi"><div class="lbl">ภ.ง.ด.53 — จ่ายให้นิติบุคคล</div>
      <div class="val">${B(sum(p53))}</div><div class="sub">${p53.length} รายการ</div></div>
    <div class="kpi"><div class="lbl">รวมที่ต้องนำส่ง</div>
      <div class="val" style="color:var(--amber)">${B(sum(rows))}</div>
      <div class="sub">${rows.length} ใบรับรอง</div></div>
  </div>

  <div class="card"><div class="card-h"><h2>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h2>
    <span class="hint">สร้างอัตโนมัติจากรายจ่ายที่มีการหัก</span>
    <button class="btn" id="csv">ส่งออก CSV</button></div>
    ${rows.length? `<div class="tw"><table><thead><tr>
      <th>วันที่จ่าย</th><th>ผู้รับเงิน</th><th>ประเภทเงินได้</th><th>แบบ</th>
      <th class="r">ยอดจ่าย</th><th class="r">อัตรา</th><th class="r">ภาษีที่หัก</th>
      <th>สถานะ</th><th></th></tr></thead><tbody>
      ${rows.map(w=>`<tr>
        <td style="white-space:nowrap">${dTH(w.pay_date)}</td>
        <td><div>${esc(w.vendor_name)}</div>
          ${w.vendor_tax_id?`<div style="font-size:11.5px;color:var(--ink-3)" class="num">${esc(w.vendor_tax_id)}</div>`:''}</td>
        <td>${esc(w.income_type)}</td>
        <td><span class="tag ${w.form_type==='PND3'?'a':'b'}">${w.form_type==='PND3'?'ภ.ง.ด.3':'ภ.ง.ด.53'}</span></td>
        <td class="n">${B(w.base_amount)}</td><td class="n">${(+w.rate).toFixed(0)}%</td>
        <td class="n" style="font-weight:600">${B(w.tax_amount)}</td>
        <td><span class="tag ${w.filed?'g':'n'}">${w.filed?'ยื่นแล้ว':'ยังไม่ยื่น'}</span></td>
        <td class="r" style="white-space:nowrap">
          <button class="btn btn-sm" data-cert="${w.id}">พิมพ์</button>
          <button class="btn btn-sm" data-file="${w.id}">${w.filed?'ยกเลิก':'ทำเครื่องหมายยื่นแล้ว'}</button></td>
      </tr>`).join('')}</tbody></table></div>`
     : EMPTY('ยังไม่มีการหักภาษี ณ ที่จ่ายในช่วงนี้','เพิ่มรายจ่ายที่มีการหัก ระบบจะสร้างใบรับรองให้เอง')}
  </div>`;

  $$('[data-cert]',el).forEach(b=>b.onclick=()=>printCert(S.wht.find(w=>w.id==b.dataset.cert)));
  $$('[data-file]',el).forEach(b=>b.onclick=async()=>{
    const w=S.wht.find(x=>x.id==b.dataset.file);
    await api(()=>sb.from('acc_wht').update({filed:!w.filed, filed_at:!w.filed?today():null})
      .eq('id',w.id),'อัปเดตสถานะ');
    await loadAll(); render();
  });
  $('#csv').onclick=()=>exportCSV(`wht-${S.period}`,
    ['วันที่จ่าย','ผู้รับเงิน','เลขผู้เสียภาษี','ประเภทเงินได้','แบบ','ยอดจ่าย','อัตรา%','ภาษีที่หัก','ยื่นแล้ว'],
    rows.map(w=>[w.pay_date,w.vendor_name,w.vendor_tax_id,w.income_type,
      w.form_type==='PND3'?'ภ.ง.ด.3':'ภ.ง.ด.53',w.base_amount,w.rate,w.tax_amount,w.filed?'ใช่':'ไม่']));
}

function printCert(w){
  const st=S.settings;
  const win=window.open('','_blank','width=800,height=900');
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8">
  <title>หนังสือรับรองการหักภาษี ณ ที่จ่าย</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600&display=swap" rel="stylesheet">
  <style>
    body{font-family:"IBM Plex Sans Thai",sans-serif;font-size:13px;padding:34px;color:#101828;line-height:1.7}
    h1{font-size:16px;text-align:center;margin-bottom:3px}
    .sub{text-align:center;color:#667085;font-size:12px;margin-bottom:22px}
    .box{border:1px solid #101828;padding:13px 15px;margin-bottom:11px;border-radius:3px}
    .box h3{font-size:12px;color:#667085;font-weight:600;margin-bottom:5px}
    table{width:100%;border-collapse:collapse;margin:14px 0}
    th,td{border:1px solid #101828;padding:7px 9px;font-size:12.5px}
    th{background:#F2F4F7;font-weight:600}
    td.n{text-align:right;font-variant-numeric:tabular-nums}
    .sign{margin-top:44px;display:flex;justify-content:flex-end}
    .sign div{text-align:center;width:240px}
    .line{border-bottom:1px dotted #101828;height:30px;margin-bottom:5px}
    @media print{body{padding:16px}}
  </style></head><body>
  <h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
  <div class="sub">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร · แบบ ${w.form_type==='PND3'?'ภ.ง.ด.3':'ภ.ง.ด.53'}</div>

  <div class="box"><h3>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</h3>
    <b>${esc(st.company_name||'')}</b><br>
    เลขประจำตัวผู้เสียภาษี ${esc(st.tax_id||'—')} · ${esc(st.branch||'สำนักงานใหญ่')}<br>
    ${esc(st.address||'')}</div>

  <div class="box"><h3>ผู้ถูกหักภาษี ณ ที่จ่าย</h3>
    <b>${esc(w.vendor_name)}</b><br>
    เลขประจำตัวผู้เสียภาษี ${esc(w.vendor_tax_id||'—')}<br>
    ${esc(w.vendor_address||'')}</div>

  <table><thead><tr><th>ประเภทเงินได้</th><th>วันที่จ่าย</th>
    <th style="width:120px">จำนวนเงินที่จ่าย</th><th style="width:70px">อัตรา</th>
    <th style="width:120px">ภาษีที่หักไว้</th></tr></thead>
  <tbody><tr><td>${esc(w.income_type)}</td><td>${dTH(w.pay_date)}</td>
    <td class="n">${B(w.base_amount)}</td><td class="n">${(+w.rate).toFixed(0)}%</td>
    <td class="n"><b>${B(w.tax_amount)}</b></td></tr>
  <tr><td colspan="4" style="text-align:right"><b>รวมภาษีที่หักและนำส่ง</b></td>
    <td class="n"><b>${B(w.tax_amount)}</b></td></tr></tbody></table>

  <div>ผู้จ่ายเงิน &nbsp;☑ หักภาษี ณ ที่จ่าย &nbsp;☐ ออกภาษีให้ตลอดไป &nbsp;☐ ออกภาษีให้ครั้งเดียว</div>

  <div class="sign"><div><div class="line"></div>
    ผู้มีหน้าที่หักภาษี ณ ที่จ่าย<br>วันที่ ${dTH(today())}</div></div>

  <script>window.onload=()=>window.print()<\/script></body></html>`);
  win.document.close();
}

// ===================================================================
//  ปฏิทินภาษี
// ===================================================================
const DUES = [
  {d:7,  name:'ภ.ง.ด.1',  desc:'ภาษีหัก ณ ที่จ่าย เงินเดือน/ค่าจ้าง ของเดือนก่อน', every:true},
  {d:7,  name:'ภ.ง.ด.3',  desc:'ภาษีหัก ณ ที่จ่าย ที่จ่ายให้บุคคลธรรมดา', every:true},
  {d:7,  name:'ภ.ง.ด.53', desc:'ภาษีหัก ณ ที่จ่าย ที่จ่ายให้นิติบุคคล', every:true},
  {d:15, name:'ประกันสังคม', desc:'เงินสมทบประกันสังคมของเดือนก่อน (ถ้ามีลูกจ้าง)', every:true},
  {d:31, m:5, name:'ภ.ง.ด.50', desc:'ภาษีเงินได้นิติบุคคลประจำปี ภายใน 150 วันนับจากวันสิ้นรอบบัญชี'},
  {d:31, m:5, name:'งบการเงิน DBD', desc:'ยื่นงบการเงินที่ผู้สอบบัญชีรับรองต่อกรมพัฒนาธุรกิจการค้า'},
  {d:31, m:8, name:'ภ.ง.ด.51', desc:'ภาษีเงินได้นิติบุคคลครึ่งปี ภายใน 2 เดือนนับจากสิ้นครึ่งรอบบัญชี'},
];

function nextDues(limit=99){
  const now=new Date(); const out=[];
  for(let k=0;k<70;k++){
    const base=new Date(now.getFullYear(), now.getMonth(), now.getDate()+k);
    for(const x of DUES){
      if(base.getDate()!==x.d) continue;
      if(!x.every && base.getMonth()+1!==x.m) continue;
      out.push({date:new Date(base), ...x});
    }
    if(out.length>=limit) break;
  }
  return out.slice(0,limit);
}

function dueList(limit=99){
  const list=nextDues(limit);
  if(!list.length) return EMPTY('ไม่มีกำหนดยื่นในช่วงนี้');
  const now=new Date(); now.setHours(0,0,0,0);
  return list.map(x=>{
    const days=Math.round((x.date-now)/86400000);
    const urgent = days<=3, soon = days<=7;
    const bg = urgent?'var(--red-tint)':soon?'var(--amber-tint)':'var(--bg-2)';
    const fg = urgent?'var(--red)':soon?'var(--amber)':'var(--ink-2)';
    const bd = urgent?'var(--red-line)':soon?'var(--amber-line)':'var(--line)';
    return `<div class="due">
      <div class="d" style="background:${bg};color:${fg};border-color:${bd}">${x.date.getDate()}<small>${TH_M[x.date.getMonth()]}</small></div>
      <div class="txt"><b>${x.name}</b><span>${esc(x.desc)}</span></div>
      <span class="tag ${urgent?'r':soon?'a':'n'}">${days===0?'วันนี้':days===1?'พรุ่งนี้':'อีก '+days+' วัน'}</span>
    </div>`;}).join('');
}

function pgCalendar(el){
  el.innerHTML=`
  <div class="alert info">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    <div><b>บริษัทยังไม่จด VAT จึงไม่ต้องยื่น ภ.พ.30</b>
    แต่ยังต้องยื่น ภ.ง.ด.1/3/53 ทุกเดือนที่มีการจ่ายและหักภาษี — ยื่นออนไลน์ที่ rd.go.th ได้ถึงวันที่ 15 (กระดาษวันที่ 7)</div></div>
  <div class="card"><div class="card-h"><h2>กำหนดยื่นถัดไป</h2></div>
    <div class="card-b">${dueList(14)}</div></div>
  <div class="card" style="margin-top:20px"><div class="card-h"><h2>แบบที่บริษัทต้องยื่นทั้งหมด</h2></div>
    <div class="tw"><table><thead><tr><th>แบบ</th><th>ยื่นเมื่อไหร่</th><th>คืออะไร</th></tr></thead><tbody>
      ${DUES.map(x=>`<tr><td><b>${x.name}</b></td>
        <td style="white-space:nowrap">${x.every?`ทุกเดือน วันที่ ${x.d}`:`ปีละครั้ง ${x.d} ${TH_M[x.m-1]}`}</td>
        <td>${esc(x.desc)}</td></tr>`).join('')}
      <tr style="opacity:.5"><td><b>ภ.พ.30</b></td><td style="white-space:nowrap">ทุกเดือน วันที่ 15</td>
        <td>ภาษีมูลค่าเพิ่ม — <b>ยังไม่ต้องยื่น</b> เพราะยังไม่จด VAT</td></tr>
    </tbody></table></div></div>`;
}

// ===================================================================
//  ทรัพย์สิน + ค่าเสื่อมราคา (เส้นตรง)
// ===================================================================
const depYear = a => Math.max(0,(+a.cost - +a.salvage)/Math.max(1,+a.life_years));
function depToDate(a, upto=new Date()){
  const start=new Date(a.acquired_date+'T00:00:00');
  const months=Math.max(0,(upto.getFullYear()-start.getFullYear())*12 + (upto.getMonth()-start.getMonth()));
  return Math.min(+a.cost - +a.salvage, depYear(a)/12*months);
}

function pgAssets(el){
  const rows=S.assets.filter(a=>!a.disposed_date);
  const cost=rows.reduce((s,a)=>s+ +a.cost,0);
  const acc=rows.reduce((s,a)=>s+depToDate(a),0);
  el.innerHTML=`
  <div class="kpis">
    <div class="kpi"><div class="lbl">ราคาทุนรวม</div><div class="val">${B(cost)}</div>
      <div class="sub">${rows.length} รายการ</div></div>
    <div class="kpi"><div class="lbl">ค่าเสื่อมสะสม</div><div class="val" style="color:var(--red)">${B(acc)}</div></div>
    <div class="kpi"><div class="lbl">มูลค่าตามบัญชี</div><div class="val">${B(cost-acc)}</div></div>
    <div class="kpi"><div class="lbl">ค่าเสื่อมปีนี้</div>
      <div class="val">${B(rows.reduce((s,a)=>s+depYear(a),0))}</div>
      <div class="sub">นำไปหักเป็นรายจ่ายทางภาษีได้</div></div>
  </div>
  <div class="card"><div class="card-h"><h2>ทะเบียนทรัพย์สิน</h2>
    <button class="btn btn-p" id="add">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>เพิ่มทรัพย์สิน</button></div>
    ${rows.length?`<div class="tw"><table><thead><tr>
      <th>ทรัพย์สิน</th><th>วันที่ได้มา</th><th class="r">ราคาทุน</th><th class="r">อายุใช้งาน</th>
      <th class="r">ค่าเสื่อม/ปี</th><th class="r">ค่าเสื่อมสะสม</th><th class="r">มูลค่าคงเหลือ</th><th></th>
      </tr></thead><tbody>
      ${rows.map(a=>{const d=depToDate(a);return `<tr>
        <td><b>${esc(a.name)}</b>${a.note?`<div style="font-size:11.5px;color:var(--ink-3)">${esc(a.note)}</div>`:''}</td>
        <td style="white-space:nowrap">${dTH(a.acquired_date)}</td>
        <td class="n">${B(a.cost)}</td><td class="n">${a.life_years} ปี</td>
        <td class="n">${B(depYear(a))}</td><td class="n">${B(d)}</td>
        <td class="n" style="font-weight:600">${B(+a.cost-d)}</td>
        <td class="r">${isOwner()?`<button class="btn btn-sm btn-d" data-del="${a.id}">ลบ</button>`:''}</td></tr>`;}).join('')}
      </tbody></table></div>`
     : EMPTY('ยังไม่มีทรัพย์สิน','เช่น คอมพิวเตอร์ เครื่องพิมพ์ ชั้นวางสินค้า')}
  </div>`;
  $('#add').onclick=assetModal;
  $$('[data-del]',el).forEach(b=>b.onclick=async()=>{
    if(!confirm('ลบทรัพย์สินรายการนี้?')) return;
    await api(()=>sb.from('acc_assets').delete().eq('id',b.dataset.del),'ลบ');
    await loadAll(); render(); toast('ลบแล้ว');
  });
}

function assetModal(){
  const m=modal('เพิ่มทรัพย์สิน',
    `<div class="f"><label>ชื่อทรัพย์สิน <span class="req">*</span></label>
      <input id="aName" placeholder="เช่น คอมพิวเตอร์ MacBook"></div>
     <div class="grid2">
      <div class="f"><label>วันที่ได้มา</label><input type="date" id="aDate" value="${today()}"></div>
      <div class="f"><label>ราคาทุน <span class="req">*</span></label>
        <input data-money-field id="aCost" placeholder="0.00"></div></div>
     <div class="grid2">
      <div class="f"><label>อายุการใช้งาน (ปี)</label><input type="number" id="aLife" value="5" min="1">
        <div class="help">สรรพากรกำหนด: คอมพิวเตอร์ 3 ปี · เครื่องใช้สำนักงาน 5 ปี · อาคาร 20 ปี</div></div>
      <div class="f"><label>มูลค่าซาก</label><input data-money-field id="aSalv" value="1">
        <div class="help">นิยมตั้งไว้ 1 บาท</div></div></div>
     <div class="f"><label>หมายเหตุ</label><input id="aNote"></div>`,
    `<button class="btn" id="aCancel">ยกเลิก</button><button class="btn btn-p" id="aSave">บันทึก</button>`);
  $('#aCancel').onclick=m.close;
  $('#aSave').onclick=async()=>{
    const name=$('#aName').value.trim(), cost=numOf($('#aCost'));
    if(!name) return toast('กรอกชื่อทรัพย์สินก่อน',true);
    if(cost<=0) return toast('กรอกราคาทุนก่อน',true);
    await api(()=>sb.from('acc_assets').insert({name, acquired_date:$('#aDate').value,
      cost, salvage:numOf($('#aSalv')), life_years:+$('#aLife').value||5,
      note:$('#aNote').value.trim()}),'บันทึก');
    m.close(); await loadAll(); render(); toast('เพิ่มทรัพย์สินแล้ว');
  };
}

// ===================================================================
//  รายงาน
// ===================================================================
const LINES={revenue:'รายได้จากการขาย', other_income:'รายได้อื่น', cogs:'ต้นทุนขาย',
  selling:'ค่าใช้จ่ายในการขาย', admin:'ค่าใช้จ่ายในการบริหาร', other:'ค่าใช้จ่ายอื่น'};

function pnl(){
  const tx=periodTxns(); const g={};
  for(const t of tx){
    const c=catById(t.category_id); const k=c?.tax_line||'other';
    if(k==='transfer') continue;   // คืนเงินกรรมการ = ล้างหนี้ ไม่ใช่รายรับ/รายจ่าย
    g[k]=(g[k]||0) + (t.direction==='in' ? +t.amount : +t.amount + +t.vat_amount);
  }
  const rev=(g.revenue||0)+(g.other_income||0);
  const cogs=g.cogs||0, gross=rev-cogs;
  const opex=(g.selling||0)+(g.admin||0)+(g.other||0);
  const dep=S.assets.filter(a=>!a.disposed_date).reduce((s,a)=>s+depYear(a),0)/12
            *(S.period.length===4?12:1);
  return {g, rev, cogs, gross, opex, dep, net:gross-opex-dep};
}

function pgReports(el){
  const p=pnl(); const tx=periodTxns();
  const label=S.period.length===4?`ปี ${+S.period+543}`
    :`${TH_M[+S.period.slice(5,7)-1]} ${+S.period.slice(0,4)+543}`;
  const row=(n,v,b=false,ind=0)=>`<tr${b?' style="font-weight:600;background:#FCFCFD"':''}>
    <td style="padding-left:${14+ind*20}px">${n}</td><td class="n">${B(v)}</td></tr>`;
  el.innerHTML=`
  <div class="card"><div class="card-h"><h2>งบกำไรขาดทุน — ${label}</h2>
    <button class="btn no-print" id="print">พิมพ์</button>
    <button class="btn btn-p no-print" id="csvAll">ส่งออกให้ผู้ทำบัญชี</button></div>
    <div class="tw"><table><tbody>
      ${row('รายได้จากการขาย', p.g.revenue||0,false,1)}
      ${row('รายได้อื่น', p.g.other_income||0,false,1)}
      ${row('รวมรายได้', p.rev, true)}
      ${row('ต้นทุนขาย', -(p.cogs),false,1)}
      ${row('กำไรขั้นต้น', p.gross, true)}
      ${row('ค่าใช้จ่ายในการขาย', -(p.g.selling||0),false,1)}
      ${row('ค่าใช้จ่ายในการบริหาร', -(p.g.admin||0),false,1)}
      ${row('ค่าใช้จ่ายอื่น', -(p.g.other||0),false,1)}
      ${row('ค่าเสื่อมราคา', -(p.dep),false,1)}
      ${row('กำไร (ขาดทุน) สุทธิก่อนภาษี', p.net, true)}
    </tbody></table></div>
    <div class="card-b" style="border-top:1px solid var(--line);color:var(--ink-2);font-size:12.5px">
      ตัวเลขนี้เป็นบัญชีเงินสด (บันทึกตอนเงินเข้า–ออกจริง) ใช้ดูสุขภาพธุรกิจ
      ส่วนงบที่ยื่นกรมสรรพากรและ DBD ต้องเป็นเกณฑ์คงค้างและผ่านผู้สอบบัญชี — ส่งไฟล์ CSV ให้ผู้ทำบัญชีได้เลย
    </div></div>

  <div class="card" style="margin-top:20px"><div class="card-h"><h2>แยกตามหมวด</h2></div>
    <div class="tw"><table><thead><tr><th>หมวด</th><th class="r">จำนวนรายการ</th>
      <th class="r">ยอดรวม</th><th class="r">% ของรายจ่าย</th></tr></thead><tbody>
      ${S.categories.map(c=>{
        const r=tx.filter(t=>t.category_id===c.id);
        if(!r.length) return '';
        const v=r.reduce((s,t)=>s+ +t.amount + +t.vat_amount,0);
        const pctv=c.direction==='out'&&(p.cogs+p.opex)?v/(p.cogs+p.opex)*100:null;
        return `<tr><td><span class="tag ${c.direction==='in'?'g':'n'}">${esc(c.name)}</span></td>
          <td class="n">${r.length}</td><td class="n">${B(v)}</td>
          <td class="n">${pctv!=null?pctv.toFixed(1)+'%':'—'}</td></tr>`;}).join('')}
    </tbody></table></div></div>`;
  $('#print').onclick=()=>window.print();
  $('#csvAll').onclick=()=>exportCSV(`บัญชี-${S.period}`,
    ['วันที่','ประเภท','หมวด','รายละเอียด','ผู้รับเงิน','ยอดตามบิล','VAT','หัก ณ ที่จ่าย','เงินจริง','เลขที่เอกสาร'],
    tx.map(t=>[t.txn_date, t.direction==='in'?'รายรับ':'รายจ่าย',
      catById(t.category_id)?.name||'', t.description,
      S.vendors.find(v=>v.id===t.vendor_id)?.name||'',
      t.amount, t.vat_amount, t.wht_amount, t.paid_amount, t.doc_no]));
}

function exportCSV(name, head, rows){
  const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const csv='﻿'+[head.map(q).join(','), ...rows.map(r=>r.map(q).join(','))].join('\r\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download=`${name}.csv`; a.click(); URL.revokeObjectURL(a.href);
  toast('ดาวน์โหลดไฟล์แล้ว');
}

// ===================================================================
//  ตั้งค่า
// ===================================================================
function pgSettings(el){
  const st=S.settings;
  el.innerHTML=`
  <div class="card"><div class="card-h"><h2>ข้อมูลบริษัท</h2>
    <span class="hint">ใช้พิมพ์บนหนังสือรับรองหัก ณ ที่จ่าย</span></div>
    <div class="card-b" style="display:flex;flex-direction:column;gap:14px">
      <div class="f"><label>ชื่อบริษัท</label><input id="sName" value="${esc(st.company_name||'')}"></div>
      <div class="grid2">
        <div class="f"><label>เลขประจำตัวผู้เสียภาษี</label>
          <input id="sTax" value="${esc(st.tax_id||'')}" placeholder="13 หลัก"></div>
        <div class="f"><label>สาขา</label><input id="sBranch" value="${esc(st.branch||'')}"></div></div>
      <div class="f"><label>ที่อยู่</label><textarea id="sAddr" rows="2">${esc(st.address||'')}</textarea></div>
      <div class="grid2">
        <div class="f"><label>สถานะ VAT</label><select id="sVat">
          <option value="false" ${!st.vat_registered?'selected':''}>ยังไม่จดทะเบียน VAT</option>
          <option value="true" ${st.vat_registered?'selected':''}>จดทะเบียน VAT แล้ว</option></select></div>
        <div class="f"><label>เพดานรายได้ที่ต้องจด VAT</label>
          <input data-money-field id="sCap" value="${st.vat_threshold||1800000}">
          <div class="help">กฎหมายกำหนด 1,800,000 บาท/ปี</div></div></div>
      <div><button class="btn btn-p" id="sSave">บันทึก</button></div>
    </div></div>

  <div class="card" style="margin-top:20px"><div class="card-h"><h2>บัญชีเงิน</h2></div>
    <div class="tw"><table><thead><tr><th>ชื่อ</th><th>ธนาคาร</th><th>เลขบัญชี</th>
      <th class="r">ยอดยกมา</th></tr></thead><tbody>
      ${S.accounts.map(a=>`<tr><td><b>${esc(a.name)}</b></td><td>${esc(a.bank_name||'—')}</td>
        <td class="num">${esc(a.account_no||'—')}</td><td class="n">${B(a.opening_balance)}</td></tr>`).join('')}
    </tbody></table></div></div>

  <div class="card" style="margin-top:20px"><div class="card-h"><h2>ผู้รับเงิน</h2>
    <button class="btn btn-p" id="addV">+ เพิ่ม</button></div>
    ${S.vendors.length?`<div class="tw"><table><thead><tr><th>ชื่อ</th><th>ประเภท</th>
      <th>เลขผู้เสียภาษี</th><th>แบบที่ต้องยื่น</th></tr></thead><tbody>
      ${S.vendors.map(v=>`<tr><td><b>${esc(v.name)}</b></td>
        <td>${v.entity_type==='person'?'บุคคลธรรมดา':'นิติบุคคล'}</td>
        <td class="num">${esc(v.tax_id||'—')}</td>
        <td><span class="tag ${v.entity_type==='person'?'a':'b'}">${v.entity_type==='person'?'ภ.ง.ด.3':'ภ.ง.ด.53'}</span></td>
      </tr>`).join('')}</tbody></table></div>`:EMPTY('ยังไม่มีผู้รับเงิน')}
  </div>

  <div class="card" style="margin-top:20px"><div class="card-h"><h2>ระบบ</h2></div>
    <div class="card-b" style="color:var(--ink-2);font-size:13px;line-height:1.9">
      ผู้ช่วยจัดหมวดรายจ่าย:
      <b style="color:${S.jevReady?'var(--green)':'var(--amber)'}">
        ${S.jevReady?'Jev + คำสำคัญ (ครบ)':'คำสำคัญอย่างเดียว'}</b><br>
      ${S.jevReady?'Ollama ทำงานอยู่ในเครื่อง ข้อมูลไม่ออกนอกเครื่อง ไม่มีค่าใช้จ่าย'
        :'เปิด Ollama ในเครื่องแล้วรีเฟรช จะได้ตัวช่วยเดาหมวดที่ฉลาดขึ้น (ชั้นคำสำคัญยังทำงานปกติ)'}<br>
      ฐานข้อมูล: Supabase · ข้อมูลการเงินเปิดอ่านได้เฉพาะผู้ที่ล็อกอินเท่านั้น
    </div></div>`;

  $('#sSave').onclick=async()=>{
    await api(()=>sb.from('acc_settings').update({
      company_name:$('#sName').value.trim(), tax_id:$('#sTax').value.trim(),
      branch:$('#sBranch').value.trim(), address:$('#sAddr').value.trim(),
      vat_registered:$('#sVat').value==='true', vat_threshold:numOf($('#sCap'))||1800000,
    }).eq('id',1),'บันทึกตั้งค่า');
    await loadAll(); render(); toast('บันทึกแล้ว');
  };
  $('#addV').onclick=()=>vendorModal(()=>render());
}

// ---- ช่องทดสอบ: เปิดเฉพาะตอนรันบนเครื่องตัวเอง ไม่ติดไปกับของจริง ----
if (['localhost','127.0.0.1'].includes(location.hostname)) {
  window.__ACC = { S, render, buildPeriods, loadAll, pnl };
}

// ===================================================================
//  เริ่มทำงาน — ถ้าเคยล็อกอินไว้ เข้าเลย
// ===================================================================
(async()=>{
  const {data}=await sb.auth.getSession();
  if(data?.session) start();
  else $('#lgEmail').focus();
})();
