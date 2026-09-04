document.addEventListener("DOMContentLoaded", ()=>{
  const CENTER = [48.5231, 35.8707]; // Pavлоград (центр)
  let lastTargetsUpdated = null;
  let lastLaunchUpdated = null;
  let lastZonesUpdated = null;
  let lastLaunchFetchMs = 0;

  const CITY_NEAR_M = 15000;   // "підлітає"
  const CITY_ALERT_M = 7000;   // "наближається"
  const CITY_DANGER_M = 3000;  // "дуже близько"

  // MUST exist before applyTheme()/refreshIcons() is called
  const markers = new Map(); // id -> {marker,line,trajLine,base,dest,dir,phase,prog,type,note,created_at,speed_kmh,last_anim_ms,active,prox}
  function setIconIfChanged(o, icon, key){
    if(o._iconKey === key) return;
    o._iconKey = key;
    try{ o.marker.setIcon(icon); }catch(_){ }
  }


  const map = L.map('map', { zoomControl:true }).setView(CENTER, 11);
  function ensurePvlsSignalLegend(){
    const wrap=document.querySelector('.map-wrap');
    if(!wrap) return;
    let box=wrap.querySelector('.signal-mini');
    if(!box){
      box=document.createElement('div');
      box.className='signal-mini';
      box.setAttribute('aria-hidden','true');
      wrap.appendChild(box);
    }
    box.innerHTML=`<div style="font-size:10px;font-weight:950;letter-spacing:.25px;opacity:.66;margin-bottom:7px">ПІДСВІТКА ЦІЛЕЙ</div>
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:950"><span style="width:10px;height:10px;border-radius:50%;background:#3a86ff;box-shadow:0 0 13px rgba(58,134,255,.60);flex:0 0 auto"></span>Реактивний шахед</div>
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:950;margin-top:6px"><span style="width:10px;height:10px;border-radius:50%;background:#c10f2a;box-shadow:0 0 13px rgba(193,15,42,.55);flex:0 0 auto"></span>Звичайний шахед</div>`;
    Object.assign(box.style,{
      position:'absolute',left:'14px',bottom:'82px',zIndex:'12050',minWidth:'182px',
      padding:'10px 12px',borderRadius:'15px',pointerEvents:'none',
      background:'rgba(18,22,36,.58)',border:'1px solid rgba(255,255,255,.16)',
      boxShadow:'0 10px 28px rgba(0,0,0,.24)',backdropFilter:'blur(10px)',
      webkitBackdropFilter:'blur(10px)',color:'#fff',lineHeight:'1.15'
    });
  }

  ensurePvlsSignalLegend();

  const baseLight = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap'});
  const baseTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {maxZoom:17, attribution:'&copy; OpenStreetMap contributors • OpenTopoMap'});
  const baseHOT = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {maxZoom:20, attribution:'&copy; OpenStreetMap contributors • HOT'});

  // Stable MapTiler-backed basemaps. We use the existing public browser key.
  // Vector Leaflet integration gives us Ukrainian labels; raster XYZ is a fallback.
  function createPvlsMapTilerStyle(styleId, opts={}){
    const key = String(window.PVLS_MAPTILER_KEY || "").trim();
    if(!key) return null;
    const language = opts.language === false ? null : (opts.language || "uk");
    const enhanceLabels = !!opts.enhanceLabels;
    const strictUa = !!opts.strictUa;

    try{
      const factory =
        (L.maptiler && typeof L.maptiler.maptilerLayer === "function" && L.maptiler.maptilerLayer.bind(L.maptiler)) ||
        (window.leafletmaptilersdk && typeof window.leafletmaptilersdk.maptilerLayer === "function" && window.leafletmaptilersdk.maptilerLayer.bind(window.leafletmaptilersdk)) ||
        (typeof L.maptilerLayer === "function" && L.maptilerLayer.bind(L));

      if(factory){
        const layer = factory({
          apiKey:key,
          style:styleId,
          language:language || undefined,
          navigationControl:false,
          geolocateControl:false,
          terrainControl:false,
          scaleControl:false,
          fullscreenControl:false,
          maptilerLogo:true,
          logoPosition:"top-right",
        });
        if(layer && typeof layer.on === "function"){
          layer.on("ready", ()=>{
            try{ if(language && typeof layer.setLanguage === "function") layer.setLanguage(language); }catch(_){ }
            if(enhanceLabels) enhancePvlsMapTilerLabels(layer);
            if(strictUa) forcePvlsStrictUkrainianLabels(layer);
          });
        }
        if(layer) return layer;
      }
    }catch(err){
      console.warn(`MapTiler ${styleId} vector layer unavailable; using raster fallback`, err);
    }

    return L.tileLayer(`https://api.maptiler.com/maps/${styleId}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`, {
      minZoom:1,
      maxZoom:20,
      crossOrigin:true,
      attribution:'&copy; MapTiler &copy; OpenStreetMap contributors'
    });
  }

  function enhancePvlsMapTilerLabels(layer){
    try{
      const mt = layer && layer.getMaptilerMap ? layer.getMaptilerMap() : null;
      if(!mt || mt.__pvlsLabelsEnhanced) return;
      mt.__pvlsLabelsEnhanced = true;
      const style = mt.getStyle ? mt.getStyle() : null;
      const layers = style && Array.isArray(style.layers) ? style.layers : [];
      for(const sl of layers){
        if(!sl || sl.type !== "symbol" || !sl.layout || sl.layout["text-field"] == null) continue;
        const id = String(sl.id || "");
        // We mainly strengthen geographic/place labels, not road shields/icons.
        const placeLabel = /(place|settlement|city|town|village|hamlet|locality|country|state|region|municip|poi-label)/i.test(id);
        if(!placeLabel) continue;
        try{ mt.setPaintProperty(id, "text-halo-color", "rgba(255,255,255,0.94)"); }catch(_){ }
        try{ mt.setPaintProperty(id, "text-halo-width", 2.1); }catch(_){ }
        try{ mt.setPaintProperty(id, "text-halo-blur", 0.35); }catch(_){ }
        try{ mt.setPaintProperty(id, "text-opacity", 1); }catch(_){ }

        const oldSize = sl.layout["text-size"];
        if(oldSize != null){
          const factor = /(city|town|settlement|place)/i.test(id) ? 1.18 : 1.10;
          try{
            if(typeof oldSize === "number") mt.setLayoutProperty(id, "text-size", oldSize * factor);
            else if(Array.isArray(oldSize)) mt.setLayoutProperty(id, "text-size", ["*", oldSize, factor]);
          }catch(_){ }
        }
      }
    }catch(err){
      console.warn("MapTiler label enhancement skipped", err);
    }
  }


  function forcePvlsStrictUkrainianLabels(layer){
    try{
      const mt = layer && layer.getMaptilerMap ? layer.getMaptilerMap() : null;
      if(!mt) return;
      const uk =
        (L.maptiler && L.maptiler.Language && L.maptiler.Language.UKRAINIAN) ||
        (window.leafletmaptilersdk && window.leafletmaptilersdk.Language && window.leafletmaptilersdk.Language.UKRAINIAN) ||
        (window.maptilersdk && window.maptilersdk.Language && window.maptilersdk.Language.UKRAINIAN) ||
        "uk";
      try{ if(typeof mt.setLanguage === "function") mt.setLanguage(uk); }catch(_){ }

      const style = mt.getStyle ? mt.getStyle() : null;
      const layers = style && Array.isArray(style.layers) ? style.layers : [];
      // Strict mode: only real Ukrainian fields from the vector data are allowed.
      // If no Ukrainian name exists, the label stays empty instead of falling back to Latin/English.
      const strictUkName = [
        "coalesce",
        ["get","name:uk"],
        ["get","name_uk"],
        ""
      ];
      for(const sl of layers){
        if(!sl || sl.type !== "symbol" || !sl.layout || sl.layout["text-field"] == null) continue;
        try{ mt.setLayoutProperty(sl.id, "text-field", strictUkName); }catch(_){ }
      }
    }catch(err){
      console.warn("MapTiler strict Ukrainian label enforcement skipped", err);
    }
  }

  function stylePvlsSatelliteLabelsOnly(layer){
    try{
      const mt = layer && layer.getMaptilerMap ? layer.getMaptilerMap() : null;
      if(!mt) return;
      const uk =
        (L.maptiler && L.maptiler.Language && L.maptiler.Language.UKRAINIAN) ||
        (window.leafletmaptilersdk && window.leafletmaptilersdk.Language && window.leafletmaptilersdk.Language.UKRAINIAN) ||
        (window.maptilersdk && window.maptilersdk.Language && window.maptilersdk.Language.UKRAINIAN) ||
        'uk';
      try{ if(typeof mt.setLanguage === 'function') mt.setLanguage(uk); }catch(_){ }

      const style = mt.getStyle ? mt.getStyle() : null;
      const layers = style && Array.isArray(style.layers) ? style.layers : [];
      for(const sl of layers){
        if(!sl || !sl.id) continue;
        // The streets style is used only as a transparent labels/roads overlay.
        // Hide every painted basemap layer so the satellite imagery stays visible.
        if(sl.type !== 'symbol'){
          try{ mt.setLayoutProperty(sl.id, 'visibility', 'none'); }catch(_){ }
          continue;
        }

        const hasText = !!(sl.layout && sl.layout['text-field'] != null);
        if(hasText){
          const strictUkName = [
            'coalesce',
            ['get','name:uk'],
            ['get','name_uk'],
            ''
          ];
          try{ mt.setLayoutProperty(sl.id, 'text-field', strictUkName); }catch(_){ }
          // High-contrast labels for satellite imagery; keep native collision/zoom behavior.
          try{ mt.setPaintProperty(sl.id, 'text-color', '#ffffff'); }catch(_){ }
          try{ mt.setPaintProperty(sl.id, 'text-halo-color', 'rgba(0,0,0,0.92)'); }catch(_){ }
          try{ mt.setPaintProperty(sl.id, 'text-halo-width', 1.7); }catch(_){ }
          try{ mt.setPaintProperty(sl.id, 'text-halo-blur', 0.25); }catch(_){ }
          try{ mt.setPaintProperty(sl.id, 'text-opacity', 1); }catch(_){ }
        }
      }
    }catch(err){
      console.warn('Satellite UA labels styling skipped', err);
    }
  }

  function createPvlsSatelliteLabelsOverlay(){
    const key = String(window.PVLS_MAPTILER_KEY || '').trim();
    if(!key) return null;
    try{
      const factory =
        (L.maptiler && typeof L.maptiler.maptilerLayer === 'function' && L.maptiler.maptilerLayer.bind(L.maptiler)) ||
        (window.leafletmaptilersdk && typeof window.leafletmaptilersdk.maptilerLayer === 'function' && window.leafletmaptilersdk.maptilerLayer.bind(window.leafletmaptilersdk)) ||
        (typeof L.maptilerLayer === 'function' && L.maptilerLayer.bind(L));
      if(!factory) return null;

      const layer = factory({
        apiKey:key,
        style:'streets-v4',
        language:'uk',
        navigationControl:false,
        geolocateControl:false,
        terrainControl:false,
        scaleControl:false,
        fullscreenControl:false,
        maptilerLogo:true,
        logoPosition:'top-right',
      });
      if(layer && typeof layer.on === 'function'){
        layer.on('ready', ()=>{
          stylePvlsSatelliteLabelsOnly(layer);
          forcePvlsStrictUkrainianLabels(layer);
          // Some SDK builds finalize their style just after the ready event.
          setTimeout(()=>{ stylePvlsSatelliteLabelsOnly(layer); forcePvlsStrictUkrainianLabels(layer); }, 200);
          setTimeout(()=>{ stylePvlsSatelliteLabelsOnly(layer); forcePvlsStrictUkrainianLabels(layer); }, 800);
        });
      }
      return layer || null;
    }catch(err){
      console.warn('MapTiler satellite UA label overlay unavailable', err);
      return null;
    }
  }

  function createPvlsHybridUaLayer(){
    const key = String(window.PVLS_MAPTILER_KEY || '').trim();
    if(!key) return null;

    // Satellite imagery is deliberately separate from labels. This avoids baked-in
    // Latin names and lets the Ukrainian vector label layer behave naturally by zoom.
    const satellite = L.tileLayer(`https://api.maptiler.com/maps/satellite-v4/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`, {
      tileSize:512,
      zoomOffset:-1,
      minZoom:1,
      maxZoom:20,
      crossOrigin:true,
      attribution:'&copy; MapTiler &copy; OpenStreetMap contributors'
    });
    const labels = createPvlsSatelliteLabelsOverlay();
    const group = L.layerGroup([satellite]);
    if(labels) group.addLayer(labels);
    group.__pvlsLabelsOverlay = labels;
    return group;
  }


  // MapTiler Hybrid satellite. Use the same proven factory/fallback path as
  // the other MapTiler basemaps, so this item can never silently disappear.
  const baseVoyager = createPvlsMapTilerStyle('voyager-v2', {language:'uk', enhanceLabels:true});
  const baseOutdoor = createPvlsMapTilerStyle('outdoor-v4', {language:'uk', enhanceLabels:true});
  const baseDark = createPvlsMapTilerStyle('dataviz-dark', {language:'uk', enhanceLabels:true});
  const baseMapTiler = createPvlsMapTilerStyle('streets-v4', {language:'uk', enhanceLabels:true, strictUa:true});
  const baseSatelliteUa = createPvlsHybridUaLayer();

  const baseLayers = {
    'Стандартна OSM': baseLight,
    'Voyager 🇺🇦 (детальна)': baseVoyager,
    'Outdoor 🇺🇦 (детальна)': baseOutdoor,
    'Топографічна': baseTopo,
    'Гуманітарна': baseHOT,
    'Темна MapTiler': baseDark,
    'MapTiler 🇺🇦 (чіткі назви)': baseMapTiler,
    '🛰 Супутник Hybrid UA 🇺🇦': baseSatelliteUa,
  };
  // Keep old storage keys compatible: old cyclOSM now opens the stable Outdoor layer, old dark opens MapTiler dark.
  const layerKeyMap = {
    osm:baseLight, voyager:baseVoyager, cyclosm:baseOutdoor, outdoor:baseOutdoor,
    topo:baseTopo, hot:baseHOT, dark:baseDark, maptiler:baseMapTiler,
    satellite_ua:baseSatelliteUa, satellite_hybrid:baseSatelliteUa, satellite:baseSatelliteUa
  };
  // Remove any unavailable optional MapTiler layer cleanly instead of leaving a dead radio item.
  for(const [name,layer] of Object.entries({...baseLayers})){ if(!layer) delete baseLayers[name]; }
  for(const [key,layer] of Object.entries({...layerKeyMap})){ if(!layer) delete layerKeyMap[key]; }
  const allBaseLayers = [...new Set(Object.values(layerKeyMap))];
  let currentBase = null;
  const isDarkBaseLayer = (layer)=> layer===baseDark || layer===baseSatelliteUa;

  const targetsLayer = L.layerGroup().addTo(map);
  const isBallisticType = (tp)=> String(tp||'').toLowerCase()==='ballistic';
  const linesLayer   = L.layerGroup().addTo(map);
  const launchLayer  = L.layerGroup().addTo(map);
  const threatZonesLayer = L.layerGroup().addTo(map);
  const threatZoneObjects = new Map();

  // Scale bar
  try{ L.control.scale({imperial:false, maxWidth:140}).addTo(map); }catch(_){}

  function refreshIcons(){
    // Rebuild icons to match theme / proximity / effects
    for(const o of markers.values()){
      const prox = getProxFlags(o.base);
      const effectsOn = !document.body.classList.contains("effects-off");
      const iconKey = `${o.type}|${o.dir}|${prox.near?1:0}|${prox.danger?1:0}`;
      setIconIfChanged(o, makeIconAnimated(o.type, o.dir, true, {
        pulse:false,
        pop:false,
        near: prox.near,
        danger: prox.danger
      }), iconKey);
    }
  }

  function layerKey(layer){
    for(const [k,v] of Object.entries(layerKeyMap)){ if(v===layer) return k; }
    return 'osm';
  }

  function applyVisualTheme(theme){
    const th = (theme==="dark") ? "dark" : "light";
    localStorage.setItem("pvls_map_theme", th);
    document.documentElement.setAttribute("data-theme", th);
    if(th==="dark"){
      setIconTheme("light");
      const wm=document.getElementById("wmLayer"); if(wm) wm.dataset.theme="light";
      const btn=document.getElementById("themeBtn"); if(btn) btn.textContent="☀";
    }else{
      setIconTheme("dark");
      const wm=document.getElementById("wmLayer"); if(wm) wm.dataset.theme="dark";
      const btn=document.getElementById("themeBtn"); if(btn) btn.textContent="☾";
    }
    refreshIcons();
  }

  function setBaseLayer(layer){
    for(const b of allBaseLayers){ if(map.hasLayer(b)) map.removeLayer(b); }
    currentBase=layer || baseLight;
    currentBase.addTo(map);
    localStorage.setItem('pvls_map_layer', layerKey(currentBase));
    applyVisualTheme(isDarkBaseLayer(currentBase) ? 'dark' : 'light');
  }

  function applyTheme(theme){
    setBaseLayer((theme==="dark" && baseDark) ? baseDark : baseLight);
  }

  // Watermark overlay
  const wm = document.getElementById("wmLayer");
  if (wm){ wm.style.pointerEvents="none"; }

  function rebuildWatermarkGrid(){
    if(!wm) return;
    wm.innerHTML = "";
    const rect = wm.getBoundingClientRect();
    const spacingX = (window.innerWidth <= 520) ? 250 : 340;
    const spacingY = (window.innerWidth <= 520) ? 150 : 190;
    const startX = -120;
    const startY = -40;
    const cols = Math.ceil((rect.width + 240) / spacingX) + 1;
    const rows = Math.ceil((rect.height + 120) / spacingY) + 1;
    for(let row=0; row<rows; row++){
      for(let col=0; col<cols; col++){
        const item = document.createElement("div");
        item.className = "wm-item";
        const x = startX + col * spacingX + ((row % 2) ? spacingX / 2 : 0);
        const y = startY + row * spacingY;
        item.style.left = `${x}px`;
        item.style.top = `${y}px`;
        item.innerHTML = `<div class="wm-main">PAVLOGRAD SKY</div><div class="wm-sub">t.me/pavlograd_sky</div>`;
        wm.appendChild(item);
      }
    }
  }

  const themeBtn=document.getElementById("themeBtn");
  L.control.layers(baseLayers, {}, {position:'topleft', collapsed:true}).addTo(map);
  map.on('baselayerchange',(e)=>{
    currentBase=e.layer;
    localStorage.setItem('pvls_map_layer', layerKey(currentBase));
    applyVisualTheme(isDarkBaseLayer(currentBase) ? 'dark' : 'light');
  });
  if(themeBtn){
    themeBtn.addEventListener("click", ()=>{
      applyTheme(isDarkBaseLayer(currentBase) ? "light" : "dark");
    });
  }
  const savedLayer=localStorage.getItem('pvls_map_layer');
  setBaseLayer(layerKeyMap[savedLayer] || ((localStorage.getItem("pvls_map_theme")||"light")==="dark" ? baseDark : baseLight));
  rebuildWatermarkGrid();
  window.addEventListener("resize", rebuildWatermarkGrid);

  setTimeout(()=>{ try{ map.invalidateSize(); map.setView(CENTER, 11); }catch(_){ } }, 250);

  function applyActiveClass(marker, active, type="unknown"){
    const el = marker && marker.getElement ? marker.getElement() : null;
    if(!el) return;
    el.classList.toggle("t-active", !!active);
    el.classList.toggle("t-inactive", !active);
    for(const cls of Array.from(el.classList)){
      if(cls.startsWith("type-")) el.classList.remove(cls);
    }
    el.classList.add(`type-${String(type||"unknown").toLowerCase()}`);
  }

  // ---------------- UI (drawers / effects / filters / feed) ----------------
  const drawerFilters = document.getElementById("drawerFilters");
  const drawerLegend  = document.getElementById("drawerLegend");
  const filtersBtn    = document.getElementById("filtersBtn");
  const legendBtn     = document.getElementById("legendBtn");
  const effectsToggle = document.getElementById("effectsToggle");
  const onlyActiveEl  = document.getElementById("onlyActive");
  const showRoutesEl  = document.getElementById("showRoutes");
  const feedList      = document.getElementById("feedList");
  const feedClear     = document.getElementById("feedClear");
  const feedClose     = document.getElementById("feedClose");
  const feedToggle    = document.getElementById("feedToggle");

  function setFeedVisible(on){
    const feed = document.getElementById("feed");
    if(!feed) return;
    feed.classList.toggle("hidden", !on);
  }

  if(feedClose) feedClose.addEventListener("click", ()=> setFeedVisible(false));
  if(feedToggle) feedToggle.addEventListener("click", ()=>{
    const feed = document.getElementById("feed");
    const isHidden = feed ? feed.classList.contains("hidden") : false;
    setFeedVisible(isHidden);
  });

  function openDrawer(el){
    if(!el) return;
    el.classList.add("open");
  }
  function closeDrawer(el){
    if(!el) return;
    el.classList.remove("open");
  }
  function closeAllDrawers(){
    closeDrawer(drawerFilters);
    closeDrawer(drawerLegend);
  }

  if(filtersBtn) filtersBtn.addEventListener("click", ()=>{
    const open = drawerFilters && drawerFilters.classList.contains("open");
    closeAllDrawers();
    if(!open) openDrawer(drawerFilters);
  });
  if(legendBtn) legendBtn.addEventListener("click", ()=>{
    const open = drawerLegend && drawerLegend.classList.contains("open");
    closeAllDrawers();
    if(!open) openDrawer(drawerLegend);
  });

  document.querySelectorAll("[data-close]").forEach((btn)=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-close");
      const el = document.getElementById(id);
      closeDrawer(el);
    });
  });

  // Close drawers on Esc
  document.addEventListener("keydown", (e)=>{
    if(e.key==="Escape"){
      closeAllDrawers();
      if(measureMode) setMeasureMode(false);
    }
  });

  // Effects toggle (persist)
  const effectsKey="pvls_map_effects";
  const savedEff = localStorage.getItem(effectsKey);
  const effectsOn = (savedEff===null) ? true : (savedEff==="1");
  if(!effectsOn) document.body.classList.add("effects-off");
  if(effectsToggle) effectsToggle.checked = effectsOn;
  if(effectsToggle){
    effectsToggle.addEventListener("change", ()=>{
      const on = !!effectsToggle.checked;
      localStorage.setItem(effectsKey, on ? "1":"0");
      document.body.classList.toggle("effects-off", !on);
      refreshIcons();
    });
  }

  // Filters (persist)
  const fltKey="pvls_map_filters";
  const defaultFilters = ["shahed","gerbera","recon","fpv","cruise","ballistic","aircraft","unknown"];
  let filters = new Set(defaultFilters);
  try{
    const raw = localStorage.getItem(fltKey);
    if(raw){
      const arr = JSON.parse(raw);
      if(Array.isArray(arr) && arr.length) filters = new Set(arr);
    }
  }catch(_){}

  // set checkbox state
  document.querySelectorAll("input.flt").forEach((cb)=>{
    cb.checked = filters.has(cb.value);
    cb.addEventListener("change", ()=>{
      if(cb.checked) filters.add(cb.value); else filters.delete(cb.value);
      localStorage.setItem(fltKey, JSON.stringify(Array.from(filters)));
      applyFilters();
    });
  });

  const onlyActiveKey="pvls_map_onlyActive";
  const showRoutesKey="pvls_map_showRoutes";

  const onlyActiveSaved = localStorage.getItem(onlyActiveKey);
  const showRoutesSaved = localStorage.getItem(showRoutesKey);
  if(onlyActiveEl) onlyActiveEl.checked = (onlyActiveSaved===null) ? true : (onlyActiveSaved==="1");
  if(showRoutesEl) showRoutesEl.checked = (showRoutesSaved===null) ? true : (showRoutesSaved==="1");

  if(onlyActiveEl){
    onlyActiveEl.addEventListener("change", ()=>{
      localStorage.setItem(onlyActiveKey, onlyActiveEl.checked ? "1":"0");
      applyFilters();
    });
  }
  if(showRoutesEl){
    showRoutesEl.addEventListener("change", ()=>{
      localStorage.setItem(showRoutesKey, showRoutesEl.checked ? "1":"0");
      applyFilters();
    });
  }

  // Feed
  const FEED_MAX = 20;
  let feed = []; // {id, ts, title, sub, latlng?}
  function pushFeed(title, sub="", latlng=null, targetId=null){
    const item = { key: `${Date.now()}_${Math.random().toString(16).slice(2)}`, ts: new Date(), title, sub, latlng, targetId };
    feed.unshift(item);
    if(feed.length>FEED_MAX) feed.length=FEED_MAX;
    renderFeed();
  }
  function renderFeed(){
    if(!feedList) return;
    feedList.innerHTML = "";
    for(const ev of feed){
      const el=document.createElement("div");
      el.className="feed-item";
      el.dataset.key=ev.key;
      el.innerHTML = `<div class="t">${escapeHtml(ev.title)}</div><span class="s">${escapeHtml(ev.sub||formatClock(ev.ts))}</span>`;
      el.addEventListener("click", ()=>{
        try{
          if(ev.latlng){
            map.flyTo(ev.latlng, Math.max(map.getZoom(), 12), {duration:0.6});
          }
          if(ev.targetId && markers.has(ev.targetId)){
            const m = markers.get(ev.targetId).marker;
            try{ m.openTooltip(); }catch(_){}
          }
        }catch(_){}
      });
      feedList.appendChild(el);
    }
  }
  if(feedClear){
    feedClear.addEventListener("click", ()=>{
      feed=[]; renderFeed();
    });
  }

  // ---------------- Modal ----------------
  const infoBtn=document.getElementById("infoBtn");
  const modalBack=document.getElementById("modalBack");
  const closeModal=document.getElementById("closeModal");
  function showModal(on){
    if(!modalBack) return;
    modalBack.style.display = on ? "flex" : "none";
  }
  if(infoBtn) infoBtn.addEventListener("click", ()=>showModal(true));
  if(closeModal) closeModal.addEventListener("click", ()=>showModal(false));
  if(modalBack) modalBack.addEventListener("click", (e)=>{ if(e.target===modalBack) showModal(false); });

  // ---------------- Presence ping (online counter) ----------------
  async function postPresence(){
    try{
      const r=await fetch("/api/presence",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({sid:getSid()})});
      if(!r.ok) throw new Error("bad");
      const data=await r.json();
      const dot=document.getElementById("onlineDot");
      const cnt=document.getElementById("onlineCount");
      if(dot) dot.style.background = "#33ff99";
      if(cnt) cnt.textContent = `${data.count || 1} глядачів`;
    }catch(_){
      const dot=document.getElementById("onlineDot");
      const cnt=document.getElementById("onlineCount");
      if(dot) dot.style.background = "#ff3b5b";
      if(cnt) cnt.textContent = "нема даних";
    }
  }
  function schedulePresence(){
    const delay = 8000 + Math.floor(Math.random()*8000);
    setTimeout(async ()=>{ await postPresence(); schedulePresence(); }, delay);
  }
  postPresence();
  schedulePresence();

  // ---------------- Targets render ----------------
  function getProxFlags(latlng){
    const d = haversineMetersLatLng(latlng, {lat:CENTER[0], lng:CENTER[1]});
    return {
      dist: d,
      near: d<=CITY_ALERT_M && d> CITY_DANGER_M,
      danger: d<=CITY_DANGER_M
    };
  }

  function makeTooltip(t){
    const TYPE_LABELS = {
      shahed: 'Шахед',
      aircraft: 'Літак',
      missile: 'Ракета',
      heli: 'Гелікоптер',
      drone: 'БПЛА',
      recon: 'Розвід-дрон',
      recon_drone: 'Розвід-дрон',
      scout: 'Розвід-дрон',
      surveillance: 'Розвід-дрон',
      other: 'Ціль'
    };

    const rawType = (t.type_label || t.type || '').toString().trim();
    const typeKey = rawType.toLowerCase();
    // Prefer a human-friendly label if possible
    const baseTitle = (TYPE_LABELS[typeKey]
      || (t.title && String(t.title).trim())
      || (t.name && String(t.name).trim())
      || rawType
      || 'Ціль').toString();
        const title = escapeHtml((baseTitle).toString());

    const note = escapeHtml(t.note || "");
    const spVal = (t.speed_kmh ?? t.speed ?? '');
    const sp   = (spVal !== '' && spVal !== null && spVal !== undefined)
      ? ` • ${escapeHtml(String(spVal))} км/год`
      : "";

    return `<b>${title || "Ціль"}</b>${sp}${note ? `<br><span style="opacity:.85">${note}</span>`:""}`;
  }

  function ensureLayers(o, shouldShow, showRoutes){
    // Marker
    if(shouldShow){
      if(!targetsLayer.hasLayer(o.marker)) targetsLayer.addLayer(o.marker);
    }else{
      if(targetsLayer.hasLayer(o.marker)) targetsLayer.removeLayer(o.marker);
    }
    // Line/trajectory
    const showL = shouldShow && showRoutes;
    if(showL){
      if(!linesLayer.hasLayer(o.line)) linesLayer.addLayer(o.line);
      if(o.trajLine && !linesLayer.hasLayer(o.trajLine)) linesLayer.addLayer(o.trajLine);
    }else{
      if(linesLayer.hasLayer(o.line)) linesLayer.removeLayer(o.line);
      if(o.trajLine && linesLayer.hasLayer(o.trajLine)) linesLayer.removeLayer(o.trajLine);
    }
  }

  function applyFilters(){
    const onlyActive = onlyActiveEl ? !!onlyActiveEl.checked : true;
    const showRoutes = showRoutesEl ? !!showRoutesEl.checked : true;

    for(const [id,o] of markers.entries()){
      const okType = filters.has(o.type);
      const okActive = onlyActive ? !!o.active : true;
      ensureLayers(o, okType && okActive, showRoutes);
    }
  }

  function upsert(t, isNew=false){
    const id = String(t.id ?? t._id ?? t.key ?? Math.random());
    const lat = (typeof t.lat==="number" ? t.lat : t.latitude);
    const lng = (typeof t.lng==="number" ? t.lng : t.lon ?? t.longitude);
    if(typeof lat!=="number" || typeof lng!=="number") return;

    const dirRaw = (t.direction ?? t.dir ?? t.course ?? t.bearing ?? t.azimuth ?? 0);
const dirNum = (typeof dirRaw==="number" ? dirRaw : parseFloat(dirRaw));
const dir = (Number.isFinite(dirNum) ? dirNum : 0);
    const active = (t.active===undefined ? true : !!t.active);

    const base = {lat, lng};
    const dest = (typeof t.dest_lat==="number" && typeof t.dest_lng==="number") ? {lat:t.dest_lat, lng:t.dest_lng} : null;

    if(markers.has(id)){
      const o = markers.get(id);
      o.type = t.type || o.type || "unknown";
      o.note = t.note || o.note || "";
      o.dir = normDeg(dir);
      o.active = active;
      o.speed_kmh = t.speed_kmh || o.speed_kmh || 0;
      o.dest = dest;
      // do not snap base backwards if animation moved forward: keep the newest known point as "base floor"
      o.base = {lat, lng};

      // update icon (no pop)
      const prox = getProxFlags(o.base);
      const effectsOn = !document.body.classList.contains("effects-off");
      const iconKey = `${o.type}|${o.dir}|${prox.near?1:0}|${prox.danger?1:0}`;
      setIconIfChanged(o, makeIconAnimated(o.type, o.dir, true, {
        pop:false,
        pulse:false,
        near: prox.near,
        danger: prox.danger,
        num:null
      }), iconKey);
      // update position/route immediately for viewers
      try{
        o.marker.setLatLng([lat, lng]);
        o.line.setLatLngs(arrowPolyline({lat, lng}, o.dir));
        if(dest){
          if(o.trajLine){
            o.trajLine.setLatLngs([{lat, lng}, dest]);
          }else{
            o.trajLine = L.polyline([{lat, lng}, dest], {color:"#ff3b5b", weight:2, opacity:0.35, dashArray:"6 8"}).addTo(linesLayer);
          }
        }else if(o.trajLine){
          try{ linesLayer.removeLayer(o.trajLine); }catch(_){}
          o.trajLine = null;
        }
      }catch(_){}
      o.marker.setTooltipContent(makeTooltip(t));
      setTimeout(()=>applyActiveClass(o.marker, o.active, o.type), 0);

    }else{
      const prox = getProxFlags(base);
      const effectsOn = !document.body.classList.contains("effects-off");
      const icon = makeIconAnimated(t.type || "unknown", normDeg(dir), true, {
        pop:false,
        pulse:false,
        near: prox.near,
        danger: prox.danger,
        num:null
      });

      const m = L.marker([lat,lng], {icon}).addTo(targetsLayer);
      setTimeout(()=>applyActiveClass(m, active, (t.type || "unknown")), 0);
      m.bindTooltip(makeTooltip(t), {direction:"top", offset:[0,-10], opacity:0.95});

      const line = L.polyline(arrowPolyline({lat, lng}, normDeg(dir)), {
        color: "#ffffff",
        weight: 2,
        opacity: 0.55
      }).addTo(linesLayer);

      // optional trajectory line
      let trajLine = null;
      if(dest){
        trajLine = L.polyline([{lat, lng}, dest], {color:"#ff3b5b", weight:2, opacity:0.35, dashArray:"6 8"}).addTo(linesLayer);
      }

      markers.set(id, {
        marker:m,
        line,
        trajLine,
        base,
        dest,
        dir:normDeg(dir),
        phase:0,
        type: t.type || "unknown",
        note: t.note || "",
        created_at: t.created_at || "",
        speed_kmh: t.speed_kmh || 0,
        last_anim_ms: Date.now(),
        active,
        prox: null,
        _iconKey: null
      });

      // feed event
      const title = `Додано: ${typeUa(t.type || "unknown")}`;
      const sub = prox.danger ? "дуже близько до Павлограда" : (prox.near ? "наближається до Павлограда" : "");
      pushFeed(title, sub || "нова ціль на мапі", [lat,lng], id);
    }
  }

  function typeUa(type){
    const map = {
      shahed: "Шахед",
      gerbera: "Гербера",
      fpv: "FPV-дрон",
      cruise: "Крилата ракета",
      ballistic: "Балістична ракета",
      aircraft: "Літак",
      recon: "Розвід-дрон",
      unknown: "Невідомо"
    };
    return map[type] || "Невідомо";
  }

  function sync(list){
    // Number targets in the order they were added (created_at oldest -> newest)
    const numById = new Map();
    try{
      const sorted = [...(list||[])].sort((a,b)=>{
        const ta = Date.parse(a.created_at || 0) || 0;
        const tb = Date.parse(b.created_at || 0) || 0;
        return ta - tb;
      });
      sorted.forEach((t, idx)=>{
        const id = String(t.id ?? t._id ?? t.key ?? "");
        if(id) numById.set(id, idx+1);
      });
    }catch(_){ /* ignore */ }

    const alive = new Set();
    for(const t of (list||[])){
      const id = String(t.id ?? t._id ?? t.key ?? "");
      if(!id) continue;
      alive.add(id);
      const isNew = !markers.has(id);
      // attach number for icon rendering
      t._num = numById.get(id) || null;
      upsert(t, isNew);
    }

    // remove missing
    for(const [id,o] of markers.entries()){
      if(!alive.has(id)){
        try{ targetsLayer.removeLayer(o.marker); }catch(_){}
        try{ linesLayer.removeLayer(o.line); }catch(_){}
        try{ if(o.trajLine) linesLayer.removeLayer(o.trajLine); }catch(_){}
        markers.delete(id);
        pushFeed("Ціль знято", "прибрано з мапи");
      }
    }

    const n = (list||[]).length;
    const c1 = document.getElementById("count");
    if(c1) c1.textContent = `Цілі: ${n}`;

    applyFilters();
  }

  function refreshTargetCountInstant(){
    const c1=document.getElementById("count");
    if(c1) c1.textContent=`Цілі: ${markers.size}`;
  }

  function removeTargetInstant(id){
    const key=String(id||"");
    if(!key || !markers.has(key)) return;
    const o=markers.get(key);
    try{targetsLayer.removeLayer(o.marker);}catch(_){ }
    try{linesLayer.removeLayer(o.line);}catch(_){ }
    try{if(o.trajLine) linesLayer.removeLayer(o.trajLine);}catch(_){ }
    markers.delete(key);
    refreshTargetCountInstant();
    applyFilters();
  }

  function clearTargetsInstant(){
    for(const id of Array.from(markers.keys())) removeTargetInstant(id);
    refreshTargetCountInstant();
  }

  // Same-browser instant path from admin tab. SSE/server still confirms the final state.
  try{
    if("BroadcastChannel" in window){
      const pvlsLiveBridge = new BroadcastChannel("pvls-map-live-v1");
      pvlsLiveBridge.addEventListener("message",(ev)=>{
        const d=ev && ev.data;
        if(!d || d.entity!=="targets") return;
        if(d.action==="delete") removeTargetInstant(d.id);
        else if(d.action==="clear") clearTargetsInstant();
      });
    }
  }catch(_){ }

  function applyTargetPush(data){
    const p=data && data.payload;
    if(!p || !p.action) return false;
    if(data.updated_at) lastTargetsUpdated=data.updated_at;
    if(p.action==="upsert" && p.target){
      const t=p.target;
      const id=String(t.id ?? t._id ?? t.key ?? "");
      const isNew=!!id && !markers.has(id);
      upsert(t,isNew);
      refreshTargetCountInstant();
      applyFilters();
      const u=document.getElementById("updated");
      if(u && data.updated_at) u.textContent=`Оновлено: ${formatTs(data.updated_at)}`;
      return true;
    }
    if(p.action==="delete") { removeTargetInstant(p.id); return true; }
    if(p.action==="clear") { clearTargetsInstant(); return true; }
    return false;
  }

  function syncThreatZones(list){
    const alive=new Set();
    for(const z of (list||[])){
      if(!z || !z.id) continue;
      alive.add(String(z.id));
      const ll=L.latLng(Number(z.lat),Number(z.lng));
      const radius=Math.max(500,Number(z.radius_m||10000));
      if(threatZoneObjects.has(String(z.id))){
        const c=threatZoneObjects.get(String(z.id));
        c.setLatLng(ll);
        c.setRadius(radius);
      }else{
        const c=L.circle(ll,{
          radius,
          color:'#ff2146',
          weight:2.2,
          opacity:.9,
          fillColor:'#ff2146',
          fillOpacity:.18,
          interactive:false
        }).addTo(threatZonesLayer);
        threatZoneObjects.set(String(z.id),c);
      }
    }
    for(const [id,c] of threatZoneObjects.entries()){
      if(!alive.has(id)){
        try{threatZonesLayer.removeLayer(c);}catch(_){ }
        threatZoneObjects.delete(id);
      }
    }
  }

  async function tick(){
    try{
      const url = lastTargetsUpdated ? ("/api/targets?since=" + encodeURIComponent(lastTargetsUpdated)) : "/api/targets";
      const data = await apiGet(url);
      if(data && data.updated_at) lastTargetsUpdated = data.updated_at;
      const u = document.getElementById("updated");
      if(u){
        const ts = data.updated_at || "";
        u.textContent = ts ? `Оновлено: ${formatTs(ts)}` : "Оновлено: —";
      }
      if(data.targets){
        sync(data.targets || []);
      }

// Точки запуску: без штучного cooldown. `since` не дає тягнути повний список без змін.
try{
  lastLaunchFetchMs = Date.now();
  const lurl = lastLaunchUpdated ? ("/api/launchsites?since=" + encodeURIComponent(lastLaunchUpdated)) : "/api/launchsites";
  const ls = await apiGet(lurl);
  if(ls && ls.updated_at) lastLaunchUpdated = ls.updated_at;
  if(ls.sites){
    launchLayer.clearLayers();
    for(const s of (ls.sites||[])){
      if(!s || !s.active) continue;
      if(typeof s.lat!=="number" || typeof s.lng!=="number") continue;
      const m=L.circleMarker([s.lat,s.lng],{radius:6,weight:2,opacity:0.9,fillOpacity:0.35,color:"#ff3b5b"}).addTo(launchLayer);
      m.bindTooltip(`Пуск: ${escapeHtml(s.name||"")}`,{direction:"top",offset:[0,-6]});
    }
  }
}catch(_){ /* ignore */ }

// Зони загрози: окремий шар, синхронізується тим самим SSE.
try{
  const zurl = lastZonesUpdated ? ("/api/zones?since=" + encodeURIComponent(lastZonesUpdated)) : "/api/zones";
  const zd = await apiGet(zurl);
  if(zd && zd.updated_at) lastZonesUpdated = zd.updated_at;
  if(zd.zones) syncThreatZones(zd.zones || []);
}catch(_){ /* ignore */ }

    }catch(err){
      console.error("tick failed", err);
      const u=document.getElementById("updated");
      if(u) u.textContent="Оновлено: помилка";
    }
  }

  // Motion: drift forward by speed (km/h) from last update
  let lastProxCheck = 0;
  function animate(){
    const now=Date.now();
    for(const [id,o] of markers.entries()){
      const speedKmh = parseFloat(o.speed_kmh||0) || 0;
      const mps = (speedKmh>0 ? speedKmh*1000/3600 : 0);
      let base = o.base;
      let pos = base;

      // Disable client-side motion for all targets except ballistic (prevents snap-back/flicker)
      const allowMotion = false; // motion disabled (static markers)

      // integrate in small steps so it never snaps back on refresh
      const last = o.last_anim_ms || now;
      if(!allowMotion){
        // keep marker exactly at server position
        o.last_anim_ms = now;
      }

      if(allowMotion){
      const dt = Math.min(2.0, Math.max(0, (now-last)/1000.0));
      o.last_anim_ms = now;

      if(mps>0 && dt>0){
        const step = mps*dt;
        if(o.dest){
          const remaining = haversineMetersLatLng(base, o.dest);
          if(remaining <= step){
            base = o.dest;
          }else{
            const br = bearingDeg(base, o.dest);
            base = offset(base, br, step);
          }
        }else{
          base = offset(base, o.dir, step); // no distance limit
        }
        o.base = base;
        pos = base;
      }

      // small wobble for drones only
      if(allowMotion && (o.type==="shahed" || o.type==="gerbera" || o.type==="recon" || o.type==="fpv")){
        o.phase=(o.phase||0)+0.04;
        const wobble=Math.sin(o.phase)*10;
        pos = offset(pos,(o.dir+90)%360,wobble);
      }

      }

      try{
        o.marker.setLatLng(pos);
        o.line.setLatLngs(arrowPolyline(pos,o.dir));
        if(o.trajLine && o.dest){
          o.trajLine.setLatLngs([pos, o.dest]);
        }
      }catch(_){}
    }

    // proximity check (1/sec)
    if(now - lastProxCheck > 1000){
      lastProxCheck = now;
      for(const [id,o] of markers.entries()){
        const prox = getProxFlags(o.base);
        const level = prox.danger ? "danger" : (prox.near ? "near" : "ok");
        if(o.prox !== level){
          o.prox = level;

          // update icon flags (static)
          const effectsOn = !document.body.classList.contains("effects-off");
          const iconKey = `${o.type}|${o.dir}|${prox.near?1:0}|${prox.danger?1:0}`;
          setIconIfChanged(o, makeIconAnimated(o.type, o.dir, true, {
            pop:false,
            pulse:false,
            near: prox.near,
            danger: prox.danger
          }), iconKey);

          if(level==="near") pushFeed("Наближається до Павлограда", `${typeUa(o.type)} • ~${fmtDist(prox.dist)}`, [o.base.lat, o.base.lng], id);
          if(level==="danger") pushFeed("Дуже близько до Павлограда", `${typeUa(o.type)} • ~${fmtDist(prox.dist)}`, [o.base.lat, o.base.lng], id);
        }
      }
    }

    // animation loop disabled (static markers)
  }

  // ---------------- Measure tool ----------------
  const measureHud  = document.getElementById("measureHud");
  const measureText = document.getElementById("measureText");
  const measureUndo = document.getElementById("measureUndo");
  const measureClear= document.getElementById("measureClear");
  const measureDone = document.getElementById("measureDone");

  let measureMode=false;
  let measurePts=[];
  let measureLine=null;
  let measureMarkers=[];
  let measureLabel=null;

  function setMeasureMode(on){
    measureMode = !!on;
    if(measureBtn){
      measureBtn.classList.toggle("active", measureMode);
      measureBtn.textContent = measureMode ? "✕" : "📏";
    }
    if(measureHud){
      measureHud.classList.toggle("show", measureMode);
      measureHud.setAttribute("aria-hidden", measureMode ? "false":"true");
    }
    if(!measureMode){
      clearMeasure();
      closeAllDrawers();
    }else{
      closeAllDrawers();
      updateMeasureText();
      pushFeed("Лінійка увімкнена", "став точки на мапі");
    }
  }

  const measureBtn=document.getElementById("measureBtn");
  if(measureBtn){
    measureBtn.addEventListener("click", ()=>{
      setMeasureMode(!measureMode);
    });
  }

  function updateMeasureText(){
    if(!measureText) return;
    if(measurePts.length===0) measureText.textContent="Торкнись мапи, щоб поставити першу точку";
    else if(measurePts.length===1) measureText.textContent="Постав ще одну точку, щоб порахувати відстань";
    else measureText.textContent=`Відстань: ${fmtDist(totalDistance(measurePts))}`;
  }

  function clearMeasure(){
    measurePts=[];
    if(measureLine){ try{ map.removeLayer(measureLine);}catch(_){} measureLine=null; }
    if(measureLabel){ try{ map.removeLayer(measureLabel);}catch(_){} measureLabel=null; }
    for(const mm of measureMarkers){ try{ map.removeLayer(mm);}catch(_){} }
    measureMarkers=[];
    updateMeasureText();
  }

  function rebuildMeasure(){
    if(measureLine){ try{ map.removeLayer(measureLine);}catch(_){} }
    if(measureLabel){ try{ map.removeLayer(measureLabel);}catch(_){} }

    if(measurePts.length>=2){
      measureLine = L.polyline(measurePts, {color:"#ff3b5b", weight:3, opacity:0.85}).addTo(map);
      const dist = totalDistance(measurePts);
      const last = measurePts[measurePts.length-1];
      measureLabel = L.marker(last, {
        icon: L.divIcon({
          className:"pvls-divicon",
          html:`<div style="padding:6px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:rgba(18,22,36,.55);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);font-weight:950;font-size:12px;color:rgba(255,255,255,.92)">${escapeHtml(fmtDist(dist))}</div>`,
          iconAnchor:[10,28],
          // Prevent text clipping: default DivIcon size is 12x12.
          iconSize: null
        })
      }).addTo(map);
    }else if(measurePts.length===1){
      // just a marker
    }
    updateMeasureText();
  }

  function addMeasurePoint(latlng){
    measurePts.push(latlng);
    const mm = L.circleMarker(latlng, {radius:6, weight:2, color:"#ffffff", fillColor:"#ff3b5b", fillOpacity:0.85, opacity:0.9}).addTo(map);
    measureMarkers.push(mm);
    rebuildMeasure();
  }

  if(measureUndo){
    measureUndo.addEventListener("click", ()=>{
      if(measurePts.length===0) return;
      measurePts.pop();
      const mm=measureMarkers.pop();
      if(mm){ try{ map.removeLayer(mm);}catch(_){} }
      rebuildMeasure();
    });
  }
  if(measureClear){
    measureClear.addEventListener("click", ()=>clearMeasure());
  }
  if(measureDone){
    measureDone.addEventListener("click", ()=>setMeasureMode(false));
  }

  map.on("click", (e)=>{
    if(!measureMode) return;
    addMeasurePoint(e.latlng);
  });
  map.on("dblclick", (e)=>{
    if(!measureMode) return;
    // finish on double click
    setMeasureMode(false);
  });


let sse = null;
let sseRetryTimer = null;
let sseRefreshBusy = false;
let sseRefreshPending = false;

async function refreshFromPush(entity){
  // Push is authoritative for this operator-oriented map: always request fresh state.
  // If another push arrives while a refresh is running, immediately do one more pass.
  if(sseRefreshBusy){
    sseRefreshPending = true;
    return;
  }
  sseRefreshBusy = true;
  try{
    do{
      sseRefreshPending = false;
      lastTargetsUpdated = null;
      lastLaunchUpdated = null;
      lastZonesUpdated = null;
      lastLaunchFetchMs = 0;
      await tick();
    }while(sseRefreshPending);
  }catch(err){
    console.error("push refresh failed", err);
  }finally{
    sseRefreshBusy = false;
    if(sseRefreshPending){
      sseRefreshPending = false;
      refreshFromPush(entity);
    }
  }
}

function connectSSE(){
  try{
    if(sse){ try{ sse.close(); }catch(_){ } sse = null; }
    sse = new EventSource("/api/events");
    const onPush = async (ev)=>{
      try{
        const data = JSON.parse(ev.data || "{}");
        if((data.entity||"")==="targets" && applyTargetPush(data)){
          return;
        }
        await refreshFromPush(data.entity || "");
      }catch(err){
        console.error("sse parse failed", err);
      }
    };
    sse.addEventListener("targets_changed", onPush);
    sse.addEventListener("launchsites_changed", onPush);
    sse.addEventListener("zones_changed", onPush);
    sse.onerror = ()=>{
      try{ if(sse) sse.close(); }catch(_){ }
      sse = null;
      if(sseRetryTimer) clearTimeout(sseRetryTimer);
      sseRetryTimer = setTimeout(connectSSE, 5000);
    };
  }catch(err){
    console.error("sse init failed", err);
  }
}


  // ---------------- Start loops ----------------
  function scheduleTick(){
    // Fast fallback in case SSE is temporarily unavailable. With the operator workflow
    // there is normally only one viewer, so a 2-second safety poll is inexpensive.
    const delay = 2000;
    setTimeout(async ()=>{ try{ await tick(); }catch(err){ console.error('tick outer', err); } scheduleTick(); }, delay);
  }
  tick();
  scheduleTick();
  connectSSE();
  // animation loop disabled (static markers)

  // ---------------- helpers ----------------
  function formatClock(d){
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    return `${hh}:${mm}`;
  }

  function fmtDist(m){
    if(!isFinite(m)) return "—";
    if(m<1000) return `${Math.round(m)} м`;
    const km = m/1000;
    if(km<10) return `${km.toFixed(1)} км`;
    return `${Math.round(km)} км`;
  }

  function totalDistance(pts){
    let sum=0;
    for(let i=1;i<pts.length;i++){
      sum += haversineMetersLatLng(pts[i-1], pts[i]);
    }
    return sum;
  }

  function haversineMetersLatLng(a,b){
    const A = {lat: (a.lat!==undefined ? a.lat : a[0]), lng:(a.lng!==undefined ? a.lng : a[1])};
    const B = {lat: (b.lat!==undefined ? b.lat : b[0]), lng:(b.lng!==undefined ? b.lng : b[1])};
    const R=6371000;
    const dLat=(B.lat-A.lat)*Math.PI/180;
    const dLon=(B.lng-A.lng)*Math.PI/180;
    const la1=A.lat*Math.PI/180;
    const la2=B.lat*Math.PI/180;
    const x=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));
  }

  function bearingDeg(a,b){
    const lat1=a.lat*Math.PI/180, lon1=a.lng*Math.PI/180;
    const lat2=b.lat*Math.PI/180, lon2=b.lng*Math.PI/180;
    const y = Math.sin(lon2-lon1)*Math.cos(lat2);
    const x = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon2-lon1);
    return (Math.atan2(y,x)*180/Math.PI + 360) % 360;
  }

  function offset(p, bearing, meters){
    const R=6371000;
    const br = bearing*Math.PI/180;
    const lat1=p.lat*Math.PI/180;
    const lon1=p.lng*Math.PI/180;
    const lat2 = Math.asin(Math.sin(lat1)*Math.cos(meters/R) + Math.cos(lat1)*Math.sin(meters/R)*Math.cos(br));
    const lon2 = lon1 + Math.atan2(Math.sin(br)*Math.sin(meters/R)*Math.cos(lat1), Math.cos(meters/R)-Math.sin(lat1)*Math.sin(lat2));
    return {lat: lat2*180/Math.PI, lng: lon2*180/Math.PI};
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }
  function formatTs(ts){
    try{
      let s = String(ts||"");
      // If server sends ISO without timezone, treat as UTC (Render often uses UTC)
      if(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) && !(/[zZ]|[\+\-]\d{2}:?\d{2}$/.test(s))){
        s = s + "Z";
      }
      const d = new Date(s);
      if(isNaN(d.getTime())) return String(ts);
      const fmt = new Intl.DateTimeFormat("uk-UA", {
        timeZone: "Europe/Kyiv",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
      const parts = fmt.formatToParts(d);
      const get=(t)=> (parts.find(p=>p.type===t)||{}).value || "";
      return `${get("day")}.${get("month")} ${get("hour")}:${get("minute")}`;
    }catch(_){
      return String(ts||"");
    }
  }
  function getCookie(name){
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(name, value, days=365){
    const d = new Date();
    d.setTime(d.getTime() + days*24*60*60*1000);
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
  }

  function genSid(){
    return (crypto?.randomUUID ? crypto.randomUUID() : (Math.random().toString(16).slice(2) + Date.now().toString(16)));
  }

  function getSid(){
    // Stable per-device id for presence counting.
    const k="pvls_map_sid";
    try{
      let v = localStorage.getItem(k);
      if(!v){ v = genSid(); localStorage.setItem(k, v); }
      return v;
    }catch(_){
      let v = getCookie(k);
      if(!v){ v = genSid(); setCookie(k, v); }
      return v;
    }
  }

});