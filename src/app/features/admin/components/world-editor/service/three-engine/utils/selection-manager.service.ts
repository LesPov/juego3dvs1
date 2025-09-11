import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { CameraMode } from './camera-manager.service';
 
const PERSPECTIVE_PARAMS = {
  edgeStrength: 10.0,
  edgeGlow: 1.0, 
  edgeThickness: 2.5,
};

const ORTHOGRAPHIC_PARAMS = {
  edgeStrength: 25.0,
  edgeGlow: 1.5,
  edgeThickness: 5.0,
};

@Injectable({
  providedIn: 'root'
})
export class SelectionManagerService {
  private outlinePass!: OutlinePass;
  private overlayMaterial!: THREE.ShaderMaterial;

  constructor() {}

  public init(scene: THREE.Scene, camera: THREE.Camera): void {
    this.outlinePass = new OutlinePass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      scene,
      camera
    );

    this.outlinePass.pulsePeriod = 0;
    this.outlinePass.visibleEdgeColor.set('#ffff00');
    this.outlinePass.hiddenEdgeColor.set('#ffff00');
    
    // ✅ LÓGICA CLAVE: Hacemos que el borde se vea siempre.
    // Al desactivar la prueba de profundidad, el borde se dibujará por encima
    // de cualquier otro objeto, sin importar la distancia.
    this.overlayMaterial = (this.outlinePass as any).overlayMaterial;
    this.overlayMaterial.depthTest = false;
    this.overlayMaterial.depthWrite = false;

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
  
  public setCamera(camera: THREE.Camera): void {
    if (this.outlinePass) {
        this.outlinePass.renderCamera = camera;
    }
  }

  public setSize(width: number, height: number): void {
    if (this.outlinePass) {
      this.outlinePass.setSize(width, height);
    }
  }
}