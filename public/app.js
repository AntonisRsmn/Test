const PROXY_BASE = "/api";

let map;
let busMarkers = [];
let stopMarkers = [];
let routePolyline = null;

/* ===== AUTO REFRESH STATE ===== */
let etaInterval = null;
let lastEtaValue = null;

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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
}

function setStatus(msg, error = false) {
  // const el = document.getElementById("status");
  // el.textContent = `Κατάσταση: ${msg}`;
  // el.style.color = error ? "var(--danger)" : "var(--accent)";
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
  lastEtaValue = null;
}

/* ================= ROUTE ================= */

async function drawRoute(routeCode, fallbackStops = []) {
  if (routePolyline) map.removeLayer(routePolyline);

  try {
    const shapeRes = await apiCall(`act=getRouteShape&p1=${routeCode}`);
    const points =
      shapeRes?.points?.length
        ? shapeRes.points
        : Array.isArray(shapeRes)
        ? shapeRes
        : [];

    if (points.length) {
      const latlngs = points
        .map(p => [
          parseFloat(p.CS_LAT || p.lat),
          parseFloat(p.CS_LNG || p.lng),
        ])
        .filter(p => !isNaN(p[0]) && !isNaN(p[1]));

      routePolyline = L.polyline(latlngs, {
        color: "var(--accent)",
        weight: 4,
        opacity: 0.9,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(map);

      map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
      return;
    }
  } catch {}

  if (fallbackStops.length > 1) {
    routePolyline = L.polyline(fallbackStops, {
      color: "var(--accent)",
      weight: 3,
      opacity: 0.5,
      dashArray: "6 6",
    }).addTo(map);

    map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
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
  try {
    setStatus("Φόρτωση γραμμών...");
    const lines = await apiCall("act=webGetLines");

    const lineSelect = document.getElementById("lineSelect");
    lineSelect.innerHTML = `<option value="">-- Επιλέξτε Γραμμή --</option>`;

    lines
      .sort((a, b) => (parseInt(a.LineID) || 0) - (parseInt(b.LineID) || 0))
      .forEach(l => {
        const opt = document.createElement("option");
        opt.value = l.LineCode;
        opt.textContent = `${l.LineID} - ${decodeGreek(l.LineDescr)}`;
        lineSelect.appendChild(opt);
      });

    lineSelect.disabled = false;
    lineSelect.onchange = () => {
      stopAutoRefresh();
      loadDirections();
    };

    map = L.map("map").setView([37.9838, 23.7275], 12);
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19 }
    ).addTo(map);

    setStatus("Έτοιμο");
  } catch (e) {
    setStatus("Σφάλμα φόρτωσης", true);
  }
}

/* ================= DIRECTIONS ================= */

async function loadDirections() {
  stopAutoRefresh();
  clearMap();

  const dirSelect = document.getElementById("dirSelect");
  const stopSelect = document.getElementById("stopSelect");

  dirSelect.innerHTML = "";
  stopSelect.innerHTML = "";

  const lineCode = document.getElementById("lineSelect").value;
  if (!lineCode) return;

  const routes = await apiCall(`act=getRoutesForLine&p1=${lineCode}`);
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

  const routeCode = dirSelect.value;
  if (!routeCode) return;

  setStatus("Φόρτωση στάσεων...");
  const stops = await apiCall(`act=getStopsForRoute&p1=${routeCode}`);

  stopSelect.innerHTML = `<option value="">-- Επιλέξτε Στάση --</option>`;
  const fallbackLatLngs = [];

  stops.forEach(s => {
    const lat = parseFloat(s.StopLat || s.lat);
    const lng = parseFloat(s.StopLng || s.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    fallbackLatLngs.push([lat, lng]);

    const code = s.StopCode || s.stop_code;
    const name = decodeGreek(s.StopDescr || s.stop_descr);

    const marker = L.circleMarker([lat, lng], {
      radius: 5,
      color: "var(--accent)",
      fillColor: "var(--accent)",
      fillOpacity: 1,
    }).addTo(map);

    marker.bindPopup(`📍 ${name}`);
    marker.on("click", () => {
      stopSelect.value = code;
      startAutoRefresh();
    });

    stopMarkers.push(marker);

    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name;
    stopSelect.appendChild(opt);
  });

  await drawRoute(routeCode, fallbackLatLngs);

  updateBusesOnly();

  stopSelect.disabled = false;
  refresh.disabled = false;
  refresh.onclick = startAutoRefresh;

  setStatus("Έτοιμο");
}



async function updateBusesOnly() {
  const dirSelect = document.getElementById("dirSelect");
  const routeCode = dirSelect.value;
  if (!routeCode) return;

  try {
    const buses = await apiCall(`act=getBusLocation&p1=${routeCode}`);

    busMarkers.forEach(b => map.removeLayer(b));
    busMarkers = [];

    buses.forEach(b => {
      const lat = parseFloat(b.CS_LAT || b.lat);
      const lng = parseFloat(b.CS_LNG || b.lng);
      if (isNaN(lat) || isNaN(lng)) return;

      const snapped = snapToRoute(L.latLng(lat, lng));

      const marker = L.marker(snapped, {
        icon: L.divIcon({
          html: `<div class="bus-icon">🚌</div>`,
          iconSize: [28, 28],
          className: "",
        }),
      }).addTo(map);

      busMarkers.push(marker);
    });
  } catch {
    /* silent */
  }
}

/* ================= ETA + BUSES ================= */

async function updateETA() {
  const lineSelect = document.getElementById("lineSelect");
  const dirSelect = document.getElementById("dirSelect");
  const stopSelect = document.getElementById("stopSelect");
  const etaEl = document.getElementById("eta");

  if (!lineSelect.value || !dirSelect.value || !stopSelect.value) return;

  try {
    const routeCode = dirSelect.value;

    const buses = await apiCall(`act=getBusLocation&p1=${routeCode}`);
    busMarkers.forEach(b => map.removeLayer(b));
    busMarkers = [];

    buses.forEach(b => {
      const lat = parseFloat(b.CS_LAT || b.lat);
      const lng = parseFloat(b.CS_LNG || b.lng);
      if (isNaN(lat) || isNaN(lng)) return;

      const snapped = snapToRoute(L.latLng(lat, lng));

      busMarkers.push(
        L.marker(snapped, {
          icon: L.divIcon({
            html: `<div class="bus-icon">🚌</div>`,
            iconSize: [26, 26],
            className: "",
          }),
        }).addTo(map)
      );
    });

    const arr = await apiCall(`act=getStopArrivals&p1=${stopSelect.value}`);
    if (!arr.length) return;

    const etaValue = parseInt(arr[0].btime2 || arr[0].btime, 10);
    if (etaValue === lastEtaValue) return;

    lastEtaValue = etaValue;

    const lineText =
      lineSelect.options[lineSelect.selectedIndex].text.split(" - ")[0];
    const dirText =
      dirSelect.options[dirSelect.selectedIndex].text;

    etaEl.innerHTML = `
      <div class="eta-box ${etaValue < 5 ? "urgent" : ""}">
        <div class="eta-line">${lineText} • ${dirText}</div>
        <div class="eta-minutes">Άφιξη σε ${etaValue} λεπτά</div>
      </div>
    `;

    setStatus("Ενημερώθηκε");
  } catch {
    setStatus("Σφάλμα ανανέωσης", true);
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  updateETA();
  etaInterval = setInterval(updateETA, 20000);
}

document.addEventListener("DOMContentLoaded", init);
