// src/app/features/admin/components/world-editor/service/three-engine/utils/scene-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';

@Injectable({
  providedIn: 'root'
})
export class SceneManagerService {
  public scene!: THREE.Scene;
  public renderer!: THREE.WebGLRenderer;
  public editorCamera!: THREE.PerspectiveCamera;
  public focusPivot!: THREE.Object3D;
  public gridHelper!: THREE.GridHelper;

  private normalPixelRatio: number = 1;

  constructor() {}

  public setupBasicScene(canvas: HTMLCanvasElement): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x282c34);

    this.editorCamera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 2000);
    this.editorCamera.name = 'Cámara del Editor';
    this.editorCamera.position.set(10, 10, 15);
    this.scene.add(this.editorCamera);

    // Lógica: "Rendimiento Máximo". Configuramos todo para que sea lo más rápido posible.
    // === CONFIGURACIÓN DE RENDERIZADO SIN SOMBRAS ===
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: false, 
      powerPreference: 'high-performance'
    });

    // Mapeo de tonos simple y rápido.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.LinearToneMapping; 
    this.renderer.toneMappingExposure = 1.0;

    // === CAMBIO CLAVE: DESACTIVAMOS COMPLETAMENTE LAS SOMBRAS ===
    // Esto le dice al renderizador que ignore cualquier cálculo de sombras.
    // Es la mayor ganancia de FPS que podemos tener.
    this.renderer.shadowMap.enabled = false;
    
    // Guardamos el pixel ratio normal y lo aplicamos.
    this.normalPixelRatio = Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(this.normalPixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    this.focusPivot = new THREE.Object3D();
    this.focusPivot.name = "FocusPivot";
    this.scene.add(this.focusPivot);

    this.gridHelper = new THREE.GridHelper(100, 100, 0x888888, 0x444444);
    this.gridHelper.name = "EditorGrid";
    this.scene.add(this.gridHelper);
  }

  public onWindowResize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      this.editorCamera.aspect = width / height;
      this.editorCamera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    }
  }

  // Lógica: Estos métodos siguen siendo útiles para la resolución dinámica,
  // lo que asegura una navegación fluida en escenas muy complejas.
  public setLowQualityRender(): void {
    this.renderer.setPixelRatio(this.normalPixelRatio * 0.5);
  }

  public setNormalQualityRender(): void {
    this.renderer.setPixelRatio(this.normalPixelRatio);
  }
}