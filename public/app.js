const PROXY_BASE = "/api";
const ROUTE_COLOR = "#3b82f6";

let map;
let busMarkers = [];
let stopMarkers = [];
let routePolyline = null;
let etaInterval = null;

/* ================= HELPERS ================= */

function decodeGreek(text) {
  if (!text) return "";
  try {
    return text.replace(/\\u[\dA-F]{4}/gi, m =>
      String.fromCharCode(parseInt(m.replace(/\\u/g, ""), 16))
    );
  } catch {
    return text;
  }
}

async function apiCall(query) {
  const res = await fetch(`${PROXY_BASE}?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error("API error");
  return data;
}

function clearMap() {
  busMarkers.forEach(m => map.removeLayer(m));
  stopMarkers.forEach(m => map.removeLayer(m));
  busMarkers = [];
  stopMarkers = [];
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
}

function stopAutoRefresh() {
  if (etaInterval) clearInterval(etaInterval);
  etaInterval = null;
}

/* ================= ROUTE ================= */

async function drawRoute(routeCode, fallbackStops = []) {
  if (routePolyline) map.removeLayer(routePolyline);

  try {
    const shapeRes = await apiCall(`act=getRouteShape&p1=${routeCode}`);
    const points = Array.isArray(shapeRes.points) ? shapeRes.points : [];

    if (points.length) {
      const latlngs = points.map(p => [
        parseFloat(p.CS_LAT || p.lat),
        parseFloat(p.CS_LNG || p.lng),
      ]);

      routePolyline = L.polyline(latlngs, {
        color: ROUTE_COLOR,
        weight: 4,
        opacity: 0.9,
      }).addTo(map);

      map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
      return;
    }
  } catch {}

  if (fallbackStops.length > 1) {
    routePolyline = L.polyline(fallbackStops, {
      color: ROUTE_COLOR,
      weight: 3,
      opacity: 0.5,
      dashArray: "6 6",
    }).addTo(map);
  }
}

/* ================= SNAP BUS ================= */

function snapToRoute(latlng) {
  if (!routePolyline) return latlng;

  let closest = null;
  let min = Infinity;

  routePolyline.getLatLngs().forEach(p => {
    const d = map.distance(latlng, p);
    if (d < min) {
      min = d;
      closest = p;
    }
  });

  return min < 120 ? closest : latlng;
}

/* ================= INIT ================= */

async function init() {
  const lines = await apiCall("act=webGetLines");
  const lineSelect = document.getElementById("lineSelect");

  lineSelect.innerHTML = `<option value="">-- Επιλέξτε Γραμμή --</option>`;

  lines.forEach(l => {
    const opt = document.createElement("option");
    opt.value = l.LineCode;
    opt.textContent = `${l.LineID} - ${decodeGreek(l.LineDescr)}`;
    lineSelect.appendChild(opt);
  });

  lineSelect.disabled = false;
  lineSelect.onchange = loadDirections;

  map = L.map("map").setView([37.9838, 23.7275], 12);
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
  ).addTo(map);
}

/* ================= DIRECTIONS ================= */

async function loadDirections() {
  stopAutoRefresh();
  clearMap();

  const lineSelect = document.getElementById("lineSelect");
  const dirSelect = document.getElementById("dirSelect");
  const stopSelect = document.getElementById("stopSelect");

  dirSelect.innerHTML = "";
  stopSelect.innerHTML = "";

  if (!lineSelect.value) return;

  const routes = await apiCall(`act=getRoutesForLine&p1=${lineSelect.value}`);

  dirSelect.innerHTML = `<option value="">-- Επιλέξτε Κατεύθυνση --</option>`;
  routes.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r.route_code || r.RouteCode;
    opt.textContent = decodeGreek(r.route_descr || r.RouteDescr);
    dirSelect.appendChild(opt);
  });

  dirSelect.disabled = false;
  dirSelect.onchange = loadStops;
}

/* ================= STOPS ================= */

async function loadStops() {
  stopAutoRefresh();
  clearMap();

  const dirSelect = document.getElementById("dirSelect");
  const stopSelect = document.getElementById("stopSelect");
  const refresh = document.getElementById("refresh");

  if (!dirSelect.value) return;

  const stops = await apiCall(`act=getStopsForRoute&p1=${dirSelect.value}`);
  stopSelect.innerHTML = `<option value="">-- Επιλέξτε Στάση --</option>`;

  const fallbackLatLngs = [];

  stops.forEach(s => {
    const lat = parseFloat(s.StopLat);
    const lng = parseFloat(s.StopLng);
    if (isNaN(lat) || isNaN(lng)) return;

    fallbackLatLngs.push([lat, lng]);

    const code = s.StopCode;
    const name = decodeGreek(s.StopDescr);

    const marker = L.circleMarker([lat, lng], {
      radius: 5,
      color: ROUTE_COLOR,
      fillColor: ROUTE_COLOR,
      fillOpacity: 1,
    }).addTo(map);

    marker.on("click", () => {
      stopSelect.value = code;
      marker.bindPopup(`📍 <strong>${name}</strong>`).openPopup();
      startAutoRefresh();
    });

    stopMarkers.push(marker);

    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name;
    stopSelect.appendChild(opt);
  });

  await drawRoute(dirSelect.value, fallbackLatLngs);
  updateBuses();

  stopSelect.disabled = false;
  refresh.disabled = false;
  refresh.onclick = startAutoRefresh;
}

/* ================= BUSES ================= */

async function updateBuses() {
  const routeCode = document.getElementById("dirSelect").value;
  if (!routeCode) return;

  const buses = await apiCall(`act=getBusLocation&p1=${routeCode}`);
  if (!Array.isArray(buses)) return;

  busMarkers.forEach(b => map.removeLayer(b));
  busMarkers = [];

  buses.forEach(b => {
    const lat = parseFloat(b.CS_LAT || b.lat);
    const lng = parseFloat(b.CS_LNG || b.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    busMarkers.push(
      L.marker(snapToRoute(L.latLng(lat, lng)), {
        icon: L.divIcon({
          html: `<div class="bus-icon">🚌</div>`,
          iconSize: [26, 26],
          className: "",
        }),
      }).addTo(map)
    );
  });
}

/* ================= ETA ================= */

async function updateETA() {
  const lineSelect = document.getElementById("lineSelect");
  const dirSelect = document.getElementById("dirSelect");
  const stopSelect = document.getElementById("stopSelect");
  const etaEl = document.getElementById("eta");

  if (!stopSelect.value || !dirSelect.value) return;

  try {
    const buses = await apiCall(`act=getBusLocation&p1=${dirSelect.value}`);
    const hasActiveBus = Array.isArray(buses) && buses.length > 0;

    const arr = await apiCall(`act=getStopArrivals&p1=${stopSelect.value}`);

    let message = "Το δρομολόγιο δεν έχει ξεκινήσει ακόμη";
    let urgent = false;

    if (hasActiveBus && Array.isArray(arr) && arr.length) {
      const eta = parseInt(arr[0].btime2 || arr[0].btime, 10);

      if (eta <= 0) {
        message = "Μόλις πέρασε";
      } else {
        message = `Άφιξη σε ${eta} λεπτά`;
        urgent = eta <= 5;
      }
    }

    etaEl.innerHTML = `
      <div class="eta-card ${urgent ? "eta-urgent" : "eta-normal"}">
        <div class="eta-route">
          ${lineSelect.selectedOptions[0].text}
        </div>
        <div class="eta-time">${message}</div>
      </div>
    `;

    if (hasActiveBus) updateBuses();
    else {
      busMarkers.forEach(b => map.removeLayer(b));
      busMarkers = [];
    }

  } catch {
    etaEl.innerHTML = `
      <div class="eta-card eta-normal">
        <div class="eta-time">Μη διαθέσιμα δεδομένα</div>
      </div>
    `;
  }
}

/* ================= AUTO REFRESH ================= */

function startAutoRefresh() {
  stopAutoRefresh();
  updateETA();
  etaInterval = setInterval(updateETA, 20000);
}

document.addEventListener("DOMContentLoaded", init);
