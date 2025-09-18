// src/app/features/admin/views/world-editor/world-view/service/three-engine/managers/scene-manager.service.ts

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

/** Prefijo para identificar los `InstancedMesh` de objetos celestes. */
const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';

/** Nombres de objetos que deben ser ignorados en cálculos como el `getBoundingBox`. */
const UNSELECTABLE_NAMES = ['Luz Ambiental', 'EditorGrid', 'SelectionProxy', 'HoverProxy', 'FocusPivot'];


/**
 * @class SceneManagerService
 * @description
 * Este servicio es el **fundamento del entorno 3D**. Su responsabilidad principal es crear y
 * configurar los componentes esenciales de Three.js: la escena, el renderizador, las cámaras
 * iniciales y el compositor de post-procesamiento.
 *
 * Actúa como un contenedor central para estos objetos base, permitiendo que otros servicios
 * accedan a ellos de manera consistente.
 */
@Injectable({ providedIn: 'root' })
export class SceneManagerService {

  // ====================================================================
  // PROPIEDADES PÚBLICAS (Componentes base de Three.js)
  // ====================================================================

  public scene!: THREE.Scene;
  public renderer!: THREE.WebGLRenderer;
  public composer!: EffectComposer;
  public canvas!: HTMLCanvasElement;
  
  public activeCamera!: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  public editorCamera!: THREE.PerspectiveCamera;
  public secondaryCamera!: THREE.PerspectiveCamera; 
  
  public bloomPass!: UnrealBloomPass;
  
  // <<< [NUEVO] Compositor dedicado exclusivamente a calcular el efecto de bloom
  public bloomComposer!: EffectComposer;
  private finalPass!: ShaderPass;

  // ====================================================================
  // ESTADO INTERNO
  // ====================================================================

  private controls!: OrbitControls;

  // ====================================================================
  // INICIALIZACIÓN
  // ====================================================================
  
  /**
   * Configura la escena básica de Three.js. Es el punto de entrada para crear el entorno de renderizado.
   * @param canvas - El elemento `<canvas>` del DOM donde se dibujará la escena.
   */
  public setupBasicScene(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const container = this.canvas.parentElement;
    if (!container) {
      console.error("El canvas debe estar dentro de un contenedor para medir las dimensiones.");
      return;
    }
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Crear la escena y la luz ambiental
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    ambientLight.name = "Luz Ambiental";
    this.scene.add(ambientLight);

    // 2. Crear y configurar las cámaras
    this._createCameras(width, height);
    this.activeCamera = this.editorCamera;

    // 3. Crear y configurar el renderizador y el compositor de post-procesado
    this._createRendererAndComposer(width, height);
  }
  
  // ====================================================================
  // API PÚBLICA
  // ====================================================================

  /**
   * Asigna la instancia de `OrbitControls` para poder usarla internamente.
   * @param controls - La instancia de `OrbitControls` creada por `ControlsManagerService`.
   */
  public setControls(controls: OrbitControls): void { 
    this.controls = controls; 
  }

  /**
   * Calcula la caja delimitadora (bounding box) que contiene todos los objetos visibles de la escena.
   * Es crucial para funcionalidades como "Encuadrar Escena" (`frameScene`).
   * @returns Un `THREE.Box3` que representa los límites de la escena.
   */
  public getSceneBoundingBox(): THREE.Box3 {
    const box = new THREE.Box3();
    if (!this.scene) return box;

    this.scene.children.forEach(object => {
      // Ignora objetos invisibles, helpers y otros objetos de sistema
      if (!object.visible || UNSELECTABLE_NAMES.includes(object.name) || object.name.endsWith('_helper')) {
        return;
      }
      // Manejo especial para objetos instanciados: itera sobre sus datos de posición
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        const allInstanceData: CelestialInstanceData[] = object.userData["celestialData"];
        if (allInstanceData) {
          allInstanceData.forEach(instance => { 
            // Solo incluye instancias que no están ocultas manualmente
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

  /**
   * Maneja el evento de redimensionamiento de la ventana para ajustar la cámara,
   * el renderizador y el compositor al nuevo tamaño.
   */
  public onWindowResize(): void {
    if (!this.canvas || !this.renderer || !this.activeCamera) return;
    const container = this.canvas.parentElement;
    if (!container) return;
    
    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;

    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
      // Actualiza el aspect ratio de la cámara si es de perspectiva
      if ('aspect' in this.activeCamera) {
          this.activeCamera.aspect = newWidth / newHeight;
      }
      this.activeCamera.updateProjectionMatrix();

      // Ajusta el tamaño del renderizador y el compositor
      this.renderer.setSize(newWidth, newHeight);
      this.composer.setSize(newWidth, newHeight);
      this.bloomComposer.setSize(newWidth, newHeight); // <<< [NUEVO]
      
      // Ajusta el pixel ratio para mantener la nitidez en pantallas de alta densidad
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    }
  }

  /**
   * Ajusta la cámara para encuadrar un área de un tamaño específico.
   * @deprecated Esta función parece específica y podría ser reemplazada por `CameraManager.frameScene`.
   * @param sceneWidth - El ancho del área a encuadrar.
   * @param sceneHeight - La altura del área a encuadrar.
   */
  public frameScene(sceneWidth: number, sceneHeight: number): void {
    if (!this.activeCamera || !this.controls || !('fov' in this.activeCamera)) return;
    
    const fovRad = THREE.MathUtils.degToRad(this.activeCamera.fov);
    const effectiveHeight = Math.max(sceneHeight, sceneWidth / this.activeCamera.aspect);
    const distance = (effectiveHeight / 2) / Math.tan(fovRad / 2);
    const finalZ = distance * 1.2; // Añade un pequeño margen
    
    this.activeCamera.position.set(0, 0, finalZ);
    this.activeCamera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
  
  // ====================================================================
  // MÉTODOS PRIVADOS DE CONFIGURACIÓN
  // ====================================================================

  /**
   * @internal Crea y configura la cámara principal del editor y la cámara secundaria.
   * @param width - Ancho inicial del canvas.
   * @param height - Alto inicial del canvas.
   */
  private _createCameras(width: number, height: number): void {
    const nearPlane = 0.1;
    const farPlane = 5e11; // 500,000,000,000
    const aspect = width / height;

    // Cámara principal del editor
    this.editorCamera = new THREE.PerspectiveCamera(50, aspect, nearPlane, farPlane);
    this.editorCamera.position.set(0, 50, 15_000_000_000); // 15 Billones
    this.editorCamera.lookAt(0, 0, 0);
    this.editorCamera.name = 'Cámara del Editor';
    this.editorCamera.userData = { apiType: 'camera', originalNear: nearPlane, originalFar: farPlane };
    
    // Cámara secundaria
    this.secondaryCamera = new THREE.PerspectiveCamera(50, aspect, nearPlane, farPlane);
    this.secondaryCamera.name = 'Cámara Secundaria';
    this.secondaryCamera.userData = { apiType: 'camera', initialOffset: new THREE.Vector3(0, 4, 15) };
    
    // Helpers visuales para las cámaras
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

  /**
   * @internal Crea y configura el WebGLRenderer y el EffectComposer para post-procesado.
   * @param width - Ancho inicial del canvas.
   * @param height - Alto inicial del canvas.
   */
  private _createRendererAndComposer(width: number, height: number): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      precision: 'highp'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // --- [NUEVA LÓGICA DE COMPOSITORES] ---

    // 1. Pase de renderizado base, que se usará en ambos compositores.
    const renderPass = new RenderPass(this.scene, this.activeCamera);

    // 2. Pase de Bloom
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.0, 0.6, 0.85);

    // 3. Compositor para el Bloom (renderiza a una textura, no a la pantalla)
    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderPass);
    this.bloomComposer.addPass(this.bloomPass);

    // 4. Pase final que mezcla la escena base con la escena con bloom
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

    // 5. Compositor final (renderiza a la pantalla)
    // Este compositor renderizará la escena principal y luego la mezclará con el resultado del bloomComposer
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.finalPass);
    
    // Los pases de Outline del SelectionManager se añadirán a ESTE composer en EngineService.
  }
}