// script.js — Smart Navigator Logic

window.addEventListener("DOMContentLoaded", () => {
    // Persistent theme: Check localStorage on load
    if (localStorage.getItem("theme") === "dark") {
        document.body.classList.add("dark");
    }

    const map = L.map("map").setView([35.9774, -79.9928], 13); // Centered on High Point, NC

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    // --- DOM Element References ---
    const fromInput = document.getElementById("from");
    const toInput = document.getElementById("to");
    const useLocBtn = document.getElementById("useLoc");
    const followMeBtn = document.getElementById("followMeBtn"); // New button
    const getRouteBtn = document.getElementById("getRoute");
    const altRouteBtn = document.getElementById("altRoute");
    const voiceLangSelect = document.getElementById("voiceLang");
    const saveFavBtn = document.getElementById("saveFav");
    const favoritesList = document.getElementById("favoritesList");
    const themeBtn = document.getElementById("themeBtn");

    const directionsPanel = document.getElementById("directionsPanel"); // The floating panel
    const closeDirectionsBtn = document.getElementById("closeDirectionsBtn");
    const stepContainer = document.getElementById("stepContainer"); // Where individual steps are listed in the panel
    const routeSummarySpan = document.getElementById("routeSummary"); // New span for route summary in header

    const qrBtn = document.getElementById("qrBtn");
    const shareBtn = document.getElementById("shareBtn");
    const toggleSidebarBtn = document.getElementById("toggleBtn");
    const sidebar = document.getElementById("sidebar");
    const closeSidebarBtn = document.getElementById("closeSidebarBtn");
    const qrModal = document.getElementById("qrModal");
    const qrCanvas = document.getElementById("qrCanvas");
    const messageArea = document.getElementById("messageArea");


    // --- Application State Variables ---
    let fromLL = null; // LatLng for 'from' location
    let toLL = null;   // LatLng for 'to' location
    let routingControl = null; // Leaflet Routing Machine control instance
    let currentRouteInstructions = []; // Stores the instructions (steps) of the current route
    let currentRouteSummary = { distance: 0, duration: 0 }; // Stores total distance and duration
    let watchId = null; // ID for geolocation watchPosition
    let liveMarker = null; // Marker for live user location (the arrow)
    let isFollowingMe = false; // New: Flag to control map follow mode
    let showAlternatives = false; // Flag to show/hide alternative routes

    // --- Helper Functions ---

    /**
     * Shows a temporary message to the user.
     * @param {string} message - The message to display.
     * @param {number} duration - How long to display the message in milliseconds.
     */
    const showMessage = (message, duration = 3000) => {
        messageArea.textContent = message;
        messageArea.classList.add("show");
        setTimeout(() => {
            messageArea.classList.remove("show");
        }, duration);
    };

    /**
     * Speaks the given text using the Web Speech API.
     * @param {string} text - The text to speak.
     */
    const speak = (text) => {
        window.speechSynthesis.cancel(); // Stop any ongoing speech

        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = voiceLangSelect.value;
        utter.rate = 1.1; // Slightly faster for directions

        utter.onerror = (event) => {
            console.error('SpeechSynthesisUtterance.onerror', event);
            showMessage('Voice synthesis error. Check console for details.', 4000);
        };

        window.speechSynthesis.speak(utter);
    };

    /**
     * Geocodes a query string to Leaflet LatLng coordinates using Nominatim.
     * @param {string} query - The location query string (e.g., "Paris, France").
     * @returns {Promise<L.LatLng|null>} A promise that resolves to L.LatLng object or null on failure.
     */
    const geocode = async (query) => {
        if (!query) return null;
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
                    query
                )}`
            );
            if (!res.ok) {
                console.error(`Geocoding API error: ${res.statusText}`);
                showMessage("Geocoding service unavailable.", 4000);
                return null;
            }
            const data = await res.json();
            if (data && data.length > 0) {
                // Return the first result's coordinates
                return L.latLng(parseFloat(data[0].lat), parseFloat(data[0].lon));
            } else {
                showMessage(`Could not find location for "${query}".`, 3000);
                return null;
            }
        } catch (e) {
            console.error("Geocoding failed:", e);
            showMessage("Failed to connect to geocoding service.", 4000);
            return null;
        }
    };

    /**
     * Converts seconds to a human-readable duration string.
     * @param {number} seconds - Duration in seconds.
     * @returns {string} Human-readable duration (e.g., "1 hour 30 min").
     */
    const formatDuration = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;

        let result = [];
        if (hours > 0) {
            result.push(`${hours} hour${hours > 1 ? 's' : ''}`);
        }
        if (remainingMinutes > 0 || (hours === 0 && minutes === 0)) { // show 0 min if duration is very short
            result.push(`${remainingMinutes} min`);
        }
        return result.join(' ');
    };

    /**
     * Displays all route instructions in the stepContainer (floating panel).
     * Each step is clickable to speak and highlight.
     */
    const displayAllStepsInPanel = () => {
        if (!currentRouteInstructions || currentRouteInstructions.length === 0) {
            stepContainer.innerHTML = "<p>No directions available.</p>";
            return;
        }

        // Update the route summary in the panel header
        routeSummarySpan.textContent = `Total: ${(currentRouteSummary.distance / 1000).toFixed(1)} km, ${formatDuration(currentRouteSummary.duration)}`;

        stepContainer.innerHTML = ""; // Clear existing steps
        currentRouteInstructions.forEach((s, idx) => {
            const div = document.createElement("div");
            div.className = "dir-step";
            div.innerHTML = `<strong>${idx + 1}.</strong> ${s.text} (${(s.distance / 1000).toFixed(2)} km)`;
            div.dataset.index = idx; // Store index for click listener

            // Add click listener to speak and highlight
            div.onclick = () => {
                // Remove 'current' from all steps
                document.querySelectorAll('#stepContainer .dir-step').forEach(stepDiv => {
                    stepDiv.classList.remove('current');
                });
                // Add 'current' to the clicked step
                div.classList.add('current');
                speak(s.text);
            };

            stepContainer.appendChild(div);
        });
        // Highlight the first step by default
        const firstStepDiv = stepContainer.querySelector(`.dir-step[data-index="0"]`);
        if (firstStepDiv) {
            firstStepDiv.classList.add('current');
            firstStepDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    };


    /**
     * Loads and displays favorite routes from local storage.
     */
    const loadFavorites = () => {
        favoritesList.innerHTML = ""; // Clear existing list
        const favs = JSON.parse(localStorage.getItem("favs") || "[]");

        if (favs.length === 0) {
            const li = document.createElement("li");
            li.textContent = "No favorites yet.";
            favoritesList.appendChild(li);
            return;
        }

        favs.forEach((fav, idx) => {
            const li = document.createElement("li");
            const favTextSpan = document.createElement("span");
            // Display 'from' and 'to', plus the saved summary
            const summaryText = fav.summary ? ` (${(fav.summary.distance / 1000).toFixed(1)} km, ${formatDuration(fav.summary.duration)})` : '';
            favTextSpan.innerHTML = `<strong>${fav.f}</strong> &rarr; <strong>${fav.t}</strong><br><small>${summaryText}</small>`;
            favTextSpan.onclick = async () => {
                fromInput.value = fav.f;
                toInput.value = fav.t;
                fromLL = await geocode(fav.f);
                toLL = await geocode(fav.t);
                route();
                sidebar.classList.remove("open"); // Close sidebar after selecting favorite
            };

            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "Delete";
            deleteBtn.className = "delete-fav";
            deleteBtn.onclick = (event) => {
                event.stopPropagation(); // Prevent li.onclick from firing
                deleteFavorite(idx);
            };

            li.appendChild(favTextSpan);
            li.appendChild(deleteBtn);
            favoritesList.appendChild(li);
        });
    };

    /**
     * Deletes a favorite route from local storage and updates the UI.
     * @param {number} index - The index of the favorite to delete.
     */
    const deleteFavorite = (index) => {
        const favs = JSON.parse(localStorage.getItem("favs") || "[]");
        if (index >= 0 && index < favs.length) {
            favs.splice(index, 1); // Remove item at index
            localStorage.setItem("favs", JSON.stringify(favs));
            loadFavorites(); // Re-render favorites list
            showMessage("Favorite deleted.", 2000);
        }
    };


    /**
     * Initiates the routing process on the map.
     */
    const route = () => {
        if (!(fromLL && toLL)) {
            showMessage("Please enter both 'From' and 'To' locations.", 3000);
            return;
        }

        window.speechSynthesis.cancel(); // Stop any previous speech when starting a new route

        if (routingControl) {
            map.removeControl(routingControl); // Remove previous route and markers
            routingControl = null;
        }

        directionsPanel.style.display = "block"; // Show floating directions panel

        routingControl = L.Routing.control({
            waypoints: [fromLL, toLL],
            router: L.Routing.osrmv1({
                serviceUrl: "https://router.project-osrm.org/route/v1",
            }),
            routeWhileDragging: false,
            showAlternatives: showAlternatives,
            fitSelectedRoutes: true, // Zoom to fit the route on the map
            altLineOptions: {
                styles: [
                    {color: 'black', opacity: 0.15, weight: 9},
                    {color: 'white', opacity: 0.8, weight: 6},
                    {color: 'blue', opacity: 0.5, weight: 2}
                ]
            },
            // Disable default route summary and instructions panel
            // We are handling this in our custom directionsPanel
            show: false, // Prevents default Leaflet Routing Machine panel from showing
            routeLine: function(route) { // Custom route line (optional, keeps default if you like it)
                return L.Routing.line(route, {
                    styles: [
                        {color: 'black', opacity: 0.15, weight: 9},
                        {color: 'white', opacity: 0.8, weight: 6},
                        {color: 'red', opacity: 1, weight: 3}
                    ]
                });
            },
            createMarker: (i, wp) => {
                // Custom markers for start (green) and end (red)
                return L.marker(wp.latLng, {
                    icon: L.divIcon({
                        className: 'leaflet-div-icon',
                        html: `<div style="background-color:${i === 0 ? 'green' : 'red'}; width:15px; height:15px; border-radius:50%; border:2px solid white;"></div>`
                    })
                });
            }
        })
            .on("routesfound", function (e) {
                currentRouteInstructions = e.routes[0].instructions;
                currentRouteSummary = { // Store the route summary
                    distance: e.routes[0].summary.totalDistance,
                    duration: e.routes[0].summary.totalTime
                };
                displayAllStepsInPanel(); // Display all steps in the floating panel
                showMessage(`Route found: ${(currentRouteSummary.distance / 1000).toFixed(1)} km, ${formatDuration(currentRouteSummary.duration)}. Click a step to hear it.`, 3000);
            })
            .on("routingerror", function (e) {
                console.error("Routing error:", e);
                showMessage(`Routing error: ${e.message || "Could not find a route."}`, 5000);
                directionsPanel.style.display = "none"; // Hide panel on error
                stepContainer.innerHTML = "<p>Failed to find a route.</p>"; // Clear directions
                routeSummarySpan.textContent = ""; // Clear summary in panel
                currentRouteInstructions = [];
                currentRouteSummary = { distance: 0, duration: 0 }; // Clear summary on error
                window.speechSynthesis.cancel(); // Cancel any pending speech
                if (routingControl) map.removeControl(routingControl); // Ensure route is cleared on error
                routingControl = null;
            })
            .addTo(map);
    };

    // --- Event Listeners ---

    toggleSidebarBtn.onclick = () => {
        sidebar.classList.toggle("open");
    };

    closeSidebarBtn.onclick = () => {
        sidebar.classList.remove("open");
        // We explicitly do NOT clear the route when the sidebar closes,
        // as the directions panel is separate.
    };

    // Close floating directions panel and clear route
    closeDirectionsBtn.onclick = () => {
        directionsPanel.style.display = "none";
        window.speechSynthesis.cancel(); // Stop speech when directions panel is closed
        if (routingControl) {
            map.removeControl(routingControl); // IMPORTANT: Remove routing control (route line and markers) from map
            routingControl = null; // Clear the reference
            currentRouteInstructions = []; // Clear instructions
            currentRouteSummary = { distance: 0, duration: 0 }; // Clear summary
            stepContainer.innerHTML = ""; // Clear displayed steps
            routeSummarySpan.textContent = ""; // Clear summary in panel
        }
    };

    getRouteBtn.onclick = async () => {
        window.speechSynthesis.cancel(); // Stop any ongoing speech before new route
        // If "My Location" is set as 'from', use its LatLng directly
        if (fromInput.value === "My Location" && fromLL) {
            // fromLL is already updated by the geolocation watchPosition
            // No need to geocode "My Location" string
        } else {
            fromLL = await geocode(fromInput.value);
        }
        toLL = await geocode(toInput.value);
        route();
        sidebar.classList.remove("open"); // Close sidebar after getting route, as directions are separate
    };

    altRouteBtn.onclick = () => {
        showAlternatives = !showAlternatives;
        altRouteBtn.textContent = showAlternatives ? "✅ Alt On" : "🔀 Alt Route";
        if (fromLL && toLL) {
            route(); // Recalculate route with new alt status
        }
    };

    themeBtn.onclick = () => {
        document.body.classList.toggle("dark");
        // Persist theme choice
        if (document.body.classList.contains("dark")) {
            localStorage.setItem("theme", "dark");
        } else {
            localStorage.removeItem("theme");
        }
    };

    // New: Handle "Follow Me" mode
    followMeBtn.onclick = () => {
        if (isFollowingMe) {
            isFollowingMe = false;
            followMeBtn.textContent = "➡️ Follow Me";
            showMessage("Follow mode off. Map will no longer center automatically.", 3000);
        } else {
            // Attempt to start geolocation if not already started by 'useLocBtn'
            if (!watchId) {
                // This will also set fromInput.value to "My Location" and update fromLL
                useLocBtn.click(); // Trigger 'useLocBtn' click to start tracking
            }

            if (watchId) { // Only enable follow if geolocation is successfully tracking
                isFollowingMe = true;
                followMeBtn.textContent = "🟢 Following";
                showMessage("Follow mode on. Map will center on your location.", 3000);
            } else {
                showMessage("Cannot start follow mode. Please enable location services and try 'My Location' first.", 4000);
            }
        }
    };


    useLocBtn.onclick = () => {
        if (watchId) { // If tracking is active, stop it
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
            if (liveMarker) {
                liveMarker.remove();
                liveMarker = null;
            }
            useLocBtn.textContent = "📍 My Location";
            isFollowingMe = false; // Turn off follow mode too
            followMeBtn.textContent = "➡️ Follow Me";
            showMessage("Location tracking stopped.", 2000);
            // If location tracking is stopped, and 'from' was 'My Location', clear it
            if (fromInput.value === "My Location") {
                fromInput.value = "";
                fromLL = null;
            }
        } else { // Start tracking
            showMessage("Starting location tracking...", 2000);
            watchId = navigator.geolocation.watchPosition(
                (pos) => {
                    const newFromLL = L.latLng(pos.coords.latitude, pos.coords.longitude);
                    let rotation = pos.coords.heading !== null && !isNaN(pos.coords.heading) ? pos.coords.heading : 0;

                    // Only update marker and map view if moved or if first time
                    // Or if heading changes significantly for smoother rotation
                    const needsMarkerUpdate = !fromLL || newFromLL.distanceTo(fromLL) > 1 || (liveMarker && Math.abs(rotation - (liveMarker.options.rotation || 0)) > 5);

                    if (needsMarkerUpdate) {
                        fromLL = newFromLL;
                        fromInput.value = "My Location";

                        if (!liveMarker) {
                            // Create the custom arrow icon
                            const arrowIcon = L.divIcon({
                                className: 'live-location-arrow', // Class for CSS styling
                                iconSize: [30, 30], // Size of the arrow div
                                iconAnchor: [15, 15] // Center of the arrow
                            });
                            liveMarker = L.marker(fromLL, { icon: arrowIcon, rotation: rotation }).addTo(map);
                        } else {
                            liveMarker.setLatLng(fromLL);
                            // Set rotation directly on the divIcon element (assuming CSS transform)
                            if (liveMarker._icon) {
                                liveMarker._icon.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
                            }
                            liveMarker.options.rotation = rotation; // Store rotation for comparison
                        }

                        // If "Follow Me" mode is active, pan the map to the new location
                        if (isFollowingMe) {
                            map.panTo(fromLL);
                            // Also adjust zoom for a closer view during navigation, if not already close enough
                            if (map.getZoom() < 18) { // Zoom in for street level if current zoom is too far
                                map.setZoom(18);
                            }
                        }
                    }
                    useLocBtn.textContent = "🛑 Stop Tracking";
                },
                (err) => {
                    console.error("Geolocation error:", err);
                    let errorMessage = "Could not get your location.";
                    if (err.code === err.PERMISSION_DENIED) {
                        errorMessage = "Location access denied. Please enable it in your browser settings.";
                    } else if (err.code === err.POSITION_UNAVAILABLE) {
                        errorMessage = "Location information is unavailable.";
                    } else if (err.code === err.TIMEOUT) {
                        errorMessage = "The request to get user location timed out.";
                    }
                    showMessage(`Location error: ${errorMessage}`, 5000);
                    useLocBtn.textContent = "📍 My Location"; // Reset button
                    isFollowingMe = false; // Also turn off follow mode
                    followMeBtn.textContent = "➡️ Follow Me";
                    if (watchId) navigator.geolocation.clearWatch(watchId);
                    watchId = null;
                    if (liveMarker) { liveMarker.remove(); liveMarker = null; }
                    if (fromInput.value === "My Location") { // Clear 'My Location' if tracking fails
                        fromInput.value = "";
                        fromLL = null;
                    }
                },
                { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
            );
        }
    };

    saveFavBtn.onclick = () => {
        const fromText = fromInput.value.trim();
        const toText = toInput.value.trim();

        if (!fromText || !toText) {
            showMessage("Both 'From' and 'To' fields must be filled to save a favorite.", 3000);
            return;
        }
        // Ensure a route has been calculated and summary data is available
        if (currentRouteSummary.distance === 0 && currentRouteSummary.duration === 0) {
            showMessage("Please get directions first to save the route summary.", 3000);
            return;
        }

        const favs = JSON.parse(localStorage.getItem("favs") || "[]");
        // Store summary with favorite
        const obj = {
            f: fromText,
            t: toText,
            summary: {
                distance: currentRouteSummary.distance,
                duration: currentRouteSummary.duration
            }
        };

        // Check for exact duplicate (including summary to be precise)
        // Note: this check might be too strict if slight route changes result in different summary values
        if (!favs.some((f) => f.f === obj.f && f.t === obj.t && f.summary?.distance === obj.summary.distance && f.summary?.duration === obj.summary.duration)) {
            favs.push(obj);
            localStorage.setItem("favs", JSON.stringify(favs));
            loadFavorites();
            showMessage("Favorite saved!", 2000);
        } else {
            showMessage("This exact route (and summary) is already in your favorites.", 3000);
        }
    };

    qrBtn.onclick = () => {
        const url = `${location.origin}${location.pathname}?from=${encodeURIComponent(
            fromInput.value
        )}&to=${encodeURIComponent(toInput.value)}`;

        if (!fromInput.value && !toInput.value) {
            showMessage("Please enter 'From' and 'To' locations to generate QR code.", 3000);
            return;
        }

        QRCode.toCanvas(qrCanvas, url, (err) => {
            if (err) {
                console.error("QR Code generation error:", err);
                showMessage("Failed to generate QR code.", 3000);
                return;
            }
            qrModal.classList.add("open");
        });
    };

    // Close QR modal when clicking on it
    qrModal.onclick = () => qrModal.classList.remove("open");

    shareBtn.onclick = async () => {
        const url = `${location.origin}${location.pathname}?from=${encodeURIComponent(
            fromInput.value
        )}&to=${encodeURIComponent(toInput.value)}`;

        if (!fromInput.value && !toInput.value) {
            showMessage("Please enter 'From' and 'To' locations to share the link.", 3000);
            return;
        }

        if (navigator.share) { // Web Share API support
            try {
                await navigator.share({
                    title: 'Smart Navigator Route',
                    text: 'Check out this route!',
                    url: url,
                });
                showMessage('Route shared successfully!', 2000);
            } catch (error) {
                console.error('Error sharing:', error);
                if (error.name === 'AbortError') {
                    showMessage('Share cancelled.', 2000);
                } else {
                    showMessage('Failed to share route.', 3000);
                }
            }
        } else { // Fallback to clipboard
            try {
                await navigator.clipboard.writeText(url);
                showMessage("Link copied to clipboard!", 2000);
            } catch (err) {
                console.error('Failed to copy text: ', err);
                showMessage("Failed to copy link. Please copy manually.", 3000);
            }
        }
    };

    // --- Initializations on Load ---
    loadFavorites(); // Load favorites when the page loads

    // Load URL parameters if present (for shared links)
    const urlParams = new URLSearchParams(window.location.search);
    const paramFrom = urlParams.get('from');
    const paramTo = urlParams.get('to');

    if (paramFrom && paramTo) {
        fromInput.value = paramFrom;
        toInput.value = paramTo;
        // Automatically get route if parameters are present
        getRouteBtn.click(); // Simulate click to trigger routing
        // Sidebar should remain closed if loaded from URL, unless user opens it
    }
});