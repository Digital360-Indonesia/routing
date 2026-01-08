const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9903;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

// Koordinat Depot Default (Surabaya Pusat)
const DEFAULT_DEPOT_LAT = -7.308080941479331;
const DEFAULT_DEPOT_LNG = 112.75513514232804;

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function calculateRouteDistance(locations, route) {
    let totalDistance = 0;
    for (let i = 0; i < route.length - 1; i++) {
        const from = locations[route[i]];
        const to = locations[route[i + 1]];
        totalDistance += calculateDistance(from.lat, from.lng, to.lat, to.lng);
    }
    return totalDistance;
}

function twoOptOptimization(locations, route) {
    if (route.length < 4) return route;

    let improved = true;
    let bestRoute = [...route];
    let bestDistance = calculateRouteDistance(locations, bestRoute);

    while (improved) {
        improved = false;

        for (let i = 0; i < route.length - 2; i++) {
            for (let j = i + 2; j < route.length; j++) {
                // Create new route by reversing segment between i and j
                const newRoute = [
                    ...bestRoute.slice(0, i + 1),
                    ...bestRoute.slice(i + 1, j + 1).reverse(),
                    ...bestRoute.slice(j + 1)
                ];

                const newDistance = calculateRouteDistance(locations, newRoute);

                if (newDistance < bestDistance) {
                    bestRoute = newRoute;
                    bestDistance = newDistance;
                    improved = true;
                }
            }
        }
    }

    return bestRoute;
}

function nearestNeighborTSPLocal(locations) {
    if (locations.length === 0) return [];

    const visited = new Set();
    const route = [];
    let currentIndex = 0;

    // Mulai dari lokasi pertama (bukan depot)
    route.push(0);
    visited.add(0);

    while (visited.size < locations.length) {
        let nearestIndex = -1;
        let nearestDistance = Infinity;

        for (let i = 0; i < locations.length; i++) {
            if (!visited.has(i)) {
                const distance = calculateDistance(
                    locations[currentIndex].lat, locations[currentIndex].lng,
                    locations[i].lat, locations[i].lng
                );

                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = i;
                }
            }
        }

        if (nearestIndex !== -1) {
            route.push(nearestIndex);
            visited.add(nearestIndex);
            currentIndex = nearestIndex;
        }
    }

    // Optimize dengan 2-opt local search
    const optimizedRoute = twoOptOptimization(locations, route);

    // Tidak kembali ke depot (one-way trip)
    return optimizedRoute;
}

function groupLocationsByArea(deliveryLocations, maxDistanceKm = 5, depotLat, depotLng, minLocationsPerDay = 5) {
    // Clustering approach: Group by proximity without hard maximum
    // Include depot as start and end point for efficient round-trips
    const groups = [];
    const used = new Set();

    // First pass: Create initial clusters based on proximity
    for (let i = 0; i < deliveryLocations.length; i++) {
        if (used.has(i)) continue;

        const group = [i];
        used.add(i);
        const baseLocation = deliveryLocations[i];

        // Find ALL nearby locations within maxDistanceKm (no hard limit)
        const nearbyLocations = [];
        for (let j = 0; j < deliveryLocations.length; j++) {
            if (used.has(j)) continue;

            const targetLocation = deliveryLocations[j];
            const distance = calculateDistance(
                baseLocation.lat, baseLocation.lng,
                targetLocation.lat, targetLocation.lng
            );

            if (distance <= maxDistanceKm) {
                nearbyLocations.push({ index: j, distance: distance });
            }
        }

        // Sort by distance and add ALL nearby locations
        nearbyLocations.sort((a, b) => a.distance - b.distance);

        nearbyLocations.forEach(item => {
            group.push(item.index);
            used.add(item.index);
        });

        groups.push(group);
    }

    // Second pass: Merge small groups with nearest groups
    let improved = true;
    let iteration = 0;
    const maxIterations = 20;

    while (improved && iteration < maxIterations) {
        improved = false;
        iteration++;

        // Sort groups: smallest first for priority merging
        groups.sort((a, b) => a.length - b.length);

        // Check each group that's below minimum
        for (let i = 0; i < groups.length; i++) {
            if (groups[i].length >= minLocationsPerDay) continue;
            if (groups[i].length === 0) continue;

            // Find NEAREST group to merge with (regardless of size)
            let bestMergeIdx = -1;
            let minDistance = Infinity;

            for (let j = 0; j < groups.length; j++) {
                if (i === j || groups[j].length === 0) continue;

                // Calculate average distance between groups
                const avgDistance = calculateAverageDistance(
                    deliveryLocations, groups[i], groups[j]
                );

                // Find the closest group, no size limit
                if (avgDistance < minDistance) {
                    minDistance = avgDistance;
                    bestMergeIdx = j;
                }
            }

            // Merge with nearest group
            if (bestMergeIdx !== -1) {
                groups[bestMergeIdx] = [...groups[bestMergeIdx], ...groups[i]];
                groups[i] = [];
                improved = true;
                break;
            }
        }

        // Clean up empty groups
        groups.sort((a, b) => b.length - a.length);
        while (groups.length > 0 && groups[groups.length - 1].length === 0) {
            groups.pop();
        }
    }

    // Convert groups to daily routes WITH DEPOT
    const dailyRoutes = [];

    // Create depot location object
    const depotLocation = {
        id: 'depot',
        lat: depotLat,
        lng: depotLng,
        name: '🏠 Depot',
        address: 'Titik Berangkat & Kembali',
        isStartPoint: true,
        isDepot: true
    };

    groups.forEach((group, groupIndex) => {
        if (group.length === 0) return;

        const groupLocations = group.map(index => deliveryLocations[index]);

        // Add depot at the beginning for round-trip optimization
        const locationsWithDepot = [depotLocation, ...groupLocations];

        // Optimize route (including depot as start point)
        const localOptimizedRoute = nearestNeighborTSPRoundTrip(locationsWithDepot);
        const optimizedGroupLocations = localOptimizedRoute.map(localIndex => locationsWithDepot[localIndex]);

        // Calculate total distance (including return to depot)
        let totalDistance = 0;
        for (let j = 0; j < optimizedGroupLocations.length - 1; j++) {
            const from = optimizedGroupLocations[j];
            const to = optimizedGroupLocations[j + 1];
            totalDistance += calculateDistance(from.lat, from.lng, to.lat, to.lng);
        }

        // Determine area name
        const areas = groupLocations
            .filter(loc => loc.kota)
            .map(loc => loc.kota);
        const areaCount = {};
        areas.forEach(area => {
            areaCount[area] = (areaCount[area] || 0) + 1;
        });
        const mainArea = Object.keys(areaCount).length > 0 ?
            Object.keys(areaCount).reduce((a, b) => areaCount[a] > areaCount[b] ? a : b) :
            'Area Campuran';

        dailyRoutes.push({
            day: groupIndex + 1,
            locations: optimizedGroupLocations,
            totalDistance: totalDistance,
            count: optimizedGroupLocations.length,
            deliveryCount: groupLocations.length,
            area: mainArea,
            subAreas: [...new Set(areas)]
        });
    });

    return dailyRoutes;
}

function nearestNeighborTSPLocal(locations) {
    if (locations.length === 0) return [];

    const visited = new Set();
    const route = [];
    let currentIndex = 0;

    // Mulai dari lokasi pertama (bukan depot)
    route.push(0);
    visited.add(0);

    while (visited.size < locations.length) {
        let nearestIndex = -1;
        let nearestDistance = Infinity;

        for (let i = 0; i < locations.length; i++) {
            if (!visited.has(i)) {
                const distance = calculateDistance(
                    locations[currentIndex].lat, locations[currentIndex].lng,
                    locations[i].lat, locations[i].lng
                );

                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = i;
                }
            }
        }

        if (nearestIndex !== -1) {
            route.push(nearestIndex);
            visited.add(nearestIndex);
            currentIndex = nearestIndex;
        }
    }

    // Optimize dengan 2-opt local search
    const optimizedRoute = twoOptOptimization(locations, route);

    // Tidak kembali ke depot (one-way trip)
    return optimizedRoute;
}

function nearestNeighborTSPRoundTrip(locations) {
    if (locations.length === 0) return [];

    const visited = new Set();
    const route = [];
    let currentIndex = 0;

    // Mulai dari depot (index 0)
    route.push(0);
    visited.add(0);

    while (visited.size < locations.length) {
        let nearestIndex = -1;
        let nearestDistance = Infinity;

        for (let i = 0; i < locations.length; i++) {
            if (!visited.has(i)) {
                const distance = calculateDistance(
                    locations[currentIndex].lat, locations[currentIndex].lng,
                    locations[i].lat, locations[i].lng
                );

                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = i;
                }
            }
        }

        if (nearestIndex !== -1) {
            route.push(nearestIndex);
            visited.add(nearestIndex);
            currentIndex = nearestIndex;
        }
    }

    // Kembali ke depot untuk round-trip
    route.push(0);

    // Optimize dengan 2-opt local search (termasuk return to depot)
    const optimizedRoute = twoOptOptimizationRoundTrip(locations, route);

    return optimizedRoute;
}

function twoOptOptimizationRoundTrip(locations, route) {
    if (route.length < 4) return route;

    let improved = true;
    let bestRoute = [...route];
    let bestDistance = calculateRouteDistance(locations, bestRoute);

    while (improved) {
        improved = false;

        for (let i = 0; i < route.length - 2; i++) {
            for (let j = i + 2; j < route.length; j++) {
                // Skip if it would break the round-trip (depot at start and end)
                if (i === 0 && j === route.length - 1) continue;

                // Create new route by reversing segment between i and j
                const newRoute = [
                    ...bestRoute.slice(0, i + 1),
                    ...bestRoute.slice(i + 1, j + 1).reverse(),
                    ...bestRoute.slice(j + 1)
                ];

                const newDistance = calculateRouteDistance(locations, newRoute);

                if (newDistance < bestDistance) {
                    bestRoute = newRoute;
                    bestDistance = newDistance;
                    improved = true;
                }
            }
        }
    }

    return bestRoute;
}

function calculateAverageDistance(locations, group1, group2) {
    let totalDist = 0;
    let count = 0;

    for (let idx1 of group1) {
        for (let idx2 of group2) {
            totalDist += calculateDistance(
                locations[idx1].lat, locations[idx1].lng,
                locations[idx2].lat, locations[idx2].lng
            );
            count++;
        }
    }

    return count > 0 ? totalDist / count : Infinity;
}

app.post('/upload', upload.single('excelFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'File tidak ditemukan' });
        }

        // Get depot coordinates from form or use default
        const depotLat = parseFloat(req.body.depotLat) || DEFAULT_DEPOT_LAT;
        const depotLng = parseFloat(req.body.depotLng) || DEFAULT_DEPOT_LNG;

        // Validate depot coordinates
        if (isNaN(depotLat) || isNaN(depotLng) || depotLat < -90 || depotLat > 90 || depotLng < -180 || depotLng > 180) {
            return res.status(400).json({ error: 'Koordinat depot tidak valid. Latitude harus antara -90 dan 90, Longitude antara -180 dan 180' });
        }

        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        const deliveryLocations = data.map((row, index) => {
            // Support various coordinate column names
            const lat = parseFloat(
                row.lat || row.latitude || row.Lat || row.Latitude ||
                row.LAT || row.LATITUDE || row.lintang
            );
            const lng = parseFloat(
                row.long || row.lng || row.longitude || row.Long || row.Longitude ||
                row.lon || row.LNG || row.LONGITUDE || row.bujur
            );

            if (isNaN(lat) || isNaN(lng)) {
                throw new Error(`Data tidak valid pada baris ${index + 1}: lat=${lat}, lng=${lng}`);
            }

            // Get name from various possible column names
            let locationName = row.name || row.Name || row.nama || row.Nama ||
                              row['Nama Klinik'] || row['nama klinik'] || row['NAMA KLINIK'] ||
                              row.location || row.Location || row.lokasi || row.Lokasi ||
                              row.tempat || row.Tempat || row.destination || row.Destination ||
                              row.title || row.Title || row.judul || row.Judul;

            // If no name found, use default with proper numbering
            if (!locationName || locationName.trim() === '') {
                locationName = `Lokasi ${index + 1}`;
            }

            // Get address from various possible column names
            let locationAddress = row.address || row.Address || row.alamat || row.Alamat ||
                                 row['Alamat'] || row['ALAMAT'] ||
                                 row.addr || row.Addr || row.keterangan || row.Keterangan ||
                                 row.description || row.Description || row.alamat_lengkap ||
                                 row['Alamat Lengkap'] || '';

            return {
                id: index + 1,
                lat: lat,
                lng: lng,
                name: locationName.trim(),
                address: locationAddress.trim(),
                originalIndex: index,
                isStartPoint: false,
                telepon: row.Telepon || row.telepon || row.phone || row.Phone || '',
                website: row.Website || row.website || row.web || row.Web || '',
                kota: row.Kota || row.kota || row.city || row.City || ''
            };
        });

        // Calculate center point from all delivery locations
        const centerLat = deliveryLocations.reduce((sum, loc) => sum + loc.lat, 0) / deliveryLocations.length;
        const centerLng = deliveryLocations.reduce((sum, loc) => sum + loc.lng, 0) / deliveryLocations.length;

        const centerPoint = {
            id: 0,
            lat: centerLat,
            lng: centerLng,
            name: '📍 Titik Pusat Area',
            address: 'Calculated Center Point',
            isStartPoint: false
        };

        const areaRadius = parseFloat(req.body.areaRadius) || 2;
        const minLocationsPerDay = parseInt(req.body.minLocationsPerDay) || 5;

        // Pass parameters to groupLocationsByArea (no more max limit!)
        const dailyRoutes = groupLocationsByArea(deliveryLocations, areaRadius, depotLat, depotLng, minLocationsPerDay);

        const totalDistance = dailyRoutes.reduce((sum, day) => sum + day.totalDistance, 0);
        const totalDeliveryLocations = deliveryLocations.length;

        // Update center point ke depot (hanya referensi, tidak termasuk dalam rute)
        const depotPoint = {
            id: 'depot-center',
            lat: depotLat,
            lng: depotLng,
            name: '🏠 Depot Pusat',
            address: 'Referensi Depot (tidak termasuk dalam rute)',
            isStartPoint: false,
            isDepot: true
        };

        res.json({
            success: true,
            totalLocations: totalDeliveryLocations,
            totalDays: dailyRoutes.length,
            totalDistance: Math.round(totalDistance * 100) / 100,
            dailyRoutes: dailyRoutes,
            deliveryLocations: deliveryLocations,
            centerPoint: depotPoint,
            areaRadius: areaRadius,
            minLocationsPerDay: minLocationsPerDay,
            depot: {
                lat: depotLat,
                lng: depotLng
            },
            optimizationMethod: 'Nearest Neighbor + 2-Opt Local Search'
        });

    } catch (error) {
        console.error('Error processing file:', error);
        res.status(500).json({
            error: 'Gagal memproses file: ' + error.message
        });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});