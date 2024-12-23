mapboxgl.accessToken = 'pk.eyJ1IjoiY2xrcnVzZSIsImEiOiJjaXIxY2M2dGcwMnNiZnZtZzN0Znk3MXRuIn0.MyKHSjxjG-ZcI2BkRUSGJA';
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/clkruse/ck5sl4yw4195e1iryj5sa28g8',
    center: [-122.5634, 37.8855],
    zoom: 9,
    scrollZoom: true
});

const timeline = document.querySelector('.timeline');
const markers = [];

// Fetch locations data from JSON file
fetch('locations.json')
    .then(response => response.json())
    .then(locationsData => {
        createSchedule(locationsData);
        setupMap(locationsData);
    })
    .catch(error => console.error('Error loading locations data:', error));

function createSchedule(locationsData) {
    const days = ["Wednesday - July 31", "Thursday - August 1", "Friday - August 2", "Saturday - August 3"];
    
    days.forEach(day => {
        const dayEvents = locationsData.filter(location => location.region === day);
        if (dayEvents.length > 0) {
            const dayElement = document.createElement('div');
            dayElement.className = 'day';
            dayElement.innerHTML = `<h2>${day}</h2>`;
            timeline.appendChild(dayElement);

            dayEvents.sort((a, b) => a.order - b.order).forEach(event => {
                const eventElement = document.createElement('div');
                eventElement.className = 'event';
                eventElement.innerHTML = `
                    <h3>${event.name}</h3>
                    <p class="time">${event.name.split('-')[1]?.trim() || ''}</p>
                    <p>${event.description}</p>
                `;
                timeline.appendChild(eventElement);

                eventElement.addEventListener('click', () => {
                    flyToLocation(event.coordinates);
                    highlightMarker(event.name);
                });
            });
        }
    });
}

function setupMap(locationsData) {
    map.on('load', function () {
        addPointsLayer(locationsData);
        
        // Fit map to show all points
        const bounds = new mapboxgl.LngLatBounds();
        locationsData.forEach(location => {
            if (location.coordinates) {
                bounds.extend(location.coordinates);
            }
        });
        map.fitBounds(bounds, { padding: 50 });
    });
}

function addPointsLayer(locationsData) {
    const visibleLocations = locationsData.filter(loc => 
        loc.region !== "Overview" && 
        loc.name !== "San Francisco Airport" && 
        loc.name !== "Oakland Airport"
    );

    map.addSource('points', {
        'type': 'geojson',
        'data': {
            'type': 'FeatureCollection',
            'features': visibleLocations.map((location, index) => ({
                'type': 'Feature',
                'id': index,
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
            'circle-color': '#8B0000',
            'circle-stroke-width': 2,
            'circle-stroke-color': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                '#c4dcff',
                '#fff'
            ]
        }
    });

    // Add click event listener to the points
    map.on('click', 'points', (e) => {
        if (e.features.length > 0) {
            const clickedPoint = e.features[0];
            flyToLocation(clickedPoint.geometry.coordinates);
            highlightMarker(clickedPoint.properties.name);
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
}

function flyToLocation(coordinates) {
    map.flyTo({
        center: coordinates,
        zoom: 14,
        duration: 2000
    });
}

function highlightMarker(locationName) {
    map.setFeatureState(
        { source: 'points', id: markers.findIndex(m => m.name === locationName) },
        { selected: true }
    );

    // Reset other markers
    markers.forEach((marker, index) => {
        if (marker.name !== locationName) {
            map.setFeatureState(
                { source: 'points', id: index },
                { selected: false }
            );
        }
    });
}