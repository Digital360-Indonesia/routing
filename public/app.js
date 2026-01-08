let map;
let routeData = null;
let markers = [];
let routeLines = [];

const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
];

function initMap() {
    try {
        const mapElement = document.getElementById('map');
        if (!mapElement) {
            console.error('Map element not found');
            return false;
        }

        // Check if map is already initialized
        if (map && map._container) {
            console.log('Map already initialized, skipping...');
            return true;
        }

        // Initialize Leaflet map centered at Indonesia
        map = L.map('map').setView([-7.2575, 112.7521], 10);

        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        console.log('Map initialized successfully with Leaflet');
        return true;
    } catch (error) {
        console.error('Error initializing map:', error);
        showError('Gagal menginisialisasi peta: ' + error.message);
        return false;
    }
}

document.getElementById('uploadForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const fileInput = document.getElementById('excelFile');
    const areaRadius = document.getElementById('areaRadius').value;
    const minLocationsPerDay = document.getElementById('minLocationsPerDay').value;
    const depotLat = document.getElementById('depotLat').value;
    const depotLng = document.getElementById('depotLng').value;

    if (!fileInput.files[0]) {
        showError('Silakan pilih file Excel terlebih dahulu');
        return;
    }

    if (!areaRadius || areaRadius <= 0) {
        showError('Silakan isi radius pengelompokan area');
        return;
    }

    if (!minLocationsPerDay || minLocationsPerDay < 3) {
        showError('Silakan isi minimum lokasi per hari (minimal 3)');
        return;
    }

    if (!depotLat || !depotLng) {
        showError('Silakan isi koordinat lokasi start & stop (depot)');
        return;
    }

    // Validate coordinates
    const lat = parseFloat(depotLat);
    const lng = parseFloat(depotLng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        showError('Koordinat depot tidak valid. Latitude harus antara -90 dan 90, Longitude antara -180 dan 180');
        return;
    }

    const formData = new FormData();
    formData.append('excelFile', fileInput.files[0]);
    formData.append('areaRadius', areaRadius);
    formData.append('minLocationsPerDay', minLocationsPerDay);
    formData.append('depotLat', depotLat);
    formData.append('depotLng', depotLng);

    showLoading(true);
    hideError();

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            routeData = data;
            displayResults(data);
            showSuccess('Rute berhasil dioptimasi!');
        } else {
            showError(data.error || 'Terjadi kesalahan saat memproses file');
        }
    } catch (error) {
        showError('Gagal menghubungi server: ' + error.message);
    } finally {
        showLoading(false);
    }
});

function displayResults(data) {
    const summaryElement = document.getElementById('summary');
    summaryElement.innerHTML = `
        <div class="summary-item">
            <h3>📍 Total Delivery Stops</h3>
            <div class="value">${data.totalLocations}</div>
        </div>
        <div class="summary-item">
            <h3>📅 Total Hari Kerja</h3>
            <div class="value">${data.totalDays}</div>
        </div>
        <div class="summary-item">
            <h3>🛣️ Total Jarak Tempuh</h3>
            <div class="value">${data.totalDistance} km</div>
        </div>
        <div class="summary-item">
            <h3>📊 Rata-rata per Hari</h3>
            <div class="value">${Math.round(data.totalLocations / data.totalDays)} stops</div>
        </div>
        <div class="summary-item">
            <h3>⚡ Metode Optimasi</h3>
            <div class="value" style="font-size: 0.65em; line-height: 1.2;">
                ${data.optimizationMethod || 'Nearest Neighbor'}
            </div>
        </div>
        <div class="summary-item">
            <h3>🗺️ Area Coverage</h3>
            <div class="value" style="font-size: 0.7em; line-height: 1.2;">
                ${data.dailyRoutes ? [...new Set(data.dailyRoutes.map(r => r.area).filter(a => a))].join(', ') : 'Multiple Areas'}
            </div>
        </div>
    `;

    displayDayRoutes(data.dailyRoutes);

    // Initialize map only once, then show data
    if (!map || !map._container) {
        // Map not initialized yet
        setTimeout(() => {
            if (initMap()) {
                setTimeout(() => {
                    showAllOnMap();
                }, 200);
            }
        }, 100);
    } else {
        // Map already exists, just clear and show new data
        clearMap();
        setTimeout(() => {
            showAllOnMap();
        }, 100);
    }

    // Show info about routing method
    setTimeout(() => {
        showSuccess('Rute Round-Trip: Berangkat dari depot → kunjungan lokasi → kembali ke depot. Garis putus-putus = jarak lurus.');
    }, 1000);

    document.getElementById('results').style.display = 'block';
}

function displayDayRoutes(dailyRoutes) {
    const dayRoutesElement = document.getElementById('dayRoutes');

    const dayRoutesHTML = dailyRoutes.map((dayRoute, index) => {
        // Generate Google Maps segments for this day
        const googleMapsSegments = generateGoogleMapsSegments(dayRoute.locations);

        const googleMapsButtons = googleMapsSegments.map((segment, segmentIndex) => `
            <a href="${segment.url}" target="_blank" class="btn" style="padding: 5px 15px; font-size: 12px; background: #4285f4; text-decoration: none; display: inline-block; margin: 2px;">
                📍 ${segment.title}
            </a>
        `).join('');

        return `
        <div class="day-route">
            <div class="day-header">
                <span>📅 Hari ${dayRoute.day} ${dayRoute.area ? `• 🏙️ ${dayRoute.area}` : ''}</span>
                <span>📍 ${dayRoute.deliveryCount || dayRoute.count} stops • 🛣️ ${dayRoute.totalDistance.toFixed(1)} km</span>
                <div style="display: flex; gap: 5px;">
                    <button class="btn" onclick="showDayOnMap(${index})" style="padding: 5px 15px; font-size: 14px;">
                        🗺️ Lihat di Peta
                    </button>
                </div>
            </div>
            <div class="day-content">
                ${googleMapsSegments.length > 1 ? `
                    <div style="margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 5px;">
                        <strong>🗺️ Google Maps Links (${googleMapsSegments.length} segmen):</strong><br>
                        <div style="margin-top: 8px;">
                            ${googleMapsButtons}
                        </div>
                    </div>
                ` : `
                    <div style="margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 5px;">
                        <strong>🗺️ Google Maps:</strong><br>
                        <div style="margin-top: 8px;">
                            ${googleMapsButtons}
                        </div>
                    </div>
                `}
                ${dayRoute.locations.map((location, locIndex) => {
                    const isDepot = location.isDepot || location.isStartPoint;

                    // Hitung nomor stop yang sebenarnya (skip depot)
                    let stopNumber = 0;
                    for (let i = 0; i <= locIndex; i++) {
                        if (!dayRoute.locations[i].isDepot && !dayRoute.locations[i].isStartPoint) {
                            stopNumber++;
                        }
                    }

                    const stopLabel = isDepot ? 'DEPOT' : `Stop ${stopNumber}`;
                    const bgColor = isDepot ? '#2ecc71' : '#667eea';

                    return `
                    <div class="location-item" style="${isDepot ? 'background: #f0fff4; border-left: 4px solid #2ecc71;' : ''}">
                        <div style="flex: 1;">
                            <strong>${isDepot ? '🏠 ' : '📍 '}${location.name}</strong><br>
                            <small style="color: #666; line-height: 1.3;">${location.address || 'Alamat tidak tersedia'}</small>
                            ${location.telepon ? `<br><small style="color: #555;">📞 ${location.telepon}</small>` : ''}
                            ${location.kota ? `<br><small style="color: #555;">🏙️ ${location.kota}</small>` : ''}
                            ${isDepot && locIndex === 0 ? `<br><small style="color: #2ecc71; font-weight: bold;">Titik Berangkat</small>` : ''}
                            ${isDepot && locIndex === dayRoute.locations.length - 1 ? `<br><small style="color: #2ecc71; font-weight: bold;">Titik Kembali</small>` : ''}
                        </div>
                        <div style="text-align: right; flex-shrink: 0; margin-left: 10px;">
                            <small style="font-weight: bold; color: ${bgColor};">
                                ${stopLabel}
                            </small><br>
                            <small style="color: #888;">${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}</small>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
        `;
    }).join('');

    dayRoutesElement.innerHTML = dayRoutesHTML;
}

function clearMap() {
    if (!map) return;

    try {
        // Clear markers
        if (markers && markers.length > 0) {
            markers.forEach(marker => {
                if (marker && map && map.hasLayer(marker)) {
                    map.removeLayer(marker);
                }
            });
        }

        // Clear route lines
        if (routeLines && routeLines.length > 0) {
            routeLines.forEach(line => {
                if (line && map && map.hasLayer(line)) {
                    map.removeLayer(line);
                }
            });
        }

        // Reset arrays
        markers = [];
        routeLines = [];

        console.log('Map cleared successfully');
    } catch (error) {
        console.error('Error clearing map:', error);
        // Reset arrays anyway
        markers = [];
        routeLines = [];
    }
}

async function drawRoadRoute(locations, color, weight) {
    if (!map || locations.length < 2) return;

    // Direct to straight lines since OSRM API is unreliable
    // This is faster and more consistent
    console.log(`Drawing ${locations.length - 1} route segments with straight lines`);

    for (let i = 0; i < locations.length - 1; i++) {
        const start = locations[i];
        const end = locations[i + 1];

        const straightLine = L.polyline([
            [start.lat, start.lng],
            [end.lat, end.lng]
        ], {
            color: color,
            weight: weight,
            opacity: 0.7,
            dashArray: '5, 10' // Dashed line to indicate it's straight-line distance
        }).addTo(map);

        routeLines.push(straightLine);
    }
}

function showAllOnMap() {
    if (!routeData || !map) return;

    clearMap();

    const allLatLngs = [];

    routeData.dailyRoutes.forEach((dayRoute, dayIndex) => {
        const color = colors[dayIndex % colors.length];

        dayRoute.locations.forEach((location, locIndex) => {
            const latLng = [location.lat, location.lng];
            allLatLngs.push(latLng);

            // Check jika ini adalah depot
            const isDepot = location.isDepot || location.isStartPoint;

            // Hitung nomor stop yang sebenarnya (skip depot)
            let stopNumber = 0;
            for (let i = 0; i <= locIndex; i++) {
                if (!dayRoute.locations[i].isDepot && !dayRoute.locations[i].isStartPoint) {
                    stopNumber++;
                }
            }

            // Special icon for depot
            let customIcon;
            if (isDepot) {
                customIcon = L.divIcon({
                    html: `<div style="
                        background-color: #2ecc71;
                        border: 3px solid white;
                        border-radius: 50%;
                        width: 35px;
                        height: 35px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-weight: bold;
                        font-size: 20px;
                        box-shadow: 0 3px 6px rgba(0,0,0,0.4);
                    ">🏠</div>`,
                    className: 'depot-marker',
                    iconSize: [35, 35],
                    iconAnchor: [17, 17]
                });
            } else {
                customIcon = L.divIcon({
                    html: `<div style="
                        background-color: ${color};
                        border: 2px solid white;
                        border-radius: 50%;
                        width: 20px;
                        height: 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-weight: bold;
                        font-size: 10px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    ">${dayIndex + 1}</div>`,
                    className: 'custom-marker',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });
            }

            const marker = L.marker(latLng, { icon: customIcon }).addTo(map);

            const stopLabel = isDepot ? 'DEPOT' : `Stop ${stopNumber}`;
            const popupHeader = isDepot ?
                `<h4 style="margin: 0 0 8px 0; color: #2ecc71;">🏠 DEPOT</h4>` :
                `<h4 style="margin: 0 0 8px 0; color: ${color};">Hari ${dayRoute.day} - ${stopLabel}</h4>`;

            const popupContent = `
                <div style="font-family: Arial, sans-serif; max-width: 280px;">
                    ${popupHeader}
                    <div style="margin-bottom: 8px;"><strong>${location.name}</strong></div>
                    <div style="margin-bottom: 8px; color: #666; line-height: 1.3;">${location.address || 'Alamat tidak tersedia'}</div>
                    ${location.telepon ? `<div style="margin-bottom: 4px; font-size: 12px;"><strong>📞</strong> ${location.telepon}</div>` : ''}
                    ${location.website ? `<div style="margin-bottom: 4px; font-size: 12px;"><strong>🌐</strong> <a href="${location.website}" target="_blank" style="color: #007bff;">Website</a></div>` : ''}
                    ${location.kota ? `<div style="margin-bottom: 4px; font-size: 12px;"><strong>🏙️</strong> ${location.kota}</div>` : ''}
                    ${isDepot && locIndex === 0 ? `<div style="margin-top: 8px; padding: 6px; background: #2ecc71; color: white; border-radius: 4px; font-size: 12px; font-weight: bold;">Titik Berangkat</div>` : ''}
                    ${isDepot && locIndex === dayRoute.locations.length - 1 ? `<div style="margin-top: 8px; padding: 6px; background: #2ecc71; color: white; border-radius: 4px; font-size: 12px; font-weight: bold;">Titik Kembali</div>` : ''}
                    <div style="font-size: 11px; color: #888; margin-top: 8px; border-top: 1px solid #eee; padding-top: 4px;">
                        Lat: ${location.lat.toFixed(6)} | Lng: ${location.lng.toFixed(6)}
                    </div>
                </div>
            `;

            marker.bindPopup(popupContent);

            marker.on('click', function() {
                console.log('Marker clicked:', location.name);
            });

            markers.push(marker);
        });

        // Draw route lines for each day following actual roads
        if (dayRoute.locations.length > 1) {
            showLoading(true, `Menggambar rute jalan untuk hari ${dayRoute.day}...`);
            drawRoadRoute(dayRoute.locations, color, 3).then(() => {
                if (dayIndex === routeData.dailyRoutes.length - 1) {
                    showLoading(false);
                }
            });
        }
    });

    // Fit map to show all markers
    if (allLatLngs.length > 0) {
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

function showDayOnMap(dayIndex) {
    if (!routeData || !routeData.dailyRoutes[dayIndex] || !map) return;

    clearMap();

    const dayRoute = routeData.dailyRoutes[dayIndex];
    const color = colors[dayIndex % colors.length];
    const dayLatLngs = [];

    dayRoute.locations.forEach((location, locIndex) => {
        const latLng = [location.lat, location.lng];
        dayLatLngs.push(latLng);

        // Check jika ini adalah depot
        const isDepot = location.isDepot || location.isStartPoint;

        // Hitung nomor stop yang sebenarnya (skip depot)
        let stopNumber = 0;
        for (let i = 0; i <= locIndex; i++) {
            if (!dayRoute.locations[i].isDepot && !dayRoute.locations[i].isStartPoint) {
                stopNumber++;
            }
        }

        // Special icon for depot
        let numberedIcon;
        if (isDepot) {
            numberedIcon = L.divIcon({
                html: `<div style="
                    background-color: #2ecc71;
                    border: 3px solid white;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                    font-size: 22px;
                    box-shadow: 0 3px 8px rgba(0,0,0,0.5);
                ">🏠</div>`,
                className: 'depot-marker-large',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });
        } else {
            numberedIcon = L.divIcon({
                html: `<div style="
                    background-color: ${color};
                    border: 2px solid white;
                    border-radius: 50%;
                    width: 30px;
                    height: 30px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                    font-size: 12px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                ">${stopNumber}</div>`,
                className: 'custom-marker-large',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });
        }

        const marker = L.marker(latLng, { icon: numberedIcon }).addTo(map);

        const stopLabel = isDepot ? 'DEPOT' : `Stop ${stopNumber}`;
        const popupHeader = isDepot ?
            `<h4 style="margin: 0 0 8px 0; color: #2ecc71;">🏠 DEPOT</h4>` :
            `<h4 style="margin: 0 0 8px 0; color: ${color};">Hari ${dayRoute.day} - ${stopLabel}</h4>`;

        const popupContent = `
            <div style="font-family: Arial, sans-serif; max-width: 250px;">
                ${popupHeader}
                <div style="margin-bottom: 5px;"><strong>${location.name}</strong></div>
                <div style="margin-bottom: 5px; color: #666;">${location.address || 'Alamat tidak tersedia'}</div>
                ${isDepot && locIndex === 0 ? `<div style="margin-top: 5px; padding: 5px; background: #2ecc71; color: white; border-radius: 4px; font-size: 11px; font-weight: bold;">Titik Berangkat</div>` : ''}
                ${isDepot && locIndex === dayRoute.locations.length - 1 ? `<div style="margin-top: 5px; padding: 5px; background: #2ecc71; color: white; border-radius: 4px; font-size: 11px; font-weight: bold;">Titik Kembali</div>` : ''}
                <div style="font-size: 12px; color: #888; margin-top: 5px; border-top: 1px solid #eee; padding-top: 4px;">
                    Lat: ${location.lat.toFixed(6)}<br>
                    Lng: ${location.lng.toFixed(6)}
                </div>
            </div>
        `;

        marker.bindPopup(popupContent);

        marker.on('click', function() {
            console.log('Day marker clicked:', location.name, 'Day:', dayRoute.day, 'Type:', isDepot ? 'DEPOT' : `Stop ${locIndex + 1}`);
        });

        markers.push(marker);
    });

    // Draw route line for the day following actual roads
    if (dayRoute.locations.length > 1) {
        showLoading(true, `Menggambar rute jalan untuk hari ${dayRoute.day}...`);
        drawRoadRoute(dayRoute.locations, color, 4).then(() => {
            showLoading(false);
        });
    }

    // Fit map to show day markers
    if (dayLatLngs.length > 0) {
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

function exportToExcel() {
    if (!routeData) return;

    const exportData = [];

    // Add summary
    exportData.push({
        'RINGKASAN': '',
        '': '',
        'Total Lokasi': routeData.totalLocations,
        'Total Hari': routeData.totalDays,
        'Total Jarak (km)': routeData.totalDistance.toFixed(2),
        'Rata-rata Lokasi per Hari': Math.round(routeData.totalLocations / routeData.totalDays)
    });

    exportData.push({});

    // Add daily routes
    routeData.dailyRoutes.forEach(dayRoute => {
        exportData.push({
            'HARI': dayRoute.day,
            'TOTAL LOKASI': dayRoute.count,
            'TOTAL JARAK (KM)': dayRoute.totalDistance.toFixed(2),
            '': '',
            '': '',
            '': ''
        });

        dayRoute.locations.forEach((location, index) => {
            exportData.push({
                'Urutan': index + 1,
                'Nama Lokasi': location.name,
                'Alamat': location.address || '',
                'Latitude': location.lat,
                'Longitude': location.lng,
                'Keterangan': `Stop ${index + 1} - Hari ${dayRoute.day}`
            });
        });

        exportData.push({});
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);

    // Set column widths
    worksheet['!cols'] = [
        { wch: 10 },  // Urutan
        { wch: 25 },  // Nama Lokasi
        { wch: 30 },  // Alamat
        { wch: 12 },  // Latitude
        { wch: 12 },  // Longitude
        { wch: 20 }   // Keterangan
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Rute Optimasi');

    const fileName = `rute_distribusi_brosur_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
}

function showLoading(show, message = null) {
    const loadingElement = document.getElementById('loading');
    if (show) {
        if (message) {
            loadingElement.innerHTML = `<p>⏳ ${message}</p>`;
        } else {
            loadingElement.innerHTML = '<p>⏳ Memproses data dan mengoptimasi rute...</p>';
        }
        loadingElement.style.display = 'block';
    } else {
        loadingElement.style.display = 'none';
    }
}

function showError(message) {
    hideError();
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.innerHTML = `⚠️ ${message}`;
    document.querySelector('.upload-section').insertBefore(errorDiv, document.getElementById('uploadForm'));
}

function hideError() {
    const existingError = document.querySelector('.error');
    if (existingError) {
        existingError.remove();
    }
}

function showSuccess(message) {
    hideSuccess();
    const successDiv = document.createElement('div');
    successDiv.className = 'success';
    successDiv.innerHTML = `✅ ${message}`;
    document.querySelector('.upload-section').appendChild(successDiv);

    setTimeout(() => {
        hideSuccess();
    }, 5000);
}

function hideSuccess() {
    const existingSuccess = document.querySelector('.success');
    if (existingSuccess) {
        existingSuccess.remove();
    }
}

function openInGoogleMaps(dayIndex) {
    if (!routeData || !routeData.dailyRoutes[dayIndex]) {
        showError('Data rute tidak tersedia');
        return;
    }

    const dayRoute = routeData.dailyRoutes[dayIndex];
    const locations = dayRoute.locations;

    if (locations.length === 0) {
        showError('Tidak ada lokasi untuk hari ini');
        return;
    }

    try {
        // For backward compatibility, open first segment only
        const firstSegment = locations.slice(0, Math.min(10, locations.length));
        let googleMapsUrl = '';

        if (firstSegment.length === 1) {
            // Single location - just open the location
            const loc = firstSegment[0];
            googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
        } else {
            // Multiple locations - create route
            const origin = firstSegment[0];
            const destination = firstSegment[firstSegment.length - 1];
            const waypoints = firstSegment.slice(1, -1);

            googleMapsUrl = `https://www.google.com/maps/dir/?api=1`;
            googleMapsUrl += `&origin=${origin.lat},${origin.lng}`;
            googleMapsUrl += `&destination=${destination.lat},${destination.lng}`;

            if (waypoints.length > 0) {
                const waypointStr = waypoints.map(loc => `${loc.lat},${loc.lng}`).join('|');
                googleMapsUrl += `&waypoints=${waypointStr}`;
            }

            googleMapsUrl += `&travelmode=driving`;
        }

        window.open(googleMapsUrl, '_blank');

        // Show success message
        if (locations.length > 10) {
            showSuccess(`Membuka Google Maps untuk ${Math.min(10, locations.length)} lokasi pertama (total ${locations.length} lokasi)`);
        } else {
            showSuccess(`Rute Hari ${dayRoute.day} dibuka di Google Maps!`);
        }

    } catch (error) {
        console.error('Error opening Google Maps:', error);
        showError('Gagal membuka Google Maps: ' + error.message);
    }
}

function generateGoogleMapsSegments(locations) {
    // Split locations into segments of max 10 locations each
    const segments = [];
    for (let i = 0; i < locations.length; i += 9) {
        const segment = locations.slice(i, Math.min(i + 10, locations.length));
        segments.push(segment);
    }

    const links = segments.map((segment, segmentIndex) => {
        let googleMapsUrl = '';

        if (segment.length === 1) {
            // Single location - just open the location
            const loc = segment[0];
            googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
        } else {
            // Multiple locations - create route
            const origin = segment[0];
            const destination = segment[segment.length - 1];
            const waypoints = segment.slice(1, -1);

            googleMapsUrl = `https://www.google.com/maps/dir/?api=1`;
            googleMapsUrl += `&origin=${origin.lat},${origin.lng}`;
            googleMapsUrl += `&destination=${destination.lat},${destination.lng}`;

            if (waypoints.length > 0) {
                const waypointStr = waypoints.map(loc => `${loc.lat},${loc.lng}`).join('|');
                googleMapsUrl += `&waypoints=${waypointStr}`;
            }

            googleMapsUrl += `&travelmode=driving`;
        }

        return {
            url: googleMapsUrl,
            title: `Segmen ${segmentIndex + 1} (${segment.length} lokasi)`,
            locations: segment
        };
    });

    return links;
}

function copyGoogleMapsLink(dayIndex) {
    if (!routeData || !routeData.dailyRoutes[dayIndex]) return;

    const dayRoute = routeData.dailyRoutes[dayIndex];
    const locations = dayRoute.locations;

    if (locations.length === 0) return;

    try {
        let googleMapsUrl = '';

        if (locations.length === 1) {
            const loc = locations[0];
            googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
        } else {
            const origin = locations[0];
            const destination = locations[locations.length - 1];
            const waypoints = locations.slice(1, -1);

            googleMapsUrl = `https://www.google.com/maps/dir/?api=1`;
            googleMapsUrl += `&origin=${origin.lat},${origin.lng}`;
            googleMapsUrl += `&destination=${destination.lat},${destination.lng}`;

            if (waypoints.length > 0) {
                const waypointLimit = Math.min(waypoints.length, 9);
                const waypointCoords = waypoints.slice(0, waypointLimit)
                    .map(wp => `${wp.lat},${wp.lng}`)
                    .join('|');
                googleMapsUrl += `&waypoints=${waypointCoords}`;
            }

            googleMapsUrl += `&travelmode=driving`;
        }

        // Copy to clipboard
        navigator.clipboard.writeText(googleMapsUrl).then(() => {
            showSuccess(`Link Google Maps Hari ${dayRoute.day} berhasil disalin!`);
        }).catch(() => {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = googleMapsUrl;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showSuccess(`Link Google Maps Hari ${dayRoute.day} berhasil disalin!`);
        });

    } catch (error) {
        console.error('Error copying link:', error);
        showError('Gagal menyalin link');
    }
}

function exportAllGoogleMapsLinks() {
    if (!routeData || !routeData.dailyRoutes) {
        showError('Data rute tidak tersedia');
        return;
    }

    try {
        let allLinks = [];

        routeData.dailyRoutes.forEach((dayRoute, index) => {
            const locations = dayRoute.locations;

            if (locations.length === 0) return;

            // Generate Google Maps segments for this day
            const googleMapsSegments = generateGoogleMapsSegments(locations);

            // Add each segment as a separate link
            googleMapsSegments.forEach((segment, segmentIndex) => {
                allLinks.push({
                    day: dayRoute.day,
                    segment: segmentIndex + 1,
                    segmentTitle: segment.title,
                    area: dayRoute.area,
                    totalStops: dayRoute.count,
                    segmentStops: segment.locations.length,
                    distance: dayRoute.totalDistance.toFixed(1),
                    url: segment.url,
                    locations: segment.locations.map(loc => ({
                        name: loc.name,
                        address: loc.address,
                        lat: loc.lat,
                        lng: loc.lng,
                        telepon: loc.telepon,
                        kota: loc.kota
                    }))
                });
            });
        });

        // Create Excel file with Google Maps links
        const exportData = [];

        // Header
        exportData.push({
            'GOOGLE MAPS LINKS - ROUTE OPTIMIZER': '',
            '': '',
            '': '',
            '': '',
            '': '',
            '': ''
        });

        exportData.push({
            'Generated': new Date().toLocaleString('id-ID'),
            'Total Days': routeData.totalDays,
            'Total Locations': routeData.totalLocations,
            'Total Distance': `${routeData.totalDistance} km`,
            '': '',
            '': ''
        });

        exportData.push({});

        // Links per segment
        allLinks.forEach(linkData => {
            exportData.push({
                'Hari': linkData.day,
                'Segmen': linkData.segment,
                'Judul Segmen': linkData.segmentTitle,
                'Area': linkData.area,
                'Stop dalam Segmen': linkData.segmentStops,
                'Total Stop Hari': linkData.totalStops,
                'Jarak Total Hari (km)': linkData.distance,
                'Google Maps Link': linkData.url
            });

            // Add locations for this segment
            linkData.locations.forEach((loc, index) => {
                exportData.push({
                    'Stop': index + 1,
                    'Nama': loc.name,
                    'Alamat': loc.address,
                    'Kota': loc.kota,
                    'Telepon': loc.telepon,
                    'Latitude': loc.lat,
                    'Longitude': loc.lng,
                    'Individual Link': `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`
                });
            });

            exportData.push({});
        });

        const worksheet = XLSX.utils.json_to_sheet(exportData);

        // Set column widths
        worksheet['!cols'] = [
            { wch: 10 },  // Day/Stop
            { wch: 20 },  // Area/Name
            { wch: 15 },  // Stops/Address
            { wch: 12 },  // Distance/Lat
            { wch: 60 },  // Google Maps Link/Lng
            { wch: 25 }   // Keterangan/Individual Link
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Google Maps Links');

        const fileName = `google_maps_links_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        showSuccess(`File ${fileName} berhasil di-download dengan semua link Google Maps!`);

    } catch (error) {
        console.error('Error exporting Google Maps links:', error);
        showError('Gagal export Google Maps links: ' + error.message);
    }
}

// Initialize when page loads
window.onload = function() {
    console.log('Page loaded, Leaflet ready');
};