mapboxgl.accessToken = 'pk.eyJ1IjoiY2xrcnVzZSIsImEiOiJjaXIxY2M2dGcwMnNiZnZtZzN0Znk3MXRuIn0.MyKHSjxjG-ZcI2BkRUSGJA';

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/clkruse/ck5sl4yw4195e1iryj5sa28g8',
    center: [0, 20],
    zoom: 1.5,
    scrollZoom: true
});

const getDirectionsBtn = addGetDirectionsButton();
const locationsContainer = document.querySelector('.locations');
const cardsById = new Map();

let activeCard = null;
let selectedPointId = null;

fetch('36-hours.csv')
    .then(response => response.text())
    .then(csvText => {
        const locations = parseCsvLocations(csvText);
        createCards(locations);
        setupMap(locations);
    })
    .catch(error => console.error('Error loading locations data:', error));

function hasValidCoordinates(location) {
    if (!location || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) {
        return false;
    }

    return location.coordinates.every(
        coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate)
    );
}

function createCards(locations) {
    locationsContainer.innerHTML = '';
    cardsById.clear();

    const fragment = document.createDocumentFragment();

    locations.forEach(location => {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.id = location.id;

        if (location.image) {
            const img = document.createElement('img');
            img.src = location.image;
            img.alt = location.name ? `${location.name} itinerary image` : 'Itinerary image';
            img.loading = 'lazy';
            card.appendChild(img);
        } else {
            card.classList.add('no-image');
        }

        const cardTitle = document.createElement('div');
        cardTitle.className = 'card-title';
        const titleHeading = document.createElement('h2');
        titleHeading.textContent = location.name || 'Untitled';
        cardTitle.appendChild(titleHeading);

        const cardContent = document.createElement('div');
        cardContent.className = 'card-content';

        const overlayTitle = document.createElement('h2');
        overlayTitle.textContent = location.name || 'Untitled';
        cardContent.appendChild(overlayTitle);

        if (location.date) {
            const formattedDate = formatDateForDisplay(location.date);
            if (formattedDate) {
                const dateText = document.createElement('p');
                dateText.className = 'meta';
                dateText.textContent = formattedDate;
                cardContent.appendChild(dateText);
            }
        }

        if (location.description) {
            const descriptionText = document.createElement('p');
            descriptionText.className = 'summary';
            descriptionText.textContent = location.description;
            cardContent.appendChild(descriptionText);
        }

        if (location.url) {
            const link = document.createElement('a');
            link.href = location.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'Read the itinerary';
            cardContent.appendChild(link);
        } else {
            const noLink = document.createElement('p');
            noLink.textContent = 'Article link unavailable.';
            cardContent.appendChild(noLink);
        }

        if (!hasValidCoordinates(location)) {
            const coordsNote = document.createElement('p');
            coordsNote.className = 'no-coordinates';
            coordsNote.textContent = 'Map preview unavailable.';
            cardContent.appendChild(coordsNote);
        }

        card.appendChild(cardTitle);
        card.appendChild(cardContent);

        fragment.appendChild(card);
        cardsById.set(location.id, card);

        card.addEventListener('click', () => {
            clearActiveState();
            card.classList.add('active');
            activeCard = card;

            if (hasValidCoordinates(location)) {
                map.flyTo({
                    center: location.coordinates,
                    zoom: 6,
                    duration: 1000
                });
                updateSelectedPoint(location.id);
            }
        });
    });

    locationsContainer.appendChild(fragment);
}

function setupMap(locations) {
    const locationsWithCoords = locations.filter(hasValidCoordinates);
    if (locationsWithCoords.length === 0) {
        return;
    }

    const initialize = () => {
        if (map.getLayer('points')) {
            map.removeLayer('points');
        }

        if (map.getSource('points')) {
            map.removeSource('points');
        }

        const geojson = {
            type: 'FeatureCollection',
            features: locationsWithCoords.map(location => ({
                type: 'Feature',
                id: location.id,
                geometry: {
                    type: 'Point',
                    coordinates: location.coordinates
                },
                properties: {
                    id: location.id,
                    name: location.name || ''
                }
            }))
        };

        map.addSource('points', {
            type: 'geojson',
            data: geojson
        });

        map.addLayer({
            id: 'points',
            type: 'circle',
            source: 'points',
            paint: {
                'circle-radius': 5,
                'circle-color': '#AE060F',
                'circle-stroke-width': 2,
                'circle-stroke-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    '#c4dcff',
                    '#fff'
                ]
            }
        });

        addMapInteractions();
        fitMapToBounds(locationsWithCoords);
        if (selectedPointId !== null) {
            updateSelectedPoint(selectedPointId);
        }
    };

    if (map.isStyleLoaded()) {
        initialize();
    } else {
        map.on('load', initialize);
    }

    map.on('moveend', () => {
        getDirectionsBtn.style.display = 'block';
    });

    function addMapInteractions() {
        map.on('click', 'points', handlePointClick);
        map.on('mouseenter', 'points', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'points', () => {
            map.getCanvas().style.cursor = '';
        });
    }

    function handlePointClick(event) {
        const feature = event.features && event.features[0];
        if (!feature) {
            return;
        }

        const coordinates = feature.geometry.coordinates.slice();
        const locationId = Number(feature.properties.id);

        map.flyTo({
            center: coordinates,
            zoom: 6,
            duration: 1000
        });

        updateSelectedPoint(locationId);
        scrollToCard(locationId);
    }

    function fitMapToBounds(locationsForMap) {
        if (!locationsForMap.length) {
            return;
        }

        const bounds = new mapboxgl.LngLatBounds(
            locationsForMap[0].coordinates,
            locationsForMap[0].coordinates
        );

        locationsForMap.forEach(location => {
            bounds.extend(location.coordinates);
        });

        map.fitBounds(bounds, { padding: 60 });
    }
}

function updateSelectedPoint(locationId) {
    const sourceExists = map.getSource('points');
    if (!sourceExists) {
        selectedPointId = locationId;
        return;
    }

    if (selectedPointId !== null) {
        map.setFeatureState(
            { source: 'points', id: selectedPointId },
            { selected: false }
        );
    }

    if (locationId === null || Number.isNaN(locationId)) {
        selectedPointId = null;
        return;
    }

    map.setFeatureState(
        { source: 'points', id: locationId },
        { selected: true }
    );

    selectedPointId = locationId;
}

function clearActiveState() {
    if (activeCard) {
        activeCard.classList.remove('active');
        activeCard = null;
    }
}

function scrollToCard(locationId) {
    const card = cardsById.get(locationId);
    if (!card) {
        return;
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    clearActiveState();
    card.classList.add('active');
    activeCard = card;
}

function addGetDirectionsButton() {
    const button = document.createElement('button');
    button.textContent = 'Get Directions';
    button.className = 'get-directions-btn';
    button.style.display = 'none';

    map.getContainer().appendChild(button);

    button.addEventListener('click', () => {
        const center = map.getCenter();
        const url = `https://www.google.com/maps/dir/?api=1&destination=${center.lat},${center.lng}`;
        window.open(url, '_blank');
    });

    return button;
}

function parseCsvLocations(csvText) {
    const table = parseCSV(csvText);
    if (!table.length) {
        return [];
    }

    const headers = table[0].map(header => header.trim());
    const locations = [];

    for (let rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
        const row = table[rowIndex];
        if (!row || row.every(cell => !cell || cell.trim() === '')) {
            continue;
        }

        const raw = {};
        headers.forEach((header, index) => {
            raw[header] = row[index] !== undefined ? row[index] : '';
        });

        const name = (raw.title || '').trim();
        const region = (raw.location || '').trim();
        const url = (raw.url || '').trim();
        const image = (raw.img_url || '').trim() || null;
        const coordinates = parseCoordinatePair(raw.coords);
        const date = (raw.date || '').trim();

        locations.push({
            id: locations.length,
            name,
            region,
            description: (raw.description || '').trim(),
            url,
            coordinates,
            image,
            date
        });
    }

    return locations;
}

function parseCoordinatePair(value) {
    if (!value) {
        return null;
    }

    const cleaned = value.replace(/[()]/g, '').trim();
    if (!cleaned) {
        return null;
    }

    const parts = cleaned.split(',').map(part => part.trim());
    if (parts.length !== 2) {
        return null;
    }

    const latitude = Number(parts[0]);
    const longitude = Number(parts[1]);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
    }

    return [longitude, latitude];
}

function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentValue = '';
    let insideQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];

        if (insideQuotes) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    currentValue += '"';
                    index += 1;
                } else {
                    insideQuotes = false;
                }
            } else {
                currentValue += char;
            }
        } else if (char === '"') {
            insideQuotes = true;
        } else if (char === ',') {
            currentRow.push(currentValue);
            currentValue = '';
        } else if (char === '\n') {
            currentRow.push(currentValue);
            rows.push(currentRow);
            currentRow = [];
            currentValue = '';
        } else if (char === '\r') {
            // Ignore carriage returns; they are handled by the subsequent newline.
        } else {
            currentValue += char;
        }
    }

    if (currentValue !== '' || insideQuotes || currentRow.length) {
        currentRow.push(currentValue);
    }
    if (currentRow.length) {
        rows.push(currentRow);
    }

    return rows;
}

function formatDateForDisplay(dateString) {
    if (!dateString) {
        return null;
    }

    const trimmed = dateString.trim();
    if (!trimmed) {
        return null;
    }

    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
        return new Date(parsed).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    return trimmed;
}
