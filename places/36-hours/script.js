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

fetch('locations.json')
    .then(response => response.json())
    .then(rawLocations => {
        const locations = rawLocations.map((location, index) => ({
            ...location,
            id: index
        }));

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

        const regionText = document.createElement('p');
        regionText.textContent = location.region || 'Unknown destination';
        cardContent.appendChild(regionText);

        if (location.description) {
            const link = document.createElement('a');
            link.href = location.description;
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
