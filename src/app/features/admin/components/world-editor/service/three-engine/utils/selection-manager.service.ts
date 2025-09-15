// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/selection-manager.service.ts
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
  private hoverOutlinePass!: OutlinePass;   // <-- NUEVO para el aro azul
  private selectOutlinePass!: OutlinePass;  // <-- Antes se llamaba outlinePass
  
  public init(scene: THREE.Scene, camera: THREE.Camera, initialSize: THREE.Vector2): void {
    // --- Configuración del pase de PRE-SELECCIÓN (Hover - Azul) ---
    this.hoverOutlinePass = new OutlinePass(initialSize, scene, camera);
    this.hoverOutlinePass.pulsePeriod = 0;
    this.hoverOutlinePass.visibleEdgeColor.set('#00aaff'); // Color azul
    this.hoverOutlinePass.hiddenEdgeColor.set('#00aaff');
    this.hoverOutlinePass.enabled = false; // Empieza desactivado

    // --- Configuración del pase de SELECCIÓN (Click - Amarillo) ---
    this.selectOutlinePass = new OutlinePass(initialSize, scene, camera);
    this.selectOutlinePass.pulsePeriod = 0;
    this.selectOutlinePass.visibleEdgeColor.set('#ffff00'); // Color amarillo
    this.selectOutlinePass.hiddenEdgeColor.set('#ffff00');
    this.selectOutlinePass.enabled = false; // Empieza desactivado

    this.updateOutlineParameters('perspective');
  }

  // Devuelve ambos pases para que el SceneManager los añada
  public getPasses(): OutlinePass[] {
    return [this.hoverOutlinePass, this.selectOutlinePass];
  }
  
  public updateOutlineParameters(mode: CameraMode): void {
    if (!this.hoverOutlinePass || !this.selectOutlinePass) return;
    
    const params = mode === 'orthographic' ? ORTHOGRAPHIC_PARAMS : PERSPECTIVE_PARAMS;
    
    // Aplicar a ambos pases
    [this.hoverOutlinePass, this.selectOutlinePass].forEach(pass => {
        pass.edgeStrength = params.edgeStrength;
        pass.edgeGlow = params.edgeGlow;
        pass.edgeThickness = params.edgeThickness;
    });
  }

  // --- NUEVA Lógica para Preseleccionar (Hover) ---
  public setHoveredObjects(objects: THREE.Object3D[]): void {
    if (!this.hoverOutlinePass) return;
    // No mostrar hover azul si el objeto ya está seleccionado en amarillo
    const currentlySelectedUuid = this.selectOutlinePass.selectedObjects[0]?.uuid;
    const isHoveringSelected = objects.length > 0 && objects[0].uuid === currentlySelectedUuid;
    
    if (objects.length > 0 && !isHoveringSelected) {
      this.hoverOutlinePass.selectedObjects = objects;
      this.hoverOutlinePass.enabled = true;
    } else {
      this.hoverOutlinePass.selectedObjects = [];
      this.hoverOutlinePass.enabled = false;
    }
  }

  // --- Lógica ACTUALIZADA para Seleccionar (Click) ---
  public setSelectedObjects(objects: THREE.Object3D[]): void {
    if (!this.selectOutlinePass) return;

    // Si seleccionamos algo, quitamos el hover azul
    if (objects.length > 0) {
      this.setHoveredObjects([]);
    }

    this.selectOutlinePass.selectedObjects = objects;
    this.selectOutlinePass.enabled = objects.length > 0;
  }
  
  public setCamera(camera: THREE.Camera): void {
    if (this.hoverOutlinePass) this.hoverOutlinePass.renderCamera = camera;
    if (this.selectOutlinePass) this.selectOutlinePass.renderCamera = camera;
  }

  public setSize(width: number, height: number): void {
    if (this.hoverOutlinePass) this.hoverOutlinePass.setSize(width, height);
    if (this.selectOutlinePass) this.selectOutlinePass.setSize(width, height);
  }
}