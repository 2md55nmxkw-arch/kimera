// Занавес: руки и печать слегка тянутся за указателем. Вся остальная механика
// секции — в CSS (pages/reach.css).
import './reach.css';

const section = document.querySelector<HTMLElement>('.reach');

if (section && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  section.addEventListener(
    'pointermove',
    (e) => {
      const box = section.getBoundingClientRect();
      section.style.setProperty('--mx', ((e.clientX - box.left) / box.width - 0.5).toFixed(3));
      section.style.setProperty('--my', ((e.clientY - box.top) / box.height - 0.5).toFixed(3));
    },
    { passive: true },
  );
}
