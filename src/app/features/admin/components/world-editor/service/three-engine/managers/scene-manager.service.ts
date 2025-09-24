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

  private _createCameras(width: number, height: number): void {
    const nearPlane = 0.1;
    const farPlane = 1e14;
    const aspect = width / height;

    this.editorCamera = new THREE.PerspectiveCamera(50, aspect, nearPlane, farPlane);
    this.editorCamera.position.set(0, 50, 300_000_000_000);
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
    // 1. Configuración optimizada del renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      precision: 'mediump',
      logarithmicDepthBuffer: true,
      stencil: false,
      depth: true
    });

    // Optimizaciones del renderer
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    // Reemplazar outputEncoding por outputColorSpace
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    // Limitar el tamaño máximo de texturas
    this.renderer.capabilities.maxTextureSize = 2048;

    // Configuración de passes más ligera
    const renderPass = new RenderPass(this.scene, this.activeCamera);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width / 2, height / 2), // Reducir resolución del bloom
      0.5,
      0.75,
      0.3
    );

    // Configurar composers con menor resolución
    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderPass);
    this.bloomComposer.addPass(this.bloomPass);

    // 5. Creamos el finalPass
    this.finalPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
          brightness: { value: 2.5 } // Valor inicial para ajustar la luminosidad
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
          uniform float brightness; // Declaramos el uniform de brillo
          varying vec2 vUv;
          void main() {
            gl_FragColor = ( texture2D( baseTexture, vUv ) * brightness + vec4( 1.0 ) * texture2D( bloomTexture, vUv ) );
          }
        `
      }), 'baseTexture'
    );
    this.finalPass.needsSwap = true;

    // 6. Inicializamos el composer principal
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.finalPass);

    // 7. Ajustamos los tamaños de los compositores
    const pixelRatio = 1;
    this.bloomComposer.setSize(width * pixelRatio, height * pixelRatio);
    this.composer.setSize(width * pixelRatio, height * pixelRatio);

    // Limpiar cualquier textura en caché
    THREE.Cache.clear();

    console.log("[SceneManager] Renderer y Composers inicializados correctamente");
  }

  private setupContextLossHandling(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      console.warn('[SceneManager] Contexto WebGL perdido - Intentando recuperar...');
      this.handleContextLoss();
    }, false);

    canvas.addEventListener('webglcontextrestored', () => {
      console.log('[SceneManager] Contexto WebGL restaurado - Reiniciando renderer...');
      this.handleContextRestore();
    }, false);
  }

  private handleContextLoss(): void {
    // Limpiar recursos
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(material => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      }
    });
  }

  private handleContextRestore(): void {
    // Reconfigurar el renderer y los composers
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this._createRendererAndComposer(width, height);

    // Recargar texturas y materiales
    this.loadSceneBackground().catch(console.error);
  }

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
    // Removemos el color de fondo por defecto ya que será reemplazado por la textura
    this.scene.background = null;

    const ambientLight = new THREE.AmbientLight(0xffffff, 4.0);
    ambientLight.name = "Luz Ambiental";
    this.scene.add(ambientLight);

    this._createCameras(width, height);
    this.activeCamera = this.editorCamera;

    // Importante: Creamos el renderer y los composers después de tener la escena y la cámara
    this._createRendererAndComposer(width, height);
    this.setupContextLossHandling(); // Añadir manejo de pérdida de contexto

    // Iniciamos la carga del fondo inmediatamente
    this.loadSceneBackground().catch(error => {
      console.error('[SceneManager] Error al cargar el fondo:', error);
    });
  }

  public loadSceneBackground(): Promise<void> {
    return new Promise((resolve, reject) => {
      const textureLoader = new THREE.TextureLoader();

      // Crear un canvas temporal para redimensionar la imagen
      const resizeImage = (image: HTMLImageElement): HTMLCanvasElement => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;

        // Calcular el nuevo tamaño manteniendo la proporción
        const maxSize = 2048;
        let width = image.width;
        let height = image.height;

        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }

        // Aplicar el nuevo tamaño al canvas
        canvas.width = width;
        canvas.height = height;

        // Usar algoritmo de suavizado para mejor calidad
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Dibujar la imagen redimensionada
        ctx.drawImage(image, 0, 0, width, height);

        return canvas;
      };

      // Cargar la imagen primero
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          // Redimensionar la imagen si es necesario
          const canvas = resizeImage(img);

          // Crear textura desde el canvas
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.needsUpdate = true;

          // Aplicar la textura a la escena
          if (this.scene) {
            this.scene.background = texture;
            this.scene.environment = texture;
          }

          // Ajustar el bloom para compensar el fondo
          if (this.bloomPass) {
            this.bloomPass.threshold = 0.85;
            this.bloomPass.strength = 0.75;
            this.bloomPass.radius = 0.65;
          }

          console.log('[SceneManager] Fondo cargado y optimizado correctamente');
          resolve();
        } catch (error) {
          console.error('[SceneManager] Error al procesar la textura:', error);
          this.scene.background = new THREE.Color(0x000215);
          reject(error);
        }
      };

      img.onerror = (error) => {
        console.error('[SceneManager] Error al cargar la imagen de fondo:', error);
        this.scene.background = new THREE.Color(0x000215);
        reject(error);
      };

      // Iniciar la carga de la imagen
      img.src = 'assets/textures/NightSky.jpg';
    });
  }

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
}