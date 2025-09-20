import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CelestialInstanceData } from './object-manager.service';

// ====================================================================
// CONSTANTES
// ====================================================================

const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';
const UNSELECTABLE_NAMES = ['Luz Ambiental', 'EditorGrid', 'SelectionProxy', 'HoverProxy', 'FocusPivot'];


/**
 * @class SceneManagerService
 * @description
 * Es el fundamento del entorno 3D. Su responsabilidad es crear y configurar los componentes
 * esenciales de Three.js: escena, renderizador, cámaras y compositor de post-procesamiento.
 */
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
      console.error("El canvas debe estar dentro de un contenedor para medir las dimensiones.");
      return;
    }
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x00042B);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    ambientLight.name = "Luz Ambiental";
    this.scene.add(ambientLight);

    this._createCameras(width, height);
    this.activeCamera = this.editorCamera;

    this._createRendererAndComposer(width, height);
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
  
  private _createCameras(width: number, height: number): void {
    const nearPlane = 0.1;
    const farPlane = 5e15; // Aumentamos el far plane para el logarithmic depth buffer
    const aspect = width / height;

    this.editorCamera = new THREE.PerspectiveCamera(50, aspect, nearPlane, farPlane);
    this.editorCamera.position.set(0, 50, 15_000_000_000);
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
  }

  private _createRendererAndComposer(width: number, height: number): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // El antialiasing a menudo se maneja en el post-procesamiento
      powerPreference: 'high-performance',
      precision: 'highp',
      // ================== SOLUCIÓN DEFINITIVA PARPADEO ==================
      // Activamos el buffer de profundidad logarítmico.
      // Esto resuelve los problemas de precisión (Z-fighting) en escenas de gran escala.
      logarithmicDepthBuffer: true
      // ================== FIN SOLUCIÓN PARPADEO ==================
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
  }
}