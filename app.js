const PROXY_BASE =
  location.hostname === "localhost"
    ? "http://localhost:4000/api"
    : "https://test-4fo1.onrender.com/api";
let map, busMarker;

/* ---------- Helpers ---------- */
function decodeGreek(text) {
  if (!text) return "";
  try {
    return text.replace(/\\u[\dA-F]{4}/gi, match => 
      String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16))
    );
  } catch {
    return text;
  }
}

async function apiCall(query) {
  try {
    console.log("API Call:", query);
    const res = await fetch(`${PROXY_BASE}?q=${encodeURIComponent(query)}`);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    console.log("API Response:", data);
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    return data;
  } catch (err) {
    console.error("API Call failed:", err);
    throw err;
  }
}

function setStatus(message, isError = false) {
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = `Κατάσταση: ${message}`;
    statusEl.style.color = isError ? "#dc2626" : "#059669";
  }
}

/* ---------- Init ---------- */
async function init() {
  const lineSelect = document.getElementById("lineSelect");

  try {
    setStatus("Φόρτωση γραμμών...");

    const raw = await apiCall("act=webGetLines");
    const lines = Array.isArray(raw) ? raw : [];

    lineSelect.innerHTML =
      '<option value="">-- Επιλέξτε Γραμμή --</option>';

    if (lines.length === 0) {
      // ⬅️ ΚΡΙΣΙΜΟ: ΜΗΝ ΚΟΛΛΑΣ ΤΟ UI
      lineSelect.innerHTML =
        '<option value="">⚠️ Οι γραμμές δεν είναι διαθέσιμες τώρα</option>';
      lineSelect.disabled = false;

      setStatus("Αναμονή backend / ΟΑΣΑ…");
      return;
    }

    lines
      .sort((a, b) => (parseInt(a.LineID) || 0) - (parseInt(b.LineID) || 0))
      .forEach(line => {
        const opt = document.createElement("option");
        opt.value = line.LineCode;
        opt.textContent = `${line.LineID || ""} - ${decodeGreek(line.LineDescr)}`;
        lineSelect.appendChild(opt);
      });

    lineSelect.disabled = false;
    lineSelect.onchange = loadDirections;

    document.getElementById("refresh").onclick = updateETA;

    map = L.map("map").setView([37.9838, 23.7275], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    setStatus("Έτοιμο");

  } catch (err) {
    console.error("Init failed:", err);

    lineSelect.innerHTML =
      '<option value="">❌ Backend μη διαθέσιμο</option>';
    lineSelect.disabled = false;

    setStatus("Backend offline", true);
  }
}

/* ---------- Directions ---------- */
async function loadDirections() {
  const lineCode = document.getElementById("lineSelect").value;
  
  const dirSelect = document.getElementById("dirSelect");
  const stopSelect = document.getElementById("stopSelect");
  const refreshBtn = document.getElementById("refresh");
  
  if (!lineCode) {
    dirSelect.disabled = true;
    stopSelect.disabled = true;
    refreshBtn.disabled = true;
    dirSelect.innerHTML = '<option value="">-- Επιλέξτε Κατεύθυνση --</option>';
    stopSelect.innerHTML = '<option value="">-- Επιλέξτε Στάση --</option>';
    return;
  }
  
  try {
    setStatus("Φόρτωση κατευθύνσεων...");
    
    dirSelect.innerHTML = '<option value="">Φόρτωση...</option>';
    dirSelect.disabled = true;
    stopSelect.innerHTML = '<option value="">-- Επιλέξτε Κατεύθυνση πρώτα --</option>';
    stopSelect.disabled = true;
    refreshBtn.disabled = true;
    
    console.log("Loading routes for line:", lineCode);
    const routes = await apiCall(`act=getRoutesForLine&p1=${lineCode}`);
    
    console.log("Routes received:", routes);
    
    if (!routes || routes.length === 0) {
      throw new Error("Δεν βρέθηκαν κατευθύνσεις για αυτή τη γραμμή");
    }
    
    dirSelect.innerHTML = '<option value="">-- Επιλέξτε Κατεύθυνση --</option>';
    
    routes.forEach(route => {
      const option = document.createElement("option");
      // ✅ FIXED: Use route_code instead of RouteCode
      option.value = route.route_code || route.RouteCode;
      // ✅ FIXED: Use route_descr instead of RouteDescr
      const routeDescr = decodeGreek(route.route_descr || route.RouteDescr) || "Άγνωστη κατεύθυνση";
      option.textContent = routeDescr;
      dirSelect.appendChild(option);
    });
    
    dirSelect.disabled = false;
    dirSelect.onchange = loadStops;
    
    setStatus("Επιλέξτε κατεύθυνση");
    
  } catch (err) {
    console.error("Load directions error:", err);
    dirSelect.innerHTML = '<option value="">Σφάλμα φόρτωσης</option>';
    dirSelect.disabled = true;
    setStatus("Αποτυχία φόρτωσης κατευθύνσεων", true);
    alert("Σφάλμα κατευθύνσεων: " + err.message);
  }
}

/* ---------- Stops ---------- */
async function loadStops() {
  const routeCode = document.getElementById("dirSelect").value;
  const stopSelect = document.getElementById("stopSelect");
  const refreshBtn = document.getElementById("refresh");
  
  if (!routeCode) {
    stopSelect.disabled = true;
    refreshBtn.disabled = true;
    stopSelect.innerHTML = '<option value="">-- Επιλέξτε Κατεύθυνση πρώτα --</option>';
    return;
  }
  
  try {
    setStatus("Φόρτωση στάσεων...");
    
    stopSelect.innerHTML = '<option value="">Φόρτωση...</option>';
    stopSelect.disabled = true;
    refreshBtn.disabled = true;
    
    console.log("Loading stops for route:", routeCode);
    const stops = await apiCall(`act=getStopsForRoute&p1=${routeCode}`);
    
    console.log("Stops received:", stops);
    
    if (!stops || stops.length === 0) {
      throw new Error("Δεν βρέθηκαν στάσεις");
    }
    
    stopSelect.innerHTML = '<option value="">-- Επιλέξτε Στάση --</option>';
    
    stops.forEach(stop => {
      const option = document.createElement("option");
      // ✅ FIXED: Handle both naming conventions
      option.value = stop.stop_code || stop.StopCode;
      const stopDescr = decodeGreek(stop.stop_descr || stop.StopDescr) || "Άγνωστη στάση";
      option.textContent = stopDescr;
      stopSelect.appendChild(option);
    });
    
    stopSelect.disabled = false;
    refreshBtn.disabled = false;
    
    setStatus("Επιλέξτε στάση");
    
  } catch (err) {
    console.error("Load stops error:", err);
    stopSelect.innerHTML = '<option value="">Σφάλμα φόρτωσης</option>';
    stopSelect.disabled = true;
    setStatus("Αποτυχία φόρτωσης στάσεων", true);
    alert("Σφάλμα στάσεων: " + err.message);
  }
}

/* ---------- ETA & Bus Location ---------- */
async function updateETA() {
  const stopCode = document.getElementById("stopSelect").value;
  
  if (!stopCode) {
    alert("Παρακαλώ επιλέξτε στάση πρώτα");
    return;
  }
  
  try {
    setStatus("Ανανέωση δεδομένων...");
    
    console.log("Getting arrivals for stop:", stopCode);
    const arrivals = await apiCall(`act=getStopArrivals&p1=${stopCode}`);
    
    console.log("Arrivals received:", arrivals);
    
    const etaEl = document.getElementById("eta");
    
    if (Array.isArray(arrivals) && arrivals.length > 0) {
      const eta = arrivals[0].btime2 || arrivals[0].btime || "N/A";
      etaEl.textContent = `⏱️ ETA: ${eta} λεπτά`;
    } else {
      etaEl.textContent = "⏱️ ETA: Δεν υπάρχουν δεδομένα";
    }
    
    // Get bus location
    const routeCode = document.getElementById("dirSelect").value;
    
    if (routeCode) {
      try {
        console.log("Getting bus location for route:", routeCode);
        const buses = await apiCall(`act=getBusLocation&p1=${routeCode}`);
        
        console.log("Bus locations received:", buses);
        
        if (Array.isArray(buses) && buses.length > 0) {
          const bus = buses[0];
          
          // ✅ FIXED: Handle both naming conventions
          const lat = parseFloat(bus.CS_LAT || bus.lat);
          const lng = parseFloat(bus.CS_LNG || bus.lng);
          
          if (!isNaN(lat) && !isNaN(lng)) {
            if (!busMarker) {
              busMarker = L.marker([lat, lng], {
                icon: L.divIcon({
                  className: 'bus-marker',
                  html: '<div style="font-size: 24px;">🚌</div>',
                  iconSize: [30, 30]
                })
              }).addTo(map);
            } else {
              busMarker.setLatLng([lat, lng]);
            }
            
            map.setView([lat, lng], 15);
            console.log("Bus marker placed at:", lat, lng);
          }
        } else {
          console.log("No bus location data available");
        }
      } catch (busErr) {
        console.log("Bus location not available:", busErr);
      }
    }
    
    setStatus("Ενημερώθηκε επιτυχώς");
    
  } catch (err) {
    console.error("Update ETA error:", err);
    setStatus("Αποτυχία ανανέωσης", true);
    alert("Σφάλμα ανανέωσης: " + err.message);
  }
}

/* ---------- Mobile Safari Fix ---------- */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function initApp() {
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
}
