// Initialize the Leaflet map
const map = L.map('map').setView([35.7796, -78.6382], 13); // Centered around NC State Main Campus
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Get references to all necessary DOM elements
const d = document;
const sidebar = d.getElementById('sidebar'),
      toggleBtn = d.getElementById('toggleBtn'),
      fromInput = d.getElementById('from'),
      toInput = d.getElementById('to'),
      useLoc = d.getElementById('useLoc'),
      getRoute = d.getElementById('getRoute'),
      voiceLang = d.getElementById('voiceLang'), // Kept for language selection
      altRoute = d.getElementById('altRoute'),
      qrBtn = d.getElementById('qrBtn'),
      shareBtn = d.getElementById('shareBtn'),
      themeBtn = d.getElementById('themeBtn'),
      saveFav = d.getElementById('saveFav'),
      favoritesList = d.getElementById('favoritesList'),
      dirPanel = d.getElementById('directionsPanel'),
      qrModal = d.getElementById('qrModal'),
      qrCanvas = d.getElementById('qrCanvas');

// Global state variables
let fromLL = null; // LatLng for 'From' location
let toLL = null;   // LatLng for 'To' location
let steps = [];    // Array to store routing instructions
let routingCtrl = null; // Leaflet Routing Machine control object
let liveMarker = null;  // Marker for user's current location
let watchId = null;     // ID for geolocation.watchPosition
let showAlt = false;    // Flag to show alternative routes

// ==================== UI Interactions ====================

// Toggle sidebar visibility
toggleBtn.onclick = () => {
  sidebar.classList.toggle('open');
  // Close directions panel if sidebar opens and covers it
  if (sidebar.classList.contains('open')) {
      dirPanel.classList.remove('open');
  }
};

// Toggle light/dark theme
themeBtn.onclick = () => {
  document.body.classList.toggle('dark');
  const currentTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
  localStorage.setItem('theme', currentTheme);
};
// Apply theme preference on page load
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
}

// ==================== Geocoding and Location ====================

/**
 * Geocodes a given query string to Leaflet LatLng coordinates using Photon.
 * @param {string} q - The location query string.
 * @returns {L.LatLng|null} The LatLng object or null if not found/error.
 */
async function geocode(q) {
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`);
    const js = await res.json();
    if (js.features && js.features.length > 0) {
      const [lng, lat] = js.features[0].geometry.coordinates;
      return L.latLng(lat, lng);
    } else {
      // alert('Location not found for: ' + q); // Removed for less intrusive experience
      console.warn('Location not found for:', q);
    }
  } catch (e) {
    console.error('Geocoding error:', e);
    alert('An error occurred while looking up location: ' + q + '. Please try again.');
  }
  return null;
}

// Enable/disable 'Get Directions' button based on both points being set
function enableRoutingButton() {
  getRoute.disabled = !(fromLL && toLL);
}
// Check button state periodically
setInterval(enableRoutingButton, 300);

// "My Location" live tracking/stop
useLoc.onclick = () => {
  if (watchId) { // If tracking is active, stop it
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    liveMarker?.remove();
    liveMarker = null;
    fromInput.value = '';
    fromLL = null;
    useLoc.textContent = '📍 My Location'; // Reset button text
    alert('Live location tracking stopped.');
    return;
  }

  // Start tracking
  useLoc.textContent = '🛑 Stop Tracking';
  alert('Starting live location tracking. Please allow location access.');

  // Get initial position first
  navigator.geolocation.getCurrentPosition(
    initialPos => {
      fromLL = L.latLng(initialPos.coords.latitude, initialPos.coords.longitude);
      fromInput.value = 'My Location';
      if (!liveMarker) {
        liveMarker = L.marker(fromLL, {
          icon: L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/64/64113.png', // Generic location icon
            iconSize: [25, 41], iconAnchor: [12, 41]
          })
        }).addTo(map);
      } else {
        liveMarker.setLatLng(fromLL);
      }
      map.setView(fromLL, map.getZoom()); // Center map on initial location

      // Then start watching for continuous updates
      watchId = navigator.geolocation.watchPosition(pos => {
        fromLL = L.latLng(pos.coords.latitude, pos.coords.longitude);
        liveMarker?.setLatLng(fromLL); // Update marker position
      }, err => {
        console.error("Geolocation watch error:", err);
        alert("Live location tracking encountered an error. Stopping tracking.");
        // Clean up on error
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        liveMarker?.remove();
        liveMarker = null;
        fromInput.value = '';
        fromLL = null;
        useLoc.textContent = '📍 My Location';
      }, {enableHighAccuracy: true, timeout: 10000, maximumAge: 0}); // Added timeout and maximumAge
    },
    err => {
      console.error("Geolocation initial fetch error:", err);
      alert("Could not get your current location. Please ensure location services are enabled for this site.");
      useLoc.textContent = '📍 My Location'; // Reset button text on initial error
    },
    {enableHighAccuracy: true, timeout: 10000, maximumAge: 0}
  );
};

// Geocode 'From' input on blur
fromInput.addEventListener('blur', async () => {
  if (fromInput.value && fromInput.value !== 'My Location') {
    fromLL = await geocode(fromInput.value);
    if (!fromLL) fromInput.value = ''; // Clear input if geocoding failed
  } else if (!fromInput.value) { // If input is empty, clear fromLL
      fromLL = null;
  }
});

// Geocode 'To' input on blur
toInput.addEventListener('blur', async () => {
  if (toInput.value) {
    toLL = await geocode(toInput.value);
    if (!toLL) toInput.value = ''; // Clear input if geocoding failed
  } else if (!toInput.value) { // If input is empty, clear toLL
      toLL = null;
  }
});

// Toggle alternative routes setting
altRoute.onclick = () => {
  showAlt = !showAlt;
  altRoute.textContent = showAlt ? '✅ Alt On' : '🔀 Alt Route';
  // Re-calculate route immediately if one is already displayed
  if (fromLL && toLL && routingCtrl) {
      getRoute.click(); // Simulate click to re-initiate routing
  }
};

// ==================== Routing and Directions ====================

// Initiate route calculation
getRoute.onclick = () => {
  if (!(fromLL && toLL)) {
      alert('Please enter both "From" and "To" locations.');
      return;
  }

  // Stop any ongoing speech before starting a new route
  if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
  }

  // Remove existing routing control if any
  if (routingCtrl) {
      map.removeControl(routingCtrl);
      routingCtrl = null;
  }

  // Clear and hide directions panel
  dirPanel.innerHTML = '';
  dirPanel.classList.remove('open');
  sidebar.classList.remove('open'); // Close sidebar after getting route

  // Ensure live marker (if active) is on the map and used as start
  if (watchId && fromLL) {
      if (!liveMarker) { // Re-add if it was removed unexpectedly
          liveMarker = L.marker(fromLL, {
            icon: L.icon({
              iconUrl: 'https://cdn-icons-png.flaticon.com/512/64/64113.png',
              iconSize: [25, 41], iconAnchor: [12, 41]
            })
          }).addTo(map);
      } else {
          liveMarker.setLatLng(fromLL); // Update position if it moved
      }
  } else if (liveMarker) { // If live tracking is off, remove the marker
      liveMarker.remove();
      liveMarker = null;
  }

  // Create new routing control
  routingCtrl = L.Routing.control({
    waypoints: [fromLL, toLL],
    showAlternatives: showAlt,
    // Using OSRM router for routing service
    router: L.Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1'
    }),
    createMarker: (i, wp) => {
      // Use the liveMarker for the first waypoint if it exists and tracking is active
      if (i === 0 && liveMarker) {
          return liveMarker;
      }
      // For other waypoints or if no live tracking, use default marker
      return L.marker(wp.latLng);
    },
    lineOptions: {
        styles: [{color: 'red', opacity: 0.7, weight: 7, dashArray: '5, 10'}] // Styled main route
    },
    altLineOptions: {
        styles: [{color: 'grey', opacity: 0.5, weight: 5, dashArray: '5, 10'}] // Styled alt routes
    },
    routeWhileDragging: true // Enable route update while dragging markers
  }).addTo(map);

  // Event listener for when routes are found
  routingCtrl.on('routesfound', e => {
    steps = e.routes[0].instructions;
    renderSteps(); // Render steps in the panel
    map.fitBounds(e.routes[0].coordinates); // Fit map to the route bounds

    // --- AUTOMATIC VOICE GUIDANCE START ---
    startVoiceGuidance();
    // --- END AUTOMATIC VOICE GUIDANCE START ---

  }).on('routingerror', e => {
      console.error("Routing error:", e.error);
      alert('Could not find a route: ' + (e.error.message || 'Unknown error.'));
      if (routingCtrl) {
          map.removeControl(routingCtrl);
          routingCtrl = null;
      }
      dirPanel.classList.remove('open'); // Hide directions panel on error
  });
};

/**
 * Determines the appropriate emoji icon for a given direction text.
 * @param {string} text - The instruction text.
 * @returns {string} An emoji character.
 */
function iconFor(text) {
  text = text.toLowerCase();
  if (text.includes('head') || text.includes('start')) return '⬆️'; // Start or go straight
  if (text.includes('left')) return '⬅️';
  if (text.includes('right')) return '➡️';
  if (text.includes('continue')) return '⬆️'; // Continue straight
  if (text.includes('merge')) return '↗️'; // Merge
  if (text.includes('exit')) return '↘️'; // Exit
  if (text.includes('uturn')) return '↩️'; // U-turn
  if (text.includes('roundabout')) return '🔄'; // Roundabout
  if (text.includes('arrive') || text.includes('destination')) return '🏁'; // Finish flag
  return '📍'; // Default pin
}

/**
 * Renders the step-by-step directions in the directions panel.
 */
function renderSteps() {
  dirPanel.innerHTML = ''; // Clear previous steps
  if (steps.length === 0) {
      dirPanel.innerHTML = '<p style="padding: 1rem; text-align: center; color: var(--text);">No detailed directions available for this route.</p>';
      return;
  }
  steps.forEach((st, i) => {
    const div = d.createElement('div');
    div.className = 'dir-step';
    div.dataset.stepIndex = i; // Store index for highlighting

    const distanceText = st.distance ? ` (${(st.distance / 1000).toFixed(1)} km)` : '';
    div.innerHTML = `<span class="icon">${iconFor(st.text)}</span>
                     <span class="text">${i+1}. ${st.text}${distanceText}</span>`;
    div.onclick = () => speakSingleStep(i); // Allow clicking individual steps to speak
    dirPanel.appendChild(div);
  });
  dirPanel.classList.add('open'); // Show the panel
}

// ==================== Voice Guidance (Automatic) ====================

let currentSpeakingIndex = -1; // Track the index of the currently spoken step

/**
 * Speaks a single direction step and highlights it.
 * @param {number} i - The index of the step to speak.
 */
function speakSingleStep(i) {
  if (!window.speechSynthesis || steps.length === 0) {
      alert("Speech synthesis not supported or no directions available.");
      return;
  }
  window.speechSynthesis.cancel(); // Stop any ongoing speech

  // Remove highlight from previously spoken step
  if (currentSpeakingIndex !== -1 && dirPanel.children[currentSpeakingIndex]) {
    dirPanel.children[currentSpeakingIndex].classList.remove('speaking-step');
  }

  // Add highlight to current step
  const currentStepElement = dirPanel.children[i];
  if (currentStepElement) {
    currentStepElement.classList.add('speaking-step');
    currentStepElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); // Scroll into view
  }
  currentSpeakingIndex = i; // Update index

  const utt = new SpeechSynthesisUtterance(steps[i].text);
  utt.lang = voiceLang.value; // Set language from dropdown

  utt.onend = () => {
    console.log(`Finished speaking step ${i}`);
    // No need to remove highlight here, as startVoiceGuidance will handle it for next step,
    // or if it's the last step, it stays highlighted until route cleared or new route.
  };

  utt.onerror = (event) => {
    console.error("Speech synthesis error for step " + i + ":", event.error);
    alert("Error speaking step. Please check language settings or browser support.");
    if (currentStepElement) {
        currentStepElement.classList.remove('speaking-step'); // Remove highlight on error
    }
    currentSpeakingIndex = -1;
  };

  window.speechSynthesis.speak(utt);
}

/**
 * Starts automatic voice guidance for all steps.
 */
function startVoiceGuidance() {
  if (!window.speechSynthesis || steps.length === 0) {
      console.warn("Cannot start voice guidance: Speech synthesis not supported or no directions.");
      return;
  }
  window.speechSynthesis.cancel(); // Stop any previous voice guidance instance
  currentSpeakingIndex = -1; // Reset highlight tracker

  let idx = 0;
  function speakNextStep() {
    if (idx >= steps.length) {
        console.log("Voice guidance finished for all steps.");
        // Remove highlight from the last step once all are spoken
        if (currentSpeakingIndex !== -1 && dirPanel.children[currentSpeakingIndex]) {
            dirPanel.children[currentSpeakingIndex].classList.remove('speaking-step');
        }
        currentSpeakingIndex = -1;
        return;
    }
    speakSingleStep(idx); // Speak current step and highlight it
    window.speechSynthesis.onend = () => {
        // Remove highlight from the just-finished step before moving to next
        if (dirPanel.children[idx]) {
            dirPanel.children[idx].classList.remove('speaking-step');
        }
        idx++;
        speakNextStep(); // Proceed to the next step
    };
    window.speechSynthesis.onerror = (event) => {
        console.error("Automatic voice guidance error:", event.error);
        alert("Error during automatic voice guidance. Stopping voice guidance.");
        window.speechSynthesis.cancel();
        if (dirPanel.children[idx]) {
            dirPanel.children[idx].classList.remove('speaking-step');
        }
        currentSpeakingIndex = -1;
    };
  }
  speakNextStep(); // Start the sequence
}


// ==================== Sharing and Favorites ====================

// Show QR code modal
qrBtn.onclick = () => {
  if (!(fromInput.value && toInput.value)) {
      alert('Please fill both "From" and "To" points to generate a QR code.');
      return;
  }
  const url = `${location.origin}${location.pathname}?from=${encodeURIComponent(fromInput.value)}&to=${encodeURIComponent(toInput.value)}`;
  QRCode.toCanvas(qrCanvas, url, { width: 280, height: 280, margin: 2 }, (error) => {
      if (error) {
          console.error('QR Code generation error:', error);
          alert('Failed to generate QR code.');
      } else {
          qrModal.classList.add('open'); // Add 'open' class to show modal
      }
  });
};
// Hide QR modal when clicked
qrModal.onclick = () => qrModal.classList.remove('open');

// Copy shareable link to clipboard
shareBtn.onclick = () => {
  if (!(fromInput.value && toInput.value)) {
      alert('Please fill both "From" and "To" points to share the link.');
      return;
  }
  const url = `${location.origin}${location.pathname}?from=${encodeURIComponent(fromInput.value)}&to=${encodeURIComponent(toInput.value)}`;
  navigator.clipboard.writeText(url).then(() => {
    alert('Shareable link copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy text: ', err);
    alert('Failed to copy link. Please copy manually from your browser\'s address bar or use the QR code.');
  });
};

// Save current route to favorites
saveFav.onclick = () => {
  if (!fromInput.value || !toInput.value) {
      alert('Please enter both "From" and "To" locations to save as favorite.');
      return;
  }
  const favs = JSON.parse(localStorage.getItem('favs') || '[]');
  const newFav = {f: fromInput.value, t: toInput.value};
  // Check for exact duplicate
  const isDuplicate = favs.some(fav => fav.f === newFav.f && fav.t === newFav.t);
  if (isDuplicate) {
      alert('This exact route is already in your favorites!');
      return;
  }
  favs.push(newFav);
  localStorage.setItem('favs', JSON.stringify(favs));
  loadFavs(); // Refresh the list
  alert('Route saved to favorites!');
};

// Load and display favorites from localStorage
function loadFavs() {
  favoritesList.innerHTML = ''; // Clear current list
  const favs = JSON.parse(localStorage.getItem('favs') || '[]');

  if (favs.length === 0) {
      const li = d.createElement('li');
      li.textContent = 'No favorites saved yet.';
      li.style.cursor = 'default';
      li.style.backgroundColor = 'transparent';
      li.style.boxShadow = 'none';
      li.style.border = 'none';
      li.style.textAlign = 'center';
      favoritesList.appendChild(li);
      return;
  }

  favs.forEach((o, index) => {
    const li = d.createElement('li');
    // Create a span for the text content
    const textSpan = d.createElement('span');
    textSpan.className = 'text';
    textSpan.textContent = `${o.f} → ${o.t}`;
    li.appendChild(textSpan);

    // Create a delete button
    const deleteBtn = d.createElement('button');
    deleteBtn.textContent = '✖';
    deleteBtn.title = 'Remove favorite';
    deleteBtn.onclick = (event) => {
        event.stopPropagation(); // Prevent the parent <li>'s click from firing
        removeFavorite(index);
    };
    li.appendChild(deleteBtn);

    // Click handler for loading the favorite route
    li.onclick = async () => {
      fromInput.value = o.f;
      toInput.value = o.t;

      // Geocode both locations in parallel
      const [fromCoord, toCoord] = await Promise.all([geocode(o.f), geocode(o.t)]);

      if (fromCoord && toCoord) {
          fromLL = fromCoord;
          toLL = toCoord;
          getRoute.click(); // Simulate click on 'Get Directions' button
          sidebar.classList.remove('open'); // Close sidebar after loading favorite
      } else {
          alert('Could not load favorite route. One or both locations might be invalid.');
          fromInput.value = ''; // Clear inputs if failed
          toInput.value = '';
          fromLL = null;
          toLL = null;
      }
    };
    favoritesList.appendChild(li);
  });
}

// Function to remove a favorite by its index
function removeFavorite(index) {
    let favs = JSON.parse(localStorage.getItem('favs') || '[]');
    if (index >= 0 && index < favs.length) {
        favs.splice(index, 1); // Remove item at the given index
        localStorage.setItem('favs', JSON.stringify(favs));
        loadFavs(); // Reload the favorites list
        alert('Favorite removed successfully!');
    }
}

// Load favorites when the script initializes
loadFavs();

// ==================== URL Parameter Handling ====================

// Auto-load route from URL query parameters (e.g., ?from=A&to=B)
(function handleParamsOnLoad() {
  const p = new URLSearchParams(location.search);
  const f = p.get('from');
  const t = p.get('to');

  if (f && t) {
    fromInput.value = f;
    toInput.value = t;

    // Geocode both locations concurrently
    Promise.all([geocode(f), geocode(t)])
      .then(([fromCoord, toCoord]) => {
        if (fromCoord && toCoord) {
          fromLL = fromCoord;
          toLL = toCoord;
          // Small delay to ensure Leaflet map is fully rendered before routing
          setTimeout(() => getRoute.click(), 500);
        } else {
          alert('Could not load route from URL. One or both locations were not found.');
        }
      })
      .catch(error => {
        console.error("Error loading route from URL parameters:", error);
        alert("An error occurred while trying to load the route from the URL.");
      })
      .finally(() => {
        // Clear URL parameters to prevent re-loading on refresh
        // This keeps the URL clean after the route is loaded once.
        history.replaceState({}, document.title, location.pathname);
      });
  }
})();
