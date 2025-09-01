// src/app/features/admin/components/world-editor/service/three-engine/utils/selection-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';

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

    // =================================================================================
    // === MEJORA CLAVE VISUAL: Parámetros ajustados para un color amarillo intenso   ===
    // =================================================================================
    this.outlinePass.edgeStrength = 10.0;     // Borde muy fuerte y sólido.
    this.outlinePass.edgeGlow = 1.0;          // Resplandor del borde al máximo para un efecto "vivo".
    this.outlinePass.edgeThickness = 2.5;     // Un grosor de línea notable.
    this.outlinePass.pulsePeriod = 0;
    this.outlinePass.visibleEdgeColor.set('#ffff00'); // Mantenemos el amarillo puro
    this.outlinePass.hiddenEdgeColor.set('#444400');
  }

  public getPass(): OutlinePass {
    return this.outlinePass;
  }

  public selectObjects(objects: THREE.Object3D[]): void {
    if (this.outlinePass) {
      this.outlinePass.selectedObjects = objects;
    }
  }
}