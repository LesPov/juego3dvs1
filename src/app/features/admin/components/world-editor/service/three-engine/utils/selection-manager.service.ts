// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/selection-manager.service.ts
import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { CameraMode } from '../engine.service'; // Importamos el tipo

const PERSPECTIVE_PARAMS = {
  edgeStrength: 10.0,
  edgeGlow: 1.0,
  edgeThickness: 3.5,
};

const ORTHOGRAPHIC_PARAMS = {
  edgeStrength: 20.0,
  edgeGlow: 5.5,
  edgeThickness: 8.0,
};

@Injectable({
  providedIn: 'root'
})
export class SelectionManagerService {
  private outlinePass!: OutlinePass;

  constructor() {}

  public init(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.outlinePass = new OutlinePass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      scene,
      camera
    );

    this.outlinePass.pulsePeriod = 0;
    this.outlinePass.visibleEdgeColor.set('#ffff00');
    this.outlinePass.hiddenEdgeColor.set('#444400');
    
    this.updateOutlineParameters('perspective');
  }

  public getPass(): OutlinePass {
    return this.outlinePass;
  }
  
  public updateOutlineParameters(mode: CameraMode): void {
    if (!this.outlinePass) return;
    const params = mode === 'orthographic' ? ORTHOGRAPHIC_PARAMS : PERSPECTIVE_PARAMS;
    
    this.outlinePass.edgeStrength = params.edgeStrength;
    this.outlinePass.edgeGlow = params.edgeGlow;
    this.outlinePass.edgeThickness = params.edgeThickness;
  }

  public selectObjects(objects: THREE.Object3D[]): void {
    if (this.outlinePass) {
      this.outlinePass.selectedObjects = objects;
    }
  }
}