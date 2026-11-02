'use strict';
// Approval-only data: names, pack facts, drawing choices and expiries from the opening file.
// Opening quantities are deliberately not imported. No API calls exist in this prototype.
const ITEMS = [
 {id:'ST-0001',en:'Nescafe Classic',ar:'نسكافيه كلاسيك',kind:'jar',color:'#3a2216',cat:'Pantry',label:['NESCAFÉ','Classic'],latin:true,pack:['12 jars × 190 g / carton','كرتون: 12 مرطبانًا، 190 غ لكل مرطبان'],contains:12,unit:['Jar','مرطبان'],count:['Carton','كرتون'],batches:['2028-03-01','2027-10-01','2027-11-01']},
 {id:'ST-0002',en:'Coffee-mate',ar:'كوفي ميت',kind:'canister',color:'#f4efe6',cat:'Pantry',label:['Coffee-mate'],latin:true,pack:['15 jars × 400 g / carton','كرتون: 15 مرطبانًا، 400 غ لكل مرطبان'],contains:15,unit:['Jar','مرطبان'],count:['Carton','كرتون'],batches:['2028-03-19','2028-02-13','2028-02-23','2027-03-25','2027-04-26','2027-04-12','2027-04-25','2026-12-02','2026-11-30']},
 {id:'ST-0003',en:'Lipton Yellow Label',ar:'ليبتون الأصفر',kind:'box',color:'#f2c230',cat:'Pantry',label:['LIPTON','Yellow Label'],latin:true,pack:['24 boxes × 400 g / carton','كرتون: 24 علبة، 400 غ لكل علبة'],contains:24,unit:['Box','علبة'],count:['Carton','كرتون'],batches:['2028-09']},
 {id:'ST-0004',en:'Green tea',ar:'شاي أخضر',kind:'box',color:'#3f7d3a',cat:'Pantry',label:['GREEN TEA'],labelAr:['شاي أخضر'],pack:['Pack size not recorded · Count packets','حجم العبوة غير مسجّل · العد بالعلبة'],count:['Packet','علبة'],batches:[null]},
 {id:'ST-0005',en:'Lipton Red Label',ar:'ليبتون الأحمر',kind:'box',color:'#b3121f',cat:'Pantry',label:['LIPTON','Red Label'],latin:true,pack:['36 boxes × 100 tea bags / carton','كرتون: 36 علبة، 100 كيس شاي لكل علبة'],contains:36,unit:['Box','علبة'],count:['Carton','كرتون'],batches:['2029-01']},
 {id:'ST-0006',en:'Rainbow milk',ar:'حليب رينبو',kind:'tins',color:'#d0312d',cat:'Pantry',label:['Rainbow'],latin:true,pack:['96 tins × 170 g / carton','كرتون: 96 علبة، 170 غ لكل علبة'],contains:96,unit:['Tin','علبة'],count:['Carton','كرتون'],batches:['2027-05']},
 {id:'ST-0007',en:'Liwa water',ar:'مياه ليوا',kind:'water',color:'#2f7fc1',cat:'Pantry',label:['Liwa'],latin:true,pack:['Pack size not recorded · Count cartons','حجم العبوة غير مسجّل · العد بالكرتون'],count:['Carton','كرتون'],batches:[null]},
 {id:'ST-0008',en:'Coffee cups',ar:'أكواب قهوة',kind:'cups',color:'#ffffff',cat:'Pantry',label:['CUPS'],labelAr:['أكواب'],pack:['50 sleeves × 40 cups / carton','كرتون: 50 رزمة، 40 كوبًا لكل رزمة'],contains:50,unit:['Sleeve','رزمة'],count:['Carton','كرتون'],batches:[null]},
 {id:'ST-0009',en:'Large coffee cups',ar:'أكواب قهوة كبيرة',kind:'bigcups',color:'#ffffff',cat:'Pantry',label:['CUPS'],labelAr:['أكواب'],pack:['Carton · contents not recorded','كرتون · المحتويات غير مسجّلة'],count:['Carton','كرتون'],batches:[null]},
 {id:'ST-0010',en:'Masafi tissues',ar:'مناديل مسافي',kind:'tissue',color:'#5aa9d6',cat:'Pantry',label:['Masafi'],latin:true,pack:['150 sheets · 2-ply · Carton contents not recorded','150 منديلًا · طبقتان · محتويات الكرتون غير مسجّلة'],count:['Carton','كرتون'],batches:[null]},
 {id:'ST-0011',en:'Nitrile gloves',ar:'قفازات نتريل',kind:'gloves',color:'#2b5fb4',cat:'Protective',label:['NITRILE'],labelAr:['نتريل'],pack:['Pack size not recorded · Count cartons','حجم العبوة غير مسجّل · العد بالكرتون'],count:['Carton','كرتون'],batches:[null]},
 {id:'ST-0012',en:'Vinyl gloves',ar:'قفازات فينيل',kind:'gloves',color:'#e9eef2',cat:'Protective',label:['VINYL'],labelAr:['فينيل'],pack:['10 boxes × 100 gloves / carton','كرتون: 10 علب، 100 قفاز لكل علبة'],contains:10,unit:['Box','علبة'],count:['Carton','كرتون'],batches:[null]},
 {id:'ST-0013',en:'Face masks',ar:'كمامات وجه',kind:'mask',color:'#eaf3fa',cat:'Protective',label:['MASK'],labelAr:['كمامة'],pack:['Blue · 3-ply · Pack size not recorded','زرقاء · 3 طبقات · حجم العبوة غير مسجّل'],count:['Carton','كرتون'],batches:[null]}
];
const KINDS=['carton','jar','canister','box','tins','water','cups','bigcups','tissue','gloves','mask'];
const COLORS=['#3a2216','#f2c230','#3f7d3a','#c8102e','#2583b8','#4e78c2'];
const SORT_NAMES=[
 ['Nescafe Classic 190 g','نسكافيه كلاسيك 190 غ'],['Coffee-mate 400 g','كوفي ميت 400 غ'],
 ['Lipton Yellow Label tea 400 g','شاي ليبتون العلامة الصفراء 400 غ'],['Green tea','شاي أخضر'],
 ['Lipton Red Label tea, 100 bags','شاي ليبتون العلامة الحمراء، 100 كيس'],['Rainbow milk 170 g','حليب رينبو 170 غ'],
 ['Liwa water','مياه ليوا'],['Coffee cups, 40 per sleeve','أكواب قهوة، 40 كوبًا في الرزمة'],
 ['Big coffee cups','أكواب قهوة كبيرة'],['Masafi café tissues, 150 sheets 2-ply','مناديل مسافي، 150 منديلًا بطبقتين'],
 ['Nitrile gloves','قفازات نتريل'],['Vinyl gloves, 100 per box','قفازات فينيل، 100 في العلبة'],['Face masks, 3-ply blue','كمامات وجه زرقاء، 3 طبقات']
];
const qs=new URLSearchParams(location.search);
let lang=qs.get('lang')==='ar'?'ar':'en',theme=qs.get('theme')==='dark'?'dark':'light';
let screen=['count','shelf','items','deliveries','disposals','home'].includes(qs.get('screen'))?qs.get('screen'):'count';
let step=['start','count','review','paused','success'].includes(qs.get('step'))?qs.get('step'):'start';
let itemId=ITEMS.some(i=>i.id===qs.get('item'))?qs.get('item'):'ST-0001';
let deliveryStage=['confirm','manual'].includes(qs.get('delivery'))?qs.get('delivery'):'upload';
let addingItem=qs.get('view')==='add',storageFailed=false,saveFailed=qs.get('storage')==='fail',draftLoaded=false;
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const KEY='sentinel-store-count-approval-v1';
let draft={started:false,date:today(),values:{},extra:{},item:itemId};
let unsavedEntries=false;
try{
 const saved=localStorage.getItem(KEY);
 if(saved){
  const data=JSON.parse(saved);
  if(data&&typeof data==='object'&&!Array.isArray(data)&&/^\d{4}-\d{2}-\d{2}$/.test(data.date)){
   const extra={},values={};
   for(const i of ITEMS){
    const seen=new Set(i.batches.map(normalize));
    extra[i.id]=(Array.isArray(data.extra?.[i.id])?data.extra[i.id]:[]).filter(b=>{
     if(!b||typeof b.key!=='string'||!b.key.startsWith(`${i.id}:added-`)||!/^ST-\d{4}:added-\d+$/.test(b.key)||(b.date!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(b.date))||seen.has(b.date))return false;
     seen.add(b.date);return true;
    }).map(b=>({key:b.key,date:b.date,month:b.month===true}));
    const keys=[...i.batches.map((_,n)=>`${i.id}:${n}`),...extra[i.id].map(b=>b.key)];
    for(const key of keys){const v=data.values?.[key];if(v&&typeof v==='object')values[key]={full:typeof v.full==='string'?normalizeDigits(v.full):'',loose:typeof v.loose==='string'?normalizeDigits(v.loose):''};}
   }
   draft={started:data.started===true,date:data.date,values,extra,item:ITEMS.some(i=>i.id===data.item)?data.item:itemId};
   draftLoaded=true;if(!qs.has('item'))itemId=draft.item;
  }
 }
}catch{storageFailed=true;}
storageFailed=storageFailed||saveFailed;
let disposalItem=screen==='disposals'?(ITEMS.find(i=>i.id===qs.get('item'))||null):null;
let deliveryLines=[],attachedFile=null,attachmentURL=null,deliveryMessage='',itemMessage='',disposalMessage='';
let deliveryDate=today(),deliveryNote='';
let itemPreview={en:'',ar:'',labelEn:'',labelAr:'',kind:'carton',color:COLORS[0],pack:'',category:'Pantry',countUnit:'Carton',contentsKnown:false,contains:'',looseUnit:'Box'};
const NEW_UNITS={Carton:['Carton','كرتون'],Packet:['Packet','رزمة'],Box:['Box','علبة'],Jar:['Jar','مرطبان'],Tin:['Tin','علبة معدنية'],Sleeve:['Sleeve','رزمة أكواب'],Piece:['Piece','قطعة']};
const $=(s,root=document)=>root.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t=(en,ar)=>lang==='ar'?ar:en;
const isolated=s=>String(s??'').split(/([A-Za-zÀ-ž][A-Za-zÀ-ž0-9éÉ .-]*)/g).map((part,index)=>index%2?`<bdi dir="ltr">${esc(part)}</bdi>`:esc(part)).join('');
const name=i=>isolated(lang==='ar'?i.ar:i.en);
const pack=i=>isolated(i.pack[lang==='ar'?1:0]);
const unit=i=>i.count[lang==='ar'?1:0];
const loose=i=>i.unit?.[lang==='ar'?1:0];
const category=c=>c==='Pantry'?t('Pantry','ضيافة'):t('Protective','وقاية');
const byId=id=>ITEMS.find(i=>i.id===id);
function sorted(){const col=new Intl.Collator(lang,{numeric:true,sensitivity:'base'});const originalName=i=>SORT_NAMES[ITEMS.indexOf(i)][lang==='ar'?1:0];return [...ITEMS].sort((a,b)=>a.cat.localeCompare(b.cat)||(KINDS.indexOf(a.kind)||99)-(KINDS.indexOf(b.kind)||99)||col.compare(originalName(a),originalName(b)));}
function normalize(raw){if(!raw)return null;if(/^\d{4}-\d{2}$/.test(raw)){const [y,m]=raw.split('-').map(Number);return `${raw}-${new Date(y,m,0).getDate()}`;}return raw;}
function batches(i){return [...i.batches.map((raw,n)=>({key:`${i.id}:${n}`,date:normalize(raw),month:!!raw&&raw.length===7})),...(draft.extra[i.id]||[])].sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));}
const allBatches=()=>sorted().flatMap(i=>batches(i).map(b=>({...b,item:i})));
const validValue=s=>typeof s==='string'&&/^\d+$/.test(s)&&Number.isSafeInteger(Number(s));
function normalizeDigits(value){return String(value).replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c>='۰'?1776:1632)));}
function batchProgressText(done,total){return t(`Batches counted: ${done} of ${total}`,`الدفعات المعدودة: ${done} من ${total}`);}
function numberSummary(i,full,looseValue=''){return i.contains?t(`Full cartons: ${full} · Loose ${loose(i)}: ${looseValue}`,`كراتين كاملة: ${full} · مفرد (${loose(i)}): ${looseValue}`):`${t('Quantity','الكمية')} (${unit(i)}): ${full}`;}
function sourceBatches(i){return i.batches.map((raw,n)=>({key:`${i.id}:${n}`,date:normalize(raw),month:!!raw&&raw.length===7}));}
function counted(i,b){const v=draft.values[b.key];return !!v&&validValue(v.full)&&(!i.contains||validValue(v.loose));}
function progress(){const list=allBatches();return {done:list.filter(b=>counted(b.item,b)).length,total:list.length};}
function expiry(b){return b.date?`<span class="date" dir="ltr">${b.date.split('-').reverse().join('/')}</span>${b.month?`<span class="monthhint">${t('Month-only expiry · shown as the last day of the month','انتهاء بالشهر فقط · يظهر آخر يوم من الشهر')}</span>`:''}`:t('Undated batch','دفعة بلا تاريخ انتهاء');}
function save(){draft.item=itemId;try{if(saveFailed)throw Error('demonstration');localStorage.setItem(KEY,JSON.stringify(draft));storageFailed=false;draftLoaded=true;unsavedEntries=false;}catch{storageFailed=true;}updateSaveState();}
function saveText(){return storageFailed?t('Draft NOT saved on this device. Keep this page open; storage is unavailable.','لم تُحفظ المسودة على هذا الجهاز. أبقِ الصفحة مفتوحة؛ التخزين غير متاح.'):draftLoaded?t('Draft saved on this browser only · not synced to another device','المسودة محفوظة في هذا المتصفح فقط · لا تنتقل إلى جهاز آخر'):t('No draft saved yet · entries will stay in this browser only','لم تُحفظ مسودة بعد · ستبقى المدخلات في هذا المتصفح فقط');}
function updateSaveState(){document.querySelectorAll('[data-save-state]').forEach(el=>{el.textContent=saveText();el.className=`status${storageFailed?' error':''}`;});}
function updateURL(){const p=new URLSearchParams();p.set('screen',screen);p.set('lang',lang);p.set('theme',theme);if(screen==='count'){p.set('step',step);if(step==='count')p.set('item',itemId);}if(screen==='items'&&addingItem)p.set('view','add');if(screen==='deliveries')p.set('delivery',deliveryStage);if(screen==='disposals'&&disposalItem)p.set('item',disposalItem.id);if(saveFailed)p.set('storage','fail');history.replaceState(null,'',`${location.pathname}?${p}`);}
function toast(message){const el=$('#toast');el.textContent=message;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,5500);}
function shade(hex,amount){const value=parseInt(hex.slice(1),16);return '#'+[value>>16,(value>>8)&255,value&255].map(v=>Math.round(amount<0?v*(1+amount):v+(255-v)*amount).toString(16).padStart(2,'0')).join('');}
function art(i){const main=i.color,dark=shade(main,-.22),light=shade(main,.18),secondary=shade(main,-.45);
const box=inside=>`<path d="M28 46l12-10h50l-12 10z" fill="${light}"/><path d="M78 46l12-10v58l-12 10z" fill="${dark}"/><rect x="28" y="46" width="50" height="58" fill="${main}"/>${inside}`;
let drawing='';switch(i.kind){
case'jar':drawing=`<rect x="33" y="40" width="54" height="62" rx="9" fill="${main}"/><rect x="36" y="28" width="48" height="15" rx="3" fill="${secondary}"/><rect x="33" y="58" width="54" height="24" fill="${secondary}"/><rect x="38" y="44" width="6" height="52" rx="3" fill="#fff" opacity=".18"/>`;break;
case'canister':drawing=`<rect x="38" y="30" width="44" height="72" rx="6" fill="${main}" stroke="#d9d2c4"/><rect x="36" y="24" width="48" height="10" rx="3" fill="${secondary}"/><path d="M38 70h44v14H38z" fill="${secondary}"/><rect x="42" y="36" width="5" height="62" rx="2.5" fill="#fff" opacity=".4"/>`;break;
case'box':drawing=box(`<rect x="28" y="64" width="50" height="20" fill="${secondary}"/>`);break;
case'tins':drawing=[38,60,82].map(x=>`<g><rect x="${x-10}" y="52" width="20" height="44" rx="3" fill="${main}"/><ellipse cx="${x}" cy="52" rx="10" ry="3" fill="#dcdcdc"/><rect x="${x-10}" y="66" width="20" height="14" fill="${secondary}"/></g>`).join('');break;
case'water':drawing=[34,48,62,76,90].map(x=>`<g><rect x="${x-6}" y="44" width="12" height="54" rx="4" fill="#cfe9f7"/><rect x="${x-3}" y="38" width="6" height="7" rx="1.5" fill="${main}"/><rect x="${x-6}" y="62" width="12" height="12" fill="${main}"/></g>`).join('')+'<rect x="25" y="50" width="72" height="44" rx="5" fill="#fff" opacity=".22"/>';break;
case'cups':drawing=[0,1,2,3,4].map(n=>`<path d="M46 ${44+n*9}h28l-2 ${n===4?26:9}H48z" fill="${n%2?'#f7f7f4':'#fff'}" stroke="#d9d6cc"/>`).join('')+`<path d="M46 44h28" stroke="${secondary}" stroke-width="3"/><rect x="51" y="84" width="18" height="4" rx="1" fill="${secondary}"/>`;break;
case'bigcups':drawing=[0,1,2,3].map(n=>`<path d="M40 ${36+n*11}h40l-3 ${n===3?34:11}H43z" fill="${n%2?'#f7f7f4':'#fff'}" stroke="#d9d6cc"/>`).join('')+`<path d="M40 36h40" stroke="${secondary}" stroke-width="3.5"/><rect x="48" y="84" width="24" height="6" rx="1" fill="${secondary}"/>`;break;
case'tissue':drawing=`<path d="M28 52l10-8h52l-10 8z" fill="${shade(main,.3)}"/><path d="M80 52l10-8v46l-10 8z" fill="${dark}"/><rect x="28" y="52" width="52" height="46" fill="${main}"/><path d="M47 50q7-16 14 0q-3 4-7 2q-4 2-7-2z" fill="#fff"/><path d="M28 80q26-10 52 0v18H28z" fill="${shade(main,-.1)}"/>`;break;
case'gloves':drawing=box(`<g fill="${secondary}" transform="translate(40 52)"><rect x="4" y="16" width="18" height="22" rx="5"/><rect x="4" y="2" width="4" height="18" rx="2"/><rect x="9" y="0" width="4" height="20" rx="2"/><rect x="14" y="1" width="4" height="19" rx="2"/><rect x="19" y="5" width="3.6" height="15" rx="1.8"/><rect x="-3" y="20" width="10" height="4" rx="2" transform="rotate(-35 2 22)"/></g>`);break;
case'mask':drawing=box(`<path d="M36 64q17-8 34 0v16q-17 8-34 0z" fill="${secondary}"/><path d="M36 68q-6 4 0 10M70 68q6 4 0 10" stroke="${secondary}" stroke-width="2" fill="none"/><path d="M38 70h30M38 74h30" stroke="#fff" stroke-width="1" opacity=".6"/>`);break;
default:drawing=box(`<path d="M53 46v58M53 46l12-10" stroke="${secondary}" stroke-width="3"/>`);}
// Printed label layers are the only modification to the existing art geometry.
const requestedLines=lang==='ar'&&!i.latin?(i.labelAr||i.label):i.label;
const lines=requestedLines.flatMap(line=>{
 if(!i.preview||line.length<=9)return [line];
 const split=line.lastIndexOf(' ',10),at=split>2?split:Math.ceil(line.length/2);
 return [line.slice(0,at).trim(),line.slice(at).trim()];
});
const front=['box','gloves','mask','carton','tissue'].includes(i.kind),cx=front?53:60;
let y=i.kind==='jar'?68:i.kind==='box'?72:i.kind==='canister'?57:['gloves','mask'].includes(i.kind)?94:i.kind==='tissue'?72:i.kind==='water'?69:i.kind==='tins'?74:67;
if(lines.length>1)y=Math.min(y,89);
const w=i.kind==='canister'?43:i.kind==='cups'?28:i.kind==='bigcups'?38:i.kind==='tins'||i.kind==='water'?64:front?49:52;
const plaqueH=lines.length>1?23:16,font=lines.some(line=>line.length>9)?7.2:8.6;
const printed=`<rect x="${cx-w/2}" y="${y-11}" width="${w}" height="${plaqueH}" rx="1.5" fill="#fffdf7" opacity=".97"/>${lines.map((line,n)=>`<text x="${cx}" y="${y+n*10}" text-anchor="middle" direction="${lang==='ar'&&!i.latin?'rtl':'ltr'}" style="unicode-bidi:isolate" fill="#192c40" font-family="${lang==='ar'&&!i.latin?'Noto Sans Arabic, sans-serif':'Inter, sans-serif'}" data-max-width="${w-4}" data-base-font="${font}" font-size="${font}" font-weight="700">${esc(line)}</text>`).join('')}`;
return `<svg class="art" viewBox="20 20 80 90" aria-hidden="true" focusable="false"><ellipse cx="60" cy="105" rx="36" ry="5" fill="#000" opacity=".12"/>${drawing}${printed}</svg>`;}
function statusLine(){return `<p class="status${storageFailed?' error':''}" data-save-state role="status">${saveText()}</p>`;}
function header(){
 const tabs=[['count',t('Stock count','جرد المخزن')],['shelf',t('Shelves','الرفوف')],['items',t('Items','الأصناف')],['deliveries',t('Deliveries','التوريدات')],['disposals',t('Disposals','الإتلاف')],['home',t('Home reference','مرجع الرئيسية')]];
 return `<div class="prototype"><div class="wrap"><strong>${t('Approval prototype · no records saved','نموذج للموافقة · لا تُحفظ سجلات')}</strong><span>${t('Proposed interactions · Phase 1 only','تفاعلات مقترحة · المرحلة الأولى فقط')}</span></div></div><header class="chrome"><div class="wrap"><div class="top"><div class="wordmark"><bdi dir="ltr">GSSG Manager</bdi><span>${t('Assets / Store','الأصول / المخزن')}</span></div><div class="controls" aria-label="${t('Prototype controls','إعدادات النموذج')}"><button data-action="lang" lang="${lang==='en'?'ar':'en'}">${t('العربية','English')}</button><button data-action="theme">${theme==='light'?t('Dark theme','الوضع الداكن'):t('Light theme','الوضع الفاتح')}</button></div></div><select class="mobile-pages" aria-label="${t('Store pages','صفحات المخزن')}">${tabs.map(([id,label])=>`<option value="${id}"${screen===id?' selected':''}>${label}</option>`).join('')}</select><nav class="tabs" aria-label="${t('Store pages','صفحات المخزن')}">${tabs.map(([id,label])=>`<button data-screen="${id}"${screen===id?' aria-current="page"':''}>${label}</button>`).join('')}</nav></div></header>`;
}
function head(title,desc,actions=''){return `<div class="pagehead"><div><h1 id="page-title" tabindex="-1">${title}</h1>${desc?`<p>${desc}</p>`:''}</div>${actions?`<div class="actions">${actions}</div>`:''}</div>`;}
function rules(){return `<p class="notice">${t('Blind count: enter only what you physically count. No previous or system quantities are shown. Monthly usage and request calculations remain unchanged.','جرد أعمى: أدخل فقط ما تعدّه فعليًا. لا تظهر كميات سابقة أو كميات النظام. لا تغيير في حساب الاستهلاك الشهري أو الطلب المقترح.')}</p>`;}
function guide(){return `<details class="panel guide"><summary>${t('Browser exercise guide & direct links','دليل التجربة وروابط الحالات')}</summary><div class="stack"><p>${t('This is an interactive proposal, not production behavior. Counts persist only in this browser. Uploaded notes remain in memory only and disappear on reload.','هذا مقترح تفاعلي، وليس سلوك النظام الفعلي. تُحفظ مسودة الجرد في هذا المتصفح فقط. المرفقات تبقى في الذاكرة وتختفي عند إعادة التحميل.')}</p><ol><li>${t('Start a count, type both full cartons and loose units for a batch, use “Counted none” for a genuine zero, and skip an item. Review the missing batches, return to one by its drawing, then reload to resume.','ابدأ الجرد، أدخل الكراتين الكاملة والوحدات المفردة، واستخدم «لم أجد شيئًا» للصفر الصريح. تجاوز صنفًا، وراجع الدفعات غير المعدودة، ثم عُد إليها واضغط إعادة التحميل لاستئناف المسودة.')}</li><li>${t('Add a month-only or undated batch. Repeating an expiry opens the existing batch instead of duplicating it.','أضف دفعة بالشهر فقط أو دون تاريخ. تكرار الانتهاء يفتح الدفعة الموجودة ولا يكررها.')}</li><li>${t('Open Deliveries, attach a local note, load illustrative lines or choose manual entry. Enter quantities and explicitly confirm every line; match the flagged line. Nothing runs OCR or saves to a server.','افتح التوريدات وأرفق مستندًا محليًا. حمّل أسطرًا توضيحية أو أدخل يدويًا. أدخل الكميات وأكّد كل سطر، وطابق السطر المعلّم. لا يوجد OCR فعلي أو حفظ على خادم.')}</li><li>${t('Try adding an item and its bilingual drawing labels, then a disposal. Compare the shelf drawings with the Home reference.','جرّب إضافة صنف وتسميات الرسم باللغتين، ثم الإتلاف. قارن رسومات الرفوف بمرجع الرئيسية.')}</li></ol><p><code>?screen=count&step=count&item=ST-0002&lang=ar&theme=dark</code><br><code>?screen=count&step=review</code><br><code>?screen=count&storage=fail</code><br><code>?screen=shelf&lang=en&theme=light</code><br><code>?screen=items&view=add</code><br><code>?screen=deliveries&delivery=confirm</code><br><code>?screen=deliveries&delivery=manual</code><br><code>?screen=disposals&item=ST-0011</code><br><code>?screen=home</code></p><p>${t('Supported: screen=count|shelf|items|deliveries|disposals|home; lang=en|ar; theme=light|dark; count step=start|count|review|paused|success; item=ST-0001…ST-0013. storage=fail simulates a failed browser draft save, without deleting your saved draft.','المتاح: screen=count|shelf|items|deliveries|disposals|home؛ lang=en|ar؛ theme=light|dark؛ step=start|count|review|paused|success؛ item=ST-0001…ST-0013. الخيار storage=fail يحاكي تعذّر حفظ المسودة دون حذف المسودة المحفوظة.')}</p><div class="actions"><button data-action="storage">${saveFailed?t('Stop save-failure simulation','إيقاف محاكاة فشل الحفظ'):t('Simulate draft save failure','محاكاة تعذّر حفظ المسودة')}</button><button data-action="reset">${t('Clear this demo draft','مسح مسودة التجربة')}</button></div></div></details>`;}
function startPage(paused=false){
 const p=progress();
 return head(t('New stock count','جرد مخزن جديد'),t('Count what is on the shelf, one item at a time.','عدّ الموجود على الرف، صنفًا واحدًا في كل مرة.'))+`<section class="panel start"><div><h2>${paused?t('Count paused on this device','الجرد متوقف على هذا الجهاز'):t('Before you begin','قبل أن تبدأ')}</h2><ol class="instructions"><li>${t('Choose the date you are physically counting.','اختر تاريخ الجرد الفعلي.')}</li><li>${t('Find the item by its drawing. Count every expiry batch separately.','تعرّف إلى الصنف من رسمه. عدّ كل دفعة انتهاء على حدة.')}</li><li>${t('Enter full cartons and loose units. For an empty batch, choose “Counted none”. Blank is not zero.','أدخل الكراتين الكاملة والوحدات المفردة. للدفعة الفارغة اختر «لم أجد شيئًا». الفراغ ليس صفرًا.')}</li><li>${t('Review all entered quantities before the demo submission.','راجع كل الكميات التي أدخلتها قبل الإرسال التجريبي.')}</li></ol><form id="start-form" class="stack"><label>${t('Count date','تاريخ الجرد')}<input type="date" id="count-date" name="date" value="${esc(draft.date)}" required max="${today()}"></label><p class="muted" style="font-size:.8em">${t('Selected date','التاريخ المختار')}: <span id="chosen-date">${expiry({date:draft.date})}</span></p><div class="actions"><button class="primary" type="submit">${draft.started?t('Resume count','استئناف الجرد'):t('Start counting','بدء العد')}</button>${draft.started?`<button type="button" data-action="review">${t('Review draft','مراجعة المسودة')}</button>`:''}</div></form></div><div class="stack"><div class="artstrip">${art(ITEMS[0])+art(ITEMS[2])+art(ITEMS[10])}</div><p class="notice">${t('13 real items · 23 original batches. Quantities start blank. Pack facts help you count; they are not stock quantities.','13 صنفًا فعليًا · 23 دفعة أصلية. تبدأ الكميات فارغة. معلومات العبوة تساعدك على العد وليست كميات مخزون.')}</p>${draft.started?`<div class="draft tight"><strong>${batchProgressText(p.done,p.total)}</strong>${statusLine()}</div>`:`<p class="muted" style="font-size:.8em">${t('Device-only draft: entries stay in this browser, not a shared account. Do not clear browser data during the count.','مسودة على هذا الجهاز فقط: تبقى المدخلات في هذا المتصفح وليس في حساب مشترك. لا تمسح بيانات المتصفح أثناء الجرد.')}</p>`}${storageFailed?`<p class="notice error">${saveText()}</p>`:''}</div></section>`+rules()+guide();
}
function nav(){return `<aside class="panel sidenav"><h2>${t('Go to an item · shelf order','انتقل إلى صنف · ترتيب الرفوف')}</h2><div class="navlist">${['Pantry','Protective'].map(cat=>`<h2>${category(cat)}</h2>${sorted().filter(i=>i.cat===cat).map(i=>{const bs=batches(i),done=bs.filter(b=>counted(i,b)).length;return `<button class="navitem${i.id===itemId?' selected':''}" data-item="${i.id}"${i.id===itemId?' aria-current="step"':''}>${art(i)}<span class="navname">${name(i)}<small>${batchProgressText(done,bs.length)}</small></span><span class="check">${done===bs.length?t('Done','تم'):''}</span></button>`;}).join('')}`).join('')}</div></aside>`;}
function entered(i,b){
 const v=draft.values[b.key];
 if(!counted(i,b)){
  if(v&&[v.full,...(i.contains?[v.loose]:[])].some(value=>value!==''&&!validValue(value)))return t('Invalid count: enter whole numbers from zero, without signs or decimals.','كمية غير صالحة: أدخل أعدادًا صحيحة من صفر، بلا إشارة أو كسور.');
  return t('Not counted yet · fill every quantity field; blank is not zero.','لم تُعدّ بعد · املأ كل حقول الكمية؛ الفراغ ليس صفرًا.');
 }
 return numberSummary(i,v.full,v.loose);
}
function quantityFields(i,b,prefix='count'){
 const v=draft.values[b.key]||{full:'',loose:''};
 const input=(field,label)=>`<label for="${prefix}-${b.key}-${field}">${label}<input id="${prefix}-${b.key}-${field}" data-batch="${b.key}" data-field="${field}" type="text" inputmode="numeric" dir="ltr" value="${esc(v[field])}" aria-describedby="summary-${b.key}" aria-invalid="${v[field]!==''&&!validValue(v[field])}" autocomplete="off"></label>`;
 return `<div class="quantity${i.contains?'':' single'}">${input('full',i.contains?t('Full cartons','كراتين كاملة'):t('Count in','العد بوحدة')+' '+esc(unit(i)))}${i.contains?input('loose',t('Loose','مفرد')+': '+esc(loose(i))):''}<button type="button" data-zero="${b.key}">${t('Counted none','لم أجد شيئًا')}</button></div>`;
}
function batchHTML(i,b){
 const added=b.key.includes(':added-');
 return `<section class="batch" id="batch-${b.key}"><div class="batchhead"><div class="expiry">${t('Expiry','الانتهاء')}: ${expiry(b)}</div><span class="badge ${counted(i,b)?'done':'wait'}" data-badge="${b.key}">${counted(i,b)?t('Counted','تم العد'):t('Not counted','لم تُعدّ')}</span></div>${quantityFields(i,b)}<p class="batchsummary" id="summary-${b.key}" role="status">${entered(i,b)}</p>${added?`<button type="button" class="quiet" data-remove-batch="${b.key}">${t('Remove this added batch','إزالة هذه الدفعة المضافة')}</button>`:''}</section>`;
}
function addBatchForm(i){return `<details class="newbatch"><summary>${t('Found another expiry? Add a batch','وجدت تاريخ انتهاء آخر؟ أضف دفعة')}</summary><form id="new-batch-form" class="stack"><p class="muted" style="font-size:.78em">${t('Use the expiry printed on the pack. This adds another blank count, never a delivery.','استخدم الانتهاء المطبوع على العبوة. تُضاف خانة جرد فارغة، وليس توريدًا.')}</p><label>${t('Expiry format','صيغة الانتهاء')}<select id="expiry-type"><option value="date">${t('Exact date','تاريخ كامل')}</option><option value="month">${t('Month only','شهر فقط')}</option><option value="undated">${t('No expiry printed / undated','بلا تاريخ انتهاء مطبوع')}</option></select></label><label id="expiry-input-label">${t('Expiry date','تاريخ الانتهاء')}<input id="new-expiry" type="date" required></label><div class="error-text" id="batch-error" role="alert"></div><button type="submit">${t('Add blank batch','إضافة دفعة فارغة')}</button></form></details>`;}
function countPage(){
 const i=byId(itemId),p=progress(),list=sorted(),idx=list.findIndex(x=>x.id===i.id);
 return head(t('Count this item','عدّ هذا الصنف'),`${category(i.cat)} · ${t('Item','الصنف')} ${idx+1} ${t('of','من')} 13`,`<button data-action="pause">${t('Save & exit','حفظ وخروج')}</button><button data-action="review">${t('Review count','مراجعة الجرد')}</button>`)+
 `<div class="panel"><div class="progresshead"><strong data-progress>${batchProgressText(p.done,p.total)}</strong><span>${t('Count date','تاريخ الجرد')}: ${expiry({date:draft.date})}</span></div><progress class="progress" data-progressbar max="${p.total}" value="${p.done}" aria-label="${t('Batches counted','الدفعات المعدودة')}"></progress></div>
 <div class="workspace"><section class="panel countpanel" aria-label="${t('Focused item count','عد الصنف الحالي')}"><div class="focusitem">${art(i)}<div><span class="code" dir="ltr">${i.id}</span><h2>${name(i)}</h2><p class="pack">${pack(i)}</p></div></div><p class="muted" style="font-size:.78em;margin-block:.8em">${i.contains?t('Enter both fields, including zero if there are no loose units. Do not count inside an unopened carton.','أدخل الحقلين، بما في ذلك صفر عند عدم وجود وحدات مفردة. لا تعدّ محتويات الكرتون المغلق.'):t('Use the recorded counting unit only; no pack conversion is assumed.','استخدم وحدة العد المسجّلة فقط؛ لا يُفترض عدد داخل العبوة.')}</p>${batches(i).map(b=>batchHTML(i,b)).join('')}${addBatchForm(i)}<div class="countfooter"><button data-action="previous"${idx===0?' disabled':''}>${t('Previous item','الصنف السابق')}</button><div class="actions"><button data-action="skip">${t('Skip for now','تجاوز الآن')}</button><button class="primary" data-action="next">${idx===list.length-1?t('Review all batches','مراجعة جميع الدفعات'):t('Next item','الصنف التالي')}</button></div></div><div style="margin-top:1em">${statusLine()}</div></section>${nav()}</div>`+rules()+guide();
}
function reviewPage(){
 const p=progress(),all=allBatches(),missing=all.filter(b=>!counted(b.item,b));
 const row=(b,done)=>`<button class="reviewrow" data-item="${b.item.id}" data-focus-batch="${b.key}">${art(b.item)}<span class="body"><strong>${name(b.item)}</strong><span class="pack" style="display:block">${pack(b.item)}</span><span style="display:block;margin-top:.3em">${t('Expiry','الانتهاء')}: ${expiry(b)}</span>${done?`<span class="entered">${esc(entered(b.item,b))}</span>`:`<span class="badge wait">${t('Not counted','لم تُعدّ')}</span>`}</span>${done?`<span class="badge">${t('Edit','تعديل')}</span>`:''}</button>`;
 return head(t('Review your count','مراجعة الجرد'),t('Only your entered quantities are shown. Check each expiry before demo submission.','تظهر فقط الكميات التي أدخلتها. راجع كل تاريخ انتهاء قبل الإرسال التجريبي.'),`<button data-action="resume">${t('Continue counting','متابعة العد')}</button>`)+`<div class="panel tight"><strong>${batchProgressText(p.done,p.total)}</strong><progress class="progress" max="${p.total}" value="${p.done}" aria-label="${t('Batches counted','الدفعات المعدودة')}"></progress>${statusLine()}</div>${missing.length?`<section class="panel"><h2>${t('Still to count','باقٍ للعد')}: ${missing.length}</h2><p class="muted" style="font-size:.8em;margin-top:.5em">${t('Select a drawing to return to that batch. Blank is not zero.','اختر الرسم للعودة إلى الدفعة. الفراغ ليس صفرًا.')}</p>${missing.map(b=>row(b,false)).join('')}</section>`:`<p class="notice success">${t('Every batch has an explicit count. Review your entries below.','لكل دفعة كمية صريحة. راجع مدخلاتك أدناه.')}</p>`}<section class="panel"><div class="panelheader"><h2>${t('Your entered quantities','الكميات التي أدخلتها')}</h2><span class="muted" style="font-size:.78em">${t('Count date','تاريخ الجرد')}: ${expiry({date:draft.date})}</span></div>${all.filter(b=>counted(b.item,b)).map(b=>row(b,true)).join('')||`<p class="muted">${t('No quantities entered yet.','لم تُدخل كميات بعد.')}</p>`}</section><section class="panel stack"><p class="notice warning">${t('Simulation only. No stock count or monthly usage is changed.','محاكاة فقط. لا يُنشأ جرد ولا يتغيّر الاستهلاك الشهري.')}</p><label style="display:flex;align-items:center;gap:.7em"><input type="checkbox" id="review-confirm"${missing.length?' disabled':''}>${t('I reviewed the quantities I physically counted.','راجعت الكميات التي عددتها فعليًا.')}</label><p class="error-text" id="submit-reason">${missing.length?t(`Batches still to count: ${missing.length}. Complete them before submitting.`,`الدفعات المتبقية للعد: ${missing.length}. أكملها قبل الإرسال.`):t('Tick the review confirmation to enable demo submission.','أكّد المراجعة لتفعيل الإرسال التجريبي.')}</p><div class="actions"><button class="primary" id="submit-count" data-action="submit-count" disabled aria-describedby="submit-reason">${t('Submit count · demo only','إرسال الجرد · تجربة فقط')}</button><button data-action="pause">${t('Save & exit','حفظ وخروج')}</button></div></section>`+guide();
}
function countSuccess(){return head(t('Demo submission complete','اكتمل الإرسال التجريبي'),t('No real stock count was saved. Your browser draft remains available for review.','لم يُحفظ جرد فعلي. تظل مسودة المتصفح متاحة للمراجعة.'))+`<section class="panel stack"><div class="successmark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10"/></svg></div><h2>${t('You reached the end of the proposed flow','وصلت إلى نهاية المسار المقترح')}</h2><p>${t('This is a demonstration, not a server receipt. No store quantities or usage calculations have changed.','هذه تجربة وليست إيصالًا من الخادم. لم تتغيّر كميات المخزن أو حسابات الاستهلاك.')}</p><button data-action="review">${t('Back to entered values','العودة إلى المدخلات')}</button></section>`+guide();}
function tile(i,action='count'){return `<button class="tile" ${action==='dispose'?`data-dispose="${i.id}"`:`data-item="${i.id}"`}>${art(i)}<span class="name">${name(i)}</span><span class="pack">${pack(i)}</span><span class="badge">${t('View count batches','عرض دفعات الجرد')}</span></button>`;}
function shelfPage(){return head(t('Recognise your shelf','تعرّف إلى أصناف الرف'),t('The same drawings, shorter names and separate pack lines. Select any item to open its blind count. No stock quantities are shown.','الرسومات نفسها، وأسماء أقصر، ومعلومات العبوة في سطر منفصل. اختر صنفًا لفتح جرده الأعمى. لا تظهر كميات مخزون.'))+['Pantry','Protective'].map(cat=>`<section class="panel"><div class="panelheader"><h2>${category(cat)}</h2><span class="muted" style="font-size:.78em">${sorted().filter(i=>i.cat===cat).length} ${t('items','أصناف')}</span></div><div class="shelf">${sorted().filter(i=>i.cat===cat).map(i=>tile(i)).join('')}</div></section>`).join('')+`<p class="notice warning">${t('Label proposal: LIPTON / Red Label follows the recorded item name. Actual packaging spelling still needs confirmation. Unknown brands stay generic.','مقترح التسمية LIPTON / Red Label يتبع اسم الصنف المسجّل. ما زالت كتابة العبوة الفعلية بحاجة إلى تأكيد. تبقى العلامات غير المعروفة عامة.')}</p>`+guide();}
function itemsPage(){return head(addingItem?t('Add an item','إضافة صنف'):t('Store items','أصناف المخزن'),t('A drawing and a clear pack description accompany every item.','يرافق كل صنف رسم ووصف واضح للعبوة.'),`<button ${addingItem?'':'class="primary"'} data-action="toggle-add">${addingItem?t('Back to item list','العودة إلى قائمة الأصناف'):t('Add item','إضافة صنف')}</button>`)+(addingItem?addItemPage():`<section class="panel">${sorted().map(i=>`<div class="listrow">${art(i)}<div class="body"><span class="code" dir="ltr">${i.id}</span><h3>${name(i)}</h3><p class="pack">${pack(i)}</p><span class="badge">${category(i.cat)}</span></div><button data-item="${i.id}">${t('Count','عدّ')}</button></div>`).join('')}</section>`)+guide();}
function previewItem(){
 const known=itemPreview.contentsKnown&&validValue(itemPreview.contains)&&Number(itemPreview.contains)>0;
 const countUnit=NEW_UNITS[itemPreview.countUnit],looseUnit=NEW_UNITS[itemPreview.looseUnit];
 const enPack=known?`${itemPreview.contains} ${looseUnit[0]} / ${countUnit[0]}`:`${countUnit[0]} · contents not recorded`;
 const arPack=known?`${looseUnit[1]} في ${countUnit[1]}: ${itemPreview.contains}`:`${countUnit[1]} · المحتويات غير مسجّلة`;
 return {preview:true,en:itemPreview.en||'New item',ar:itemPreview.ar||'صنف جديد',kind:itemPreview.kind,color:itemPreview.color,label:[itemPreview.labelEn||'LABEL'],labelAr:[itemPreview.labelAr||'تسمية'],latin:false,pack:[enPack+(itemPreview.pack?' · '+itemPreview.pack:''),arPack+(itemPreview.pack?' · '+itemPreview.pack:'')],contains:known?Number(itemPreview.contains):undefined,unit:looseUnit,count:countUnit};
}
function addItemPage(){
 const options=(keys,selected)=>keys.map(key=>`<option value="${key}"${selected===key?' selected':''}>${NEW_UNITS[key][lang==='ar'?1:0]}</option>`).join('');
 const i=previewItem();
 return `<form class="panel stack" id="add-item-form"><div id="item-preview" class="preview">${art(i)}<div><h2>${name(i)}</h2><p class="pack">${pack(i)}</p></div></div>
 <div class="formgrid"><label>${t('Name · English','الاسم · إنجليزي')}<input required name="en" data-preview="en" value="${esc(itemPreview.en)}" dir="ltr" maxlength="128"></label><label>${t('Name · Arabic','الاسم · عربي')}<input required name="ar" data-preview="ar" value="${esc(itemPreview.ar)}" dir="rtl" maxlength="128"></label>
 <label>${t('Printed drawing label · English','تسمية الرسم · إنجليزي')}<input required name="labelEn" data-preview="labelEn" value="${esc(itemPreview.labelEn)}" dir="ltr" maxlength="18"><small>${t('Use the real brand. The print preview wraps long labels; the full name stays beside it.','استخدم العلامة الفعلية. يلتف نص الرسم الطويل ويبقى الاسم كاملًا بجانبه.')}</small></label><label>${t('Printed drawing label · Arabic','تسمية الرسم · عربي')}<input required name="labelAr" data-preview="labelAr" value="${esc(itemPreview.labelAr)}" dir="auto" maxlength="18"><small>${t('Keep brands in Latin; translate generic words.','أبقِ العلامة باللاتينية وترجم الكلمات العامة.')}</small></label>
 <label>${t('Category','الفئة')}<select name="category" data-preview="category">${['Pantry','Protective'].map(cat=>`<option value="${cat}"${itemPreview.category===cat?' selected':''}>${category(cat)}</option>`).join('')}</select></label><label>${t('Counting unit','وحدة العد')}<select name="unit" data-preview="countUnit">${options(['Carton','Packet','Box'],itemPreview.countUnit)}</select></label>
 <label class="span2" style="display:flex;align-items:center;gap:.6em"><input type="checkbox" data-preview="contentsKnown"${itemPreview.contentsKnown?' checked':''}>${t('Contents per counting unit are known','عدد المحتويات في وحدة العد معروف')}</label>
 ${itemPreview.contentsKnown?`<label>${t('Units inside one carton / counting unit','عدد الوحدات داخل كرتون / وحدة عد واحدة')}<input required data-preview="contains" type="text" inputmode="numeric" value="${esc(itemPreview.contains)}" pattern="[0-9]+"><small>${t('A positive whole number, only when verified.','عدد صحيح موجب، عند التحقق منه فقط.')}</small></label><label>${t('Loose-unit name','اسم الوحدة المفردة')}<select data-preview="looseUnit">${options(['Jar','Box','Tin','Sleeve','Packet','Piece'],itemPreview.looseUnit)}</select></label>`:`<p class="notice span2">${t('Unknown contents: count in the selected unit only. No loose-unit conversion will be assumed.','محتويات غير معروفة: العد بالوحدة المختارة فقط، دون افتراض تحويل للوحدات المفردة.')}</p>`}
 <label class="span2">${t('Pack description, if known','وصف العبوة، إن كان معروفًا')}<input data-preview="pack" value="${esc(itemPreview.pack)}" placeholder="${t('Size / weight, if recorded','الحجم / الوزن، إن كان مسجّلًا')}" maxlength="150"></label></div>
 <fieldset style="border:0;padding:0;margin:0"><legend style="font-size:.86em;font-weight:600;margin-bottom:.65em">${t('Drawing kind','نوع الرسم')}</legend><div class="drawingpicker">${KINDS.map(k=>`<button type="button" data-kind="${k}" aria-pressed="${itemPreview.kind===k}">${art({...i,kind:k})}<span>${t(({carton:'Carton',jar:'Jar',canister:'Canister',box:'Box',tins:'Tins',water:'Water',cups:'Cups',bigcups:'Large cups',tissue:'Tissues',gloves:'Gloves',mask:'Mask'})[k],({carton:'كرتون',jar:'مرطبان',canister:'عبوة',box:'علبة',tins:'علب معدنية',water:'مياه',cups:'أكواب',bigcups:'أكواب كبيرة',tissue:'مناديل',gloves:'قفازات',mask:'كمامة'})[k])}</span></button>`).join('')}</div></fieldset>
 <label>${t('Drawing colour','لون الرسم')}<input type="color" data-preview="color" value="${itemPreview.color}"></label><p class="notice warning">${t('Custom picture upload remains undecided. This drawing-only preview does not decide the upload policy.','رفع صورة مخصّصة غير محسوم. معاينة الرسم لا تحسم سياسة رفع الصور.')}</p><p class="notice">${t('Demo preview only: no item or official code is created. Contents entered here do not modify any real item.','معاينة تجريبية فقط: لا يُنشأ صنف أو رمز رسمي، ولا تتغيّر محتويات أي صنف فعلي.')}</p><p role="status" id="item-result">${itemMessage}</p><button class="primary" type="submit">${t('Preview add item · demo only','معاينة إضافة الصنف · تجربة فقط')}</button></form>`;
}
function picker(selected,attr){return `<div class="picker">${sorted().map(i=>`<button type="button" ${attr}="${i.id}" aria-pressed="${selected?.id===i.id}">${art(i)}<span>${name(i)}</span><small>${pack(i)}</small></button>`).join('')}</div>`;}
function deliveryOptions(selected=''){return `<option value="">${t('Match an item…','اختر صنفًا مطابقًا…')}</option>${sorted().map(i=>`<option value="${i.id}"${selected===i.id?' selected':''}>${esc(lang==='ar'?i.ar:i.en)} · ${i.id}</option>`).join('')}`;}
function deliveryInput(line,n){
 const i=byId(line.item);
 if(line.skipped)return `<section class="deliveryline"><span class="badge wait">${t('Skipped · not included in demo submission','متجاوز · لا يُدرج في الإرسال التجريبي')}</span><p dir="auto">${esc(line.source?.raw||t('Manual line','سطر يدوي'))}</p>${i?`<div class="lineidentity">${art(i)}<strong>${name(i)}</strong></div>`:''}<button type="button" data-restore-line="${n}">${t('Restore this line','استعادة السطر')}</button></section>`;
 const source=line.source;
 const noted=source?`${t('Counting units on synthetic note','وحدات العد في المستند المصطنع')} (${NEW_UNITS[source.count]?.[lang==='ar'?1:0]||source.count}): ${source.full}${source.unit?` · ${t('Loose','مفرد')} (${NEW_UNITS[source.unit]?.[lang==='ar'?1:0]||source.unit}): ${source.loose}`:''}`:'';
 const mismatch=deliveryDiscrepancy(line);
 return `<section class="deliveryline${line.confirmed?' confirmed':''}" data-line="${n}">
 <div class="lineidentity">${i?art(i):art({kind:'carton',color:'#b48e55',label:['MATCH'],labelAr:['مطابقة']})}<div><h3>${i?name(i):t('Unmatched note line','سطر غير مطابق من المستند')}</h3>${i?`<p class="pack">${pack(i)}</p>`:`<p class="notice warning">${t('Read the raw source text below, then choose the correct item by its drawing.','اقرأ النص الخام أدناه ثم اختر الصنف الصحيح برسمه.')}</p>`}<span class="badge ${line.confirmed?'done':'wait'}">${line.confirmed?t('Explicitly confirmed','تم التأكيد الصريح'):t('Needs your confirmation','بانتظار تأكيدك')}</span></div></div>
 ${source?`<div class="notice warning tight"><strong>${t('Synthetic OCR fixture · not read from your attachment','مثال OCR مصطنع · لم يُقرأ من مرفقك')}</strong><span>${t('Raw source text','النص الخام للمصدر')}: <bdi dir="ltr">${esc(source.raw)}</bdi></span><span>${isolated(noted)}</span></div>`:`<p class="muted">${t('Manual line: no OCR source or noted quantity is available.','سطر يدوي: لا يوجد مصدر OCR أو كمية مقروءة من المستند.')}</p>`}
 ${line.confirmed?`<div class="tight" style="margin-top:1em"><strong>${t('Actually received','المستلم فعليًا')}</strong><p>${isolated(numberSummary(i,line.full,line.loose))}</p><p>${t('Expiry','الانتهاء')}: ${expiry({date:line.expiry,month:line.month})}</p>${line.reason?`<p>${t('Discrepancy reason','سبب الفرق')}: ${esc(line.reason)}</p>`:''}<div class="actions"><button type="button" data-edit-line="${n}">${t('Edit line','تعديل السطر')}</button><button type="button" data-skip-line="${n}">${t('Skip line','تجاوز السطر')}</button></div></div>`:
 `<div class="stack" style="margin-top:1em"><details${!i?' open':''}><summary>${t('Match item by drawing','مطابقة الصنف بالرسم')}</summary><div class="picker">${sorted().map(candidate=>`<button type="button" data-match-line="${n}" data-match-item="${candidate.id}" aria-pressed="${line.item===candidate.id}">${art(candidate)}<span>${name(candidate)}</span><small>${pack(candidate)}</small></button>`).join('')}</div></details><label>${t('Item match · keyboard selection','مطابقة الصنف · اختيار بلوحة المفاتيح')}<select data-delivery-field="item" data-n="${n}">${deliveryOptions(line.item)}</select></label><h3>${t('Actually received · enter your checked quantity','المستلم فعليًا · أدخل الكمية بعد التحقق')}</h3><p class="muted" style="font-size:.8em">${t('These fields stay blank until you type. Source-note quantities are not copied into received quantities.','تبقى هذه الحقول فارغة حتى تكتب فيها. لا تُنسخ كميات المستند إلى الكميات المستلمة.')}</p><div class="formgrid"><label>${t('Expiry format','صيغة الانتهاء')}<select data-delivery-field="mode" data-n="${n}"><option value="date"${line.mode==='date'?' selected':''}>${t('Exact date','تاريخ كامل')}</option><option value="month"${line.mode==='month'?' selected':''}>${t('Month only','شهر فقط')}</option><option value="undated"${line.mode==='undated'?' selected':''}>${t('Undated','بلا تاريخ')}</option></select></label>${line.mode!=='undated'?`<label>${t('Expiry','الانتهاء')}<input type="${line.mode}" data-delivery-field="expiryInput" data-n="${n}" value="${esc(line.expiryInput)}" required></label>`:`<p class="muted">${t('Undated batch selected','تم اختيار دفعة بلا تاريخ')}</p>`}<label>${i?.contains?t('Full cartons','كراتين كاملة'):t('Quantity','الكمية')+(i?' · '+esc(unit(i)):'')}<input type="text" inputmode="numeric" data-delivery-field="full" data-n="${n}" value="${esc(line.full)}"></label>${i?.contains?`<label>${t('Loose','مفرد')}: ${esc(loose(i))}<input type="text" inputmode="numeric" data-delivery-field="loose" data-n="${n}" value="${esc(line.loose)}"></label>`:''}<label class="span2">${t('Discrepancy / correction reason','سبب الفرق / التصحيح')}<textarea data-delivery-field="reason" data-n="${n}" rows="2" aria-describedby="difference-${n}">${esc(line.reason)}</textarea><small id="difference-${n}" data-difference="${n}">${mismatch?t('Required: received quantity or units differ from the synthetic note.','مطلوب: الكمية أو الوحدة المستلمة تختلف عن المستند المصطنع.'):t('Required if the received quantity or units differ from the note.','مطلوب إذا اختلفت الكمية أو الوحدة المستلمة عن المستند.')}</small></label></div><div class="actions"><button type="button" data-confirm-line="${n}">${t('Confirm this line','تأكيد هذا السطر')}</button><button type="button" data-skip-line="${n}">${t('Skip line · can restore','تجاوز السطر · يمكن استعادته')}</button></div></div>`}</section>`;
}
function blankLine(item=''){
 return {item,mode:'undated',expiryInput:'',expiry:null,month:false,full:'',loose:'',confirmed:false,skipped:false,reason:'',source:null};
}
function deliveryPage(){
 const retained=deliveryLines.filter(line=>!line.skipped);
 const attachment=attachedFile?`<div class="stack"><p class="notice">${t('Note attached in this tab: ','المستند مرفق في هذه الصفحة: ')}${esc(attachedFile.name)} <a href="${attachmentURL}" target="_blank" rel="noopener">${t('Open selected note','فتح المستند المختار')}</a></p><details><summary>${t('View selected note for comparison','عرض المستند المختار للمقارنة')}</summary><p class="muted">${t('Actual local attachment preview. No OCR or line-specific crop was generated.','معاينة المرفق المحلي الفعلي. لم يُنشأ OCR أو اقتصاص خاص بالأسطر.')}</p>${attachedFile.type==='application/pdf'?`<iframe title="${t('Selected delivery note PDF preview','معاينة PDF لمستند التوريد المختار')}" src="${attachmentURL}" style="width:100%;height:22em;border:1px solid var(--border)"></iframe>`:`<img src="${attachmentURL}" alt="${t('Selected delivery note — actual local attachment','مستند التوريد المختار — المرفق المحلي الفعلي')}" style="display:block;width:100%;max-height:24em;object-fit:contain;background:var(--raised)">`}</details></div>`:`<p class="notice warning">${t('No note attached. You may select a note on the previous screen or continue manually.','لا يوجد مستند مرفق. يمكنك اختيار مستند من الشاشة السابقة أو المتابعة يدويًا.')}</p>`;
 return head(t('Receive a monthly delivery','استلام التوريد الشهري'),t('Attach the HQ note once, then review and confirm every retained line.','أرفق مستند المقر مرة واحدة، ثم راجع وأكّد كل سطر غير متجاوز.'))+
 (deliveryStage==='upload'?`<section class="panel stack"><h2>${t('Delivery note','مستند التوريد')}</h2><div class="scanarea stack"><label>${t('Scan or select a note','تصوير أو اختيار مستند')}<input id="delivery-file" type="file" accept="image/*,application/pdf" capture="environment"></label><p class="muted" style="font-size:.8em">${t('PDF or image · maximum 10 MiB · stays in this tab only','PDF أو صورة · بحد أقصى 10 ميبيبايت · تبقى في هذه الصفحة فقط')}</p><p id="file-status">${attachedFile?esc(attachedFile.name):t('No note selected','لم يُحدّد مستند')}</p><div class="actions"><button class="primary" data-action="scan-demo">${t('Load synthetic OCR example','تحميل مثال OCR مصطنع')}</button><button data-action="manual-delivery">${t('OCR unavailable · enter manually','OCR غير متاح · إدخال يدوي')}</button></div></div>${attachedFile?attachment:''}<p class="notice warning">${t('No OCR runs here. The example has explicitly synthetic raw text and noted quantities, unrelated to your selected file. Actual received quantities always start blank.','لا يُشغّل OCR هنا. يحتوي المثال على نص خام وكميات مصطنعة، لا علاقة لها بملفك المختار. تبدأ الكميات المستلمة الفعلية فارغة دائمًا.')}</p></section>`:
 `<section class="panel stack"><div class="panelheader"><h2>${deliveryStage==='manual'?t('Manual entry · OCR unavailable','إدخال يدوي · OCR غير متاح'):t('Compare, correct, then confirm','قارن وصحّح ثم أكّد')}</h2><button data-action="delivery-upload">${t('Back to note','العودة إلى المستند')}</button></div>${attachment}<p class="notice warning">${t('Simulation only. Synthetic source-note amounts are not store balances, and never enter the blind count. The attachment stays while editing but disappears on reload.','محاكاة فقط. كميات المستند المصطنع ليست أرصدة مخزون ولا تدخل في الجرد الأعمى. يبقى المرفق أثناء التعديل ويختفي عند إعادة التحميل.')}</p><label>${t('Received date','تاريخ الاستلام')}<input type="date" id="received-date" value="${deliveryDate}" required max="${today()}"></label><p class="muted" style="font-size:.8em">${t('Selected received date','تاريخ الاستلام المختار')}: <span id="received-date-echo">${expiry({date:deliveryDate})}</span></p><div>${deliveryLines.map(deliveryInput).join('')||`<p class="muted">${t('No lines yet. Add an item below.','لا توجد أسطر. أضف صنفًا أدناه.')}</p>`}</div><button data-action="add-delivery-line">${t('Add an item line','إضافة سطر صنف')}</button><label>${t('Delivery note / correction note','ملاحظة التوريد / التصحيح')}<textarea id="delivery-note" rows="2" placeholder="${t('Optional note','ملاحظة اختيارية')}">${esc(deliveryNote)}</textarea></label><p id="delivery-result" role="status">${esc(deliveryMessage)}</p><p class="muted" style="font-size:.78em">${t('Every retained line needs explicit confirmation. Skipped source lines remain visible and can be restored; at least one retained line is required.','كل سطر غير متجاوز يحتاج تأكيدًا صريحًا. تبقى الأسطر المتجاوزة ظاهرة ويمكن استعادتها؛ يلزم سطر واحد غير متجاوز على الأقل.')}</p><button class="primary" data-action="submit-delivery"${!retained.length||retained.some(line=>!line.confirmed)?' disabled':''}>${t('Confirm delivery · demo only','تأكيد التوريد · تجربة فقط')}</button></section>`)+guide();
}
function disposalPage(){
 const i=disposalItem;
 return head(t('Record a disposal','تسجيل إتلاف'),t('Select the drawing, choose its expiry batch, then enter quantity and reason.','اختر الرسم ثم دفعة الانتهاء، وأدخل الكمية والسبب.'))+(!i?`<section class="panel stack"><h2>${t('Choose an item','اختر صنفًا')}</h2>${picker(null,'data-dispose')}</section>`:`<form id="disposal-form" class="panel stack"><div class="focusitem">${art(i)}<div><h2>${name(i)}</h2><p class="pack">${pack(i)}</p><button type="button" class="quiet" data-action="change-disposal">${t('Choose another item','اختيار صنف آخر')}</button></div></div><label>${t('Expiry batch','دفعة الانتهاء')}<select name="batch" required><option value="">${t('Choose a batch…','اختر دفعة…')}</option>${sourceBatches(i).map(b=>`<option value="${b.key}">${b.date?b.date.split('-').reverse().join('/')+(b.month?t(' · month end',' · نهاية الشهر'):''):t('Undated batch','دفعة بلا تاريخ انتهاء')}</option>`).join('')}</select></label><label>${t('Disposal date','تاريخ الإتلاف')}<input type="date" name="date" value="${today()}" required max="${today()}"></label><div class="formgrid"><label>${i.contains?t('Full cartons','كراتين كاملة'):t('Quantity','الكمية')+' · '+esc(unit(i))}<input name="full" data-normalize-number type="text" inputmode="numeric" pattern="[0-9]+" required></label>${i.contains?`<label>${t('Loose','مفرد')}: ${esc(loose(i))}<input name="loose" data-normalize-number type="text" inputmode="numeric" pattern="[0-9]+" required></label>`:''}<label>${t('Reason','السبب')}<select name="reason" required><option value="">${t('Select a reason…','اختر السبب…')}</option><option value="expired">${t('Expired','منتهي الصلاحية')}</option><option value="damaged">${t('Damaged','تالف')}</option></select></label><label>${t('Note, optional','ملاحظة اختيارية')}<textarea name="note" rows="2"></textarea></label></div><p class="notice">${t('Source batches only; newly added count-draft batches are not recorded batches. No real availability check or disposal is performed.','الدفعات الأصلية فقط؛ الدفعات المضافة لمسودة الجرد ليست دفعات مسجّلة. لا يُنفّذ تحقق فعلي من التوفر أو إتلاف.')}</p><div id="disposal-result" role="status">${disposalMessage}</div><button class="primary" type="submit">${t('Review disposal · demo only','مراجعة الإتلاف · تجربة فقط')}</button></form>`)+guide();
}
function homePage(){return head(t('Home Dashboard reference','مرجع لوحة الرئيسية'),t('Visual comparison only: WidgetFrame-like rounded cards, hairline borders, em-scaled labels and the same store drawings. No operational metrics are invented.','مقارنة بصرية فقط: بطاقات مستديرة وحدود رفيعة وتسميات متناسبة مع الخط ورسومات المخزن نفسها. لا توجد مقاييس تشغيلية مخترعة.'))+`<div class="columns"><section class="widget"><h2>${t('Store · expiry review','المخزن · مراجعة الانتهاء')}</h2><div class="listrow">${art(ITEMS[1])}<div class="body"><h3>${name(ITEMS[1])}</h3><p>${pack(ITEMS[1])}</p></div></div><p>${t('Illustrative item placement only. Live expiry status is not calculated in this prototype.','موضع توضيحي للصنف فقط. لا تُحسب حالة الانتهاء الفعلية في النموذج.')}</p><button class="quiet" data-screen="shelf">${t('View store','عرض المخزن')}</button></section><section class="widget"><h2>${t('Store · item reference','المخزن · مرجع الصنف')}</h2><div class="listrow">${art(ITEMS[10])}<div class="body"><h3>${name(ITEMS[10])}</h3><p>${pack(ITEMS[10])}</p></div></div><p>${t('No low-stock count or quantity is implied. Drawings accompany names in home widgets too.','لا تُفترض كمية أو حالة انخفاض للمخزون. ترافق الرسومات الأسماء في أدوات الرئيسية أيضًا.')}</p><button class="quiet" data-screen="items">${t('View items','عرض الأصناف')}</button></section></div><section class="panel stack"><h2>${t('Drawing-led item picker','اختيار الأصناف بالرسم')}</h2><p class="muted" style="font-size:.82em">${t('Illustrative picker: selecting an item opens its blind count.','اختيار توضيحي: الضغط على الصنف يفتح جرده الأعمى.')}</p>${picker(null,'data-item')}</section>`+guide();}
function render(focus=false){
 const receivedInput=$('#received-date'),noteInput=$('#delivery-note');
 if(receivedInput)deliveryDate=receivedInput.value;
 if(noteInput)deliveryNote=noteInput.value;
 document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.documentElement.dataset.theme=theme;
 document.title=t('Store count · Approval prototype','جرد المخزن · نموذج للموافقة');updateURL();
 const content=screen==='count'?(step==='count'?countPage():step==='review'?reviewPage():step==='success'?countSuccess():startPage(step==='paused')):screen==='shelf'?shelfPage():screen==='items'?itemsPage():screen==='deliveries'?deliveryPage():screen==='disposals'?disposalPage():homePage();
 $('#app').innerHTML=header()+`<main id="main" class="wrap page" aria-labelledby="page-title">${content}</main>`;
 if(screen==='deliveries'&&deliveryStage!=='upload'){$('#received-date').value=deliveryDate;$('#delivery-note').value=deliveryNote;}
 fitDrawingLabels();
 if(focus){$('#page-title')?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
}
function updateCountUI(){
 const p=progress();
 document.querySelectorAll('[data-progress]').forEach(el=>el.textContent=batchProgressText(p.done,p.total));
 document.querySelectorAll('[data-progressbar]').forEach(el=>{el.value=p.done;el.max=p.total;});
 const i=byId(itemId);batches(i).forEach(b=>{const badge=document.querySelector(`[data-badge="${b.key}"]`);if(badge){badge.textContent=counted(i,b)?t('Counted','تم العد'):t('Not counted','لم تُعدّ');badge.className=`badge ${counted(i,b)?'done':'wait'}`;document.getElementById(`summary-${b.key}`).textContent=entered(i,b);}});
 document.querySelectorAll('[data-batch]').forEach(input=>input.setAttribute('aria-invalid',String(input.value!==''&&!validValue(input.value))));
 const aside=$('.sidenav');if(aside)aside.outerHTML=nav();
 fitDrawingLabels();
}
function openItem(id,key){itemId=id;screen='count';step='count';draft.started=true;save();render(true);if(key){const batch=document.getElementById(`batch-${key}`);batch?.scrollIntoView({block:'center'});batch?.querySelector('input')?.focus({preventScroll:true});}}
function moveItem(delta){const list=sorted(),idx=list.findIndex(i=>i.id===itemId);if(idx+delta>=list.length){step='review';save();render(true);}else if(idx+delta>=0){itemId=list[idx+delta].id;save();render(true);}}
function scanExample(){
 // Entire fixture is synthetic; it is never represented as OCR of the operator's selected file.
 deliveryLines=[
  {...blankLine(ITEMS[0].id),mode:'date',expiryInput:'2027-10-01',source:{raw:'NESCAFE CLASSIC 12x190g | CTN 4 | EXP 01/10/2027',full:'4',loose:'0',count:'Carton',unit:'Jar'}},
  {...blankLine(ITEMS[2].id),mode:'month',expiryInput:'2028-09',source:{raw:'LIPTON YELLOW LABEL 24x400g | CTN 2 | EXP 09/2028',full:'2',loose:'0',count:'Carton',unit:'Box'}},
  {...blankLine(),source:{raw:'MISC CUP PKT ? | CTN 1 | EXP NOT PRINTED',full:'1',loose:'0',count:'Carton',unit:null}}
 ];
}
if(screen==='deliveries'&&deliveryStage==='confirm')scanExample();
if(screen==='deliveries'&&deliveryStage==='manual')deliveryLines=[blankLine()];
// Deep links preview screens without populating count fields or simulating a successful save.
render();
function fitDrawingLabels(){
 document.querySelectorAll('svg text[data-max-width]').forEach(text=>{
  const base=Number(text.dataset.baseFont),max=Number(text.dataset.maxWidth);
  text.setAttribute('font-size',String(base));
  const measured=text.getComputedTextLength();
  if(measured>max)text.setAttribute('font-size',String(base*max/measured));
 });
}
function refreshItemPreview(){
 const i=previewItem(),preview=$('#item-preview');
 if(preview)preview.innerHTML=`${art(i)}<div><h2>${name(i)}</h2><p class="pack">${pack(i)}</p><p class="pack">${category(itemPreview.category)}</p></div>`;
 fitDrawingLabels();
}
function deliveryDiscrepancy(line){
 if(!line.source||!byId(line.item)||!validValue(line.full))return false;
 const i=byId(line.item),source=line.source;
 return i.count[0]!==source.count||Number(line.full)!==Number(source.full)||(i.contains&&(Number(line.loose)!==Number(source.loose)||(source.unit&&i.unit[0]!==source.unit)));
}
function confirmDeliveryLine(n){
 const line=deliveryLines[n],i=byId(line.item);
 if(!i){toast(t('Match this line to an item first.','طابق السطر بصنف أولًا.'));return;}
 if(!validValue(line.full)||(i.contains&&!validValue(line.loose))||Number(line.full)+(i.contains?Number(line.loose):0)<=0){toast(t('Enter a whole quantity greater than zero. Fill both quantity fields, including explicit zero.','أدخل كمية صحيحة أكبر من صفر. املأ حقلي الكمية، بما في ذلك الصفر الصريح.'));return;}
 const expiryInput=$(`[data-line="${n}"] input[data-delivery-field="expiryInput"]`);
 if(line.mode!=='undated'&&(!line.expiryInput||!expiryInput?.reportValidity())){toast(t('Enter the printed expiry, or explicitly choose undated.','أدخل الانتهاء المطبوع أو اختر بلا تاريخ صراحةً.'));return;}
 if(line.mode==='month'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(line.expiryInput)){toast(t('Enter the expiry month as YYYY-MM, for example 2028-09.','أدخل شهر الانتهاء بصيغة YYYY-MM، مثل 2028-09.'));return;}
 if(deliveryDiscrepancy(line)&&!line.reason.trim()){toast(t('Explain why the received quantity or units differ from the note before confirming.','وضّح سبب اختلاف الكمية أو الوحدة المستلمة عن المستند قبل التأكيد.'));$(`[data-line="${n}"] textarea[data-delivery-field="reason"]`)?.focus();return;}
 line.expiry=line.mode==='undated'?null:normalize(line.expiryInput);line.month=line.mode==='month';line.confirmed=true;deliveryMessage='';render();
}
document.addEventListener('input',event=>{
 const el=event.target;
 if(el.matches('[data-batch]')){
  el.value=normalizeDigits(el.value);const key=el.dataset.batch;draft.values[key]??={full:'',loose:''};draft.values[key][el.dataset.field]=el.value;draft.started=true;unsavedEntries=true;save();updateCountUI();
 }
 if(el.matches('[data-normalize-number]'))el.value=normalizeDigits(el.value);
 if(el.matches('[data-preview]')&&el.type!=='checkbox'){
  const field=el.dataset.preview;if(field==='contains')el.value=normalizeDigits(el.value);itemPreview[field]=el.value;refreshItemPreview();
 }
 if(el.matches('[data-delivery-field]')&&!['item','mode'].includes(el.dataset.deliveryField)){
  const line=deliveryLines[Number(el.dataset.n)],field=el.dataset.deliveryField;
  if(['full','loose'].includes(field))el.value=normalizeDigits(el.value);
  line[field]=el.value;line.confirmed=false;deliveryMessage='';
  const difference=$(`[data-difference="${el.dataset.n}"]`);
  if(difference)difference.textContent=deliveryDiscrepancy(line)?t('Required: received quantity or units differ from the synthetic note.','مطلوب: الكمية أو الوحدة المستلمة تختلف عن المستند المصطنع.'):t('Required if the received quantity or units differ from the note.','مطلوب إذا اختلفت الكمية أو الوحدة المستلمة عن المستند.');
 }
 if(el.id==='count-date')$('#chosen-date').innerHTML=expiry({date:el.value});
 if(el.id==='received-date'){
  deliveryDate=el.value;$('#received-date-echo').innerHTML=expiry({date:deliveryDate});
 }
});
document.addEventListener('change',event=>{
 const el=event.target;
 if(el.classList.contains('mobile-pages')){screen=el.value;render(true);return;}
 if(el.id==='review-confirm'){
  const enabled=el.checked&&progress().done===progress().total;$('#submit-count').disabled=!enabled;
  $('#submit-reason').textContent=enabled?t('Ready for demo submission. No real records will be saved.','جاهز للإرسال التجريبي. لن تُحفظ سجلات فعلية.'):t('Tick the review confirmation to enable demo submission.','أكّد المراجعة لتفعيل الإرسال التجريبي.');
 }
 if(el.matches('[data-preview]')){
  itemPreview[el.dataset.preview]=el.type==='checkbox'?el.checked:el.value;
  if(el.dataset.preview==='contentsKnown')render();else refreshItemPreview();
 }
 if(el.id==='expiry-type'){
  const mode=el.value;$('#expiry-input-label').hidden=mode==='undated';$('#new-expiry').required=mode!=='undated';if(mode!=='undated')$('#new-expiry').type=mode;
 }
 if(el.id==='delivery-file'){
  const file=el.files[0];if(!file)return;
  if(file.size>10*1024*1024){toast(t('Choose a note smaller than 10 MiB.','اختر مستندًا أصغر من 10 ميبيبايت.'));el.value='';return;}
  if(attachmentURL)URL.revokeObjectURL(attachmentURL);attachedFile=file;attachmentURL=URL.createObjectURL(file);render();
 }
 if(el.matches('[data-delivery-field="item"],[data-delivery-field="mode"]')){
  const line=deliveryLines[Number(el.dataset.n)];line[el.dataset.deliveryField]=el.value;
  if(el.dataset.deliveryField==='mode'){line.expiryInput='';line.expiry=null;}line.confirmed=false;deliveryMessage='';render();
 }
});
document.addEventListener('submit',event=>{
 event.preventDefault();const form=event.target;
 if(form.id==='start-form'){
  if(draft.date!==$('#count-date').value)unsavedEntries=true;
  draft.date=$('#count-date').value;draft.started=true;step='count';save();render(true);
 }
 if(form.id==='new-batch-form'){
  const i=byId(itemId),mode=$('#expiry-type').value,raw=mode==='undated'?null:$('#new-expiry').value,date=normalize(raw);if(mode!=='undated'&&!raw)return;
  if(mode==='month'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)){$('#batch-error').textContent=t('Enter the expiry month as YYYY-MM, for example 2028-09.','أدخل شهر الانتهاء بصيغة YYYY-MM، مثل 2028-09.');return;}
  const existing=batches(i).find(b=>b.date===date);
  if(existing){toast(t('This expiry already has a batch. Enter its count there.','توجد دفعة بهذا الانتهاء. أدخل عدّها هناك.'));render();document.getElementById(`batch-${existing.key}`)?.scrollIntoView({block:'center'});document.getElementById(`count-${existing.key}-full`)?.focus();return;}
  const b={key:`${i.id}:added-${Date.now()}`,date,month:mode==='month'};(draft.extra[i.id]??=[]).push(b);unsavedEntries=true;save();render();document.getElementById(`batch-${b.key}`)?.scrollIntoView({block:'center'});document.getElementById(`count-${b.key}-full`)?.focus();
 }
 if(form.id==='add-item-form'){
  if(itemPreview.contentsKnown&&(!validValue(itemPreview.contains)||Number(itemPreview.contains)<=0)){itemMessage=t('Enter verified positive whole-number contents, or leave contents unknown.','أدخل عدد محتويات صحيحًا موجبًا ومؤكدًا، أو اترك المحتويات غير معروفة.');$('#item-result').textContent=itemMessage;return;}
  itemMessage=t('Demo preview complete. No item was created. Drawing, category, counting unit and verified contents are shown above.','اكتملت المعاينة التجريبية. لم يُنشأ صنف. يظهر الرسم والفئة ووحدة العد والمحتويات المؤكدة أعلاه.');$('#item-result').textContent=itemMessage;toast(itemMessage);
 }
 if(form.id==='disposal-form'){
  const data=new FormData(form),i=disposalItem,full=normalizeDigits(data.get('full')||''),looseValue=i.contains?normalizeDigits(data.get('loose')||''):'0';
  if(!validValue(full)||!validValue(looseValue)||Number(full)+(i.contains?Number(looseValue):0)<=0){$('#disposal-result').textContent=t('Enter a whole quantity greater than zero.','أدخل كمية صحيحة أكبر من صفر.');return;}
  const b=sourceBatches(i).find(batch=>batch.key===data.get('batch'));if(!b)return;
  disposalMessage=`<div class="notice tight"><strong>${t('Demo review only — no disposal saved.','مراجعة تجريبية فقط — لم يُحفظ إتلاف.')}</strong><span>${name(i)}</span><span>${t('Expiry','الانتهاء')}: ${expiry(b)}</span><span>${isolated(numberSummary(i,full,looseValue))}</span><span>${t('Disposal date','تاريخ الإتلاف')}: ${expiry({date:String(data.get('date'))})}</span><span>${t('Reason','السبب')}: ${data.get('reason')==='expired'?t('Expired','منتهي الصلاحية'):t('Damaged','تالف')}</span></div>`;
  $('#disposal-result').innerHTML=disposalMessage;toast(t('Demo only. No disposal recorded.','تجربة فقط. لم يُسجّل إتلاف.'));
 }
});
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.dataset.screen){screen=button.dataset.screen;render(true);return;}
 if(button.dataset.item){openItem(button.dataset.item,button.dataset.focusBatch);return;}
 if(button.dataset.dispose){disposalItem=byId(button.dataset.dispose);disposalMessage='';render(true);return;}
 if(button.dataset.zero){
  const key=button.dataset.zero;draft.values[key]={full:'0',loose:'0'};draft.started=true;unsavedEntries=true;save();
  document.querySelectorAll('[data-batch]').forEach(el=>{if(el.dataset.batch===key)el.value='0';});updateCountUI();toast(t('Explicit zero entered for this batch.','أُدخل صفر صريح لهذه الدفعة.'));return;
 }
 if(button.dataset.removeBatch){
  const i=byId(itemId),key=button.dataset.removeBatch;
  if(!(draft.extra[i.id]||[]).some(b=>b.key===key))return;
  if(!confirm(t('Remove this added draft batch and its typed count? Original batches cannot be removed.','هل تريد إزالة الدفعة المضافة وعدّها المكتوب؟ لا يمكن إزالة الدفعات الأصلية.')))return;
  draft.extra[i.id]=draft.extra[i.id].filter(b=>b.key!==key);delete draft.values[key];unsavedEntries=true;save();render();return;
 }
 if(button.dataset.kind){itemPreview.kind=button.dataset.kind;render();return;}
 if(button.dataset.matchLine!==undefined){const line=deliveryLines[Number(button.dataset.matchLine)];line.item=button.dataset.matchItem;line.confirmed=false;deliveryMessage='';render();return;}
 if(button.dataset.confirmLine!==undefined){confirmDeliveryLine(Number(button.dataset.confirmLine));return;}
 if(button.dataset.editLine!==undefined){deliveryLines[Number(button.dataset.editLine)].confirmed=false;deliveryMessage='';render();return;}
 if(button.dataset.skipLine!==undefined){const line=deliveryLines[Number(button.dataset.skipLine)];line.skipped=true;line.confirmed=false;deliveryMessage='';render();return;}
 if(button.dataset.restoreLine!==undefined){const line=deliveryLines[Number(button.dataset.restoreLine)];line.skipped=false;line.confirmed=false;deliveryMessage='';render();return;}
 switch(button.dataset.action){
  case'lang':lang=lang==='en'?'ar':'en';render();break;
  case'theme':theme=theme==='light'?'dark':'light';render();break;
  case'next':case'skip':moveItem(1);break;
  case'previous':moveItem(-1);break;
  case'review':screen='count';step='review';save();render(true);break;
  case'resume':step='count';save();render(true);break;
  case'pause':save();if(storageFailed){toast(t('Cannot save & exit: browser draft saving failed. Keep this page open.','تعذّر الحفظ والخروج: لم تُحفظ المسودة. أبقِ الصفحة مفتوحة.'));return;}step='paused';render(true);break;
  case'submit-count':if(progress().done===progress().total&&$('#review-confirm')?.checked){step='success';render(true);}break;
  case'reset':if(confirm(t('Clear only this prototype’s count draft?','هل تريد مسح مسودة الجرد التجريبية فقط؟'))){try{localStorage.removeItem(KEY);draft={started:false,date:today(),values:{},extra:{},item:'ST-0001'};draftLoaded=false;unsavedEntries=false;itemId='ST-0001';step='start';screen='count';storageFailed=false;render(true);}catch{toast(t('The browser could not clear the saved draft.','تعذّر مسح المسودة المحفوظة.'));}}break;
  case'storage':saveFailed=!saveFailed;save();render();break;
  case'toggle-add':addingItem=!addingItem;render(true);break;
  case'scan-demo':if(!attachedFile){toast(t('Attach a note first, or use manual entry.','أرفق مستندًا أولًا، أو استخدم الإدخال اليدوي.'));return;}scanExample();deliveryStage='confirm';deliveryMessage='';render(true);break;
  case'manual-delivery':deliveryStage='manual';deliveryLines=[blankLine()];deliveryMessage='';render(true);break;
  case'delivery-upload':deliveryStage='upload';render(true);break;
  case'add-delivery-line':deliveryLines.push(blankLine());deliveryMessage='';render();break;
  case'submit-delivery':{
   const retained=deliveryLines.filter(line=>!line.skipped);
   if(retained.length&&retained.every(line=>line.confirmed)){
    if(!$('#received-date').reportValidity())return;
    deliveryMessage=t('Demo confirmation complete. No delivery was saved and no note was uploaded to a server.','اكتمل التأكيد التجريبي. لم يُحفظ توريد ولم يُرفع المستند إلى خادم.');$('#delivery-result').textContent=deliveryMessage;toast(deliveryMessage);
   }break;
  }
  case'change-disposal':disposalItem=null;disposalMessage='';render();break;
 }
});
window.addEventListener('beforeunload',event=>{if(storageFailed&&unsavedEntries){event.preventDefault();event.returnValue='';}});
document.fonts.ready.then(fitDrawingLabels);
document.addEventListener('toggle',fitDrawingLabels,true);
