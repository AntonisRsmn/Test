const PROXY_BASE = "https://test-4fo1.onrender.com/api";
let map, busMarker;

/* ---------- Helpers ---------- */

function decodeGreek(text) {
  try {
    return JSON.parse(`"${text}"`);
  } catch {
    return text;
  }
}

async function apiCall(query) {
  const res = await fetch(`${PROXY_BASE}?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    throw new Error("API error");
  }
  return res.json();
}

/* ---------- Init ---------- */

async function init() {
  try {
    const raw = await apiCall("act=webGetLines");
    const lines = Array.isArray(raw) ? raw : raw.data;
    const lineSelect = document.getElementById("lineSelect");
    lineSelect.innerHTML = "";

    lines.forEach(line => {
      const o = document.createElement("option");
      o.value = line.LineCode;
      o.textContent = decodeGreek(line.LineDescr);
      lineSelect.appendChild(o);
    });

    lineSelect.onchange = loadDirections;
    document.getElementById("refresh").onclick = updateETA;

    map = L.map("map").setView([37.98, 23.72], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19
    }).addTo(map);

    await loadDirections();
  } catch (err) {
    console.error(err);
    alert("Αποτυχία φόρτωσης γραμμών");
  }
}

/* ---------- Directions ---------- */

async function loadDirections() {
  try {
    const lineCode = document.getElementById("lineSelect").value;
    const routes = await apiCall(`act=getRoutesForLine&p1=${lineCode}`);

    const dirSelect = document.getElementById("dirSelect");
    dirSelect.innerHTML = "";

    routes.forEach(r => {
      const o = document.createElement("option");
      o.value = r.RouteCode;
      o.textContent = decodeGreek(r.RouteDescr);
      dirSelect.appendChild(o);
    });

    dirSelect.onchange = loadStops;
    await loadStops();
  } catch (err) {
    console.error(err);
    alert("Αποτυχία φόρτωσης κατευθύνσεων");
  }
}

/* ---------- Stops ---------- */

async function loadStops() {
  try {
    const routeCode = document.getElementById("dirSelect").value;
    const stops = await apiCall(`act=getStopsForRoute&p1=${routeCode}`);

    const stopSelect = document.getElementById("stopSelect");
    stopSelect.innerHTML = "";

    stops.forEach(s => {
      const o = document.createElement("option");
      o.value = s.StopCode;
      o.textContent = decodeGreek(s.StopDescr);
      stopSelect.appendChild(o);
    });

    await updateETA();
  } catch (err) {
    console.error(err);
    alert("Αποτυχία φόρτωσης στάσεων");
  }
}

/* ---------- ETA & Bus ---------- */

async function updateETA() {
  try {
    const stopCode = document.getElementById("stopSelect").value;
    const arrivals = await apiCall(`act=getStopArrivals&p1=${stopCode}`);

    if (arrivals.length) {
      document.getElementById("eta").textContent =
        `ETA: ${arrivals[0].btime2} λεπτά`;
    }

    const routeCode = document.getElementById("dirSelect").value;
    const buses = await apiCall(`act=getBusLocation&p1=${routeCode}`);

    if (buses.length) {
      const b = buses[0];
      if (!busMarker) {
        busMarker = L.marker([b.lat, b.lng]).addTo(map);
      } else {
        busMarker.setLatLng([b.lat, b.lng]);
      }
      map.setView([b.lat, b.lng], 14);
    }
  } catch (err) {
    console.error(err);
  }
}

/* ---------- Mobile Safari Fix ---------- */

document.querySelectorAll("select").forEach(sel => {
  sel.addEventListener("focus", () => {
    if (map) {
      map.dragging.disable();
      map.touchZoom.disable();
      map.scrollWheelZoom.disable();
    }
  });

  sel.addEventListener("blur", () => {
    if (map) {
      map.dragging.enable();
      map.touchZoom.enable();
      map.scrollWheelZoom.enable();
    }
  });
});

init();
