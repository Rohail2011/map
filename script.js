const map = L.map('map').setView([35.7796, -78.6382], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// DOM elements
const d = document;
const sidebar = d.getElementById('sidebar'),
      toggleBtn = d.getElementById('toggleBtn'),
      fromInput = d.getElementById('from'),
      toInput = d.getElementById('to'),
      useLoc = d.getElementById('useLoc'),
      getRoute = d.getElementById('getRoute'),
      voiceGuide = d.getElementById('voiceGuide'),
      voiceLang = d.getElementById('voiceLang'),
      altRoute = d.getElementById('altRoute'),
      qrBtn = d.getElementById('qrBtn'),
      shareBtn = d.getElementById('shareBtn'),
      themeBtn = d.getElementById('themeBtn'),
      saveFav = d.getElementById('saveFav'),
      favoritesList = d.getElementById('favoritesList'),
      dirPanel = d.getElementById('directionsPanel'),
      qrModal = d.getElementById('qrModal'),
      qrCanvas = d.getElementById('qrCanvas');

// State
let fromLL = null, toLL = null, steps = [], routingCtrl = null, liveMarker = null;
let watchId = null, showAlt = false;

// Sidebar toggle
toggleBtn.onclick = () => sidebar.classList.toggle('open');

// Theme toggle
themeBtn.onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');

// Geocode helper
async function geocode(q) {
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`);
    const js = await res.json();
    if (js.features.length) {
      const [lng, lat] = js.features[0].geometry.coordinates;
      return L.latLng(lat, lng);
    }
  } catch (e) {
    console.error(e);
  }
  return null;
}

// Enable/disable route button
function enableRouting() {
  getRoute.disabled = !(fromLL && toLL);
}
setInterval(enableRouting, 300);

// “My Location” live tracking
useLoc.onclick = () => {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(pos => {
    fromLL = L.latLng(pos.coords.latitude, pos.coords.longitude);
    fromInput.value = 'My Location';
    if (!liveMarker) {
      liveMarker = L.marker(fromLL, {
        icon: L.icon({
          iconUrl: 'https://cdn-icons-png.flaticon.com/512/64/64113.png',
          iconSize: [25, 41], iconAnchor: [12, 41]
        })
      }).addTo(map);
    } else liveMarker.setLatLng(fromLL);
    map.setView(fromLL, map.getZoom());
  }, err => console.error(err), {enableHighAccuracy:true});
};

// Input blur geocoding
fromInput.addEventListener('blur', async () => {
  if (fromInput.value !== 'My Location') fromLL = await geocode(fromInput.value);
});
toInput.addEventListener('blur', async () => {
  toLL = await geocode(toInput.value);
});

// Alt toggle
altRoute.onclick = () => {
  showAlt = !showAlt;
  altRoute.textContent = showAlt ? '✅ Alt On' : '🔀 Alt Route';
};

// Routing and live marker placement
getRoute.onclick = () => {
  if (!(fromLL && toLL)) return alert('Please set both points.');
  if (routingCtrl) map.removeControl(routingCtrl);
  dirPanel.innerHTML = '';
  dirPanel.classList.remove('open');
  sidebar.classList.remove('open');

  if (liveMarker) liveMarker.remove();
  useLoc.onclick();

  routingCtrl = L.Routing.control({
    waypoints: [fromLL, toLL],
    showAlternatives: showAlt,
    createMarker: (i, wp) => {
      if (i === 0 && liveMarker) return liveMarker;
      return L.marker(wp.latLng);
    }
  }).addTo(map).on('routesfound', e => {
    steps = e.routes[0].instructions;
    renderSteps();
  });
};

// Render steps panel with icons
function iconFor(text) {
  text = text.toLowerCase();
  if (text.includes('left')) return '⬅️';
  if (text.includes('right')) return '➡️';
  if (text.includes('straight')) return '⬆️';
  return '⚠️';
}

function renderSteps() {
  dirPanel.innerHTML = '';
  steps.forEach((st, i) => {
    const div = d.createElement('div');
    div.className = 'dir-step';
    div.innerHTML = `<span class="icon">${iconFor(st.text)}</span>
                     <span class="text">${i+1}. ${st.text}</span>`;
    div.onclick = () => speakStep(i);
    dirPanel.appendChild(div);
  });
  dirPanel.classList.add('open');
}

// Voice guidance
function speakStep(i) {
  const utt = new SpeechSynthesisUtterance(steps[i].text);
  utt.lang = voiceLang.value;
  window.speechSynthesis.speak(utt);
}

voiceGuide.onclick = () => {
  let idx = 0;
  function next() {
    if (idx >= steps.length) return;
    speakStep(idx);
    window.speechSynthesis.onend = () => { idx++; next(); };
  }
  next();
};

// QR code modal
qrBtn.onclick = () => {
  if (!(fromLL && toLL)) return alert('Fill both points first.');
  const url = `${location.origin}${location.pathname}?from=${encodeURIComponent(fromInput.value)}&to=${encodeURIComponent(toInput.value)}`;
  QRCode.toCanvas(qrCanvas, url, () => qrModal.style.display = 'block');
};
qrModal.onclick = () => qrModal.style.display = 'none';

// Share link
shareBtn.onclick = () => {
  if (!(fromLL && toLL)) return alert('Fill both points first.');
  const url = `${location.origin}${location.pathname}?from=${encodeURIComponent(fromInput.value)}&to=${encodeURIComponent(toInput.value)}`;
  navigator.clipboard.writeText(url).then(() => alert('Link copied!'));
};

// Favorites
saveFav.onclick = () => {
  const arr = JSON.parse(localStorage.getItem('favs') || '[]');
  arr.push({f: fromInput.value, t: toInput.value});
  localStorage.setItem('favs', JSON.stringify(arr));
  loadFavs();
};

function loadFavs() {
  favoritesList.innerHTML = '';
  JSON.parse(localStorage.getItem('favs') || '[]').forEach(o => {
    const li = d.createElement('li');
    li.textContent = `${o.f} → ${o.t}`;
    li.onclick = async () => {
      fromInput.value = o.f;
      toInput.value = o.t;
      fromLL = await geocode(o.f);
      toLL = await geocode(o.t);
      getRoute.click();
    };
    favoritesList.appendChild(li);
  });
}
loadFavs();

// Auto-load share link params
(function handleParams() {
  const p = new URLSearchParams(location.search),
        f = p.get('from'), t = p.get('to');
  if (f && t) {
    fromInput.value = f; toInput.value = t;
    geocode(f).then(ll => fromLL = ll);
    geocode(t).then(ll => {
      toLL = ll;
      setTimeout(() => click(getRoute), 800);
    });
  }
})();
