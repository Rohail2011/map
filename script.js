const map = L.map('map').setView([35.7877, -78.6443], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let selectedPlaces = { from: null, to: null };
let routingControl = null;
let steps = [], currentStepIndex = -1;
const stepsList = document.getElementById('stepsList');
const routeBtn = document.getElementById('routeBtn');
const voiceBtn = document.getElementById('voiceBtn');
const altRouteBtn = document.getElementById('altRouteBtn');
const qrBtn = document.getElementById('qrBtn');
const qrCanvas = document.getElementById('qrCanvas');

async function search(query) {
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`);
    const data = await res.json();
    return data.features || [];
  } catch {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
    return (await res.json()).map(place => ({
      geometry: { coordinates: [parseFloat(place.lon), parseFloat(place.lat)] },
      properties: { name: place.display_name.split(',')[0] || '' }
    }));
  }
}

function setupAutocomplete(id, boxId, key) {
  const input = document.getElementById(id);
  const box = document.getElementById(boxId);
  input.addEventListener('input', async () => {
    box.innerHTML = '';
    selectedPlaces[key] = null;
    updateButtons();
    const results = await search(input.value);
    results.forEach(feature => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = feature.properties.name;
      item.onclick = () => {
        input.value = item.textContent;
        box.innerHTML = '';
        const [lon, lat] = feature.geometry.coordinates;
        selectedPlaces[key] = L.latLng(lat, lon);
        updateButtons();
      };
      box.appendChild(item);
    });
  });
  document.addEventListener('click', e => {
    if (!box.contains(e.target) && e.target !== input) box.innerHTML = '';
  });
}

function updateButtons() {
  const ready = selectedPlaces.from && selectedPlaces.to;
  routeBtn.disabled = !ready;
  altRouteBtn.disabled = !ready;
}

function renderRoute(alternative = false) {
  if (routingControl) map.removeControl(routingControl);
  stepsList.innerHTML = '';
  voiceBtn.disabled = true;
  currentStepIndex = -1;

  routingControl = L.Routing.control({
    waypoints: [selectedPlaces.from, selectedPlaces.to],
    showAlternatives: alternative,
    routeWhileDragging: false,
    createMarker: (i, wp) => L.marker(wp.latLng),
  }).on('routesfound', e => {
    const route = e.routes[0];
    steps = route.instructions;
    stepsList.innerHTML = '';
    steps.forEach((step, i) => {
      const div = document.createElement('div');
      div.className = 'instruction-step';
      div.textContent = `${i + 1}. ${step.text}`;
      div.onclick = () => {
        currentStepIndex = i;
        speakStep(i);
        highlight(i);
        if (step.latLng) map.panTo(step.latLng);
      };
      stepsList.appendChild(div);
    });
    voiceBtn.disabled = false;
    highlight(0);
  }).addTo(map);
  map.fitBounds(L.latLngBounds([selectedPlaces.from, selectedPlaces.to]));
}

function speakStep(i) {
  if (!steps[i]) return;
  const msg = new SpeechSynthesisUtterance(steps[i].text);
  msg.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(msg);
}

function highlight(i) {
  document.querySelectorAll('.instruction-step').forEach(el => el.classList.remove('highlight'));
  const step = document.querySelectorAll('.instruction-step')[i];
  if (step) {
    step.classList.add('highlight');
    step.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

voiceBtn.onclick = () => {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    voiceBtn.textContent = '▶️ Voice Guidance';
    return;
  }
  currentStepIndex = 0;
  voiceBtn.textContent = '⏸️ Stop Guidance';
  speakStep(currentStepIndex);
  window.speechSynthesis.onend = () => {
    currentStepIndex++;
    if (currentStepIndex < steps.length) {
      highlight(currentStepIndex);
      speakStep(currentStepIndex);
    } else {
      voiceBtn.textContent = '▶️ Voice Guidance';
    }
  };
};

document.getElementById('liveLocationBtn').onclick = () => {
  navigator.geolocation.getCurrentPosition(pos => {
    selectedPlaces.from = L.latLng(pos.coords.latitude, pos.coords.longitude);
    updateButtons();
    alert('Live location set as start point.');
  }, () => alert('Failed to access location.'));
};

routeBtn.onclick = () => renderRoute(false);
altRouteBtn.onclick = () => renderRoute(true);

qrBtn.onclick = () => {
  if (!selectedPlaces.from || !selectedPlaces.to) return;
  const from = `${selectedPlaces.from.lat},${selectedPlaces.from.lng}`;
  const to = `${selectedPlaces.to.lat},${selectedPlaces.to.lng}`;
  const routeUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${from}%3B${to}`;
  const qr = new QRious({
    element: qrCanvas,
    value: routeUrl,
    size: 200
  });
};

setupAutocomplete('fromInput', 'fromAutocomplete', 'from');
setupAutocomplete('toInput', 'toAutocomplete', 'to');