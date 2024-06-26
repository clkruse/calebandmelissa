document.addEventListener('DOMContentLoaded', (event) => {
    // Lightbox functionality
    const lightbox = document.getElementById('lightbox');
    const lightboxImage = document.getElementById('lightbox-image');
    const images = Array.from(document.querySelectorAll('.lightbox-image'));
    const closeButton = document.querySelector('.close');
    let currentImageIndex = 0;

    function openLightbox(index) {
        currentImageIndex = index;
        lightboxImage.src = images[currentImageIndex].src;
        lightbox.classList.add('active');
    }

    function closeLightbox() {
        lightbox.classList.remove('active');
    }

    function navigateImage(direction) {
        currentImageIndex = (currentImageIndex + direction + images.length) % images.length;
        lightboxImage.src = images[currentImageIndex].src;
    }

    images.forEach((img, index) => {
        img.addEventListener('click', () => openLightbox(index));
    });

    closeButton.addEventListener('click', closeLightbox);

    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('active')) return;

        switch (e.key) {
            case 'ArrowLeft':
                navigateImage(-1);
                break;
            case 'ArrowRight':
                navigateImage(1);
                break;
            case 'Escape':
                closeLightbox();
                break;
        }
    });

    // Canvas Scroll Clip initialization
    import('https://cdn.jsdelivr.net/npm/canvas-scroll-clip@1.3.1/dist/esbuild/main.esm.min.js')
        .then((module) => {
            const CSC = module.default;
            const element = document.querySelector('.canvas-container');
            const options = {
                framePath: "../img/invitation-001.jpg",
                frameCount: 6,
                scrollArea: 1500
            };

            const csc = new CSC(element, options);

            csc.events.on('viewport.scroll', (scrollTop) => {
                const element = document.querySelector('.promo');
                const screenHeight = window.innerHeight;
                const when = document.documentElement.scrollHeight - innerHeight - 200;

                if (scrollTop >= when) {
                    element.style.setProperty("opacity", "1");
                } else {
                    element.style.removeProperty('opacity');
                }
            });
        })
        .catch(error => console.error('Error loading Canvas Scroll Clip:', error));
});