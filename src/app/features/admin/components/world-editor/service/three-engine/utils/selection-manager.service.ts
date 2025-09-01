import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { CameraMode } from '../engine.service'; // Importamos el tipo

// =================================================================================
// === MEJORA CLAVE 2D: Perfiles de estilo para el contorno de selección       ====
// =================================================================================
// Perfil estándar para la vista 3D. Fuerte pero estilizado.
const PERSPECTIVE_PARAMS = {
  edgeStrength: 10.0,
  edgeGlow: 1.0,
  edgeThickness: 3.5,
};

// Perfil "NITRO" para la vista 2D. Máximo grosor y fuerza para que sea imposible de ignorar.
const ORTHOGRAPHIC_PARAMS = {
  edgeStrength: 20.0,    // Borde extremadamente sólido y definido.
  edgeGlow: 5.5,         // Un resplandor potente para que el bloom lo capture bien.
  edgeThickness: 8.0,     // Una línea muy gruesa e inconfundible.
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