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

  private normalPixelRatio: number = 1;

  constructor() {}

  public setupBasicScene(canvas: HTMLCanvasElement): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x282c34);

    this.editorCamera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 2000);
    this.editorCamera.name = 'Cámara del Editor';
    this.editorCamera.position.set(10, 10, 15);
    this.scene.add(this.editorCamera);

    // Configuración del renderizador optimizado
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: false, 
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.LinearToneMapping; 
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = false;
    
    this.normalPixelRatio = Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(this.normalPixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Pivote de enfoque
    this.focusPivot = new THREE.Object3D();
    this.focusPivot.name = "FocusPivot";
    this.scene.add(this.focusPivot);

    // Centralizamos la creación de todas las guías visuales en un método.
    this.setupEditorGuides();
  }

  /**
   * Lógica: Este método crea y añade a la escena los elementos visuales de ayuda
   * del editor, como la rejilla y las líneas de los ejes.
   * Esto mantiene el método setupBasicScene más limpio y organizado.
   */
  private setupEditorGuides(): void {
    const gridSize = 100;
    const gridDivisions = 100;

    // 1. Rejilla del Suelo
    const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0xffffff, 0x444444);
    gridHelper.name = "EditorGrid";
    this.scene.add(gridHelper);

    // 2. Líneas de Ejes Manuales
    
    // Línea del Eje X (rojo) que cruza toda la rejilla
    const pointsX = [
      new THREE.Vector3(-gridSize / 2, 0, 0),
      new THREE.Vector3(gridSize / 2, 0, 0)
    ];
    const geometryX = new THREE.BufferGeometry().setFromPoints(pointsX);
    const materialX = new THREE.LineBasicMaterial({
      color: 0xff4d4d,
      depthTest: false
    });
    const lineX = new THREE.Line(geometryX, materialX);
    lineX.renderOrder = 1;
    this.scene.add(lineX);

    // Línea del Eje Z (azul) que cruza toda la rejilla
    const pointsZ = [
      new THREE.Vector3(0, 0, -gridSize / 2),
      new THREE.Vector3(0, 0, gridSize / 2)
    ];
    const geometryZ = new THREE.BufferGeometry().setFromPoints(pointsZ);
    const materialZ = new THREE.LineBasicMaterial({
      color: 0x4d4dff,
      depthTest: false
    });
    const lineZ = new THREE.Line(geometryZ, materialZ);
    lineZ.renderOrder = 1;
    this.scene.add(lineZ);

    // 3. === CAMBIO CLAVE: AÑADIMOS LA LÍNEA DEL EJE Y POSITIVO ===
    // Línea del Eje Y (verde) que va hacia arriba desde el origen.
    const pointsY = [
      new THREE.Vector3(0, 0, 0),                  // Punto inicial en el origen
      new THREE.Vector3(0, gridSize / 2, 0)       // Punto final en Y positivo
    ];
    const geometryY = new THREE.BufferGeometry().setFromPoints(pointsY);
    const materialY = new THREE.LineBasicMaterial({
      color: 0x4dff4d, // Un verde brillante
      depthTest: false // Asegura que la línea sea siempre visible
    });
    const lineY = new THREE.Line(geometryY, materialY);
    lineY.renderOrder = 1; // Renderizar encima de la rejilla
    this.scene.add(lineY);
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

  public setLowQualityRender(): void {
    this.renderer.setPixelRatio(this.normalPixelRatio * 0.5);
  }

  public setNormalQualityRender(): void {
    this.renderer.setPixelRatio(this.normalPixelRatio);
  }
}