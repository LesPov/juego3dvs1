// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/scene-manager.service.ts
import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CelestialInstanceData } from './object-manager.service';

const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';
// ✅ MODIFICADO: Ya NO ocultamos las cámaras principales para que puedan ser seleccionadas
const UNSELECTABLE_NAMES = ['Luz Ambiental', 'EditorGrid', 'SelectionProxy', 'FocusPivot'];

@Injectable({ providedIn: 'root' })
export class SceneManagerService {
  public scene!: THREE.Scene;
  
  public activeCamera!: THREE.PerspectiveCamera;
  public editorCameraOriginal!: THREE.PerspectiveCamera;
  public mainCamera!: THREE.PerspectiveCamera; 

  public renderer!: THREE.WebGLRenderer;
  public composer!: EffectComposer;
  public canvas!: HTMLCanvasElement;
  private controls!: OrbitControls;
  public bloomPass!: UnrealBloomPass;

  constructor() { }

  public setupBasicScene(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    const container = this.canvas.parentElement;
    if (!container) {
      console.error("El canvas debe estar dentro de un contenedor para medir las dimensiones.");
      return;
    }

    const width = container.clientWidth;
    const height = container.clientHeight;

    // ✨ ¡MEJORA IMPORTANTE! Reducimos el 'near' plane para poder acercarnos mucho a los objetos.
    const nearPlane = 0.1;
    const farPlane = 500000000000;

    this.editorCameraOriginal = new THREE.PerspectiveCamera(50, width / height, nearPlane, farPlane);
    this.editorCameraOriginal.position.set(0, 50, 150);
    this.editorCameraOriginal.lookAt(0, 0, 0);
    this.editorCameraOriginal.name = 'Cámara del Editor';
    // ✅ MODIFICADO: Añadimos 'apiType' para que aparezca en la lista de entidades
    this.editorCameraOriginal.userData['apiType'] = 'camera'; 
    
    this.mainCamera = new THREE.PerspectiveCamera(50, width / height, nearPlane, farPlane);
    this.mainCamera.position.set(50, 50, 150);
    this.mainCamera.lookAt(0, 0, 0);
    this.mainCamera.name = 'Cámara Principal';
    this.mainCamera.userData['apiType'] = 'camera';
    
    const editorCameraHelper = new THREE.CameraHelper(this.editorCameraOriginal);
    editorCameraHelper.name = `${this.editorCameraOriginal.name}_helper`;
    this.editorCameraOriginal.userData['helper'] = editorCameraHelper;
    editorCameraHelper.visible = false;
    
    const mainCameraHelper = new THREE.CameraHelper(this.mainCamera);
    mainCameraHelper.name = `${this.mainCamera.name}_helper`;
    this.mainCamera.userData['helper'] = mainCameraHelper;
    mainCameraHelper.visible = true;
    
    this.scene.add(this.editorCameraOriginal, editorCameraHelper, this.mainCamera, mainCameraHelper);
    
    this.activeCamera = this.editorCameraOriginal;

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
    
    const renderPass = new RenderPass(this.scene, this.activeCamera);
    
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 2.5, 0.6, 0.1);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
  }

  public setControls(controls: OrbitControls): void {
    this.controls = controls;
  }

  public getSceneBoundingBox(): THREE.Box3 {
    const box = new THREE.Box3();
    if (!this.scene) return box;

    this.scene.children.forEach(object => {
      // ✅ MODIFICADO: La lógica ahora solo ignora los objetos no seleccionables por su nombre
      if (!object.visible || UNSELECTABLE_NAMES.includes(object.name) || object.name.endsWith('_helper')) {
        return;
      }
      
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        const allInstanceData: CelestialInstanceData[] = object.userData["celestialData"];
        if (allInstanceData) {
          allInstanceData.forEach(instance => {
            box.expandByPoint(instance.position);
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

  public frameScene(sceneWidth: number, sceneHeight: number): void {
    if (!this.activeCamera || !this.controls) return;

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