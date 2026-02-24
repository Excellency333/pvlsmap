let ICON_THEME = "dark";

const ICONS = {
  dark: {
    shahed: "/static/icons/shahed_dark.png",
    gerbera: "/static/icons/gerbera_dark.png",
    fpv: "/static/icons/fpv_dark.png",
    cruise: "/static/icons/cruise_dark.png",
    ballistic: "/static/icons/ballistic_dark.png",
    aircraft: "/static/icons/aircraft_dark.png",
    recon: "/static/icons/recon_dark.png",
    unknown: "/static/icons/unknown_dark.png",
  },
  light: {
    shahed: "/static/icons/shahed_light.png",
    gerbera: "/static/icons/gerbera_light.png",
    fpv: "/static/icons/fpv_light.png",
    cruise: "/static/icons/cruise_light.png",
    ballistic: "/static/icons/ballistic_light.png",
    aircraft: "/static/icons/aircraft_light.png",
    recon: "/static/icons/recon_light.png",
    unknown: "/static/icons/unknown_light.png",
  }
};

function setIconTheme(theme){
  ICON_THEME = (theme === "light") ? "light" : "dark";
}

function makeIcon(type){
  const url = (ICONS[ICON_THEME][type] || ICONS[ICON_THEME].unknown);
  return L.icon({ iconUrl: url, iconSize:[48,48], iconAnchor:[24,24] });
}

function arrowPolyline(latlng, deg, lenMeters=1200){
  const rad = deg * Math.PI / 180;
  const dLat = (lenMeters * Math.cos(rad)) / 111320.0;
  const dLng = (lenMeters * Math.sin(rad)) / (111320.0 * Math.cos(latlng.lat*Math.PI/180));
  const end = {lat: latlng.lat + dLat, lng: latlng.lng + dLng};
  return [latlng, end];
}

async function apiGet(url){
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}
async function apiPost(url, body){
  const r = await fetch(url, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)});
  if(!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}
async function apiDelete(url){
  const r = await fetch(url, {method:"DELETE"});
  if(!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}
