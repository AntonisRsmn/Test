const PROXY_BASE = "http://localhost:4000/api";

let routePolyline = null;
let etaRequestInProgress = false;
let map;
let busMarker = null;
let stopMarkers = [];
let autoRefreshTimer = null;
let lastEtaSignature = null;

/* ================= HELPERS ================= */

function decodeGreek(text) {
  if (!text) return "";
  try {
    return text.replace(/\\u[\dA-F]{4}/gi, m =>
      String.fromCharCode(parseInt(m.replace("\\u", ""), 16))
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
  const el = document.getElementById("status");
  el.textContent = `Κατάσταση: ${msg}`;
  el.style.color = error ? "#dc2626" : "#059669";
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildEtaSignature(arrivals) {
  if (!Array.isArray(arrivals)) return null;
  return arrivals
    .slice(0, 3)
    .map(a => `${a.route_code || a.RouteCode}-${a.btime2}`)
    .join("|");
}

/* ================= ROUTE POLYLINE ================= */

async function drawRoutePolyline(routeCode) {
  try {
    if (routePolyline) {
      map.removeLayer(routePolyline);
      routePolyline = null;
    }

    const shape = await apiCall(`act=getRouteShape&p1=${routeCode}`);

    if (!Array.isArray(shape) || shape.length === 0) {
      console.log("ℹ️ No route shape available for this route");
      return;
    }

    const points = shape
      .map(p => [
        parseFloat(p.CS_LAT || p.lat),
        parseFloat(p.CS_LNG || p.lng)
      ])
      .filter(p => !isNaN(p[0]) && !isNaN(p[1]));

    if (points.length < 2) {
      console.log("ℹ️ Not enough points for polyline");
      return;
    }

    routePolyline = L.polyline(points, {
      color: "#2563eb",
      weight: 5,
      opacity: 0.85
    }).addTo(map);

    map.fitBounds(routePolyline.getBounds(), { padding: [30, 30] });

    console.log("🟦 Route polyline drawn");

  } catch (err) {
    // 🔥 ΕΔΩ ΕΙΝΑΙ ΤΟ FIX
    console.log("ℹ️ Route polyline not supported for this line");
    routePolyline = null;
  }
}

function snapToRoute(latlng, polyline) {
  if (!polyline) return latlng;

  let closestPoint = latlng;
  let minDistance = Infinity;

  polyline.getLatLngs().forEach(p => {
    const d = map.distance(latlng, p);
    if (d < minDistance) {
      minDistance = d;
      closestPoint = p;
    }
  });

  return minDistance < 100 ? closestPoint : latlng;
}

/* ================= INIT ================= */

async function init() {
  try {
    setStatus("Φόρτωση γραμμών…");

    map = L.map("map").setView([37.9838, 23.7275], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19
    }).addTo(map);

    const raw = await apiCall("act=webGetLines");
    const lines = Array.isArray(raw) ? raw : raw.data || [];

    lineSelect.innerHTML = `<option value="">-- Επιλέξτε Γραμμή --</option>`;

    lines
      .sort((a, b) => (parseInt(a.LineID) || 0) - (parseInt(b.LineID) || 0))
      .forEach(l => {
        const o = document.createElement("option");
        o.value = l.LineCode;
        o.textContent = `${l.LineID || ""} - ${decodeGreek(l.LineDescr)}`;
        lineSelect.appendChild(o);
      });

    lineSelect.disabled = false;
    lineSelect.onchange = loadDirections;
    refresh.onclick = updateETA;

    setStatus("Έτοιμο");
  } catch (e) {
    console.error(e);
    setStatus("Σφάλμα", true);
  }
}

/* ================= DIRECTIONS ================= */

async function loadDirections() {
  lastEtaSignature = null;
  clearAutoRefresh();
  clearStops();

  const lineCode = lineSelect.value;
  if (!lineCode) return;

  try {
    setStatus("Φόρτωση κατευθύνσεων…");
    const routes = await apiCall(`act=getRoutesForLine&p1=${lineCode}`);

    dirSelect.innerHTML = `<option value="">-- Επιλέξτε Κατεύθυνση --</option>`;
    routes.forEach(r => {
      const o = document.createElement("option");
      o.value = r.route_code || r.RouteCode;
      o.textContent = decodeGreek(r.route_descr || r.RouteDescr);
      dirSelect.appendChild(o);
    });

    dirSelect.disabled = false;
    dirSelect.onchange = loadStops;
  } catch {
    alert("Σφάλμα κατευθύνσεων");
  }
}

/* ================= STOPS ================= */

async function loadStops() {
  lastEtaSignature = null;
  clearAutoRefresh();
  clearStops();

  const routeCode = dirSelect.value;
  if (!routeCode) return;

  await drawRoutePolyline(routeCode);

  try {
    setStatus("Φόρτωση στάσεων…");
    const stops = await apiCall(`act=getStopsForRoute&p1=${routeCode}`);

    stopSelect.innerHTML = `<option value="">-- Επιλέξτε Στάση --</option>`;

    stops.forEach(s => {
      const code = s.stop_code || s.StopCode;
      const name = decodeGreek(s.stop_descr || s.StopDescr);

      const o = document.createElement("option");
      o.value = code;
      o.textContent = name;
      stopSelect.appendChild(o);

      addStopMarker(code, name, s.StopLat || s.lat, s.StopLng || s.lng);
    });

    stopSelect.disabled = false;
    startAutoRefresh();
    locateNearestStop(stops);

    setStatus("Επιλέξτε στάση");
  } catch {
    alert("Σφάλμα στάσεων");
  }
}

/* ================= STOPS MAP ================= */

function addStopMarker(code, name, lat, lng) {
  if (!lat || !lng) return;

  const m = L.circleMarker([lat, lng], {
    radius: 6,
    color: "#2563eb"
  }).addTo(map);

  m.on("click", () => {
    stopSelect.value = code;
    setTimeout(updateETA, 0);
  });

  m.bindPopup(`📍 ${name}`);
  stopMarkers.push(m);
}

function clearStops() {
  stopMarkers.forEach(m => map.removeLayer(m));
  stopMarkers = [];
}

/* ================= NEAREST STOP ================= */

function locateNearestStop(stops) {
  if (!navigator.geolocation || !window.isSecureContext) return;

  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude } = pos.coords;

    let nearest = null;
    let min = Infinity;

    stops.forEach(s => {
      const lat = s.StopLat || s.lat;
      const lng = s.StopLng || s.lng;
      if (!lat || !lng) return;

      const d = haversine(latitude, longitude, lat, lng);
      if (d < min) {
        min = d;
        nearest = s;
      }
    });

    if (nearest) {
      stopSelect.value = nearest.stop_code || nearest.StopCode;
      updateETA();
    }
  });
}

/* ================= ETA & BUS ================= */

async function updateETA() {
  if (etaRequestInProgress) return;
  etaRequestInProgress = true;

  try {
    const stopCode = stopSelect.value;
    if (!stopCode) return;

    setStatus("Ανανέωση δεδομένων…");

    const rawArrivals = await apiCall(`act=getStopArrivals&p1=${stopCode}`);
    const arrivals = Array.isArray(rawArrivals) ? rawArrivals : [];

    const newSignature = buildEtaSignature(arrivals);
    if (newSignature === lastEtaSignature) {
      setStatus("Χωρίς αλλαγή");
      return;
    }

    lastEtaSignature = newSignature;

    eta.textContent = arrivals.length
      ? "⏱️ " +
        arrivals
          .slice(0, 3)
          .map(a => `${a.route_code || "—"}: ${a.btime2}’`)
          .join(" | ")
      : "⏱️ Δεν υπάρχουν δεδομένα";

    const routeCode = dirSelect.value;
    if (!routeCode) return;

    const buses = await apiCall(`act=getBusLocation&p1=${routeCode}`);
    if (!Array.isArray(buses) || !buses.length) return;

    const b = buses[0];

    const rawLatLng = L.latLng(
      parseFloat(b.CS_LAT || b.lat),
      parseFloat(b.CS_LNG || b.lng)
    );

    const snapped = snapToRoute(rawLatLng, routePolyline);

    if (!busMarker) {
      busMarker = L.marker(snapped, {
        icon: L.divIcon({
          html: "🚌",
          iconSize: [28, 28],
          className: ""
        })
      }).addTo(map);
    } else {
      busMarker.setLatLng(snapped);
    }

    setStatus("Ενημερώθηκε");
  } catch (e) {
    console.error(e);
    setStatus("Σφάλμα ETA", true);
  } finally {
    etaRequestInProgress = false;
  }
}

/* ================= AUTO REFRESH ================= */

function startAutoRefresh() {
  clearAutoRefresh();
  autoRefreshTimer = setInterval(updateETA, 30000);
}

function clearAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

/* ================= BOOT ================= */

document.addEventListener("DOMContentLoaded", init);
