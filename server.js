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

// Fetch OSRM road distance between two points
async function getOSRMDistance(lat1, lon1, lat2, lon2) {
    try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;

        const response = await fetch(osrmUrl);
        const data = await response.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            return data.routes[0].distance / 1000; // Return distance in km
        }

        // Fallback to straight-line distance if OSRM fails
        return calculateDistance(lat1, lon1, lat2, lon2);
    } catch (error) {
        // Fallback to straight-line distance on error
        return calculateDistance(lat1, lon1, lat2, lon2);
    }
}

// Build OSRM distance matrix for all locations in a group
async function buildOSRMDistanceMatrix(locations) {
    const n = locations.length;
    const matrix = [];

    console.log(`Building OSRM distance matrix for ${n} locations...`);

    for (let i = 0; i < n; i++) {
        matrix[i] = [];
        for (let j = 0; j < n; j++) {
            if (i === j) {
                matrix[i][j] = 0;
            } else if (matrix[j] && matrix[j][i] !== undefined) {
                // Use symmetric property (distance A->B ≈ B->A)
                matrix[i][j] = matrix[j][i];
            } else {
                matrix[i][j] = await getOSRMDistance(
                    locations[i].lat, locations[i].lng,
                    locations[j].lat, locations[j].lng
                );
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        // Progress indicator
        if ((i + 1) % 5 === 0 || i === n - 1) {
            console.log(`  OSRM matrix progress: ${i + 1}/${n} rows`);
        }
    }

    console.log(`OSRM distance matrix complete!`);
    return matrix;
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

async function groupLocationsByArea(deliveryLocations, maxDistanceKm = 5, depotLat, depotLng, maxDistancePerDay = 15) {
    // Distance-based clustering: Group locations so travel distance
    // between locations (from first to last) stays within maxDistancePerDay
    // Depot is NOT included in distance calculation
    const groups = [];
    const used = new Set();

    // Sort all locations by distance from depot (nearest first)
    const locationsByDepotDistance = deliveryLocations.map((loc, index) => ({
        index,
        depotDistance: calculateDistance(depotLat, depotLng, loc.lat, loc.lng)
    })).sort((a, b) => a.depotDistance - b.depotDistance);

    // Build groups using nearest-neighbor within each group,
    // capped by travel distance between locations
    for (const entry of locationsByDepotDistance) {
        if (used.has(entry.index)) continue;

        const group = [entry.index];
        used.add(entry.index);

        // Track distance between locations only (not including depot)
        let groupDistanceEstimate = 0;

        // Keep adding nearest unused locations while distance allows
        let improved = true;
        while (improved) {
            improved = false;
            let bestCandidate = -1;
            let bestExtraDistance = Infinity;

            // Find nearest unused location to any location in the group
            for (let j = 0; j < deliveryLocations.length; j++) {
                if (used.has(j)) continue;

                // Distance from this candidate to the nearest group member
                let minDistToGroup = Infinity;
                for (const groupIdx of group) {
                    const d = calculateDistance(
                        deliveryLocations[groupIdx].lat, deliveryLocations[groupIdx].lng,
                        deliveryLocations[j].lat, deliveryLocations[j].lng
                    );
                    if (d < minDistToGroup) minDistToGroup = d;
                }

                if (minDistToGroup < bestExtraDistance) {
                    bestExtraDistance = minDistToGroup;
                    bestCandidate = j;
                }
            }

            if (bestCandidate !== -1) {
                // Distance is just the extra travel between locations
                const newEstimate = groupDistanceEstimate + bestExtraDistance;

                // Check if adding would exceed max distance per day
                if (newEstimate <= maxDistancePerDay) {
                    group.push(bestCandidate);
                    used.add(bestCandidate);
                    groupDistanceEstimate = newEstimate;
                    improved = true;
                }
            }
        }

        groups.push(group);
    }

    // Second pass: Try to merge small groups if combined distance is still within limit
    let improved = true;
    let iteration = 0;
    const maxIterations = 20;

    while (improved && iteration < maxIterations) {
        improved = false;
        iteration++;

        // Sort groups: smallest first for priority merging
        groups.sort((a, b) => a.length - b.length);

        for (let i = 0; i < groups.length; i++) {
            if (groups[i].length === 0) continue;

            let bestMergeIdx = -1;
            let minDistance = Infinity;

            for (let j = 0; j < groups.length; j++) {
                if (i === j || groups[j].length === 0) continue;

                const avgDistance = calculateAverageDistance(
                    deliveryLocations, groups[i], groups[j]
                );

                if (avgDistance < minDistance) {
                    minDistance = avgDistance;
                    bestMergeIdx = j;
                }
            }

            if (bestMergeIdx !== -1) {
                // Estimate combined distance before merging
                const combinedGroup = [...groups[bestMergeIdx], ...groups[i]];
                const combinedLocations = combinedGroup.map(idx => deliveryLocations[idx]);

                // Estimate distance between locations only
                const estimatedDist = estimateRouteDistanceBetweenLocations(combinedLocations);

                if (estimatedDist <= maxDistancePerDay) {
                    groups[bestMergeIdx] = combinedGroup;
                    groups[i] = [];
                    improved = true;
                    break;
                }
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

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex];
        if (group.length === 0) continue;

        const groupLocations = group.map(index => deliveryLocations[index]);

        // Add depot at the beginning for round-trip optimization
        const locationsWithDepot = [depotLocation, ...groupLocations];

        // Optimize route (including depot as start point) using OSRM
        console.log(`Optimizing route for Day ${groupIndex + 1} with ${locationsWithDepot.length} locations using OSRM...`);
        const localOptimizedRoute = await nearestNeighborTSPRoundTrip(locationsWithDepot, true);
        const optimizedGroupLocations = localOptimizedRoute.map(localIndex => locationsWithDepot[localIndex]);

        // Calculate total distance (including return to depot for display)
        let totalDistance = 0;
        for (let j = 0; j < optimizedGroupLocations.length - 1; j++) {
            const from = optimizedGroupLocations[j];
            const to = optimizedGroupLocations[j + 1];
            totalDistance += calculateDistance(from.lat, from.lng, to.lat, to.lng);
        }

        // Calculate travel distance between locations only (for grouping verification)
        let travelDistance = 0;
        const deliveryOnlyLocations = optimizedGroupLocations.filter(loc => !loc.isDepot);
        for (let j = 0; j < deliveryOnlyLocations.length - 1; j++) {
            const from = deliveryOnlyLocations[j];
            const to = deliveryOnlyLocations[j + 1];
            travelDistance += calculateDistance(from.lat, from.lng, to.lat, to.lng);
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
            travelDistance: travelDistance,
            count: optimizedGroupLocations.length,
            deliveryCount: groupLocations.length,
            area: mainArea,
            subAreas: [...new Set(areas)]
        });
    }

    return dailyRoutes;
}

// Estimate route distance between locations only (not including depot)
function estimateRouteDistanceBetweenLocations(locations) {
    if (locations.length <= 1) return 0;

    const visited = new Set();
    let totalDistance = 0;

    // Start from first location
    visited.add(0);
    let currentLat = locations[0].lat;
    let currentLng = locations[0].lng;

    // Nearest-neighbor tour
    for (let step = 1; step < locations.length; step++) {
        let nearestIdx = -1;
        let nearestDist = Infinity;

        for (let i = 0; i < locations.length; i++) {
            if (visited.has(i)) continue;
            const d = calculateDistance(currentLat, currentLng, locations[i].lat, locations[i].lng);
            if (d < nearestDist) {
                nearestDist = d;
                nearestIdx = i;
            }
        }

        if (nearestIdx !== -1) {
            totalDistance += nearestDist;
            currentLat = locations[nearestIdx].lat;
            currentLng = locations[nearestIdx].lng;
            visited.add(nearestIdx);
        }
    }

    // No return to depot - just distance between locations
    return totalDistance;
}

async function nearestNeighborTSPRoundTrip(locations, useOSRM = true) {
    if (locations.length === 0) return [];

    // Build distance matrix (OSRM or Haversine fallback)
    let distanceMatrix;
    if (useOSRM) {
        distanceMatrix = await buildOSRMDistanceMatrix(locations);
    } else {
        // Fallback to Haversine distances
        distanceMatrix = [];
        for (let i = 0; i < locations.length; i++) {
            distanceMatrix[i] = [];
            for (let j = 0; j < locations.length; j++) {
                if (i === j) {
                    distanceMatrix[i][j] = 0;
                } else {
                    distanceMatrix[i][j] = calculateDistance(
                        locations[i].lat, locations[i].lng,
                        locations[j].lat, locations[j].lng
                    );
                }
            }
        }
    }

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
                // Use distance from matrix
                const distance = distanceMatrix[currentIndex][i];

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

    // Optimize dengan 2-opt local search using distance matrix
    const optimizedRoute = twoOptOptimizationRoundTripWithMatrix(distanceMatrix, route);

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

// 2-opt optimization using pre-computed distance matrix (for OSRM)
function twoOptOptimizationRoundTripWithMatrix(distanceMatrix, route) {
    if (route.length < 4) return route;

    // Calculate route distance using matrix
    const getRouteDistance = (r) => {
        let dist = 0;
        for (let i = 0; i < r.length - 1; i++) {
            dist += distanceMatrix[r[i]][r[i + 1]];
        }
        return dist;
    };

    let improved = true;
    let bestRoute = [...route];
    let bestDistance = getRouteDistance(bestRoute);

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

                const newDistance = getRouteDistance(newRoute);

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

app.post('/upload', upload.single('excelFile'), async (req, res) => {
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
        const maxDistancePerDay = parseFloat(req.body.maxDistancePerDay) || 15;

        // Distance-based grouping: each day's route stays within maxDistancePerDay
        const dailyRoutes = await groupLocationsByArea(deliveryLocations, areaRadius, depotLat, depotLng, maxDistancePerDay);

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
            maxDistancePerDay: maxDistancePerDay,
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

// OSRM Proxy endpoint to avoid CORS issues
app.get('/api/route', async (req, res) => {
    const { startLng, startLat, endLng, endLat } = req.query;

    if (!startLng || !startLat || !endLng || !endLat) {
        return res.status(400).json({ error: 'Missing coordinates' });
    }

    try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;

        const response = await fetch(osrmUrl);
        const data = await response.json();

        res.json(data);
    } catch (error) {
        console.error('OSRM proxy error:', error);
        res.status(500).json({ error: 'Failed to fetch route from OSRM' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});