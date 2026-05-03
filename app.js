'use strict';

/* ── TILES ── */
const TILES = {
  osm:  { url:'https://tile.openstreetmap.de/{z}/{x}/{y}.png', attr:'© OpenStreetMap', max:19 },
  dark: { url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr:'© CARTO', max:20 },
  topo: { url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attr:'© OpenTopoMap', max:17 },
  // Google Satellite - Mejor calidad y zoom hasta nivel 20
  sat:  { url:'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', attr:'© Google', max:20 }
};

/* ── GeoTIFF SUPPORT ── */
// Usamos geotiff.js desde CDN para leer archivos GeoTIFF
let GeoTIFF_lib = null;
async function loadGeoTIFFLib() {
  if (!GeoTIFF_lib) {
    GeoTIFF_lib = await import('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm');
  }
  return GeoTIFF_lib;
}

/* ══════════════════════════════════════════════════════════════
   PATRÓN ÚNICO PARA GRUPOS DE BOTONES OPT
   ─────────────────────────────────────────────────────────────
   setGroupActive(groupName, val):
   Busca el div[data-group="groupName"] en el DOM,
   quita .on de todos sus .opt-btn,
   y pone .on solo al que tiene data-val="val".
   
   Funciona aunque el panel esté oculto (display:none),
   porque accede al DOM directamente sin depender de visibilidad.
══════════════════════════════════════════════════════════════ */
function setGroupActive(groupName, val) {
  const row = document.querySelector(`.opt-row[data-group="${groupName}"]`);
  if (!row) return;
  row.querySelectorAll('.opt-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.val === val);
  });
}

/* ── TEMA ── */
let curTheme = 'dark';
function setTheme(t) {
  curTheme = t;
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('thbtn').textContent = t === 'dark' ? '🌙' : '☀';
  setGroupActive('theme', t);
}
function toggleTheme() { setTheme(curTheme === 'dark' ? 'light' : 'dark'); }

/* ── TABS ── */
function showTab(name, btn) {
  document.querySelectorAll('.spanel').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.stab').forEach(b => b.classList.remove('on'));
  document.getElementById('tab-' + name).classList.add('on');
  btn.classList.add('on');
}

/* ── MAPA PRINCIPAL ── */
const map = L.map('map', {
  center: [-17.99, -70.25], zoom: 13,
  zoomControl: true, attributionControl: true,
  zoomSnap: 0.25, zoomDelta: 1
});
map.zoomControl.setPosition('bottomleft');
L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

let mainTile = L.tileLayer(TILES.osm.url, { attribution: TILES.osm.attr, maxZoom: TILES.osm.max }).addTo(map);
let currentBaseKey = 'osm';

function swMain(key) {
  const cfg = TILES[key]; if (!cfg) return;
  currentBaseKey = key;
  
  // Configurar límite de zoom según tipo de capa
  // Google Satellite soporta hasta zoom 20 (~50m o menos), sin bloqueo
  if (key === 'sat') {
    map.setMaxZoom(20); // Google Satellite permite mayor zoom con buena calidad
  } else {
    map.setMaxZoom(cfg.max);
  }
  
  map.removeLayer(mainTile);
  mainTile = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: cfg.max }).addTo(map);
  mainTile.bringToBack();
  setGroupActive('main-bm', key);
}

/* ── MINI MAPA ── */
const mini = L.map('mmi', {
  center: map.getCenter(), zoom: Math.max(1, map.getZoom() - 5),
  zoomControl: false, attributionControl: false,
  dragging: false, touchZoom: false, scrollWheelZoom: false,
  doubleClickZoom: false, boxZoom: false, keyboard: false
});

let miniTile = L.tileLayer(TILES.dark.url, { maxZoom: 20 }).addTo(mini);

/*
  miniData: LayerGroup para los espejos de las geometrías DXF.
  IMPORTANTE: NO usar bringToFront() sobre un LayerGroup — ese método
  no existe en L.layerGroup y lanza TypeError, abortando la función.
  La superposición se controla por orden de addTo() al mapa mini.
*/
const miniData = L.layerGroup().addTo(mini);

function swMini(key) {
  const cfg = TILES[key]; if (!cfg) return;
  mini.removeLayer(miniTile);
  miniTile = L.tileLayer(cfg.url, { maxZoom: cfg.max }).addTo(mini);
  miniTile.bringToBack();
  /* NO llamar miniData.bringToFront() — LayerGroup no tiene ese método */
  setGroupActive('mini-bm', key);
}

function syncMini() {
  mini.setView(map.getCenter(), Math.max(1, map.getZoom() - 5), { animate: false });
  try {
    const b = map.getBounds();
    const tl = mini.latLngToContainerPoint(b.getNorthWest());
    const br = mini.latLngToContainerPoint(b.getSouthEast());
    const vp = document.getElementById('mm-vp');
    const W = 340, H = 230;
    const bw = Math.max(6, br.x - tl.x), bh = Math.max(6, br.y - tl.y);
    vp.style.left   = Math.max(0, Math.min(tl.x, W - bw)) + 'px';
    vp.style.top    = Math.max(0, Math.min(tl.y, H - bh)) + 'px';
    vp.style.width  = Math.min(bw, W) + 'px';
    vp.style.height = Math.min(bh, H) + 'px';
    vp.style.display = (bw >= W * 0.88 && bh >= H * 0.88) ? 'none' : 'block';
  } catch(e) {}
}
map.on('move zoom moveend zoomend', syncMini);
setTimeout(syncMini, 150);

/* ── UTM COORDS ── */
let utmDispZone = 18;
function wgs84ToUtm(lat, lng, zone) {
  const a=6378137, f=1/298.257223563, e2=2*f-f*f, ep2=e2/(1-e2);
  const k0=0.9996, E0=500000, N0=lat<0?10000000:0;
  const lng0=((zone-1)*6-180+3)*Math.PI/180;
  const phi=lat*Math.PI/180, lam=lng*Math.PI/180;
  const sp=Math.sin(phi), cp=Math.cos(phi), tp=Math.tan(phi);
  const Nv=a/Math.sqrt(1-e2*sp*sp), T=tp*tp, C=ep2*cp*cp, A=(lam-lng0)*cp;
  const M=a*((1-e2/4-3*e2*e2/64-5*e2**3/256)*phi
    -(3*e2/8+3*e2*e2/32+45*e2**3/1024)*Math.sin(2*phi)
    +(15*e2*e2/256+45*e2**3/1024)*Math.sin(4*phi)
    -(35*e2**3/3072)*Math.sin(6*phi));
  return {
    E: Math.round(E0 + k0*Nv*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120)),
    N: Math.round(N0 + k0*(M + Nv*tp*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720)))
  };
}
map.on('mousemove', e => {
  const {E,N} = wgs84ToUtm(e.latlng.lat, e.latlng.lng, utmDispZone);
  document.getElementById('uz').textContent  = utmDispZone + (e.latlng.lat < 0 ? 'S' : 'N');
  document.getElementById('ue').textContent  = E.toLocaleString();
  document.getElementById('un').textContent  = N.toLocaleString();
  document.getElementById('uzm').textContent = map.getZoom().toFixed(1);
  document.getElementById('sbz').textContent = map.getZoom().toFixed(1);
});
map.on('mouseout', () => ['uz','ue','un'].forEach(id => document.getElementById(id).textContent = '—'));
map.on('zoomend', () => { const z=map.getZoom().toFixed(1); document.getElementById('uzm').textContent=z; document.getElementById('sbz').textContent=z; });

/* ══════════════════════════════════════════════════════════════
   LAYER REGISTRY - DARK / PRINT SAFE
══════════════════════════════════════════════════════════════ */
const PAL = [
  '#1f5fbf', // azul profundo
  '#1e8449', // verde oscuro
  '#b9770e', // naranja quemado
  '#922b21', // rojo oscuro
  '#6c3483', // morado intenso
  '#117864', // teal oscuro
  '#9a7d0a', // amarillo oliva (print-safe)
  '#1b4f72', // azul acero
  '#a04000', // naranja oscuro
  '#4a3f8f', // violeta oscuro
  '#9b1b5a', // magenta oscuro
  '#196f3d', // verde bosque
  '#7b241c', // rojo vino
  '#2e86c1', // azul medio oscuro (contraste alto)
  '#7e5109'  // marrón profundo
];
let registry=[], totFeat=0, colI=0;
const pickCol = () => PAL[colI++ % PAL.length];

function registerLayer(name, group, count, mirrorFC) {
  const color = pickCol();
  const id = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2,4);
  group.addTo(map);
  styleGroup(group, color);
  if (mirrorFC) {
    try {
      const ml = L.geoJSON(mirrorFC, {
        pointToLayer: (f,ll) => L.circleMarker(ll, {radius:2, color, fillColor:color, fillOpacity:.4, weight:1}),
        style: () => ({color, weight:1, opacity:.8, fillOpacity:.18, fillColor:color})
      });
      ml._rid = id;
      miniData.addLayer(ml);
    } catch(e) { console.warn('mini mirror:', e); }
  }
  registry.push({id, name, color, group, count, visible:true});
  totFeat += count;
  document.getElementById('sfe').textContent = totFeat;
  renderList(); updateBadge();
}

function styleGroup(group, color) {
  const op = parseInt(document.getElementById('gop').value)/100;
  const wt = parseInt(document.getElementById('gwt').value);
  const opts = {color, fillColor:color, opacity:op, fillOpacity:op*0.2, weight:wt};
  const applyR = l => { if(l.setStyle) l.setStyle(opts); if(l.eachLayer) l.eachLayer(applyR); };
  applyR(group);
}

function applyStyle() {
  document.getElementById('opv').textContent = document.getElementById('gop').value;
  document.getElementById('wtv').textContent = document.getElementById('gwt').value;
  registry.forEach(ly => styleGroup(ly.group, ly.color));
}

function renderList() {
  const el = document.getElementById('llist');
  if (!registry.length) { el.innerHTML = '<div id="empty" style="padding:14px 12px;text-align:center;font-size:10px;color:var(--t3);line-height:1.7">Sin capas.<br/>Arrastra un DXF o GeoJSON.</div>'; return; }
  el.innerHTML = registry.map(ly => `
    <div class="litem">
      <div class="lclr" style="background:${ly.color}"></div>
      <div class="lnm" title="${ly.name}">${ly.name}</div>
      <div class="lcn">${ly.count}</div>
      <button class="ltog ${ly.visible?'on':''}" onclick="togLayer('${ly.id}')"></button>
    </div>`).join('');
}

function updateBadge() { document.getElementById('lcb').textContent = registry.length; }

function togLayer(id) {
  const ly = registry.find(l => l.id === id); if (!ly) return;
  ly.visible = !ly.visible;
  if (ly.visible) { map.addLayer(ly.group); userTextGroup.bringToFront(); }
  else { map.removeLayer(ly.group); }
  miniData.eachLayer(ml => {
    if (ml._rid !== id) return;
    const op = ly.visible ? 1 : 0;
    if (ml.eachLayer) ml.eachLayer(l => { if(l.setStyle) l.setStyle({opacity: ly.visible ? 0.8 : 0, fillOpacity: ly.visible ? 0.18 : 0}); });
  });
  renderList();
  // Forzar actualización visual del botón
  setTimeout(() => {
    const btn = document.querySelector(`button[onclick="togLayer('${id}')"]`);
    if (btn) {
      btn.classList.toggle('on', ly.visible);
    }
  }, 0);
}

function togAll(show) {
  registry.forEach(ly => { ly.visible=show; if(show) map.addLayer(ly.group); else map.removeLayer(ly.group); });
  if (show) userTextGroup.bringToFront();
  renderList();
}

function clearAll() {
  registry.forEach(ly => map.removeLayer(ly.group));
  registry=[]; totFeat=0; colI=0;
  document.getElementById('sfe').textContent = 0;
  miniData.clearLayers();
  clearTexts();
  renderList(); updateBadge();
  showToast('Capas eliminadas','inf');
}

/* ── FIT ALL ── */
function collectB(layer, acc) {
  if (layer.getLatLng) { try { acc.push(layer.getLatLng().toBounds(2)); } catch(e){} return; }
  if (layer.getBounds) { try { const b=layer.getBounds(); if(b&&b.isValid()){acc.push(b);return;} } catch(e){} }
  if (layer.eachLayer) layer.eachLayer(sub => collectB(sub, acc));
}
function fitAll() {
  const vis = registry.filter(l => l.visible);
  if (!vis.length) { showToast('No hay capas visibles','inf'); return; }
  const all = [];
  vis.forEach(ly => collectB(ly.group, all));
  if (!all.length) { showToast('Sin bounds válidos','inf'); return; }
  const merged = all.reduce((a,b) => a.extend(b), all[0]);
  if (merged.isValid()) map.fitBounds(merged, {padding:[40,40], maxZoom:20, animate:true});
}

/* ── FILE HANDLING ── */
const dz=document.getElementById('dz'), fi=document.getElementById('fi');
dz.addEventListener('dragover', e=>{e.preventDefault();dz.classList.add('over')});
dz.addEventListener('dragleave', ()=>dz.classList.remove('over'));
dz.addEventListener('drop', e=>{e.preventDefault();dz.classList.remove('over');if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0])});
fi.addEventListener('change', ()=>{if(fi.files[0]){handleFile(fi.files[0]);fi.value=''}});
document.getElementById('mc').addEventListener('dragover', e=>e.preventDefault());
document.getElementById('mc').addEventListener('drop', e=>{e.preventDefault();if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0])});

function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext==='dwg') { showToast('DWG: Exporta como DXF R2013','err'); setStatus('DWG no soportado','err'); return; }
  
  // Soporte para GeoTIFF
  if (ext==='tif' || ext==='tiff') {
    processGeoTIFF(file);
    return;
  }
  
  setStatus('Leyendo: '+file.name,'warn');
  showLoader('Procesando: '+file.name,'Analizando…');
  const r=new FileReader();
  r.onload = ev => {
    try {
      if (ext==='dxf') processDXF(ev.target.result, file.name);
      else if (ext==='geojson'||ext==='json') processGeoJSON(JSON.parse(ev.target.result), file.name);
      else throw new Error('Formato no soportado: .'+ext);
    } catch(err) { hideLoader(); showToast('Error: '+err.message,'err'); setStatus('Error: '+err.message,'err'); console.error(err); }
  };
  r.onerror = ()=>{hideLoader();showToast('No se pudo leer el archivo','err')};
  r.readAsText(file,'utf-8');
}

/* ── GeoTIFF ── */
async function processGeoTIFF(file) {
  try {
    showLoader('Cargando GeoTIFF...', 'Procesando imagen...');
    updateLoader('Leyendo archivo...');
    
    // Cargar librería geotiff.js
    const GeoTIFF = await loadGeoTIFFLib();
    
    // Leer el archivo como ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Parsear el GeoTIFF
    updateLoader('Analizando metadatos...');
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const fileDirectory = image.getFileDirectory();
    
    // Obtener información de la imagen
    const width = fileDirectory.ImageWidth;
    const height = fileDirectory.ImageLength;
    
    // Obtener transformación geográfica (GeoKeyDirectoryTag o ModelTransformation)
    let bbox = null;
    try {
      const geoKeys = image.getGeoKeys();
      if (geoKeys && geoKeys.GeoGTParams) {
        // Usar parámetros de transformación si están disponibles
        const tiePoints = image.getTiePoints();
        const resolution = image.getResolution();
        
        if (tiePoints && tiePoints.length > 0) {
          // Calcular bbox a partir de tie points
          const [i, j, k, x, y] = tiePoints[0];
          const [resX, resY] = resolution;
          
          const minX = x - i * resX;
          const maxY = y - j * resY;
          const maxX = minX + width * resX;
          const minY = maxY - height * resY;
          
          bbox = [minX, minY, maxX, maxY];
        }
      }
    } catch (e) {
      console.warn('No se pudo leer la información geográfica:', e);
    }
    
    if (!bbox) {
      hideLoader();
      showToast('GeoTIFF sin información geográfica válida', 'err');
      return;
    }
    
    updateLoader('Creando capa de imagen...');
    
    // Crear URL para el blob
    const url = URL.createObjectURL(new Blob([arrayBuffer], { type: 'image/tiff' }));
    
    // Para mostrar GeoTIFF en Leaflet, usamos ImageOverlay con los límites
    // Nota: Los navegadores no renderizan TIFF directamente, necesitamos convertirlo
    // Usaremos una aproximación creando un canvas o usando un servicio externo
    
    // Opción simplificada: Mostrar advertencia y usar solo los límites
    const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
    
    // Crear un rectángulo para mostrar los límites del GeoTIFF
    const rectangle = L.rectangle(bounds, {
      color: '#ff6b6b',
      weight: 2,
      dashArray: '10, 10',
      fillOpacity: 0.1
    });
    
    const group = L.featureGroup([rectangle]);
    
    // Agregar popup con información
    rectangle.bindPopup(`
      <b>${file.name}</b><br/>
      Dimensiones: ${width} x ${height} píxeles<br/>
      Límites:<br/>
      Min X: ${bbox[0].toFixed(4)}<br/>
      Min Y: ${bbox[1].toFixed(4)}<br/>
      Max X: ${bbox[2].toFixed(4)}<br/>
      Max Y: ${bbox[3].toFixed(4)}<br/>
      <small>Nota: Visualización completa requiere servidor de tiles</small>
    `);
    
    const name = file.name.replace(/\.[^.]+$/, '');
    registerLayer(name, group, 1, { type: 'GeoTIFF_BBOX', file: file });
    
    hideLoader();
    setTimeout(fitAll, 200);
    showToast(`✓ GeoTIFF cargado: ${width}x${height}`, 'ok');
    setStatus(`"${name}" — GeoTIFF`, 'ok');
    
  } catch (err) {
    hideLoader();
    showToast('Error GeoTIFF: ' + err.message, 'err');
    setStatus('Error: ' + err.message, 'err');
    console.error(err);
  }
}

/* ── GEOJSON ── */
function processGeoJSON(gj, fname) {
  updateLoader('Construyendo geometría…');
  if (!gj||!gj.type) throw new Error('GeoJSON inválido');
  let fc=gj;
  if (gj.type==='Feature') fc={type:'FeatureCollection',features:[gj]};
  if (gj.type==='Geometry') fc={type:'FeatureCollection',features:[{type:'Feature',geometry:gj,properties:{}}]};
  if (!fc.features?.length) {hideLoader();showToast('GeoJSON vacío','inf');return}

  const group = L.featureGroup();
  const mirrorFeats = [];

  const gjLayer = L.geoJSON(
    {type:'FeatureCollection', features: fc.features.filter(f=>f?.geometry)},
    {
      pointToLayer: (f,ll) => L.circleMarker(ll, {radius:5}),
      onEachFeature: (f,l) => { bindPopup(l, f.properties, fname); mirrorFeats.push(f); }
    }
  );
  group.addLayer(gjLayer);

  const count = mirrorFeats.length;
  hideLoader();
  if (!count) { showToast('Sin geometrías válidas','err'); return; }
  const name = fname.replace(/\.[^.]+$/,'');
  registerLayer(name, group, count, {type:'FeatureCollection',features:mirrorFeats});
  setTimeout(fitAll, 200);
  showToast(`✓ GeoJSON: ${count} features`,'ok');
  setStatus(`"${name}" — ${count} features`,'ok');
}

/* ══════════════════════════════════════════════════════════════
   PARSER DXF — sin dependencias externas
══════════════════════════════════════════════════════════════ */
function parseDXF(text) {
  /* Normalizar y construir array de pares [código, valor] */
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const P = [];
  for (let i=0; i+1<lines.length; i+=2) {
    const c = parseInt(lines[i].trim(), 10);
    if (!isNaN(c)) P.push([c, lines[i+1].trim()]);
  }

  /* Encontrar sección ENTITIES */
  let s0=-1, s1=P.length;
  for (let i=0; i<P.length; i++) {
    if (P[i][0]===2 && P[i][1]==='ENTITIES') s0=i+1;
    if (s0>0 && P[i][0]===0 && P[i][1]==='ENDSEC') { s1=i; break; }
  }
  if (s0<0) { console.warn('DXF: no se encontró sección ENTITIES'); return []; }

  /* Dividir en bloques de entidad */
  const blocks=[]; let cur=null;
  for (let i=s0; i<s1; i++) {
    if (P[i][0]===0) { if(cur) blocks.push(cur); cur={type:P[i][1], pairs:[]}; }
    else if (cur) cur.pairs.push(P[i]);
  }
  if (cur) blocks.push(cur);

  const SUPP = new Set(['LINE','LWPOLYLINE','POLYLINE','VERTEX','SEQEND','CIRCLE','ARC','POINT','INSERT','TEXT','MTEXT']);
  const out = [];
  let polyOpen = null;

  for (const blk of blocks) {
    if (!SUPP.has(blk.type)) { polyOpen=null; continue; }
    if (blk.type==='SEQEND') { polyOpen=null; continue; }

    if (blk.type==='VERTEX') {
      if (polyOpen) {
        let vx=undefined, vy=undefined;
        for (const [c,v] of blk.pairs) {
          if (c===10) vx=parseFloat(v);
          if (c===20) vy=parseFloat(v);
        }
        if (vx!==undefined && vy!==undefined && !isNaN(vx) && !isNaN(vy))
          polyOpen._v.push({x:vx, y:vy});
      }
      continue;
    }

    const ent = {type:blk.type, layer:'0', handle:''};

    if (blk.type==='LWPOLYLINE') {
      const xs=[], ys=[];
      for (const [c,v] of blk.pairs) {
        if (c===5)  ent.handle=v;
        else if (c===8)  ent.layer=v;
        else if (c===70) ent.flags=parseInt(v,10);
        else if (c===10) xs.push(parseFloat(v));
        else if (c===20) ys.push(parseFloat(v));
      }
      ent.vertices = xs.map((x,i)=>({x, y: ys[i]??0})).filter(v=>!isNaN(v.x)&&!isNaN(v.y));

    } else if (blk.type==='POLYLINE') {
      for (const [c,v] of blk.pairs) {
        if (c===5) ent.handle=v;
        else if (c===8) ent.layer=v;
        else if (c===70) ent.flags=parseInt(v,10);
      }
      ent._v=[]; polyOpen=ent;

    } else if (blk.type==='TEXT' || blk.type==='MTEXT') {
      for (const [c,v] of blk.pairs) {
        const n=parseFloat(v);
        if (c===5) ent.handle=v;
        else if (c===8) ent.layer=v;
        else if (c===10 && !isNaN(n)) ent.x=n;
        else if (c===20 && !isNaN(n)) ent.y=n;
        else if (c===40 && !isNaN(n)) ent.height=n;
        else if (c===1) ent.text=v;
        else if (c===3) ent.text=(ent.text||'')+v;
      }
      if (ent.text) ent.text=ent.text.replace(/\\[PNn]/g,' ').replace(/\{\\[^;]+;/g,'').replace(/\}/g,'').replace(/%%[cCdDpP]/g,'').replace(/\\U\+[0-9A-Fa-f]+/g,'').trim();

    } else {
      /* LINE, CIRCLE, ARC, POINT, INSERT */
      for (const [c,v] of blk.pairs) {
        const n=parseFloat(v);
        if (c===5) ent.handle=v;
        else if (c===8)  ent.layer=v;
        else if (c===10 && !isNaN(n)) ent.x=n;
        else if (c===20 && !isNaN(n)) ent.y=n;
        else if (c===30 && !isNaN(n)) ent.z=n;
        else if (c===11 && !isNaN(n)) ent.x2=n;
        else if (c===21 && !isNaN(n)) ent.y2=n;
        else if (c===40 && !isNaN(n)) ent.radius=n;
        else if (c===50 && !isNaN(n)) ent.startAngle=n;
        else if (c===51 && !isNaN(n)) ent.endAngle=n;
        else if (c===70) ent.flags=parseInt(v,10);
      }
    }

    if (blk.type!=='POLYLINE') polyOpen=null;
    out.push(ent);
  }

  /* Transferir vértices acumulados de POLYLINE */
  for (const e of out) {
    if (e.type==='POLYLINE' && e._v) { e.vertices=e._v; delete e._v; }
  }

  console.log(`DXF parseado: ${out.length} entidades en ENTITIES`);
  return out;
}

/* Convierte entidad DXF → GeoJSON Feature, null si no aplica */
function entToFeature(ent) {
  const p = {type:ent.type, layer:ent.layer};
  try {
    switch(ent.type) {

      case 'POINT':
        if (ent.x===undefined||ent.y===undefined) return null;
        return {type:'Feature', geometry:{type:'Point', coordinates:[ent.x,ent.y]}, properties:p};

      case 'LINE':
        if (ent.x===undefined||ent.y===undefined||ent.x2===undefined||ent.y2===undefined) return null;
        return {type:'Feature', geometry:{type:'LineString', coordinates:[[ent.x,ent.y],[ent.x2,ent.y2]]}, properties:p};

      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const v=ent.vertices;
        if (!v||v.length<2) return null;
        const coords=v.map(v=>[v.x,v.y]);
        const closed = !!(ent.flags && (ent.flags & 1));
        p.vertices=coords.length;
        if (closed && coords.length>=3) {
          const ring=[...coords];
          if (ring[0][0]!==ring[ring.length-1][0]||ring[0][1]!==ring[ring.length-1][1]) ring.push(ring[0]);
          return {type:'Feature', geometry:{type:'Polygon', coordinates:[ring]}, properties:p};
        }
        return {type:'Feature', geometry:{type:'LineString', coordinates:coords}, properties:p};
      }

      case 'CIRCLE': {
        if (ent.x===undefined||ent.y===undefined) return null;
        const r=ent.radius||1, pts=[];
        for (let i=0;i<=72;i++){const a=(i/72)*2*Math.PI;pts.push([ent.x+r*Math.cos(a),ent.y+r*Math.sin(a)]);}
        p.radius=r;
        return {type:'Feature', geometry:{type:'Polygon', coordinates:[pts]}, properties:p};
      }

      case 'ARC': {
        if (ent.x===undefined||ent.y===undefined) return null;
        const r=ent.radius||1;
        let sa=(ent.startAngle||0)*Math.PI/180, ea=(ent.endAngle||360)*Math.PI/180;
        if (ea<=sa) ea+=2*Math.PI;
        const tr=ea-sa, steps=Math.max(8,Math.round((tr*180/Math.PI)/5)), pts=[];
        for (let i=0;i<=steps;i++){const a=sa+tr*i/steps;pts.push([ent.x+r*Math.cos(a),ent.y+r*Math.sin(a)]);}
        p.radius=r;
        return {type:'Feature', geometry:{type:'LineString', coordinates:pts}, properties:p};
      }

      case 'INSERT':
        if (ent.x===undefined||ent.y===undefined) return null;
        return {type:'Feature', geometry:{type:'Point', coordinates:[ent.x,ent.y]}, properties:p};

      default: return null;
    }
  } catch(e) { console.warn('entToFeature error:', ent.type, e); return null; }
}

/* ══════════════════════════════════════════════════════════════
   PROCESAR DXF
══════════════════════════════════════════════════════════════ */
function processDXF(text, fname) {
  updateLoader('Parseando DXF…');
  const entities = parseDXF(text);
  if (!entities.length) { hideLoader(); showToast('DXF sin entidades reconocidas','err'); return; }

  const isUTM = entities.some(e => Math.abs(e.x||0)>1000 || Math.abs(e.y||0)>1000);
  if (isUTM) { document.getElementById('utmw').style.display='block'; showToast('⚠ Coordenadas UTM — ve a ⚙ Config','inf'); }

  const textEnts = entities.filter(e => (e.type==='TEXT'||e.type==='MTEXT') && e.x!==undefined && e.text);
  const geoEnts  = entities.filter(e => e.type!=='TEXT' && e.type!=='MTEXT');

  /* Agrupar por layer DXF */
  const byLayer = {};
  for (const e of geoEnts) {
    const l = e.layer||'0';
    if (!byLayer[l]) byLayer[l]=[];
    byLayer[l].push(e);
  }

  const base = fname.replace(/\.[^.]+$/,'');
  let totalAdded = 0;
  const layerNames = Object.keys(byLayer);

  for (let i=0; i<layerNames.length; i++) {
    const ln = layerNames[i];
    updateLoader(`Capa ${i+1}/${layerNames.length}: "${ln}"`);

    /* Convertir entidades → GeoJSON Features válidas */
    const feats = geoEnts
      .filter(e => (e.layer||'0')===ln)
      .map(entToFeature)
      .filter(f => f !== null);

    if (!feats.length) continue;

    const group = L.featureGroup();
    const mirrorFeats = [];

    /*
      FORMA CORRECTA de usar L.geoJSON con featureGroup:
      1. Crear el L.geoJSON layer con todas las features
      2. Agregar ese layer (el wrapper) al featureGroup
      3. onEachFeature solo se usa para bindPopup y recolectar mirrorFeats
      El L.geoJSON internamente crea sub-layers para cada feature y los
      maneja — no necesitamos agregarlos manualmente.
    */
    const gjLayer = L.geoJSON(
      {type:'FeatureCollection', features:feats},
      {
        pointToLayer: (f,ll) => L.circleMarker(ll, {radius:4}),
        onEachFeature: (f,l) => {
          bindPopup(l, f.properties, ln);
          mirrorFeats.push(f);
        }
      }
    );
    group.addLayer(gjLayer);

    const count = mirrorFeats.length;
    if (!count) continue;

    const dn = layerNames.length===1 ? base : `${base} › ${ln}`;
    registerLayer(dn, group, count, {type:'FeatureCollection', features:mirrorFeats});
    totalAdded += count;
  }

  /* Textos DXF como capa aparte */
  /*if (textEnts.length) {
    const tg = L.featureGroup();
    let tc = 0;
    for (const e of textEnts) {
      if (!e.text?.trim()) continue;
      const sz = Math.max(10, Math.min(18, (e.height||3)*1.8));
      const m = L.marker([e.y, e.x], {
        icon: L.divIcon({
          className: '',
          html: `<span style="font-size:${sz}px;font-family:'Space Mono',monospace;color:#fff;-webkit-text-stroke:1px #000;paint-order:stroke fill;white-space:nowrap;pointer-events:none">${esc(e.text)}</span>`,
          iconAnchor: [0, sz/2]
        })
      });
      tg.addLayer(m);
      tc++;
    }
    if (tc) { registerLayer(`${base} › [textos]`, tg, tc, null); totalAdded+=tc; }
  }*/

  hideLoader();
  if (!totalAdded) { showToast('No se encontraron geometrías convertibles','err'); return; }
  userTextGroup.bringToFront();
  setTimeout(fitAll, 300);
  showToast(`✓ DXF: ${totalAdded} elementos`+(layerNames.length>1?` en ${layerNames.length} capas`:''),'ok');
  setStatus(`"${base}" — ${totalAdded} elementos`,'ok');
}

/* ── REPROYECCIÓN UTM → WGS84 ── */
const UTM_CFG = {'17S':{z:17,n:false},'18S':{z:18,n:false},'19S':{z:19,n:false},'17N':{z:17,n:true},'18N':{z:18,n:true},'19N':{z:19,n:true}};
function utmToWgs84(E,N,zone,northH) {
  const a=6378137,f=1/298.257223563,e2=2*f-f*f,ep2=e2/(1-e2);
  const k0=0.9996,E0=500000,N0=northH?0:10000000;
  const x=E-E0,y=(N-N0)/k0;
  const mu=y/(a*(1-e2/4-3*e2*e2/64-5*e2**3/256));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const phi1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const sp=Math.sin(phi1),cp=Math.cos(phi1),tp=Math.tan(phi1);
  const N1=a/Math.sqrt(1-e2*sp*sp),T1=tp*tp,C1=ep2*cp*cp,R1=a*(1-e2)/Math.pow(1-e2*sp*sp,1.5),D=x/(N1*k0);
  const lat=phi1-(N1*tp/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720);
  const lng0=(zone-1)*6-180+3;
  const lng=lng0+(1/cp)*(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)*(180/Math.PI);
  return [lng, lat*180/Math.PI];
}
function xfCoords(coords,zone,northH) {
  if (typeof coords[0]==='number') return utmToWgs84(coords[0],coords[1],zone,northH);
  return coords.map(c=>xfCoords(c,zone,northH));
}
function reprojectAll() {
  const sel=document.getElementById('utmz').value;
  if (sel==='none') {showToast('Selecciona zona UTM','inf');return}
  const cfg=UTM_CFG[sel];
  if (!registry.length) {showToast('No hay capas','inf');return}
  showLoader('Reproyectando…','UTM '+sel+' → WGS84');
  setTimeout(()=>{
    try {
      registry.forEach(ly=>{
        const ng=L.featureGroup(); let cnt=0;
        const proc=l=>{
          if(l.eachLayer){l.eachLayer(proc);return}
          try{
            const gj=l.toGeoJSON?.();if(!gj?.geometry)return;
            const cl=JSON.parse(JSON.stringify(gj));
            cl.geometry.coordinates=xfCoords(cl.geometry.coordinates,cfg.z,cfg.n);
            L.geoJSON(cl,{pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:4}),onEachFeature:(f,nl)=>{bindPopup(nl,f.properties,ly.name);ng.addLayer(nl);cnt++;}});
          }catch(e){console.warn('reproj:',e)}
        };
        ly.group.eachLayer(proc);
        map.removeLayer(ly.group);ly.group=ng;ly.count=cnt;
        if(ly.visible)map.addLayer(ly.group);
        styleGroup(ly.group,ly.color);
      });
      miniData.clearLayers();
      hideLoader();renderList();
      document.getElementById('utmw').style.display='none';
      userTextGroup.bringToFront();
      setTimeout(fitAll,200);
      showToast('✓ Reproyectado ('+sel+')','ok');
      setStatus('Reproyectado desde UTM '+sel,'ok');
    }catch(e){hideLoader();showToast('Error: '+e.message,'err')}
  },50);
}

/* ── EDITOR TEXTOS ── */
let textMarkers=[], txtCnt=0, placing=false;
const userTextGroup = L.layerGroup().addTo(map);

function updatePreview() {
  const txt   = document.getElementById('txt-content').value||'Texto de prueba';
  const font  = document.getElementById('txt-font').value;
  const size  = parseInt(document.getElementById('txt-size').value)||14;
  const color = document.getElementById('txt-color').value;
  const sc    = document.getElementById('txt-sc').value;
  const sw    = parseInt(document.getElementById('txt-sw').value)||0;
  const bold  = document.getElementById('txt-bold').value;
  const ital  = document.getElementById('txt-ital').value;
  const pi    = document.getElementById('txt-pi');
  pi.style.fontFamily = font;
  pi.style.fontSize   = size+'px';
  pi.style.color      = color;
  pi.style.fontWeight = bold;
  pi.style.fontStyle  = ital;
  pi.style.background = 'transparent';
  pi.style.webkitTextStroke = sw>0 ? `${sw}px ${sc}` : '0px transparent';
  pi.style.paintOrder = 'stroke fill';
  pi.textContent = txt;
}

function buildIcon() {
  const txt   = document.getElementById('txt-content').value||'Texto';
  const font  = document.getElementById('txt-font').value;
  const size  = parseInt(document.getElementById('txt-size').value)||14;
  const color = document.getElementById('txt-color').value;
  const sc    = document.getElementById('txt-sc').value;
  const sw    = parseInt(document.getElementById('txt-sw').value)||0;
  const bold  = document.getElementById('txt-bold').value;
  const ital  = document.getElementById('txt-ital').value;
  const stroke= sw>0 ? `-webkit-text-stroke:${sw}px ${sc};paint-order:stroke fill` : '';
  return L.divIcon({
    className:'',
    html:`<span style="font-family:${font};font-size:${size}px;color:${color};font-weight:${bold};font-style:${ital};${stroke};white-space:nowrap;pointer-events:none;background:transparent">${esc(txt)}</span>`,
    iconAnchor:[0,size/2],
    // Importante para que el evento click se propague al marcador
    interactive: false
  });
}

function togglePlace() {
  placing=!placing;
  const btn=document.getElementById('txt-placebtn');
  if(placing){btn.textContent='✖ Cancelar (Esc)';btn.classList.add('placing');document.getElementById('map').classList.add('placing');}
  else{btn.textContent='📌 Clic en el mapa para colocar';btn.classList.remove('placing');document.getElementById('map').classList.remove('placing');}
}

map.on('click', e => {
  if (!placing) return;
  const txt = document.getElementById('txt-content').value;
  if (!txt?.trim()) {showToast('Escribe un texto primero','inf');return}
  txtCnt++;
  const id='T'+txtCnt;
  const marker = L.marker(e.latlng, {icon:buildIcon(), draggable:true, zIndexOffset:1000});
  userTextGroup.addLayer(marker);
  marker._tid=id;
  const label=txt.slice(0,24)+(txt.length>24?'…':'');
  textMarkers.push({id,marker,label});
  
  // Evento: inicio de arrastre
  marker.on('dragstart', function() {
    map.getContainer().style.cursor = 'grabbing';
  });
  
  // Evento: fin de arrastre - actualizar posición
  marker.on('dragend', function(e) {
    map.getContainer().style.cursor = '';
    renderTxtList();
    showToast('✏ Texto movido','inf');
  });
  
  // Evento: click en marcador existente para editar
  marker.on('click', function(e) {
    if (placing) return; // no editar mientras se coloca otro
    e.originalEvent.stopPropagation();
    openTextEdit(id);
  });
  
  renderTxtList();
  document.getElementById('txt-count').textContent=textMarkers.length;
});
document.addEventListener('keydown', e=>{if(e.key==='Escape'&&placing)togglePlace()});

function renderTxtList() {
  const el=document.getElementById('txt-list2');
  if(!textMarkers.length){el.innerHTML='<div style="padding:10px 12px;font-size:10px;color:var(--t3)">Sin textos colocados</div>';return}
  el.innerHTML=textMarkers.map(t=>`<div class="ti"><span style="font-size:10px;color:var(--acc)">T</span><span class="tn">${esc(t.label)}</span><button onclick="editTextFromList('${t.id}')" title="Editar">✎</button><button onclick="removeText('${t.id}')" title="Eliminar" style="margin-left:2px">✕</button></div>`).join('');
}
function editTextFromList(id) {
  openTextEdit(id);
}
function openTextEdit(id) {
  const t = textMarkers.find(x => x.id === id);
  if (!t) return;
  
  // Obtener el texto completo del tooltip o label almacenado
  const currentLabel = t.label;
  
  // Mostrar modal/prompt para editar
  const newText = prompt('Editar texto:', currentLabel);
  if (newText === null) return; // cancelado
  if (!newText.trim()) {
    showToast('El texto no puede estar vacío', 'err');
    return;
  }
  
  // Actualizar el label en el array
  t.label = newText.slice(0, 24) + (newText.length > 24 ? '…' : '');
  
  // Actualizar el tooltip del marcador si existe
  if (t.marker.getTooltip()) {
    t.marker.setTooltipContent(newText);
  } else {
    t.marker.bindTooltip(newText, {permanent: false, direction: 'top'});
  }
  
  // Actualizar el icono con el nuevo texto
  t.marker.setIcon(buildIconFromText(newText));
  
  renderTxtList();
  showToast('✓ Texto actualizado', 'ok');
}

// Función auxiliar para crear un icono desde un texto específico (no desde el input)
function buildIconFromText(texto) {
  const font  = document.getElementById('txt-font').value;
  const size  = parseInt(document.getElementById('txt-size').value)||14;
  const color = document.getElementById('txt-color').value;
  const sc    = document.getElementById('txt-sc').value;
  const sw    = parseInt(document.getElementById('txt-sw').value)||0;
  const bold  = document.getElementById('txt-bold').value;
  const ital  = document.getElementById('txt-ital').value;
  const stroke= sw>0 ? `-webkit-text-stroke:${sw}px ${sc};paint-order:stroke fill` : '';
  return L.divIcon({
    className:'',
    html:`<span style="font-family:${font};font-size:${size}px;color:${color};font-weight:${bold};font-style:${ital};${stroke};white-space:nowrap;pointer-events:none;background:transparent">${esc(texto)}</span>`,
    iconAnchor:[0,size/2],
    interactive: false
  });
}
function removeText(id) {
  const i=textMarkers.findIndex(t=>t.id===id);if(i<0)return;
  userTextGroup.removeLayer(textMarkers[i].marker);
  textMarkers.splice(i,1);
  renderTxtList();
  document.getElementById('txt-count').textContent=textMarkers.length;
}
function clearTexts() { textMarkers.forEach(t=>userTextGroup.removeLayer(t.marker)); textMarkers=[]; renderTxtList(); document.getElementById('txt-count').textContent=0; }

/* ── POPUP ── */
function bindPopup(layer, props, src) {
  const entries=Object.entries(props||{}).filter(([,v])=>v!=null&&v!=='');
  if(!entries.length){layer.bindPopup(`<span style="font-size:10px;color:var(--t3)">Sin atributos · ${esc(src)}</span>`);return}
  const rows=entries.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(String(v).slice(0,100))}</td></tr>`).join('');
  layer.bindPopup(`<div style="font-family:var(--mono);font-size:11px"><div style="color:var(--t3);margin-bottom:5px;font-size:10px">${esc(src)}</div><table class="ptbl">${rows}</table></div>`,{maxWidth:280});
}

/* ── EXPORT ── */
function exportGeoJSON() {
  if(!registry.length&&!textMarkers.length){showToast('No hay capas para exportar','inf');return}
  const feats=[];
  const coll=l=>{if(l.eachLayer){l.eachLayer(coll);return}try{const g=l.toGeoJSON?.();if(g?.type==='Feature')feats.push(g)}catch(e){}};
  registry.forEach(ly=>ly.group.eachLayer(coll));
  textMarkers.forEach(t=>{const ll=t.marker.getLatLng();feats.push({type:'Feature',geometry:{type:'Point',coordinates:[ll.lng,ll.lat]},properties:{text:t.label,type:'USER_TEXT'}})});
  const blob=new Blob([JSON.stringify({type:'FeatureCollection',features:feats},null,2)],{type:'application/json'});
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:`geoviewer_${Date.now()}.geojson`});
  a.click();URL.revokeObjectURL(a.href);
  showToast(`✓ Exportado: ${feats.length} features`,'ok');
}

/* ── GEOLOC ── */
function myLoc(){
  if(!navigator.geolocation){showToast('Geolocalización no disponible','err');return}
  navigator.geolocation.getCurrentPosition(p=>{map.setView([p.coords.latitude,p.coords.longitude],15,{animate:true});showToast('📍 Ubicación actualizada','ok')},()=>showToast('No se pudo obtener ubicación','err'));
}

/* ── UI HELPERS ── */
function showLoader(t,s){document.getElementById('ltxt').textContent=t;document.getElementById('lsub').textContent=s;document.getElementById('lov').classList.add('on')}
function updateLoader(t,s){if(t)document.getElementById('ltxt').textContent=t;if(s)document.getElementById('lsub').textContent=s}
function hideLoader(){document.getElementById('lov').classList.remove('on')}
function showToast(msg,type){const t=document.createElement('div');t.className='toast '+type;t.textContent=msg;document.getElementById('tc').appendChild(t);setTimeout(()=>t.remove(),3500)}
function setStatus(msg,s){document.getElementById('smsg').textContent=msg;const d=document.getElementById('sdot');d.className='sdot';if(s==='err')d.classList.add('err');if(s==='warn')d.classList.add('warn')}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

/* INIT */
document.getElementById('sbz').textContent=map.getZoom();
setStatus('Listo','ok');
updatePreview();
