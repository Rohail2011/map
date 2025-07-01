let map, control, currentStepIndex = 0;
let routeInstructions = [];
let activeRoute;
let following = true;

const instructionBox = document.getElementById('instructionBox');

// Initialize map
map = L.map('map').setView([35.9774, -79.9928], 13);
let tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

function setMapType(type) {
  if (map.hasLayer(tileLayer)) map.removeLayer(tileLayer);
  tileLayer = type === "satellite"
    ? L.tileLayer.provider('Esri.WorldImagery')
    : L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
  tileLayer.addTo(map);
}

document.getElementById('mapType').onchange = e => setMapType(e.target.value);

document.getElementById('themeBtn').onclick = () =>
  document.body.classList.toggle('dark');

document.getElementById('toggleSidebar').onclick = () => {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('closed');
  document.getElementById('toggleSidebar').textContent = sidebar.classList.contains('closed') ? '❯' : '❮';
};

document.getElementById('locateBtn').onclick = () => {
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
    const data = await res.json();
    document.getElementById('from').value = data.display_name || `${lat},${lon}`;
    map.setView([lat, lon], 15);
  });
};

document.getElementById('routeBtn').onclick = async () => {
  const from = document.getElementById('from').value.trim();
  const to = document.getElementById('to').value.trim();
  if (!from || !to) return alert('Enter both addresses');

  const fromLL = await geocode(from);
  const toLL = await geocode(to);
  if (!fromLL || !toLL) return;

  if (control) map.removeControl(control);

  control = L.Routing.control({
    waypoints: [fromLL, toLL],
    show: false,
    addWaypoints: false,
    draggableWaypoints: false,
    routeWhileDragging: false,
    createMarker: () => null,
    lineOptions: { styles: [{ color: '#007bff', weight: 5 }] },
    router: L.Routing.osrmv1({
      serviceUrl: 'https://router.project-osrm.org/route/v1'
    })
  }).addTo(map);

  control.on('routesfound', e => {
    const route = e.routes[0];
    activeRoute = route;
    routeInstructions = route.instructions;
    currentStepIndex = 0;
    showInstruction(routeInstructions[currentStepIndex]);
  });
};

async function geocode(q) {
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`);
  const json = await res.json();
  if (!json.features[0]) {
    alert(`Location not found: ${q}`);
    return null;
  }
  const [lon, lat] = json.features[0].geometry.coordinates;
  return L.latLng(lat, lon);
}

function showInstruction(instruction) {
  instructionBox.style.display = 'block';
  instructionBox.textContent = instruction.text || instruction;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(instruction.text || instruction));
}

function distance(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;

  const aVal = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
               Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}

navigator.geolocation.watchPosition(pos => {
  const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
  if (following) map.setView(latlng, 16, { animate: true });

  if (!routeInstructions || currentStepIndex >= routeInstructions.length) return;

  const nextStep = routeInstructions[currentStepIndex];
  const stepCoord = nextStep.latLng;

  if (distance(latlng, stepCoord) < 30) {
    currentStepIndex++;
    if (routeInstructions[currentStepIndex]) {
      showInstruction(routeInstructions[currentStepIndex]);
    } else {
      instructionBox.textContent = "You've arrived!";
    }
  }
}, err => {
  console.error("Geolocation error:", err);
}, {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000
});
