import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CelestialInstanceData } from './object-manager.service';

const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';
const UNSELECTABLE_NAMES = ['Luz Ambiental', 'EditorGrid', 'SelectionProxy', 'HoverProxy', 'FocusPivot'];


@Injectable({ providedIn: 'root' })
export class SceneManagerService {

  public scene!: THREE.Scene;
  public renderer!: THREE.WebGLRenderer;
  public composer!: EffectComposer;
  public canvas!: HTMLCanvasElement;

  public activeCamera!: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  public editorCamera!: THREE.PerspectiveCamera;
  public secondaryCamera!: THREE.PerspectiveCamera;

  public bloomPass!: UnrealBloomPass;

  public bloomComposer!: EffectComposer;
  private finalPass!: ShaderPass;

  private controls!: OrbitControls;

  public setupBasicScene(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const container = this.canvas.parentElement;
    if (!container) {
      console.error("[SceneManager] El canvas debe estar dentro de un contenedor para medir las dimensiones.");
      return;
    }
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000215);

    const ambientLight = new THREE.AmbientLight(0xffffff, 4.0);
    ambientLight.name = "Luz Ambiental";
    this.scene.add(ambientLight);
    
    console.log("[SceneManager] Escena básica y luz ambiental creadas.");

    this._createCameras(width, height);
    this.activeCamera = this.editorCamera;

    this._createRendererAndComposer(width, height);
  }

  // ====================================================================
  // ✨ INICIO DE LA LÓGICA DE CARGA DE FONDO CON PROMESA ✨
  // ====================================================================
  /**
   * Carga la textura de fondo de la escena y devuelve una Promesa que se resuelve
   * cuando la textura ha sido cargada y asignada a la escena.
   * @returns Una `Promise<void>` que indica la finalización de la carga del fondo.
   */
  public loadSceneBackground(): Promise<void> {
    // LÓGICA CLAVE: Se crea una promesa que envolverá todo el proceso de carga de la textura.
    // Esta promesa será la "garantía" de que el fondo está listo.
    return new Promise((resolve, reject) => {
      // Importante: El TextureLoader se crea aquí, SIN el LoadingManager,
      // porque estamos controlando su ciclo de vida manualmente con la promesa.
      const textureLoader = new THREE.TextureLoader();
      
      textureLoader.load(
        'assets/textures/NightSky.jpg',
        (texture) => {
          // ÉXITO: La textura se ha descargado.
          texture.mapping = THREE.EquirectangularReflectionMapping;
          this.scene.background = texture;
          this.scene.backgroundIntensity = 0.5;
          this.scene.environment = texture;

          console.log('[SceneManager] Fondo de escena configurado correctamente.');
          
          // LÓGICA CLAVE: Resolvemos la promesa AHORA. Esto le indicará al
          // EngineService que esta tarea específica ha terminado.
          resolve();
        },
        undefined,
        (error) => {
          // ERROR: La textura no se pudo cargar.
          console.error('[SceneManager] Error al cargar la textura de fondo.', error);
          this.scene.background = new THREE.Color(0x00042B); // Usar color de respaldo

          // Resolvemos igualmente para no bloquear la carga de la aplicación.
          // El usuario verá un fondo de color sólido en lugar de la imagen.
          resolve();
        }
      );
    });
  }
  // ====================================================================
  // ✨ FIN DE LA LÓGICA DE CARGA DE FONDO CON PROMESA ✨
  // ====================================================================

  public setControls(controls: OrbitControls): void {
    this.controls = controls;
  }

  public getSceneBoundingBox(): THREE.Box3 {
    const box = new THREE.Box3();
    if (!this.scene) return box;

    this.scene.children.forEach(object => {
      if (!object.visible || UNSELECTABLE_NAMES.includes(object.name) || object.name.endsWith('_helper')) {
        return;
      }
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        const allInstanceData: CelestialInstanceData[] = object.userData["celestialData"];
        if (allInstanceData) {
          allInstanceData.forEach(instance => {
            if (!instance.isManuallyHidden) {
              box.expandByPoint(instance.position);
            }
          });
        }
      } else {
        box.expandByObject(object);
      }
    });
    return box;
  }

  public onWindowResize(): void {
    if (!this.canvas || !this.renderer || !this.activeCamera) return;
    const container = this.canvas.parentElement;
    if (!container) return;

    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;

    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
      if ('aspect' in this.activeCamera) {
        this.activeCamera.aspect = newWidth / newHeight;
      }
      this.activeCamera.updateProjectionMatrix();

      this.renderer.setSize(newWidth, newHeight);
      this.composer.setSize(newWidth, newHeight);
      this.bloomComposer.setSize(newWidth, newHeight);

      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    }
  }

  public frameScene(sceneWidth: number, sceneHeight: number): void {
    if (!this.activeCamera || !this.controls || !('fov' in this.activeCamera)) return;

    const fovRad = THREE.MathUtils.degToRad(this.activeCamera.fov);
    const effectiveHeight = Math.max(sceneHeight, sceneWidth / this.activeCamera.aspect);
    const distance = (effectiveHeight / 2) / Math.tan(fovRad / 2);
    const finalZ = distance * 1.2;

    this.activeCamera.position.set(0, 0, finalZ);
    this.activeCamera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private _createCameras(width: number, height: number): void {
    const nearPlane = 0.1;
    const farPlane = 1e14; 
    const aspect = width / height;

    this.editorCamera = new THREE.PerspectiveCamera(50, aspect, nearPlane, farPlane);
    this.editorCamera.position.set(0, 50, 50_000_000_000);
    this.editorCamera.lookAt(0, 0, 0);
    this.editorCamera.name = 'Cámara del Editor';
    this.editorCamera.userData = { apiType: 'camera', originalNear: nearPlane, originalFar: farPlane };

    this.secondaryCamera = new THREE.PerspectiveCamera(50, aspect, nearPlane, farPlane);
    this.secondaryCamera.name = 'Cámara Secundaria';
    this.secondaryCamera.userData = { apiType: 'camera', initialOffset: new THREE.Vector3(0, 4, 15) };

    const editorCameraHelper = new THREE.CameraHelper(this.editorCamera);
    editorCameraHelper.name = `${this.editorCamera.name}_helper`;
    this.editorCamera.userData['helper'] = editorCameraHelper;
    editorCameraHelper.visible = false;

    const secondaryCameraHelper = new THREE.CameraHelper(this.secondaryCamera);
    secondaryCameraHelper.name = `${this.secondaryCamera.name}_helper`;
    this.secondaryCamera.userData['helper'] = secondaryCameraHelper;
    secondaryCameraHelper.visible = true;

    this.scene.add(this.editorCamera, this.secondaryCamera, editorCameraHelper, secondaryCameraHelper);
    console.log(`[SceneManager] Cámaras creadas. Far plane ajustado a: ${farPlane}`);
  }

  private _createRendererAndComposer(width: number, height: number): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      precision: 'highp',
      logarithmicDepthBuffer: true
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const renderPass = new RenderPass(this.scene, this.activeCamera);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.0, 0.6, 0.85);

    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderPass);
    this.bloomComposer.addPass(this.bloomPass);

    this.finalPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }
        `,
        fragmentShader: `
          uniform sampler2D baseTexture;
          uniform sampler2D bloomTexture;
          varying vec2 vUv;
          void main() {
            gl_FragColor = ( texture2D( baseTexture, vUv ) + vec4( 1.0 ) * texture2D( bloomTexture, vUv ) );
          }
        `
      }), 'baseTexture'
    );
    this.finalPass.needsSwap = true;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.finalPass);
    console.log("[SceneManager] Renderer y Composer creados con logarithmicDepthBuffer activado.");
  }
}