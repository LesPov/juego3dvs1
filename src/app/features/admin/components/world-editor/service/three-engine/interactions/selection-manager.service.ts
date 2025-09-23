// src/app/features/admin/views/world-editor/world-view/service/three-engine/interactions/selection-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { CameraMode } from '../managers/camera-manager.service';

// ====================================================================
// CONSTANTES DE ESTILO
// ====================================================================

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

  private hoverOutlinePass!: OutlinePass;
  private selectOutlinePass!: OutlinePass;

  public init(scene: THREE.Scene, camera: THREE.Camera, initialSize: THREE.Vector2): void {
    this.hoverOutlinePass = new OutlinePass(initialSize, scene, camera);
    this.hoverOutlinePass.pulsePeriod = 0;
    this.hoverOutlinePass.visibleEdgeColor.set('#00aaff');
    this.hoverOutlinePass.hiddenEdgeColor.set('#00aaff');
    this.hoverOutlinePass.enabled = false;

    this.selectOutlinePass = new OutlinePass(initialSize, scene, camera);
    this.selectOutlinePass.pulsePeriod = 0;
    this.selectOutlinePass.visibleEdgeColor.set('#ffff00');
    this.selectOutlinePass.hiddenEdgeColor.set('#ffff00');
    this.selectOutlinePass.enabled = false;

    this.updateOutlineParameters('perspective');
  }

  public getPasses(): OutlinePass[] {
    return [this.hoverOutlinePass, this.selectOutlinePass];
  }

  public updateOutlineParameters(mode: CameraMode): void {
    if (!this.hoverOutlinePass || !this.selectOutlinePass) return;

    const params = mode === 'orthographic' ? ORTHOGRAPHIC_PARAMS : PERSPECTIVE_PARAMS;

    [this.hoverOutlinePass, this.selectOutlinePass].forEach(pass => {
        pass.edgeStrength = params.edgeStrength;
        pass.edgeGlow = params.edgeGlow;
        pass.edgeThickness = params.edgeThickness;
    });
  }

  public setHoveredObjects(objects: THREE.Object3D[]): void {
    if (!this.hoverOutlinePass) return;

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

  public setSelectedObjects(objects: THREE.Object3D[]): void {
    if (!this.selectOutlinePass) return;

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

  /**
   * ✨ NUEVO MÉTODO PÚBLICO ✨
   * Comprueba si un objeto con un UUID específico está actualmente seleccionado.
   * @param uuid - El UUID del objeto a comprobar.
   * @returns `true` si el objeto está en la lista de selección, `false` en caso contrario.
   */
  public isObjectSelected(uuid: string): boolean {
      if (!this.selectOutlinePass || this.selectOutlinePass.selectedObjects.length === 0) {
          return false;
      }
      return this.selectOutlinePass.selectedObjects[0].uuid === uuid;
  }
}