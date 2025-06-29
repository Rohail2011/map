// script.js — Smart Navigator Logic

// Wait for DOM content to load
window.addEventListener("DOMContentLoaded", () => {
  const map = L.map("map").setView([35.7796, -78.6382], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  const fromInput = document.getElementById("from");
  const toInput = document.getElementById("to");
  const useLoc = document.getElementById("useLoc");
  const getRoute = document.getElementById("getRoute");
  const altRoute = document.getElementById("altRoute");
  const voiceLang = document.getElementById("voiceLang");
  const saveFav = document.getElementById("saveFav");
  const favoritesList = document.getElementById("favoritesList");
  const themeBtn = document.getElementById("themeBtn");
  const stepContainer = document.getElementById("stepContainer");
  const qrBtn = document.getElementById("qrBtn");
  const shareBtn = document.getElementById("shareBtn");

  let fromLL = null;
  let toLL = null;
  let routingControl = null;
  let steps = [];
  let currentStepIndex = 0;
  let watchId = null;
  let liveMarker = null;
  let showAlt = false;

  const speak = (text) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = voiceLang.value;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  const geocode = async (q) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          q
        )}`
      );
      const data = await res.json();
      if (data && data.length > 0) {
        return L.latLng(parseFloat(data[0].lat), parseFloat(data[0].lon));
      }
    } catch (e) {
      console.error("Geocoding failed:", e);
    }
    return null;
  };

  const showStep = (index) => {
    if (index >= steps.length) return;
    stepContainer.innerHTML = "";
    const step = steps[index];
    const div = document.createElement("div");
    div.className = "dir-step";
    div.innerText = `${index + 1}. ${step.text} (${(step.distance / 1000).toFixed(
      2
    )} km)`;
    stepContainer.appendChild(div);
    speak(step.text);
  };

  const loadFavorites = () => {
    favoritesList.innerHTML = "";
    const favs = JSON.parse(localStorage.getItem("favs") || "[]");
    if (favs.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No favorites yet.";
      favoritesList.appendChild(li);
      return;
    }
    favs.forEach((fav, idx) => {
      const li = document.createElement("li");
      li.textContent = `${fav.f} → ${fav.t}`;
      li.style.cursor = "pointer";
      li.onclick = async () => {
        fromInput.value = fav.f;
        toInput.value = fav.t;
        fromLL = await geocode(fav.f);
        toLL = await geocode(fav.t);
        route();
      };
      favoritesList.appendChild(li);
    });
  };

  const route = () => {
    if (!(fromLL && toLL)) {
      alert("Enter both locations.");
      return;
    }
    if (routingControl) map.removeControl(routingControl);

    routingControl = L.Routing.control({
      waypoints: [fromLL, toLL],
      router: L.Routing.osrmv1({
        serviceUrl: "https://router.project-osrm.org/route/v1",
      }),
      routeWhileDragging: true,
      showAlternatives: showAlt,
      createMarker: (i, wp) => L.marker(wp.latLng),
    })
      .on("routesfound", function (e) {
        steps = e.routes[0].instructions;
        currentStepIndex = 0;
        showStep(currentStepIndex);
      })
      .addTo(map);
  };

  document.getElementById("toggleBtn").onclick = () => {
    document.getElementById("sidebar").classList.toggle("open");
  };

  getRoute.onclick = async () => {
    fromLL =
      fromInput.value === "My Location"
        ? fromLL
        : await geocode(fromInput.value);
    toLL = await geocode(toInput.value);
    route();
  };

  altRoute.onclick = () => {
    showAlt = !showAlt;
    altRoute.textContent = showAlt ? "✅ Alt On" : "🔀 Alt Route";
    if (fromLL && toLL) route();
  };

  themeBtn.onclick = () => {
    document.body.classList.toggle("dark");
  };

  useLoc.onclick = () => {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      liveMarker?.remove();
      liveMarker = null;
      useLoc.textContent = "📍 My Location";
    } else {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          fromLL = L.latLng(pos.coords.latitude, pos.coords.longitude);
          fromInput.value = "My Location";
          if (!liveMarker) {
            liveMarker = L.marker(fromLL).addTo(map);
          } else {
            liveMarker.setLatLng(fromLL);
          }
          map.setView(fromLL, 15);
        },
        (err) => {
          alert("Location error.");
          console.error(err);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
      useLoc.textContent = "🛑 Stop Tracking";
    }
  };

  saveFav.onclick = () => {
    const favs = JSON.parse(localStorage.getItem("favs") || "[]");
    const obj = { f: fromInput.value, t: toInput.value };
    if (!favs.some((f) => f.f === obj.f && f.t === obj.t)) {
      favs.push(obj);
      localStorage.setItem("favs", JSON.stringify(favs));
      loadFavorites();
    } else {
      alert("Already in favorites.");
    }
  };

  qrBtn.onclick = () => {
    const canvas = document.getElementById("qrCanvas");
    const qrModal = document.getElementById("qrModal");
    const url = `${location.origin}${location.pathname}?from=${encodeURIComponent(
      fromInput.value
    )}&to=${encodeURIComponent(toInput.value)}`;
    QRCode.toCanvas(canvas, url, (err) => {
      if (err) return alert("QR Error");
      qrModal.classList.add("open");
    });
    qrModal.onclick = () => qrModal.classList.remove("open");
  };

  shareBtn.onclick = () => {
    const url = `${location.origin}${location.pathname}?from=${encodeURIComponent(
      fromInput.value
    )}&to=${encodeURIComponent(toInput.value)}`;
    navigator.clipboard.writeText(url);
    alert("Link copied.");
  };

  loadFavorites();
});
