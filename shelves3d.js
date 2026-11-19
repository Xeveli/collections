// Vue « Rayons » en 3D (Three.js). Chargé seulement quand on ouvre cette vue.
// Étape 1 : le meuble, une planche par groupe (étagère ou catégorie). Les objets viendront ensuite.

// Version épinglée (MIT). Gardée en cache par le service worker (THREE_URL dans sw.js) pour le hors-ligne.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const ROW_HEIGHT = 1.2; // hauteur d'un rayon (unités 3D ≈ 25 cm)
const WIDTH = 4;
const DEPTH = 0.9;
const BOARD = 0.06; // épaisseur des planches

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export function hasWebGL() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

export function createShelves(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(2, 4, 6);
  scene.add(sun);

  const wood = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const back = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const furniture = new THREE.Group();
  scene.add(furniture);
  let rows = 1;

  const box = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    furniture.add(m);
  };

  function build() {
    furniture.traverse((o) => o.geometry?.dispose());
    furniture.clear();
    const h = rows * ROW_HEIGHT;
    for (let i = 0; i <= rows; i += 1) box(WIDTH, BOARD, DEPTH, 0, i * ROW_HEIGHT, 0, wood); // planches
    for (const x of [-WIDTH / 2, WIDTH / 2]) box(BOARD, h + BOARD, DEPTH, x, h / 2, 0, wood); // montants
    box(WIDTH, h, BOARD, 0, h / 2, -DEPTH / 2, back); // fond
  }

  // Couleurs accordées au thème clair / sombre de l'appli.
  function theme() {
    scene.background = new THREE.Color(css('--bg'));
    wood.color.set(dark() ? '#6b4a33' : '#a8774f');
    back.color.set(dark() ? '#3b2a1e' : '#d9c3a3');
  }

  function frame() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Recule la caméra pour que tout le meuble tienne, en largeur comme en hauteur.
    const h = rows * ROW_HEIGHT;
    const fitH = (h / 2 + 0.3) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitW = fitH * Math.max(1, (WIDTH + 0.6) / (h + 0.6) / camera.aspect);
    camera.position.set(0, h / 2 + 0.2, Math.max(fitH, fitW) + DEPTH / 2);
    camera.lookAt(0, h / 2, 0);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  // Rendu à la demande (pas de boucle permanente) : économise la batterie.
  const resize = new ResizeObserver(frame);
  resize.observe(container);
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => { theme(); frame(); };
  scheme.addEventListener('change', onScheme);
  theme();

  return {
    // groups : noms des rayons, du haut vers le bas.
    show(groups) {
      rows = Math.max(1, groups.length);
      build();
      frame();
    },
    dispose() {
      resize.disconnect();
      scheme.removeEventListener('change', onScheme);
      furniture.traverse((o) => o.geometry?.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
