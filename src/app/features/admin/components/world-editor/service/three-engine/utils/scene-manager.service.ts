// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/scene-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CelestialInstanceData } from './object-manager.service';

const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';
const UNSELECTABLE_NAMES = ['Luz Ambiental', 'EditorGrid', 'SelectionProxy', 'FocusPivot'];

@Injectable({ providedIn: 'root' })
export class SceneManagerService {

  // ====================================================================
  // SECTION: Public Properties
  // ====================================================================
  // Propiedades públicas que definen los componentes esenciales de la escena.

  public scene!: THREE.Scene;
  
  public activeCamera!: THREE.PerspectiveCamera;
  public editorCamera!: THREE.PerspectiveCamera;
  public secondaryCamera!: THREE.PerspectiveCamera; 

  public renderer!: THREE.WebGLRenderer;
  public composer!: EffectComposer;
  public bloomPass!: UnrealBloomPass;
  public canvas!: HTMLCanvasElement;
  private controls!: OrbitControls;

  // ====================================================================
  // SECTION: Scene Setup
  // ====================================================================

  /**
   * Configura la escena básica de Three.js, incluyendo cámaras, renderizador y efectos de post-procesado.
   * @param canvas El elemento HTMLCanvasElement donde se renderizará la escena.
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

    // 1. Crear la Escena
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // 2. Configurar Cámaras
    const nearPlane = 0.1;
    const farPlane = 500000000000;

    // Cámara principal para la edición libre
    this.editorCamera = new THREE.PerspectiveCamera(50, width / height, nearPlane, farPlane);
    this.editorCamera.position.set(0, 50, 150);
    this.editorCamera.lookAt(0, 0, 0);
    this.editorCamera.name = 'Cámara del Editor';
    this.editorCamera.userData['apiType'] = 'camera'; 
    
    // Cámara secundaria (p.ej., para seguir a un objeto)
    this.secondaryCamera = new THREE.PerspectiveCamera(50, width / height, nearPlane, farPlane);
    this.secondaryCamera.name = 'Cámara Secundaria';
    this.secondaryCamera.userData['apiType'] = 'camera';
    // Se define una posición inicial relativa ("sobre el hombro") para un comportamiento predecible.
    const initialSecondaryCamOffset = new THREE.Vector3(0, 4, 15);
    this.secondaryCamera.userData['initialOffset'] = initialSecondaryCamOffset;
    
    // 3. Crear Helpers visuales para las cámaras
    const editorCameraHelper = new THREE.CameraHelper(this.editorCamera);
    editorCameraHelper.name = `${this.editorCamera.name}_helper`;
    this.editorCamera.userData['helper'] = editorCameraHelper;
    editorCameraHelper.visible = false; // El helper de la cámara activa está oculto
    
    const secondaryCameraHelper = new THREE.CameraHelper(this.secondaryCamera);
    secondaryCameraHelper.name = `${this.secondaryCamera.name}_helper`;
    this.secondaryCamera.userData['helper'] = secondaryCameraHelper;
    secondaryCameraHelper.visible = true; // El helper de la cámara inactiva es visible
    
    this.scene.add(this.editorCamera, this.secondaryCamera, editorCameraHelper, secondaryCameraHelper);
    this.activeCamera = this.editorCamera;

    // 4. Configurar el Renderizador
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      precision: 'highp'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // 5. Configurar el Post-Procesado (para efectos como el Bloom)
    const renderPass = new RenderPass(this.scene, this.activeCamera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 2.5, 0.6, 0.1);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
  }

  // ====================================================================
  // SECTION: Utility Methods
  // ====================================================================

  /**
   * Asigna los controles de órbita al manager.
   * @param controls Instancia de OrbitControls.
   */
  public setControls(controls: OrbitControls): void {
    this.controls = controls;
  }

  /**
   * Calcula la caja delimitadora (bounding box) que contiene todos los objetos visibles de la escena.
   * Es crucial para las funciones de "enfocar todo" y para calcular las vistas ortográficas.
   * @returns Un THREE.Box3 que representa los límites de la escena.
   */
  public getSceneBoundingBox(): THREE.Box3 {
    const box = new THREE.Box3();
    if (!this.scene) return box;

    this.scene.children.forEach(object => {
      // Ignora objetos invisibles, helpers y objetos especiales del editor
      if (!object.visible || UNSELECTABLE_NAMES.includes(object.name) || object.name.endsWith('_helper')) {
        return;
      }
      
      // Para objetos instanciados, calcula el bounding box a partir de sus datos de posición
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        const allInstanceData: CelestialInstanceData[] = object.userData["celestialData"];
        if (allInstanceData) {
          allInstanceData.forEach(instance => {
            box.expandByPoint(instance.position);
          });
        }
      } else {
        // Para objetos normales, usa el método estándar de Three.js
        box.expandByObject(object);
      }
    });

    return box;
  }

  /**
   * Maneja el redimensionamiento de la ventana del navegador para ajustar el aspect ratio de la cámara y el tamaño del renderer.
   */
  public onWindowResize(): void {
    if (!this.canvas || !this.renderer || !this.activeCamera) return;
    const container = this.canvas.parentElement;
    if (!container) return;

    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;

    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
      this.activeCamera.aspect = newWidth / newHeight;
      this.activeCamera.updateProjectionMatrix();

      this.renderer.setSize(newWidth, newHeight);
      this.composer.setSize(newWidth, newHeight);
      if (this.bloomPass) {
        this.bloomPass.setSize(newWidth, newHeight);
      }
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
  }

  /**
   * Ajusta la posición de la cámara para que toda la escena sea visible (función "Frame All").
   * @param sceneWidth Ancho efectivo de la escena.
   * @param sceneHeight Alto efectivo de la escena.
   */
  public frameScene(sceneWidth: number, sceneHeight: number): void {
    if (!this.activeCamera || !this.controls) return;

    const fovRad = THREE.MathUtils.degToRad(this.activeCamera.fov);
    const effectiveHeight = Math.max(sceneHeight, sceneWidth / this.activeCamera.aspect);
    const distance = (effectiveHeight / 2) / Math.tan(fovRad / 2);
    const finalZ = distance * 1.2; // Añade un pequeño margen

    this.activeCamera.position.set(0, 0, finalZ);
    this.activeCamera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
}