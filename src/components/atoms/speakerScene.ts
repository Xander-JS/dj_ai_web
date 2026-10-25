/**
 * SYSTEM DJ — Escena 3D del altavoz (Login y Registro)
 * Módulo imperativo de three.js; Speaker3D lo importa bajo demanda para que three
 * viaje en su propio chunk y nunca bloquee el formulario.
 *
 * El GLB no trae animaciones, morph targets ni conos separados: cada caja es una sola
 * malla con dos altavoces en su cara -X local, un woofer abajo (centro y ≈ -0.433) y un
 * tweeter arriba (y ≈ 0.541). La vibración se aplica en el vertex shader solo al cono y
 * la suspensión del woofer; el aro, el tweeter y la caja no se deforman.
 */

import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { speakerPulse, speakerSway } from './speakerPulse';

export const SPEAKER_MODEL_URL = '/assets/models/dj-speaker.glb';

export type SpeakerTheme = 'light' | 'dark';

export interface SpeakerSceneOptions {
  canvas: HTMLCanvasElement;
  reduceMotion: boolean;
  theme: SpeakerTheme;
}

export interface SpeakerSceneHandle {
  resize: (width: number, height: number) => void;
  setRunning: (running: boolean) => void;
  setTheme: (theme: SpeakerTheme) => void;
  dispose: () => void;
}

// Excursión máxima del cono en unidades locales de la caja (la caja mide 2 de ancho)
const CONE_TRAVEL = 0.08;
// Golpe de la caja entera: casi imperceptible, solo acompaña al cono
const BODY_KICK = 0.012;
const SWAY_RADIANS = MathUtils.degToRad(2.5);
// Vista de tres cuartos desde el frente de las cajas (que miran hacia -X)
const VIEW_DIRECTION = new Vector3(-1, 0.32, -0.62).normalize();
const FOV = 26;
const EXPOSURE: Record<SpeakerTheme, number> = { light: 1.05, dark: 0.92 };

interface ConeUniforms {
  uPulse: { value: number };
}

function createSpeakerMaterial(uniforms: ConeUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: new Color('#141414'), roughness: 0.62, metalness: 0.08 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPulse = uniforms.uPulse;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uPulse;\nvarying float vCone;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // Distancias en la cara frontal con el estiramiento vertical del nodo (1.567) compensado
        float front = 1.0 - step(-0.84, position.x);
        float wooferDistance = length(vec2((position.y + 0.433) * 1.567, position.z));
        float tweeterDistance = length(vec2((position.y - 0.541) * 1.567, position.z));
        // El cono empuja como pistón y la suspensión se estira hasta el aro, que queda fijo
        float cone = (1.0 - smoothstep(0.3, 0.56, wooferDistance)) * front;
        vCone = max(cone, (1.0 - smoothstep(0.2, 0.3, tweeterDistance)) * front);
        transformed.x -= uPulse * cone;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCone;')
      .replace(
        '#include <color_fragment>',
        // Conos en grafito satinado contra la caja negra mate, para que el movimiento se lea
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.16, 0.17), vCone);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.34, vCone);`,
      );
  };
  return material;
}

function disposeMaterial(material: Material | Material[]): void {
  (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
}

/** Crea la escena. Lanza si WebGL no está disponible o el modelo no carga: el llamador muestra el respaldo. */
export async function createSpeakerScene({ canvas, reduceMotion, theme }: SpeakerSceneOptions): Promise<SpeakerSceneHandle> {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE[theme];
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environment = environment;
  scene.environmentIntensity = 0.55;

  // Luz de estudio: clave cálida arriba a la izquierda y recorte frío por detrás
  const key = new DirectionalLight('#fff4ea', 2.4);
  key.position.set(-6, 8, -5);
  const rim = new DirectionalLight('#e6eeff', 1.6);
  rim.position.set(4, 5, 7);
  scene.add(key, rim);

  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);

  let gltf: GLTF;
  try {
    gltf = await new GLTFLoader().loadAsync(SPEAKER_MODEL_URL);
  } catch (error) {
    environment.dispose();
    renderer.dispose();
    throw error;
  }

  const rig = new Group();
  const speakers: { mesh: Mesh; uniforms: ConeUniforms; offsetBeats: number; gain: number; rest: Vector3; back: Vector3 }[] = [];

  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    disposeMaterial(object.material);
    // El plano es el fondo del estudio en Blender; aquí el altavoz va recortado sobre el campo de color
    if (object.name === 'Plane') {
      object.visible = false;
      return;
    }
    const uniforms: ConeUniforms = { uPulse: { value: 0 } };
    object.material = createSpeakerMaterial(uniforms);
    // La caja de pie lleva el bombo; la tumbada responde a contratiempo y más suave
    const standing = speakers.length === 0;
    speakers.push({
      mesh: object,
      uniforms,
      offsetBeats: standing ? 0 : 0.5,
      gain: standing ? 1 : 0.45,
      rest: object.position.clone(),
      // Eje +X local en el espacio del padre: hacia atrás de la caja
      back: new Vector3(1, 0, 0).applyQuaternion(object.quaternion),
    });
  });

  // Centra el conjunto en el origen para que el balanceo gire sobre su propio eje
  gltf.scene.updateMatrixWorld(true);
  const bounds = new Box3();
  speakers.forEach(({ mesh }) => bounds.expandByObject(mesh));
  const center = bounds.getCenter(new Vector3());
  gltf.scene.position.sub(center);
  rig.add(gltf.scene);
  scene.add(rig);
  const sphere = bounds.getBoundingSphere(new Sphere());

  let width = 1;
  let height = 1;
  let frame = 0;
  let running = false;
  let disposed = false;
  let startedAt = performance.now();
  let elapsedBeforePause = 0;

  const frameCamera = () => {
    camera.aspect = width / height;
    // Distancia que encaja la esfera del conjunto tanto en vertical como en horizontal
    const vertical = MathUtils.degToRad(FOV) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = (sphere.radius / Math.sin(Math.min(vertical, horizontal))) * 0.94;
    camera.position.copy(VIEW_DIRECTION).multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };

  const pose = (seconds: number) => {
    speakers.forEach(({ mesh, uniforms, offsetBeats, gain, rest, back }) => {
      const pulse = speakerPulse(seconds, offsetBeats) * gain;
      uniforms.uPulse.value = pulse * CONE_TRAVEL;
      // La caja retrocede un pelo con cada golpe, en sentido contrario al frente
      mesh.position.copy(rest).addScaledVector(back, pulse * BODY_KICK);
    });
    rig.rotation.y = speakerSway(seconds) * SWAY_RADIANS;
    key.intensity = 2.4 * (1 + 0.05 * speakerPulse(seconds));
  };

  const render = () => renderer.render(scene, camera);

  const tick = () => {
    if (!running) return;
    pose((elapsedBeforePause + performance.now() - startedAt) / 1000);
    render();
    frame = requestAnimationFrame(tick);
  };

  frameCamera();
  pose(0);
  // Compila los shaders antes del primer fotograma visible para que la entrada no tartamudee
  await renderer.compileAsync(scene, camera);

  return {
    resize(nextWidth, nextHeight) {
      if (disposed || nextWidth === 0 || nextHeight === 0) return;
      width = nextWidth;
      height = nextHeight;
      renderer.setSize(width, height, false);
      frameCamera();
      if (!running) render();
    },
    setRunning(next) {
      // Con movimiento reducido el altavoz queda en reposo: un único fotograma estático
      const shouldRun = next && !reduceMotion && !disposed;
      if (shouldRun === running) return;
      running = shouldRun;
      if (running) {
        startedAt = performance.now();
        frame = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(frame);
        elapsedBeforePause += performance.now() - startedAt;
        if (!disposed) render();
      }
    },
    setTheme(nextTheme) {
      renderer.toneMappingExposure = EXPOSURE[nextTheme];
      if (!running && !disposed) render();
    },
    dispose() {
      disposed = true;
      running = false;
      cancelAnimationFrame(frame);
      gltf.scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        disposeMaterial(object.material);
      });
      environment.dispose();
      renderer.dispose();
    },
  };
}
