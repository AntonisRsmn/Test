const API_BASE = "https://telematics.oasa.gr/api/";
let map, busMarker;

async function api(act, p1, p2){
  const url = `${API_BASE}?act=${act}${p1?`&p1=${p1}`:''}${p2?`&p2=${p2}`:''}`;
  const res = await fetch(url);
  return res.json();
}

async function init(){
  const lines = await api("webGetLines");
  const lineSelect = document.getElementById("lineSelect");
  lines.forEach(l=>{
    const o=document.createElement("option");
    o.value=l.line_code;
    o.textContent=l.line_descr;
    lineSelect.appendChild(o);
  });

  lineSelect.onchange = loadDirections;
  document.getElementById("refresh").onclick = updateETA;

  map = L.map("map").setView([37.98,23.72],13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

  await loadDirections();
}

async function loadDirections(){
  const line = document.getElementById("lineSelect").value;
  const routes = await api("getRoutesForLine", line);
  const dirSelect = document.getElementById("dirSelect");
  dirSelect.innerHTML="";
  routes.forEach(r=>{
    const o=document.createElement("option");
    o.value=r.route_code;
    o.textContent=r.route_descr;
    dirSelect.appendChild(o);
  });
  dirSelect.onchange = loadStops;
  await loadStops();
}

async function loadStops(){
  const route = document.getElementById("dirSelect").value;
  const stops = await api("getStopsForRoute", route);
  const stopSelect = document.getElementById("stopSelect");
  stopSelect.innerHTML="";
  stops.forEach(s=>{
    const o=document.createElement("option");
    o.value=s.stop_code;
    o.textContent=s.stop_descr;
    stopSelect.appendChild(o);
  });
  await updateETA();
}

async function updateETA(){
  const stop = document.getElementById("stopSelect").value;
  const arrivals = await api("getStopArrivals", stop);
  if(arrivals.length){
    document.getElementById("eta").textContent =
      `ETA: ${arrivals[0].btime2} λεπτά`;
  }

  const route = document.getElementById("dirSelect").value;
  const buses = await api("getBusLocation", route);
  if(buses.length){
    const b = buses[0];
    if(!busMarker){
      busMarker = L.marker([b.lat,b.lng]).addTo(map);
    } else {
      busMarker.setLatLng([b.lat,b.lng]);
    }
    map.setView([b.lat,b.lng],14);
  }
}

// 🔧 Mobile Safari fix: disable map interaction when selecting
const selects = document.querySelectorAll("select");

selects.forEach(sel => {
  sel.addEventListener("focus", () => {
    if (map) {
      map.dragging.disable();
      map.scrollWheelZoom.disable();
      map.doubleClickZoom.disable();
      map.touchZoom.disable();
    }
  });

  sel.addEventListener("blur", () => {
    if (map) {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoom.enable();
    }
  });
});

init();
