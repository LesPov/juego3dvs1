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
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      precision: 'mediump',
      logarithmicDepthBuffer: true,
      stencil: false,
      depth: true
    });

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.capabilities.maxTextureSize = 2048;

    const renderPass = new RenderPass(this.scene, this.activeCamera);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width / 2, height / 2),
      0.5,
      0.75,
      0.3
    );

    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderPass);
    this.bloomComposer.addPass(this.bloomPass);

    this.finalPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
          brightness: { value: 2.5 }
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
          uniform float brightness;
          varying vec2 vUv;
          void main() {
            gl_FragColor = ( texture2D( baseTexture, vUv ) * brightness + vec4( 1.0 ) * texture2D( bloomTexture, vUv ) );
          }
        `
      }), 'baseTexture'
    );
    this.finalPass.needsSwap = true;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.finalPass);

    const pixelRatio = 1;
    this.bloomComposer.setSize(width * pixelRatio, height * pixelRatio);
    this.composer.setSize(width * pixelRatio, height * pixelRatio);

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
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this._createRendererAndComposer(width, height);
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
    this.scene.background = null;

    const ambientLight = new THREE.AmbientLight(0xffffff, 4.0);
    ambientLight.name = "Luz Ambiental";
    this.scene.add(ambientLight);

    this._createCameras(width, height);
    this.activeCamera = this.editorCamera;

    this._createRendererAndComposer(width, height);
    this.setupContextLossHandling();

    this.loadSceneBackground().catch(error => {
      console.error('[SceneManager] Error al cargar el fondo:', error);
    });
  }

  public loadSceneBackground(): Promise<void> {
    return new Promise((resolve, reject) => {
      const resizeImage = (image: HTMLImageElement): HTMLCanvasElement => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
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
        canvas.width = width;
        canvas.height = height;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, width, height);
        return canvas;
      };

      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          const canvas = resizeImage(img);
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.needsUpdate = true;

          if (this.scene) {
            const skySphereGeometry = new THREE.SphereGeometry(4e15, 32, 32);
            const skySphereMaterial = new THREE.MeshBasicMaterial({
              map: texture,
              side: THREE.BackSide,
              depthWrite: false,
              fog: false
            });

            const skySphere = new THREE.Mesh(skySphereGeometry, skySphereMaterial);
            skySphere.name = 'SkySphere';
            skySphere.renderOrder = -1;
            this.scene.add(skySphere);
            this.scene.environment = texture;
          }

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

  public frameScene(): void {
    if (!this.activeCamera || !this.controls) {
        console.warn('[SceneManager] No se puede encuadrar la escena: la cámara o los controles no están disponibles.');
        return;
    }

    const boundingBox = this.getSceneBoundingBox();

    if (boundingBox.isEmpty()) {
        console.warn('[SceneManager] No se puede encuadrar la escena: la escena está vacía o todos los objetos están ocultos.');
        return;
    }

    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());

    if (this.activeCamera instanceof THREE.PerspectiveCamera) {
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.activeCamera.fov * (Math.PI / 180);
        const distance = maxDim / (2 * Math.tan(fov / 2));

        const direction = new THREE.Vector3();
        this.activeCamera.getWorldDirection(direction);
        this.activeCamera.position.copy(center).sub(direction.multiplyScalar(distance * 1.5));

    } else if (this.activeCamera instanceof THREE.OrthographicCamera) {
        const orthoCam = this.activeCamera;
        const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        const padding = 1.2;

        const camDir = new THREE.Vector3();
        orthoCam.getWorldDirection(camDir);

        let worldWidth: number;
        let worldHeight: number;

        if (Math.abs(camDir.y) > 0.9) {
            worldWidth = size.x;
            worldHeight = size.z;
        } else if (Math.abs(camDir.x) > 0.9) {
            worldWidth = size.z;
            worldHeight = size.y;
        } else {
            worldWidth = size.x;
            worldHeight = size.y;
        }
        
        worldWidth *= padding;
        worldHeight *= padding;

        if (aspect >= worldWidth / worldHeight) {
            orthoCam.top = worldHeight / 2;
            orthoCam.bottom = -orthoCam.top;
            orthoCam.right = orthoCam.top * aspect;
            orthoCam.left = -orthoCam.right;
        } else {
            orthoCam.right = worldWidth / 2;
            orthoCam.left = -orthoCam.right;
            orthoCam.top = orthoCam.right / aspect;
            orthoCam.bottom = -orthoCam.top;
        }

        const camDistance = size.length();
        orthoCam.position.copy(center).add(camDir.multiplyScalar(camDistance));
        orthoCam.lookAt(center);
        orthoCam.updateProjectionMatrix();
    }

    this.controls.target.copy(center);
    this.controls.update();
  }
}