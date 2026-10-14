'use strict';
/* 百景ナビ 実地テスト版
   地図：地理院タイル／登山道・山名：OpenStreetMap／標高：地理院 → 推定コースタイム
   車の所要：OSRM（目安）／電車・バス：Googleマップに渡す */

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d){ try{ const v = localStorage.getItem('hn.'+k); return v===null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('hn.'+k, JSON.stringify(v)); }catch(e){} },
};

/* ---------- 時刻 ---------- */
const hm = m => { m = Math.round(m); const mm = ((m%1440)+1440)%1440; return `${Math.floor(mm/60)}:${String(mm%60).padStart(2,'0')}`; };
const dur = m => { m = Math.round(m); const h = Math.floor(m/60), r = m%60; return h ? `${h}時間${r?r+'分':''}` : `${r}分`; };
const durS = m => { m = Math.round(m); return `${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`; };
const WD = '日月火水木金土';
const dayLabel = (d, add) => { const t = new Date(d); t.setDate(t.getDate()+add); return `${t.getMonth()+1}/${t.getDate()}(${WD[t.getDay()]})`; };
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const nowMin = () => { const n = new Date(); return n.getHours()*60 + n.getMinutes() + n.getSeconds()/60; };

/* 日の出・日の入（NOAAの近似式、日本時間の分） */
function sunTimes(date, lat, lon){
  const start = new Date(date.getFullYear(), 0, 0), N = Math.floor((date - start)/864e5);
  const g = 2*Math.PI/365*(N-1), r = Math.PI/180;
  const eq = 229.18*(0.000075+0.001868*Math.cos(g)-0.032077*Math.sin(g)-0.014615*Math.cos(2*g)-0.040849*Math.sin(2*g));
  const dec = 0.006918-0.399912*Math.cos(g)+0.070257*Math.sin(g)-0.006758*Math.cos(2*g)+0.000907*Math.sin(2*g)-0.002697*Math.cos(3*g)+0.00148*Math.sin(3*g);
  const ha = Math.acos(Math.cos(90.833*r)/(Math.cos(lat*r)*Math.cos(dec)) - Math.tan(lat*r)*Math.tan(dec))/r;
  return { rise: 720 - 4*(lon+ha) - eq + 540, set: 720 - 4*(lon-ha) - eq + 540 };
}

/* ---------- 距離 ---------- */
const R = 6371000, rad = Math.PI/180;
function distM(a, b){ const dLat = (b[0]-a[0])*rad, dLon = (b[1]-a[1])*rad, la = (a[0]+b[0])/2*rad; return R*Math.hypot(dLat, dLon*Math.cos(la)); }
function distToSeg(p, a, b){ // m
  const k = Math.cos(p[0]*rad), ax = a[1]*k, ay = a[0], bx = b[1]*k, by = b[0], px = p[1]*k, py = p[0];
  const dx = bx-ax, dy = by-ay; let t = ((px-ax)*dx+(py-ay)*dy)/((dx*dx+dy*dy)||1e-12); t = Math.max(0, Math.min(1, t));
  return { d: R*rad*Math.hypot(ax+t*dx-px, ay+t*dy-py), t };
}

/* ---------- データ ---------- */
let DATA = null;
const ROUTES = [
  { id:'irodo', title:'易老渡から（長野側）', chain:'irodo', level:2,
    car:{ to:[35.37857,138.07833], name:'易老渡 駐車場', q:'易老渡 駐車場' },
    transit:{ station:'平岡駅', st:[35.2929,137.8466], last:{ mode:'taxi', min:80, label:'タクシー（前日までに予約）' }, prestay:'平岡駅の近く（または遠山郷）に前泊' },
    note:'林道（北又渡〜易老渡）が通行止めの年は、芝沢ゲートに停めて林道を約1時間歩く。通行状況は事前に確認' },
  { id:'hatanagi', title:'畑薙から（静岡側）', chain:'hatanagi', level:4,
    car:{ to:[35.3175,138.1905], name:'畑薙 臨時駐車場', q:'畑薙臨時駐車場' },
    walk:{ min:60, label:'畑薙大吊橋まで歩く（約1時間・目安）' },
    transit:{ station:'静岡駅', st:[34.9719,138.3890], last:{ mode:'bus', min:210, label:'路線バス 畑薙第一ダム行き（季節運行・要確認）' }, prestay:'静岡市内に前泊' },
    note:'茶臼岳を越える長い縦走。上級者向け' },
];
const HUT_INFO = {
  hut:{ name:'県営光岳小屋', season:[7,15,10,15] }, chausuHut:{ name:'茶臼小屋', season:[7,10,10,10] }, yokokubo:{ name:'横窪沢小屋', season:[7,10,10,10] },
};
const MODE_NAME = { car:'車', taxi:'タクシー', train:'電車・バス', bus:'バス', walk:'徒歩', hike:'登山', stay:'泊' };
const IC = {
  car:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 11l1.6-4.6A2 2 0 018.5 5h7a2 2 0 011.9 1.4L19 11v6h-2v2h-2v-2H9v2H7v-2H5zm2.5 1.5a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6zm9 0a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6zM7.4 10h9.2l-1-3H8.4z"/></svg>',
  taxi:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M10 3h4v2h-4zM5 11l1.6-4.6A2 2 0 018.5 5h7a2 2 0 011.9 1.4L19 11v6h-2v2h-2v-2H9v2H7v-2H5zm2.4-1h9.2l-1-3H8.4z"/></svg>',
  train:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 3h8a3 3 0 013 3v9a3 3 0 01-2 2.8l1.5 2.2h-2.3L15 18H9l-1.2 2H5.5L7 17.8A3 3 0 015 15V6a3 3 0 013-3zm-1 4v4h10V7zm1.5 6.5a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4zm7 0a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z"/></svg>',
  bus:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 3h12a2 2 0 012 2v11a2 2 0 01-1 1.7V20h-2.5v-2h-9v2H5v-2.3A2 2 0 014 16V5a2 2 0 012-2zm0 3v5h12V6zm1.5 7.5a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4zm9 0a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z"/></svg>',
  walk:'<svg viewBox="0 0 24 24"><circle cx="13" cy="4" r="2" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M9 21l2-6 3 3v3M11 15l1-6-3 2-1 3M12 9l3 3 3 1"/></svg>',
  hike:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 20l7-12 4 6 3-4 6 10z"/></svg>',
  stay:'<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 19V7M3 15h18v4M21 15v-2a3 3 0 00-3-3h-7v5"/><circle cx="7" cy="12" r="2" fill="currentColor"/></svg>',
  summit:'<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M6 21V4M6 4h11l-3 4 3 4H6"/></svg>',
  th:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/></svg>',
  warn:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3l10 18H2zm-1 6v6h2V9zm0 8v2h2v-2z"/></svg>',
  home:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>',
  up:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l7 10h-5v10h-4V12H5z"/></svg>',
};
const GMAPS = (dest, mode, origin) => `https://www.google.com/maps/dir/?api=1${origin?'&origin='+encodeURIComponent(origin):''}&destination=${encodeURIComponent(dest)}&travelmode=${mode}`;

/* ---------- 状態 ---------- */
const nextSat = () => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return d; };
const S = {
  screen:'explore', sel:'tekari', cat:null, query:'', searchOpen:false, sheet:'peek',
  tmode:'car', optSel:0, showAdv:false, picking:false,
  date: nextSat(), depart: store.get('depart', 240), pace: store.get('pace', 1.2),
  origin: { kind:'gps' }, // or {kind:'place', name, lat, lon}
  me: null, follow:false, base: store.get('base', 'pale'),
};
const drive = {}; // `${originKey}|${routeId}` → {min, geo} | null（取得失敗）| 'loading'

/* ---------- 地図 ---------- */
const map = L.map('map', { zoomControl:false, attributionControl:true, minZoom:5, maxZoom:18, zoomSnap:0.25, tap:false }).setView([35.36, 138.09], 12);
map.attributionControl.setPrefix(false);
const GSI = (id, ext, maxN) => L.tileLayer(`https://cyberjapandata.gsi.go.jp/xyz/${id}/{z}/{x}/{y}.${ext}`, { maxNativeZoom:maxN, maxZoom:18, crossOrigin:true,
  attribution:'<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a> | © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' });
const BASES = { pale:['淡色地図', GSI('pale','png',18)], std:['標準地図', GSI('std','png',18)], photo:['航空写真', GSI('seamlessphoto','jpg',18)] };
const hill = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png', { minZoom:9, maxNativeZoom:16, maxZoom:18, opacity:.2, className:'hillshade', crossOrigin:true });
let baseLayer = null;
function setBase(k){ if(baseLayer) map.removeLayer(baseLayer); S.base = k; store.set('base', k); baseLayer = BASES[k][1].addTo(map); baseLayer.bringToBack(); if(k==='photo') map.removeLayer(hill); else hill.addTo(map); }
setBase(BASES[S.base] ? S.base : 'pale');

const trailLayer = L.layerGroup().addTo(map), routeLayer = L.layerGroup().addTo(map), placeLayer = L.layerGroup().addTo(map), meLayer = L.layerGroup().addTo(map), navLayer = L.layerGroup().addTo(map);

/* ---------- 場所 ---------- */
let POIS = [];
function buildPois(){
  const wp = DATA.waypoints, byName = {};
  for (const k in wp) byName[wp[k].name] = k;
  const alias = { '県営光岳小屋':'hut' };
  const used = new Set();
  POIS = DATA.places.map((p, i) => {
    const id = alias[p.name] || byName[p.name] || 'p'+i; used.add(id);
    return { id, name: p.name === '県営光岳小屋' ? '光岳小屋' : p.name, kind: p.kind, lat: p.lat, lon: p.lon, ele: p.ele ?? wp[id]?.ele ?? null };
  });
  for (const k in wp) if (!used.has(k)) POIS.push({ id:k, name:wp[k].name, kind: wp[k].kind==='th' ? 'th' : wp[k].kind, lat:wp[k].lat, lon:wp[k].lon, ele:wp[k].ele });
  POIS.push({ id:'pkIrodo', name:'易老渡 駐車場', kind:'parking', lat:35.37857, lon:138.07833, ele:880 });
}
const poi = id => POIS.find(p => p.id === id);
const CAT = { peak:['山頂','#C0392B'], hut:['山小屋','#B26A00'], th:['登山口','#1E8E3E'], parking:['駐車場','#1A73E8'] };
const KEY_PEAKS = new Set(['tekari','chausu','irodake','hut','irodo','bridge','chausuHut','yokokubo']);

function drawTrails(){
  trailLayer.clearLayers();
  for (const t of DATA.trails) L.polyline(t.c, { color: t.h==='track' ? '#8F8470' : '#8A4B1F', weight: t.h==='track' ? 2 : 2.2, opacity:.85, dashArray: t.h==='track' ? '8 5' : '5 4', interactive:false }).addTo(trailLayer);
}
function drawPlaces(){
  placeLayer.clearLayers();
  const z = map.getZoom();
  for (const p of POIS){
    if (S.cat && S.cat !== p.kind) continue;
    const key = KEY_PEAKS.has(p.id) || p.id === S.sel;
    if (!key && z < 12.5 && !S.cat) continue;
    if (p.id === S.sel && S.screen !== 'nav'){
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className:'', html:'<div class="pin"></div>', iconSize:[26,26], iconAnchor:[13,30] }), interactive:false })
        .bindTooltip(p.name, { permanent:true, direction:'bottom', offset:[0,4], className:'lbl sel' }).addTo(placeLayer);
      continue;
    }
    const m = L.circleMarker([p.lat, p.lon], { radius: key ? 7 : 5.5, color:'#fff', weight:2, fillColor: CAT[p.kind][1], fillOpacity:1, bubblingMouseEvents:false }).addTo(placeLayer);
    if (key || z >= 13) m.bindTooltip(p.name, { permanent:true, direction:'bottom', offset:[0,5], className: key ? 'lbl' : 'lbl small' });
    m.on('click', () => { if (S.screen === 'explore') selectPoi(p.id); });
  }
}
map.on('zoomend', () => drawPlaces());

/* ---------- 現在地 ---------- */
let watchId = null, heading = null;
function startWatch(){
  if (!('geolocation' in navigator)) { toast('この端末では位置情報が使えません'); return; }
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(p => {
    S.me = { lat:p.coords.latitude, lon:p.coords.longitude, acc:p.coords.accuracy, alt:p.coords.altitude, heading: p.coords.heading, t: Date.now() };
    drawMe();
    if (S.follow && S.screen !== 'nav') map.panTo([S.me.lat, S.me.lon], { animate:true });
    if (S.screen === 'nav') onNavPosition();
    if (S.screen === 'dir' && S.origin.kind === 'gps' && !drive[originKey()+'|irodo']) requestDrives();
  }, e => {
    watchId = null;
    toast(e.code === 1 ? '位置情報がオフです。設定でこのサイトの位置情報を許可してください' : '現在地を取得できませんでした');
  }, { enableHighAccuracy:true, maximumAge:5000, timeout:20000 });
}
function drawMe(){
  meLayer.clearLayers();
  if (!S.me || (S.screen === 'nav' && sim.on)) return;
  L.circle([S.me.lat, S.me.lon], { radius: S.me.acc, color:'#1A73E8', weight:1, fillOpacity:.1, interactive:false }).addTo(meLayer);
  const h = heading ?? S.me.heading;
  const html = `<div class="me-wrap">${h!=null && !isNaN(h) ? `<div class="me-cone" style="transform:rotate(${h}deg)"></div>` : ''}<div class="me-dot"></div></div>`;
  L.marker([S.me.lat, S.me.lon], { icon: L.divIcon({ className:'', html, iconSize:[18,18], iconAnchor:[9,9] }), interactive:false, zIndexOffset:1000 }).addTo(meLayer);
}
function enableCompass(){
  const on = e => { const h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null); if (h != null) { heading = h; drawMe(); } };
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
      DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') addEventListener('deviceorientation', on); }).catch(()=>{});
    else addEventListener('deviceorientationabsolute', on);
  } catch(e) {}
}

/* ---------- 経路の計算 ---------- */
const originKey = () => S.origin.kind === 'gps' ? (S.me ? `${S.me.lat.toFixed(3)},${S.me.lon.toFixed(3)}` : 'nogps') : `${S.origin.lat.toFixed(4)},${S.origin.lon.toFixed(4)}`;
const originLL = () => S.origin.kind === 'gps' ? (S.me ? [S.me.lat, S.me.lon] : null) : [S.origin.lat, S.origin.lon];
const originName = () => S.origin.kind === 'gps' ? '現在地' : S.origin.name;
const originForGmaps = () => S.origin.kind === 'gps' ? (S.me ? `${S.me.lat},${S.me.lon}` : '') : `${S.origin.lat},${S.origin.lon}`;

function requestDrives(){
  const o = originLL(); if (!o) return;
  for (const r of ROUTES){
    const k = originKey()+'|'+r.id; if (drive[k] !== undefined) continue;
    drive[k] = 'loading';
    fetch(`https://router.project-osrm.org/route/v1/driving/${o[1]},${o[0]};${r.car.to[1]},${r.car.to[0]}?overview=simplified&geometries=geojson`)
      .then(x => x.json()).then(j => {
        if (j.code !== 'Ok') throw 0;
        const rt = j.routes[0];
        drive[k] = { min: Math.round(rt.duration/60*1.15/5)*5, km: rt.distance/1000, geo: rt.geometry.coordinates.map(c => [c[1], c[0]]) };
      }).catch(() => { drive[k] = null; }).finally(() => { if (S.screen === 'dir') { renderSheet(); drawRoutes(); } });
  }
}

const seg = (a, b) => { const s = DATA.segments[a+'>'+b]; if (s) return { t:s.t, s, fwd:true }; const r = DATA.segments[b+'>'+a]; return { t:r.tRev, s:r, fwd:false }; };
const dirTarget = () => { const c = ROUTES.map(r => DATA.chains[r.chain]); return c.some(ch => ch.indexOf(S.sel) > 0) ? S.sel : 'tekari'; };
const reachable = () => ROUTES.filter(r => DATA.chains[r.chain].indexOf(dirTarget()) > 0);
const visibleRoutes = () => reachable().filter(r => S.showAdv || r.level <= 3);
const hutOpen = (k, date) => { const h = HUT_INFO[k]; if (!h) return true; const [m1,d1,m2,d2] = h.season; const v = (date.getMonth()+1)*100 + date.getDate(); return v >= m1*100+d1 && v <= m2*100+d2; };

function plan(route, mode){
  const chain = DATA.chains[route.chain], tgt = chain.indexOf(dirTarget()), W = DATA.waypoints;
  const th = W[chain[0]], sun = sunTimes(S.date, th.lat, th.lon), SUNSET = sun.set, DEADLINE = SUNSET - 60;
  const HUTSTART = Math.max(4*60+30, Math.round((sun.rise - 30)/5)*5);
  const pace = S.pace, rows = []; let day = 0, t = 0, nights = 0, hikeTotal = 0, unknown = false;
  const push = (kind, text, sub, x={}) => rows.push({ day, t, kind, text, sub, ...x });
  const stopAt = k => W[chain[k]].kind === 'hut' || k === 0 || k === tgt;
  const legT = (k, dir) => seg(chain[k], chain[k+dir]).t * pace;
  function farthest(j, t0, dir){
    const end = dir > 0 ? tgt : 0; let best = null, tt = t0, k = j;
    while (k !== end){ tt += legT(k, dir); k += dir; if (tt > DEADLINE) break; if (stopAt(k)) best = { k, t:tt }; }
    return best;
  }
  const walk = route.walk;
  // 行き
  if (mode === 'car'){
    const dv = drive[originKey()+'|'+route.id];
    const dmin = dv && dv !== 'loading' ? dv.min : null; if (dmin === null) unknown = true;
    const approach = (dmin ?? 0) + (walk ? walk.min : 0);
    t = S.depart;
    const pre = dmin === null ? false : !farthest(0, t + approach + 20, +1);
    if (pre) t = Math.max(12*60, 17*60 - (dmin ?? 0));
    push('car', `${originName()}を出発`, `${dmin===null ? '運転時間は取得中か、取得できませんでした' : `${route.car.name}まで 約${dur(dmin)}（目安）`}`, { min:dmin, link: GMAPS(`${route.car.to[0]},${route.car.to[1]}`, 'driving', originForGmaps()), linkText:'運転はGoogleマップで案内' });
    t += dmin ?? 0;
    if (pre){ push('stay', `${route.car.name}で車中泊、または近くの宿に前泊`, '当日に出ると、日没1時間前までに山小屋か下山口に着けないため', { warn:true }); nights++; day++; t = HUTSTART - (walk ? walk.min : 0); }
    if (walk){ push('walk', walk.label, '', { min:walk.min }); t += walk.min; }
  } else {
    const tr = route.transit;
    t = 15*60;
    push('train', `${originName()}から${tr.station}へ`, '電車・バスの時刻はGoogleマップで確認', { link: GMAPS(tr.station, 'transit', originForGmaps()), linkText:'乗換をGoogleマップで見る', notime:true });
    t = 18*60;
    push('stay', tr.prestay, '登山口へ向かう車・バスは本数が少ないため、前の日のうちに近くまで行く', { warn:true }); nights++; day++;
    t = Math.max(HUTSTART - tr.last.min, 4*60+30);
    push(tr.last.mode, `${tr.station} 発`, `${tr.last.label}　約${dur(tr.last.min)}（目安）`, { min:tr.last.min }); t += tr.last.min;
    if (walk){ push('walk', walk.label, '', { min:walk.min }); t += walk.min; }
  }
  push('th', `${W[chain[0]].name} 登山口`, '準備・トイレ 20分'); t += 20;
  // 登り
  let j = 0, guard = 0, ok = true;
  while (j !== tgt && guard++ < 10){
    const r = farthest(j, t, +1);
    if (!r){ push('warn', 'この先、日没1時間前までに着ける山小屋がありません', '出発を早めるか、手前で引き返してください', { warn:true }); ok = false; break; }
    const via = chain.slice(j+1, r.k).map(k => W[k].name);
    push('hike', `${W[chain[j]].name} → ${W[chain[r.k]].name}`, `${via.length ? via.join('・')+' 経由　' : ''}歩く ${dur(r.t-t)}`, { from:j, to:r.k, t0:t, t1:r.t, dir:+1 });
    hikeTotal += r.t - t; j = r.k; t = r.t;
    if (j === tgt) break;
    push('stay', `${W[chain[j]].name}に泊まる`, `${hm(t)} 着　日没 ${hm(SUNSET)}${hutOpen(chain[j], S.date) ? '' : '　※この日は営業期間外の可能性'}`, { warn: !hutOpen(chain[j], S.date) }); nights++; day++; t = HUTSTART;
  }
  if (j === tgt && ok){
    push('summit', `${W[chain[tgt]].name}${W[chain[tgt]].kind==='hut' ? 'に到着' : ' 山頂'}`, '写真・休憩 20分'); t += 20;
    guard = 0;
    while (j !== 0 && guard++ < 10){
      let r = farthest(j, t, -1);
      if (!r){
        let k = j-1, tt = t + legT(j, -1); while (k > 0 && W[chain[k]].kind !== 'hut'){ tt += legT(k, -1); k--; }
        if (W[chain[j]].kind === 'hut'){ push('stay', `${W[chain[j]].name}に泊まる`, `${hm(t)} 着`); nights++; day++; t = HUTSTART; continue; }
        if (k > 0 && tt - t <= 60 && tt <= SUNSET){ push('hike', `${W[chain[j]].name} → ${W[chain[k]].name}`, `歩く ${dur(tt-t)}`, { from:j, to:k, t0:t, t1:tt, dir:-1 }); hikeTotal += tt-t; j = k; t = tt;
          push('stay', `${W[chain[j]].name}に泊まる`, `${hm(t)} 着　日没 ${hm(SUNSET)}${hutOpen(chain[j], S.date) ? '' : '　※この日は営業期間外の可能性'}`, { warn: !hutOpen(chain[j], S.date) }); nights++; day++; t = HUTSTART; continue; }
        push('warn', '日没1時間前までに下りきれません', '出発を早める必要があります', { warn:true }); ok = false; break;
      }
      const via = chain.slice(r.k+1, j).reverse().map(k => W[k].name);
      push('hike', `${W[chain[j]].name} → ${W[chain[r.k]].name}`, `${via.length ? via.join('・')+' 経由　' : ''}歩く ${dur(r.t-t)}`, { from:j, to:r.k, t0:t, t1:r.t, dir:-1 });
      hikeTotal += r.t - t; j = r.k; t = r.t;
      if (j !== 0){ push('stay', `${W[chain[j]].name}に泊まる`, `${hm(t)} 着${hutOpen(chain[j], S.date) ? '' : '　※この日は営業期間外の可能性'}`, { warn: !hutOpen(chain[j], S.date) }); nights++; day++; t = HUTSTART; }
    }
    if (ok){
      push('th', `${W[chain[0]].name}に下山`, `日没 ${hm(SUNSET)} まで ${dur(SUNSET - t)}`);
      if (walk){ push('walk', walk.label.replace('大吊橋まで','駐車場・バス停まで'), '', { min:walk.min }); t += walk.min; }
      if (mode === 'car'){
        const dv = drive[originKey()+'|'+route.id], dmin = dv && dv !== 'loading' ? dv.min : null;
        push('car', '帰りの運転', dmin === null ? '' : `約${dur(dmin)}（目安）`, { min:dmin }); t += dmin ?? 0;
        if (dmin !== null && t > 20*60) push('warn', '帰りの運転が夜になります', '疲れた状態で山道を運転しないよう、麓で1泊するのがおすすめです', { warn:true });
      } else {
        push(route.transit.last.mode, `${route.transit.station}へ`, `${route.transit.last.label}`, { min:route.transit.last.min }); t += route.transit.last.min;
        push('train', `${route.transit.station}から${originName()}へ`, '最終の電車に間に合わない場合は駅の近くに後泊', { link: GMAPS(originForGmaps() || originName(), 'transit', route.transit.station), linkText:'帰りの乗換を見る', notime:true });
      }
      push('home', `${originName()}に到着`, '', { notime: mode !== 'car' });
    }
  }
  return { rows, nights, days: day+1, hikeTotal, ok, unknown, sun };
}

/* ---------- ルートの線 ---------- */
function chainCoords(chainName, from, to){ // チェーンの index from→to の座標 [[lat,lon,ele]...]
  const ch = DATA.chains[chainName], out = [], dir = to >= from ? 1 : -1;
  for (let k = from; k !== to; k += dir){
    const g = seg(ch[k], ch[k+dir]); let c = g.s.coords; if (!g.fwd) c = c.slice().reverse();
    out.push(...(out.length ? c.slice(1) : c));
  }
  return out;
}
function drawRoutes(){
  routeLayer.clearLayers();
  if (S.screen !== 'dir') return;
  const rs = visibleRoutes(), tgt = dirTarget();
  rs.forEach((r, i) => {
    const sel = i === S.optSel, line = chainCoords(r.chain, 0, DATA.chains[r.chain].indexOf(tgt)).map(c => [c[0], c[1]]);
    const dv = drive[originKey()+'|'+r.id];
    if (S.tmode === 'car' && dv && dv !== 'loading') L.polyline(dv.geo, { color: sel ? '#1A73E8' : '#9DB7DD', weight: sel ? 6 : 5, opacity:.95 }).addTo(routeLayer).on('click', () => { S.optSel = i; renderAll(); });
    L.polyline(line, { color:'#fff', weight: sel ? 9 : 7, opacity:.9, interactive:false }).addTo(routeLayer);
    L.polyline(line, { color: sel ? '#D2462F' : '#E8A497', weight: sel ? 5 : 4 }).addTo(routeLayer).on('click', () => { S.optSel = i; renderAll(); });
  });
  const o = originLL();
  if (o && S.origin.kind !== 'gps') L.marker(o, { icon: L.divIcon({ className:'', html:'<div class="org"></div>', iconSize:[16,16], iconAnchor:[8,8] }) }).bindTooltip(S.origin.name, { permanent:true, direction:'bottom', offset:[0,8], className:'lbl' }).addTo(routeLayer);
}
function fitDir(){
  const rs = visibleRoutes(), pts = [];
  rs.forEach(r => { pts.push(...chainCoords(r.chain, 0, DATA.chains[r.chain].indexOf(dirTarget())).map(c => [c[0], c[1]])); });
  if (S.tmode === 'car'){ const o = originLL(); if (o) pts.push(o); }
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { paddingTopLeft:[30, 190], paddingBottomRight:[30, sheetPx() + 80], maxZoom:14 });
}

/* ---------- 画面：上部 ---------- */
let gsiTimer = null, gsiHits = [];
function renderTop(){
  const el = $('#top');
  el.className = S.picking ? 'top picking' : 'top';
  if (S.screen === 'explore'){
    el.innerHTML = `<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input id="q" type="search" enterkeyhint="search" placeholder="山・山小屋・登山口・地名で検索" value="${esc(S.query)}" autocomplete="off" aria-label="検索"><span class="avatar" aria-hidden="true">な</span></div>
      <div class="chips" role="group" aria-label="カテゴリ">${Object.entries(CAT).map(([k,[n,c]]) => `<button class="chip" data-cat="${k}" aria-pressed="${S.cat===k}"><i style="background:${c}"></i>${n}</button>`).join('')}</div>
      <ul class="results" id="results" ${S.searchOpen ? '' : 'hidden'}></ul>`;
    const q = $('#q');
    q.addEventListener('focus', () => { S.searchOpen = true; fillResults(); });
    q.addEventListener('input', () => { S.query = q.value; fillResults(); });
    q.addEventListener('blur', () => setTimeout(() => { S.searchOpen = false; const r = $('#results'); if (r) r.hidden = true; }, 200));
    $$('.chip').forEach(b => b.addEventListener('click', () => { S.cat = S.cat === b.dataset.cat ? null : b.dataset.cat; S.sel = null; S.sheet = 'half'; renderAll(); }));
    if (S.searchOpen) fillResults();
  } else if (S.screen === 'dir'){
    const W = DATA.waypoints, tg = W[dirTarget()];
    el.innerHTML = `<div class="dircard"><div class="dirrow">
        <button class="iconbtn" id="dirBack" aria-label="戻る"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="fields"><button class="field" id="fromBtn" aria-label="出発地を変更"><i class="dot ${S.origin.kind==='gps'?'me':'st'}"></i>${esc(S.origin.kind==='gps' ? '現在地' : S.origin.name)}</button>
        <div class="field"><i class="dot dest"></i>${esc(tg.name)}${tg.kind==='peak' ? ' 山頂' : ''}</div></div></div>
        <div class="tmodes" role="group" aria-label="移動手段">
          <button class="tmode" data-m="car" aria-pressed="${S.tmode==='car'}">${IC.car}車</button>
          <button class="tmode" data-m="transit" aria-pressed="${S.tmode==='transit'}">${IC.train}電車・バス</button></div></div>
      ${S.picking ? `<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="oq" type="search" enterkeyhint="search" placeholder="出発地を検索（駅名・住所など）" autocomplete="off" aria-label="出発地を検索"><button class="iconbtn" id="pickClose" aria-label="閉じる"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><ul class="results" id="oresults"></ul>` : ''}`;
    $('#dirBack').addEventListener('click', () => setScreen('explore'));
    $('#fromBtn').addEventListener('click', () => { S.picking = true; renderTop(); $('#oq').focus(); });
    $$('.tmode').forEach(b => b.addEventListener('click', () => { S.tmode = b.dataset.m; S.optSel = 0; renderAll(); fitDir(); }));
    if (S.picking){
      $('#pickClose').addEventListener('click', () => { S.picking = false; renderTop(); });
      $('#oq').addEventListener('input', fillOrigins); fillOrigins();
    }
  } else el.innerHTML = '';
}
function gsiSearch(q, cb){ // 駅・施設はOSM（Nominatim）、なければ地理院の地名検索
  clearTimeout(gsiTimer);
  if (q.length < 2) { gsiHits = []; cb(); return; }
  gsiTimer = setTimeout(async () => {
    try {
      const j = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&countrycodes=jp&accept-language=ja&limit=8&addressdetails=1`).then(r => r.json());
      gsiHits = j.map(x => { const a = x.address || {}; const area = [a.province || a.state, a.city || a.town || a.village || a.county].filter(Boolean).join(' ');
        return { name: x.name || x.display_name.split(',')[0], area, lat: +x.lat, lon: +x.lon }; });
      if (!gsiHits.length){
        const g = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q)).then(r => r.json());
        gsiHits = g.slice(0, 8).map(f => ({ name: f.properties.title, area: '', lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
      }
    } catch(e) { gsiHits = []; }
    cb();
  }, 450);
}
function fillResults(){
  const ul = $('#results'); if (!ul) return;
  const q = S.query.trim();
  const local = POIS.filter(p => !q || p.name.includes(q)).sort((a,b) => (KEY_PEAKS.has(b.id)-KEY_PEAKS.has(a.id))).slice(0, 6);
  const paint = () => {
    ul.hidden = false;
    ul.innerHTML = local.map(p => `<li><button data-id="${p.id}"><b>${esc(p.name)}</b><small>${CAT[p.kind][0]}${p.ele ? '・'+p.ele.toLocaleString()+'m' : ''}</small></button></li>`).join('')
      + gsiHits.filter(h => !local.some(p => p.name === h.name)).map((h, i) => `<li><button data-g="${i}"><b>${esc(h.name)}</b><small>${esc(h.area || '地名')}</small></button></li>`).join('')
      || '<li><button disabled><b>見つかりませんでした</b><small>山の名前・駅名・住所で探せます</small></button></li>';
    ul.querySelectorAll('[data-id]').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); S.searchOpen = false; selectPoi(b.dataset.id); }));
    ul.querySelectorAll('[data-g]').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); const h = gsiHits[+b.dataset.g]; S.searchOpen = false; selectPlace(h); }));
  };
  paint(); gsiSearch(q, () => { if (S.searchOpen) paint(); });
}
function fillOrigins(){
  const ul = $('#oresults'); if (!ul) return;
  const q = ($('#oq')?.value || '').trim();
  const recent = store.get('recentOrigins', []);
  const paint = () => {
    const items = [`<li><button data-o="gps"><b>◎ 現在地</b><small>${S.me ? `GPS（精度 約${Math.round(S.me.acc)}m）` : 'GPS（位置情報を許可してください）'}</small></button></li>`]
      .concat((q ? gsiHits : recent).map((h, i) => `<li><button data-h="${i}"><b>${esc(h.name)}</b><small>${esc(q ? (h.area || '地名') : '最近使った出発地')}</small></button></li>`));
    if (q && !gsiHits.length) items.push('<li><button disabled><b>検索中、または見つかりませんでした</b><small>駅名・市町村名・住所で探せます</small></button></li>');
    ul.innerHTML = items.join('');
    ul.querySelector('[data-o]').addEventListener('click', () => { S.origin = { kind:'gps' }; startWatch(); afterOrigin(); });
    ul.querySelectorAll('[data-h]').forEach(b => b.addEventListener('click', () => {
      const h = (q ? gsiHits : recent)[+b.dataset.h]; S.origin = { kind:'place', name:h.name, lat:h.lat, lon:h.lon };
      store.set('recentOrigins', [h, ...recent.filter(r => r.name !== h.name)].slice(0, 6)); afterOrigin();
    }));
  };
  paint(); if (q) gsiSearch(q, paint);
}
function afterOrigin(){ S.picking = false; S.optSel = 0; requestDrives(); renderAll(); fitDir(); toast(`${originName()}からの経路を表示しました`); }

/* ---------- 画面：シート ---------- */
const sheetPx = () => { const h = $('#app').clientHeight - 56; if (S.sheet === 'full') return h - 120; if (S.sheet === 'half') return Math.round(h*.55); return S.screen === 'dir' ? 270 : S.sel ? 230 : 150; };
function setSheetH(){ document.documentElement.style.setProperty('--sheet-h', (S.screen === 'explore' || S.screen === 'dir' ? sheetPx() : S.screen === 'nav' ? 110 : 0) + 'px'); }

function placeCardHTML(p){
  const W = DATA.waypoints, isWp = !!W[p.id];
  const onChain = ROUTES.some(r => DATA.chains[r.chain].indexOf(p.id) > 0);
  const info = [];
  if (p.id === 'tekari'){
    info.push(['山小屋', '県営光岳小屋（山頂まで約20分）。営業期間は例年7月中旬〜10月中旬（要確認）'], ['登山口', '易老渡（長野側・初心者はこちら）／畑薙（静岡側・上級者向け）'], ['推定コースタイム', `易老渡→光岳 約${dur(seg('irodo','irodake').t+seg('irodake','hut').t+seg('hut','tekari').t)}（標準ペース）`]);
  }
  if (p.kind === 'hut' && HUT_INFO[p.id]) { const s = HUT_INFO[p.id].season; info.push(['営業期間', `例年 ${s[0]}/${s[1]}〜${s[2]}/${s[3]} ごろ（要確認・予約推奨）`]); }
  info.push(['位置', `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`]);
  return `<div><h2>${esc(p.name)}</h2><div class="sub">${CAT[p.kind][0]}${p.ele ? '・標高 '+p.ele.toLocaleString()+'m' : ''}${p.id==='tekari' ? '・日本百名山・南アルプス' : ''}</div></div>
    <div class="acts">
      ${onChain ? `<button class="act primary" id="aDir">${IC.car}経路</button>` : ''}
      <a class="act" href="${GMAPS(`${p.lat},${p.lon}`, 'driving')}" target="_blank" rel="noopener">${IC.car}Googleマップ</a>
      <button class="act" id="aSave"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M4 20h16"/></svg>この周辺の地図を保存</button></div>
    ${p.id === 'tekari' ? `<div class="badge">初心者には難しめ：日帰りはできず、山小屋に1泊が必要です</div>` : ''}
    ${!onChain && !isWp ? `<div class="note">経路の案内は、いまは光岳周辺（易老渡・畑薙からのルート）だけ対応しています。</div>` : ''}
    <ul class="info">${info.map(([k,v]) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`).join('')}</ul>`;
}

function legChips(p){
  const chips = []; let beforeSummit = true;
  for (const r of p.rows){
    if (['car','taxi','train','bus','walk'].includes(r.kind)){ chips.push({ k:r.kind, m:r.min }); }
    else if (r.kind === 'hike') chips.push({ k:'hike', m:r.t1 - r.t0 });
    else if (r.kind === 'stay') chips.push({ k:'stay' });
    else if (r.kind === 'summit') beforeSummit = false;
  }
  return chips.map(c => `<span class="leg ${c.k}">${IC[c.k]}${c.m ? durS(c.m) : MODE_NAME[c.k]}</span>`).join('<span class="chev">›</span>');
}
const stars = n => '★'.repeat(n) + '☆'.repeat(5-n);

function renderSheet(){
  const sh = $('#sheet'), body = $('#sheetBody');
  sh.hidden = !(S.screen === 'explore' || S.screen === 'dir');
  setSheetH();
  if (sh.hidden) return;
  if (S.screen === 'explore'){
    if (S.sel && S.sel.startsWith('g:')){
      const g = S.gplace;
      body.innerHTML = `<div><h2>${esc(g.name)}</h2><div class="sub">${esc(g.area || '地名')}</div></div>
        <div class="acts"><button class="act primary" id="aFrom">${IC.car}ここから光岳へ</button><a class="act" href="${GMAPS(`${g.lat},${g.lon}`,'driving')}" target="_blank" rel="noopener">Googleマップ</a></div>`;
      $('#aFrom').addEventListener('click', () => { S.origin = { kind:'place', name:g.name, lat:g.lat, lon:g.lon }; S.sel = 'tekari'; setScreen('dir'); requestDrives(); });
    } else if (S.sel){
      const p = poi(S.sel); body.innerHTML = placeCardHTML(p);
      $('#aDir')?.addEventListener('click', () => { setScreen('dir'); requestDrives(); });
      $('#aSave').addEventListener('click', () => { saveArea(`${p.name} 周辺`, [[p.lat-0.03, p.lon-0.037],[p.lat+0.03, p.lon+0.037]]); });
    } else if (S.cat){
      const list = POIS.filter(p => p.kind === S.cat).sort((a,b) => (b.ele||0)-(a.ele||0));
      body.innerHTML = `<h2>${CAT[S.cat][0]}</h2><ul class="list">${list.map(p => `<li><button data-id="${p.id}"><b>${esc(p.name)}</b><small>${CAT[p.kind][0]}</small><span class="r">${p.ele ? p.ele.toLocaleString()+'m' : ''}</span></button></li>`).join('')}</ul>`;
      body.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => selectPoi(b.dataset.id)));
    } else {
      body.innerHTML = `<h2>この辺りの山</h2><ul class="list">${POIS.filter(p => p.kind==='peak' && (p.ele||0) >= 2500).sort((a,b) => b.ele-a.ele).map(p => `<li><button data-id="${p.id}"><b>${esc(p.name)}</b><small>山頂</small><span class="r">${p.ele.toLocaleString()}m</span></button></li>`).join('')}</ul>
        <div class="note">実地テスト版。地図は地理院タイル、登山道と山名は OpenStreetMap、コースタイムは地理院の標高から計算した推定値です。紙の地図とほかの登山アプリも必ず併用してください。</div>`;
      body.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => selectPoi(b.dataset.id)));
    }
  }
  if (S.screen === 'dir'){
    const rs = visibleRoutes(), hidden = reachable().length - rs.length;
    if (S.optSel >= rs.length) S.optSel = 0;
    const plans = rs.map(r => plan(r, S.tmode)), sp = plans[S.optSel], so = rs[S.optSel];
    const departSel = [2,3,4,5,6,7,8].map(h => `<option value="${h*60}" ${S.depart===h*60?'selected':''}>${h}:00 出発</option>`).join('');
    const gpsNote = S.origin.kind === 'gps' && !S.me ? `<div class="badge">現在地を取得中です。位置情報を許可するか、上の「現在地」をタップして出発地を選んでください。</div>` : '';
    body.innerHTML = `${gpsNote}<div class="prefs">
        <label class="pref">日付<input type="date" id="pDate" value="${isoDate(S.date)}"></label>
        ${S.tmode === 'car' ? `<label class="pref"><select id="pDepart" aria-label="出発時刻">${departSel}</select></label>` : ''}
        <label class="pref">ペース<select id="pPace" aria-label="歩くペース"><option value="1.2" ${S.pace===1.2?'selected':''}>ゆっくり</option><option value="1" ${S.pace===1?'selected':''}>標準</option></select></label></div>
      <div class="opts">${rs.map((r, i) => { const p = plans[i]; const dv = drive[originKey()+'|'+r.id];
        return `<button class="opt" data-i="${i}" aria-pressed="${i===S.optSel}">
          <div class="opt-h"><b>${p.ok ? (p.nights ? `${p.nights}泊${p.days}日` : '日帰り') : '計画できません'}</b><span>歩く時間 計${dur(p.hikeTotal)}</span>${S.tmode==='car' ? `<span>${dv==='loading' ? '運転時間を計算中…' : dv ? `運転 約${dur(dv.min)}・${Math.round(dv.km)}km` : (originLL() ? '運転時間を取得できませんでした' : '')}</span>` : ''}</div>
          <div class="opt-t">${esc(r.title)}</div>
          <div class="legs">${legChips(p)}</div>
          <div class="note">体力 ${stars(Math.min(5, r.level+2))}　技術 ${stars(r.level)}（目安）</div>
          ${r.note ? `<div class="warnline">${esc(r.note)}</div>` : ''}</button>`; }).join('')}
        ${hidden && !S.showAdv ? `<button class="hidden-note" id="showAdv">上級者向けの候補 ${hidden}件を非表示にしています（タップで表示）</button>` : ''}</div>
      ${sp ? `<div class="startbar"><button class="act primary" id="aStart">${IC.hike}登山ナビを開始</button><button class="act" id="aOff">このルートの地図を保存</button></div>
      <div class="note">日の出 ${hm(sp.sun.rise)}・日の入 ${hm(sp.sun.set)}（${esc(DATA.waypoints[DATA.chains[so.chain][0]].name)}、${dayLabel(S.date,0)}）。日没の1時間前までに山小屋か登山口に着く組み方だけを出しています。</div>
      <ol class="sched">${schedHTML(sp)}</ol>` : ''}
      <div class="note">コースタイムは、OpenStreetMapの登山道と国土地理院の標高から計算した推定値です（水平3.5km/h・登り500m/h・下り800m/h）。運転時間は OSRM による目安です。山小屋の営業・林道の通行・バスの運行は必ず事前に確認してください。</div>`;
    $$('.opt').forEach(b => b.addEventListener('click', () => { S.optSel = +b.dataset.i; renderAll(); }));
    $('#pDate').addEventListener('change', e => { const [y,m,d] = e.target.value.split('-').map(Number); if (y) { S.date = new Date(y, m-1, d); renderSheet(); } });
    $('#pDepart')?.addEventListener('change', e => { S.depart = +e.target.value; store.set('depart', S.depart); renderSheet(); });
    $('#pPace').addEventListener('change', e => { S.pace = +e.target.value; store.set('pace', S.pace); renderSheet(); });
    $('#showAdv')?.addEventListener('click', () => { S.showAdv = true; renderAll(); fitDir(); });
    $('#aStart')?.addEventListener('click', () => startNav(so, sp));
    $('#aOff')?.addEventListener('click', () => { const c = chainCoords(so.chain, 0, DATA.chains[so.chain].indexOf(dirTarget())).map(x => [x[0], x[1]]); const b = L.latLngBounds(c).pad(0.15); saveArea(`${DATA.waypoints[dirTarget()].name}　${so.title.replace(/（.*）/,'')}`, [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]); });
  }
}
function schedHTML(p){
  let out = '', d = -1;
  for (const r of p.rows){
    if (r.day !== d){ d = r.day; out += `<li class="dayh">${d+1}日目　${dayLabel(S.date, d)}</li>`; }
    const ic = IC[r.kind] || IC.th;
    out += `<li class="ev${r.warn ? ' w' : ''}"><time>${r.kind==='warn' || r.notime ? '' : hm(r.t)}</time><span class="ic ${r.kind}">${ic}</span><div><b>${esc(r.text)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}${r.link ? `<a href="${r.link}" target="_blank" rel="noopener">${esc(r.linkText)} ↗</a>` : ''}</div></li>`;
  }
  return out;
}

/* ---------- 選択 ---------- */
function selectPoi(id){
  S.sel = id; S.cat = null; S.searchOpen = false; S.sheet = 'peek';
  const p = poi(id); S.query = p.name; renderAll();
  map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 14), { duration:.5 });
  setTimeout(() => map.panBy([0, sheetPx()/2 - 40], { animate:true }), 550);
}
function selectPlace(h){
  S.gplace = h; S.sel = 'g:' + h.name; S.query = h.name; S.sheet = 'peek'; renderAll();
  map.flyTo([h.lat, h.lon], 13, { duration:.6 });
}

/* ---------- 登山ナビ ---------- */
const sim = { on:false, prog:.2 };
let nav = null, wakeLock = null;
function startNav(route, p){
  const h = p.rows.find(r => r.kind === 'hike'); if (!h){ toast('この条件では登山を始められません'); return; }
  const chain = DATA.chains[route.chain];
  // 今日歩く区間（最初の登り）に、山頂までの続きも載せる
  const upTo = chain.indexOf(dirTarget());
  const coords = chainCoords(route.chain, 0, upTo);
  const cum = [0], tm = [0], W = DATA.waypoints;
  // 区間ごとの推定時間を距離で配分
  const nodeAt = [0];
  for (let k = 0; k < upTo; k++){
    const g = seg(chain[k], chain[k+1]); const c = g.fwd ? g.s.coords : g.s.coords.slice().reverse();
    const base = cum.length - 1; let segLen = 0; const ds = [];
    for (let i = 1; i < c.length; i++){ const dd = distM(c[i-1], c[i]); ds.push(dd); segLen += dd; }
    for (let i = 0; i < ds.length; i++){ cum.push(cum[cum.length-1] + ds[i]); tm.push(tm[tm.length-1] + g.t * ds[i] / (segLen || 1)); }
    nodeAt.push(cum.length - 1);
  }
  const stops = chain.slice(0, upTo+1).map((k, i) => ({ k, idx: nodeAt[i], name: W[k].name, kind: W[k].kind }));
  const goalK = chain[h.to], goalIdx = nodeAt[h.to];
  nav = { route, plan:p, coords, cum, tm, stops, goalK, goalIdx, startT: h.t0, sun: p.sun, track: [], startedAt: Date.now() };
  sim.on = !S.me || distToRoute([S.me.lat, S.me.lon]).d > 3000; // 登山道から遠ければ「家で試す」から始める
  $('#simOn').checked = sim.on; $('#simProg').hidden = !sim.on;
  enableCompass();
  try { navigator.wakeLock?.request('screen').then(l => wakeLock = l).catch(()=>{}); } catch(e) {}
  startWatch();
  setScreen('nav');
}
function distToRoute(pt){
  let best = { d:Infinity, i:0, t:0 };
  for (let i = 1; i < nav.coords.length; i++){ const r = distToSeg(pt, nav.coords[i-1], nav.coords[i]); if (r.d < best.d) best = { d:r.d, i:i-1, t:r.t }; }
  return best;
}
function navState(){
  if (sim.on){
    const n = nav.coords.length - 1, f = sim.prog * n, i = Math.min(n-1, Math.floor(f)), t = f - i, a = nav.coords[i], b = nav.coords[i+1];
    return { lat: a[0]+(b[0]-a[0])*t, lon: a[1]+(b[1]-a[1])*t, i, t, off:0, sim:true };
  }
  if (!S.me) return null;
  const r = distToRoute([S.me.lat, S.me.lon]);
  return { lat:S.me.lat, lon:S.me.lon, i:r.i, t:r.t, off:r.d, sim:false };
}
function onNavPosition(){
  if (!nav) return;
  const st = navState();
  if (st && !st.sim && S.me){ // 記録
    const last = nav.track[nav.track.length-1];
    if (!last || distM([last[0], last[1]], [S.me.lat, S.me.lon]) >= 10) nav.track.push([+S.me.lat.toFixed(6), +S.me.lon.toFixed(6), S.me.alt != null ? Math.round(S.me.alt) : null, Date.now()]);
  }
  updateNav();
}
function updateNav(){
  if (!nav) return;
  const st = navState();
  navLayer.clearLayers();
  L.polyline(nav.coords.map(c => [c[0], c[1]]), { color:'#fff', weight:10, opacity:.9, interactive:false }).addTo(navLayer);
  L.polyline(nav.coords.map(c => [c[0], c[1]]), { color:'#D2462F', weight:6, interactive:false }).addTo(navLayer);
  for (const s of nav.stops) L.circleMarker([nav.coords[s.idx][0], nav.coords[s.idx][1]], { radius:6, color:'#fff', weight:2, fillColor: s.kind==='hut' ? '#B26A00' : s.kind==='peak' ? '#C0392B' : '#1E8E3E', fillOpacity:1 }).bindTooltip(s.name, { permanent:true, direction:'right', offset:[8,0], className:'lbl' }).addTo(navLayer);
  if (nav.track.length > 1) L.polyline(nav.track.map(p => [p[0], p[1]]), { color:'#1A73E8', weight:4, opacity:.8, interactive:false }).addTo(navLayer);
  if (!st){ $('#nDist').textContent = '現在地を待っています'; $('#nText').textContent = '位置情報を許可してください'; return; }
  if (st.sim) L.marker([st.lat, st.lon], { icon: L.divIcon({ className:'', html:'<div class="me-wrap"><div class="me-dot"></div></div>', iconSize:[18,18], iconAnchor:[9,9] }), interactive:false, zIndexOffset:1000 }).addTo(navLayer);
  drawMe();
  const i = st.i, fr = st.t, last = nav.coords.length - 1;
  const cumHere = nav.cum[i] + (nav.cum[i+1]-nav.cum[i])*fr, tmHere = nav.tm[i] + (nav.tm[i+1]-nav.tm[i])*fr;
  const next = nav.stops.find(s => s.idx > i) || nav.stops[nav.stops.length-1];
  const dist = nav.cum[next.idx] - cumHere;
  const now = st.sim ? nav.startT + tmHere*S.pace : nowMin();
  const goalIdx = nav.goalIdx > i ? nav.goalIdx : last;
  const remain = Math.max(0, (nav.tm[goalIdx] - tmHere) * S.pace), eta = now + remain, margin = (nav.sun.set - 60) - eta;
  const goalName = nav.stops.find(s => s.idx === goalIdx)?.name || '';
  $('#nIcon').innerHTML = next.kind === 'hut' ? IC.stay : next.kind === 'peak' ? IC.summit : IC.up;
  $('#nDist').textContent = dist < 1000 ? `${Math.max(0, Math.round(dist/10)*10)} m` : `${(dist/1000).toFixed(1)} km`;
  const eleHere = Math.round(nav.coords[i][2] + (nav.coords[i+1][2]-nav.coords[i][2])*fr);
  $('#nText').textContent = `${next.name}まで（標高差 ${next.idx < nav.coords.length ? Math.round(nav.coords[next.idx][2] - eleHere) : 0}m）`;
  const N = $('#nNote'); N.hidden = false; N.textContent = `今日の目的地：${goalName}　いまの標高 約${eleHere.toLocaleString()}m${st.sim ? '　（家で試す中）' : `　GPS精度 約${Math.round(S.me.acc)}m`}`;
  const cls = margin >= 60 ? 'ok' : margin >= 0 ? 'warn' : 'bad';
  const E = $('#nEta'); E.className = cls; E.textContent = dur(remain);
  $('#nSub').textContent = `${goalName} ${hm(eta)} 着予定・残り ${((nav.cum[goalIdx]-cumHere)/1000).toFixed(1)}km`;
  const SN = $('#nSun'); SN.className = 'sunchip ' + cls; SN.innerHTML = `日没 ${hm(nav.sun.set)}<br>${nav.sun.set - eta >= 0 ? '余裕 ' + dur(nav.sun.set - eta) : '日没後に到着'}`;
  const T = $('#nTurn');
  if (margin < 0 && i < goalIdx){
    const back = tmHere * S.pace * 0.75;
    T.hidden = false; T.innerHTML = `<b>このままだと、${esc(goalName)}に着くのが日没の1時間前を過ぎます。</b><span>ここで引き返すと、登山口に ${hm(now + back)} ごろ戻れます（推定）。</span>`;
  } else T.hidden = true;
  const O = $('#nOff');
  if (!st.sim && st.off > 60){ O.hidden = false; O.textContent = st.off > 2000 ? `ルートから ${(st.off/1000).toFixed(1)}km 離れています。登山口に着いてから使うか、「家で試す」をオンにしてください` : `登山道から ${Math.round(st.off)}m 外れています。来た道を戻ってください`; }
  else O.hidden = true;
  if (S.follow || st.sim) map.panTo([st.lat, st.lon], { animate:false });
}
function endNav(){
  if (nav && nav.track.length > 5){
    const tracks = store.get('tracks', []);
    tracks.unshift({ id: Date.now(), name: `${DATA.waypoints[nav.stops[0].k].name}〜 ${new Date(nav.startedAt).toLocaleDateString('ja-JP')}`, pts: nav.track });
    store.set('tracks', tracks.slice(0, 30)); toast('歩いた記録を保存しました');
  }
  try { wakeLock?.release(); } catch(e) {}
  nav = null; navLayer.clearLayers(); S.follow = false; setScreen('dir'); fitDir();
}
$('#simOn').addEventListener('change', e => { sim.on = e.target.checked; $('#simProg').hidden = !sim.on; updateNav(); });
$('#simProg').addEventListener('input', e => { sim.prog = e.target.value / 1000; updateNav(); });
$('#nEnd').addEventListener('click', endNav);

/* ---------- オフライン地図 ---------- */
function tileXY(lat, lon, z){ const n = 2**z, x = Math.floor((lon+180)/360*n), y = Math.floor((1 - Math.log(Math.tan(lat*rad) + 1/Math.cos(lat*rad))/Math.PI)/2*n); return [x, y]; }
function tileList(bounds, zmin, zmax){
  const urls = [];
  for (let z = zmin; z <= zmax; z++){
    const [x0, y1] = tileXY(bounds[0][0], bounds[0][1], z), [x1, y0] = tileXY(bounds[1][0], bounds[1][1], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++){
      urls.push(`https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x}/${y}.png`);
      if (z <= 16) urls.push(`https://cyberjapandata.gsi.go.jp/xyz/hillshademap/${z}/${x}/${y}.png`);
      if (z >= 13) urls.push(`https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`);
    }
  }
  return urls;
}
let saving = null;
async function saveArea(name, bounds){
  if (!('caches' in window)) { toast('このブラウザは地図の保存に対応していません'); return; }
  if (saving) { toast('保存中です。終わるまでお待ちください'); return; }
  const urls = tileList(bounds, 10, 17);
  const id = 'map-' + Date.now();
  const areas = store.get('areas', []);
  areas.unshift({ id, name, bounds, n: urls.length, bytes: 0, done: 0, date: new Date().toLocaleDateString('ja-JP') });
  store.set('areas', areas);
  saving = { id, done:0, n:urls.length };
  toast(`${name} の地図を保存しています（${urls.length}枚）`);
  const cache = await caches.open(id); let bytes = 0, done = 0, fail = 0;
  const worker = async () => {
    while (urls.length){
      const u = urls.pop();
      try { const r = await fetch(u, { mode:'cors' }); if (r.ok){ const b = await r.clone().blob(); bytes += b.size; await cache.put(u, r); } else fail++; } catch(e) { fail++; }
      done++; saving.done = done;
      if (done % 25 === 0) { updArea(id, { bytes, done }); if (S.screen === 'saved') renderSaved(); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  updArea(id, { bytes, done, fail }); saving = null;
  toast(fail ? `保存しました（${fail}枚は取得できませんでした）` : `${name} の地図を保存しました（${(bytes/1048576).toFixed(1)}MB）`);
  if (S.screen === 'saved') renderSaved();
}
function updArea(id, patch){ const a = store.get('areas', []); const x = a.find(v => v.id === id); if (x) Object.assign(x, patch); store.set('areas', a); }

/* ---------- 保存済み ---------- */
let confirmKey = null;
async function renderSaved(){
  const el = $('#saved'), areas = store.get('areas', []), tracks = store.get('tracks', []);
  let est = null; try { est = await navigator.storage?.estimate(); } catch(e) {}
  const used = areas.reduce((s, a) => s + (a.bytes||0), 0);
  el.innerHTML = `<h1>保存済み</h1>
    <h3>オフラインの地図</h3>
    ${est ? `<div class="meter"><i style="width:${Math.max(2, Math.min(100, used/(est.quota||1)*100))}%"></i></div><div class="note">地図で使用 ${(used/1048576).toFixed(1)}MB ／ このアプリが使える容量 約${(est.quota/1073741824).toFixed(1)}GB。保存できる数に上限はありません。</div>` : ''}
    <ul class="dl">${areas.length ? areas.map(a => `<li><div class="meta"><b>${esc(a.name)}</b><small>${a.date} 保存・${(a.bytes/1048576).toFixed(1)}MB${saving && saving.id === a.id ? '' : a.fail ? `・${a.fail}枚欠け` : ''}</small>${saving && saving.id === a.id ? `<div class="progress">保存中 ${saving.done}/${saving.n}</div>` : ''}</div><button class="mini" data-show="${a.id}">表示</button><button class="mini del${confirmKey===a.id ? ' confirm' : ''}" data-del="${a.id}">${confirmKey===a.id ? '削除する' : '削除'}</button></li>`).join('')
      : '<li><div class="meta"><b>保存した地図はありません</b><small>場所の「この周辺の地図を保存」か、経路の「このルートの地図を保存」から保存できます。圏外でも地図が表示されます。</small></div></li>'}</ul>
    <h3>歩いた記録</h3>
    <ul class="dl">${tracks.length ? tracks.map(t => { let d = 0; for (let i = 1; i < t.pts.length; i++) d += distM(t.pts[i-1], t.pts[i]); const ms = t.pts[t.pts.length-1][3] - t.pts[0][3];
        return `<li><div class="meta"><b>${esc(t.name)}</b><small>${(d/1000).toFixed(1)}km・${dur(ms/60000)}・${t.pts.length}点</small></div><button class="mini" data-gpx="${t.id}">GPX</button><button class="mini del${confirmKey==='t'+t.id ? ' confirm' : ''}" data-tdel="${t.id}">${confirmKey==='t'+t.id ? '削除する' : '削除'}</button></li>`; }).join('')
      : '<li><div class="meta"><b>記録はまだありません</b><small>登山ナビを使うと、歩いた道を自動で記録します（家で試すときは記録しません）。</small></div></li>'}</ul>
    <h3>このアプリについて</h3>
    <div class="note">実地テスト版です。地図：国土地理院（地理院タイル）。登山道・山名：© OpenStreetMap contributors。標高：国土地理院。コースタイムは推定値で、公式の標準コースタイムではありません。登山中は紙の地図・コンパス・ほかの登山アプリも必ず併用してください。<br>ホーム画面に追加すると、アプリのように全画面で使えます（iPhone：共有ボタン→ホーム画面に追加）。</div>`;
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.del;
    if (confirmKey !== id){ confirmKey = id; renderSaved(); return; }
    await caches.delete(id); store.set('areas', store.get('areas', []).filter(a => a.id !== id)); confirmKey = null; toast('地図を削除しました'); renderSaved();
  }));
  el.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => { const a = areas.find(x => x.id === b.dataset.show); setScreen('explore'); map.fitBounds(a.bounds); }));
  el.querySelectorAll('[data-tdel]').forEach(b => b.addEventListener('click', () => {
    const k = 't' + b.dataset.tdel;
    if (confirmKey !== k){ confirmKey = k; renderSaved(); return; }
    store.set('tracks', store.get('tracks', []).filter(t => String(t.id) !== b.dataset.tdel)); confirmKey = null; toast('記録を削除しました'); renderSaved();
  }));
  el.querySelectorAll('[data-gpx]').forEach(b => b.addEventListener('click', () => {
    const t = tracks.find(x => String(x.id) === b.dataset.gpx);
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="hyakkei-navi" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(t.name)}</name><trkseg>${t.pts.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[2]!=null ? `<ele>${p[2]}</ele>` : ''}<time>${new Date(p[3]).toISOString()}</time></trkpt>`).join('')}</trkseg></trk></gpx>`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([gpx], { type:'application/gpx+xml' })); a.download = `track-${t.id}.gpx`; a.click();
  }));
}

/* ---------- 共通 ---------- */
let toastT;
function toast(m){ const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3000); }
function renderAll(){
  renderTop(); renderSheet();
  $('#nav').hidden = S.screen !== 'nav'; $('#saved').hidden = S.screen !== 'saved';
  $('#tabbar').hidden = S.screen === 'nav';
  $('#fabs').hidden = S.screen === 'saved';
  $$('.tabbar button').forEach(b => { if ((b.dataset.tab === 'saved') === (S.screen === 'saved')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (S.screen === 'saved') renderSaved();
  drawPlaces(); drawRoutes();
  if (S.screen !== 'nav') navLayer.clearLayers();
  map.invalidateSize();
}
function setScreen(s){
  S.screen = s; S.picking = false; if (s === 'dir') S.sheet = 'peek';
  if (s === 'dir' && !S.sel) S.sel = 'tekari';
  if (s === 'nav') S.follow = true;
  renderAll();
  if (s === 'dir') setTimeout(fitDir, 50);
  if (s === 'nav') { map.setZoom(16); updateNav(); }
}
$$('.tabbar button').forEach(b => b.addEventListener('click', () => setScreen(b.dataset.tab)));
{ // シートの開閉（タップで段階、ドラッグで上下）
  const order = ['peek','half','full']; let y0 = null; const g = $('#grab');
  g.addEventListener('click', () => { S.sheet = order[(order.indexOf(S.sheet)+1) % 3]; setSheetH(); });
  g.addEventListener('pointerdown', e => { y0 = e.clientY; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointerup', e => { if (y0 === null) return; const dy = e.clientY - y0; y0 = null; if (Math.abs(dy) > 24){ const i = order.indexOf(S.sheet); S.sheet = order[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]; setSheetH(); e.preventDefault(); } });
}
$('#fLoc').addEventListener('click', () => {
  startWatch();
  if (S.me){ S.follow = !S.follow || map.distance(map.getCenter(), [S.me.lat, S.me.lon]) > 30; map.flyTo([S.me.lat, S.me.lon], Math.max(map.getZoom(), 15), { duration:.5 }); }
  else { S.follow = true; toast('現在地を探しています…'); }
  $('#fLoc').classList.toggle('follow', S.follow);
});
map.on('dragstart', () => { S.follow = false; $('#fLoc').classList.remove('follow'); });
$('#fLayer').addEventListener('click', () => {
  const el = $('#layers'); el.hidden = !el.hidden; if (el.hidden) return;
  el.innerHTML = Object.entries(BASES).map(([k,[n]]) => `<button data-b="${k}" aria-pressed="${S.base===k}">${n}</button>`).join('') + `<button data-t aria-pressed="${map.hasLayer(trailLayer)}">登山道（OSM）を重ねる</button>`;
  el.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', () => { setBase(b.dataset.b); el.hidden = true; }));
  el.querySelector('[data-t]').addEventListener('click', () => { map.hasLayer(trailLayer) ? map.removeLayer(trailLayer) : trailLayer.addTo(map); el.hidden = true; });
});
map.on('click', () => { $('#layers').hidden = true; if (S.screen === 'explore' && S.sel){ S.sel = null; S.query = ''; renderAll(); } });
addEventListener('resize', () => { setSheetH(); map.invalidateSize(); });

/* ---------- 起動 ---------- */
fetch('data/tekari.json').then(r => r.json()).then(d => {
  DATA = d; buildPois(); drawTrails(); renderAll();
  const p = poi('tekari'); map.setView([p.lat, p.lon + 0.02], 12);
  startWatch();
}).catch(() => toast('データを読み込めませんでした。電波のある所で一度開いてください'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
