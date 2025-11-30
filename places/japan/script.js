mapboxgl.accessToken = 'pk.eyJ1IjoiY2xrcnVzZSIsImEiOiJjaXIxY2M2dGcwMnNiZnZtZzN0Znk3MXRuIn0.MyKHSjxjG-ZcI2BkRUSGJA';
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/clkruse/ck5sl4yw4195e1iryj5sa28g8',
    center: [-122.5634, 37.8855],
    zoom: 11,
    scrollZoom: true
});

const getDirectionsBtn = addGetDirectionsButton();
const locationsContainer = document.querySelector('.locations');
const markers = [];

// Define the new region order
const regionOrder = ["Kyoto", "Tokyo"];

// Fetch locations data from JSON file
fetch('locations.json')
    .then(response => response.json())
    .then(locationsData => {
        // Sort locations by the new region order
        locationsData.sort((a, b) => {
            const indexA = regionOrder.indexOf(a.region);
            const indexB = regionOrder.indexOf(b.region);
            if (indexA === indexB) {
                return a.name.localeCompare(b.name);
            }
            return indexA - indexB;
        });

        // Group locations by region
        const groupedLocations = locationsData.reduce((acc, location) => {
            if (!acc[location.region]) {
                acc[location.region] = [];
            }
            acc[location.region].push(location);
            return acc;
        }, {});

        createCards(locationsData, groupedLocations);
        setupMap(locationsData);
    })
    .catch(error => console.error('Error loading locations data:', error));

    function createCards(locationsData) {
        const welcomeLocation = locationsData.find(loc => loc.name === "Welcome to Japan");
        if (welcomeLocation) {
            createWelcomeCard(welcomeLocation, locationsData);
        }
    
        const regionOrder = ["Kyoto", "Tokyo"];
        const overviewLocations = locationsData.filter(loc => loc.region === "Overview" && loc.name !== "Welcome to Japan");
        const nonOverviewLocations = locationsData.filter(loc => 
            loc.region !== "Overview"
        );
    
        regionOrder.forEach((regionName, index) => {
            const overviewLocation = overviewLocations.find(loc => loc.name === regionName);
            if (overviewLocation) {
                // Add divider before each region
                const divider = document.createElement('hr');
                divider.className = 'regional-divider';
                locationsContainer.appendChild(divider);
    
                createRegionCard(overviewLocation);
                const regionLocations = nonOverviewLocations.filter(loc => loc.region === regionName);
                
                // Sort locations within the region based on the 'order' field
                regionLocations.sort((a, b) => (a.order || Infinity) - (b.order || Infinity));
                
                regionLocations.forEach(location => createLocationCard(location));
            }
        });
    }

// Add this function to clear routes when clicking on other cards
function clearRoutes() {
    map.getSource('routes').setData({
        type: 'FeatureCollection',
        features: []
    });
}

function createWelcomeCard(welcomeLocation, locationsData) {
    const welcomeCard = document.createElement('div');
    welcomeCard.className = 'welcome-card';
    welcomeCard.innerHTML = `
        <img src="./img/welcome.jpg" alt="Welcome to Northern California">
        <div class="region-title">
            <h2>Welcome to Japan!</h2>
        </div>
        <div class="card-content">
            <h2>Welcome to Northern California</h2>
            <p>${welcomeLocation.description}</p>
        </div>
    `;
    locationsContainer.appendChild(welcomeCard);

    welcomeCard.addEventListener('click', function() {
        clearActiveState();
        if (window.innerWidth <= 767) {
            this.classList.add('active');
            activeCard = this;
        }
    });
}

function createRegionCard(location) {
    const regionCard = document.createElement('div');
    regionCard.className = 'region-card';
    regionCard.innerHTML = `
        <img src="./img/${location.name}.jpg" alt="${location.name}">
        <div class="region-title">
            <h2>${location.name.toUpperCase()}</h2>
        </div>
        <div class="region-content">
            <h2>${location.name}</h2>
            <p>${location.description}</p>
        </div>
    `;
    locationsContainer.appendChild(regionCard);

    regionCard.addEventListener('click', () => {
        clearActiveState();
        if (window.innerWidth <= 767) {
            regionCard.classList.add('active');
            activeCard = regionCard;
        }
        map.flyTo({
            center: location.coordinates,
            zoom: 10,
            duration: 1000
        });
        clearRoutes();
    });
}

let selectedPointId = null;

let activeCard = null;

function createLocationCard(location) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
        <img src="./img/${location.name}.jpg" alt="${location.name}">
        <div class="card-title">
            <h2>${location.name.toUpperCase()}</h2>
        </div>
        <div class="card-content">
            <h2>${location.name}</h2>
            <p>${location.description}</p>
        </div>
    `;
    locationsContainer.appendChild(card);

    card.addEventListener('click', function() {
        clearActiveState();
        if (window.innerWidth <= 767) {
            this.classList.add('active');
            activeCard = this;
        }
        clearRoutes();
        
        map.flyTo({
            center: location.coordinates,
            zoom: 14,
            duration: 1000
        });

        map.once('moveend', () => {
            updateSelectedPoint(location.name);
        });
    });
}

function clearActiveState() {
    if (activeCard) {
        activeCard.classList.remove('active');
        activeCard = null;
    }
}


function updateSelectedPoint(locationName) {
    if (selectedPointId !== null) {
        map.setFeatureState(
            { source: 'points', id: selectedPointId },
            { selected: false }
        );
    }

    const features = map.querySourceFeatures('points', {
        filter: ['==', ['get', 'name'], locationName]
    });

    if (features.length > 0) {
        selectedPointId = features[0].id;
        map.setFeatureState(
            { source: 'points', id: selectedPointId },
            { selected: true }
        );
    } else {
        selectedPointId = null;
    }
}

function clearActiveState() {
    if (activeCard) {
        activeCard.classList.remove('active');
        activeCard = null;
    }
}

function updateSelectedPoint(locationName) {
    if (selectedPointId !== null) {
        map.setFeatureState(
            { source: 'points', id: selectedPointId },
            { selected: false }
        );
    }

    const features = map.querySourceFeatures('points', {
        filter: ['==', ['get', 'name'], locationName]
    });

    if (features.length > 0) {
        selectedPointId = features[0].id;
        map.setFeatureState(
            { source: 'points', id: selectedPointId },
            { selected: true }
        );
    } else {
        selectedPointId = null;
    }
}

function setupMap(locationsData) {
    map.on('load', function () {
        addPointsLayer(locationsData);
        addRoutesLayer();
        
        // Add click event listener to the points
        map.on('click', 'points', (e) => {
            if (e.features.length > 0) {
                const clickedPoint = e.features[0];
                const locationName = clickedPoint.properties.name;
                
                // Fly to the clicked point
                map.flyTo({
                    center: clickedPoint.geometry.coordinates,
                    zoom: 14,
                    duration: 1000
                });

                // Update the selected point
                updateSelectedPoint(locationName);

                // Scroll to the corresponding card
                scrollToCard(locationName);
            }
        });

        // Change the cursor to a pointer when hovering over a point
        map.on('mouseenter', 'points', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        // Change it back to the default cursor when it leaves a point
        map.on('mouseleave', 'points', () => {
            map.getCanvas().style.cursor = '';
        });
    });
    map.on('moveend', () => {
        getDirectionsBtn.style.display = 'block';
    });

    function addPointsLayer(locationsData) {
        const visibleLocations = locationsData.filter(loc => 
            loc.region !== "Overview"
        );
    
        map.addSource('points', {
            'type': 'geojson',
            'data': {
                'type': 'FeatureCollection',
                'features': visibleLocations.map((location, index) => ({
                    'type': 'Feature',
                    'id': index,  // Add this line
                    'geometry': {
                        'type': 'Point',
                        'coordinates': location.coordinates
                    },
                    'properties': {
                        'name': location.name
                    }
                }))
            }
        });
    
        map.addLayer({
            'id': 'points',
            'type': 'circle',
            'source': 'points',
            'paint': {
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
    }

    function addRoutesLayer() {
        map.addSource('routes', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });

        map.addLayer({
            id: 'routes',
            type: 'line',
            source: 'routes',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#AE060F',
                'line-width': 3
            }
        });
    }

    // Fit map to show all points
    const bounds = new mapboxgl.LngLatBounds();
    locationsData.forEach(location => bounds.extend(location.coordinates));
    map.fitBounds(bounds, { padding: 50 });
}


function scrollToCard(locationName) {
    const cards = document.querySelectorAll('.card');
    for (let card of cards) {
        if (card.querySelector('h2').textContent.trim().toUpperCase() === locationName.toUpperCase()) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Clear any previously active cards
            clearActiveState();
            
            // Set this card as active
            card.classList.add('active');
            activeCard = card;
            break;
        }
    }
}

function flyToMarker(lng, lat) {
    map.flyTo({
        center: [lng, lat],
        zoom: 14,
        duration: 1000
    });
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