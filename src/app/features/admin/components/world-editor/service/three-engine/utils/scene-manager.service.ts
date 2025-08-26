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
    this.scene.background = new THREE.Color(0x000000);

    // --- CAMBIO CLAVE: Aumentamos la distancia de visión de la cámara ---
    // El último parámetro, 'far', controla hasta qué distancia puede ver la cámara.
    // Estaba en 2000, lo que podía ser corto para escenas grandes.
    // Lo aumentamos a un valor muy alto (10000) para que prácticamente nunca
    // los objetos desaparezcan por estar demasiado lejos.
    this.editorCamera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 10000);
    this.editorCamera.name = 'Cámara del Editor';
    this.editorCamera.position.set(10, 10, 15);
    this.scene.add(this.editorCamera);

    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; 
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    this.normalPixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this.normalPixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    this.focusPivot = new THREE.Object3D();
    this.focusPivot.name = "FocusPivot";
    this.scene.add(this.focusPivot);

    this.setupEditorGuides();
  }

  private setupEditorGuides(): void {
    const gridSize = 100;
    const gridDivisions = 100;

    const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x888888, 0x444444);
    gridHelper.name = "EditorGrid";
    this.scene.add(gridHelper);

    const pointsX = [ new THREE.Vector3(-gridSize / 2, 0, 0), new THREE.Vector3(gridSize / 2, 0, 0) ];
    const lineX = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pointsX), new THREE.LineBasicMaterial({ color: 0xff4d4d, depthTest: false }));
    lineX.renderOrder = 1;
    this.scene.add(lineX);

    const pointsZ = [ new THREE.Vector3(0, 0, -gridSize / 2), new THREE.Vector3(0, 0, gridSize / 2) ];
    const lineZ = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pointsZ), new THREE.LineBasicMaterial({ color: 0x4d4dff, depthTest: false }));
    lineZ.renderOrder = 1;
    this.scene.add(lineZ);

    const pointsY = [ new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, gridSize / 2, 0) ];
    const lineY = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pointsY), new THREE.LineBasicMaterial({ color: 0x4dff4d, depthTest: false }));
    lineY.renderOrder = 1;
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