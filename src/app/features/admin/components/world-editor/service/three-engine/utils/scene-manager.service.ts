// RUTA: src/app/features/admin/views/world-editor/world-editor/service/three-engine/utils/scene-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CelestialInstanceData } from './object-manager.service';

const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';
const UNSELECTABLE_NAMES = ['Cámara del Editor', 'Luz Ambiental', 'EditorGrid', 'SelectionProxy', 'FocusPivot'];

@Injectable({ providedIn: 'root' })
export class SceneManagerService {
  public scene!: THREE.Scene;
  public editorCamera!: THREE.PerspectiveCamera;
  public renderer!: THREE.WebGLRenderer;
  public composer!: EffectComposer;
  private canvas!: HTMLCanvasElement;
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

    this.editorCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 500_000_000_000);
    this.editorCamera.position.set(0, 50, 150);
    this.editorCamera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      precision: 'highp' // ✅ MEJORA: Solicita máxima precisión para shaders.
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    const renderPass = new RenderPass(this.scene, this.editorCamera);
    
    // ✅ MEJORA: Parámetros del efecto Bloom para un brillo atractivo.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 
      1.2, // strength: Qué tan intenso es el brillo.
      0.6, // radius: Qué tan difuminado es el brillo.
      0.1  // threshold: Qué tan brillante debe ser algo para empezar a brillar.
    );

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
  }

  // --- MÉTODOS RESTANTES (SIN CAMBIOS) ---
  public setControls(controls: OrbitControls): void { this.controls = controls; }
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
    if (!this.canvas || !this.renderer || !this.editorCamera) return;
    const container = this.canvas.parentElement;
    if (!container) return;

    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;

    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
      this.editorCamera.aspect = newWidth / newHeight;
      this.editorCamera.updateProjectionMatrix();

      this.renderer.setSize(newWidth, newHeight);
      this.composer.setSize(newWidth, newHeight);
      if (this.bloomPass) {
        this.bloomPass.setSize(newWidth, newHeight);
      }
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
  }
  public frameScene(sceneWidth: number, sceneHeight: number): void {
    if (!this.editorCamera || !this.controls) return;
    const fovRad = THREE.MathUtils.degToRad(this.editorCamera.fov);
    const effectiveHeight = Math.max(sceneHeight, sceneWidth / this.editorCamera.aspect);
    const distance = (effectiveHeight / 2) / Math.tan(fovRad / 2);
    const finalZ = distance * 1.2;
    this.editorCamera.position.set(0, 0, finalZ);
    this.editorCamera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
}