// src/app/features/admin/services/three-engine/camera-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';

// ¡NUEVO! Definimos un tipo de retorno para ser más claros.
export interface CameraWithHelper {
  camera: THREE.PerspectiveCamera;
  helper: THREE.CameraHelper;
}

@Injectable({
  providedIn: 'root'
})
export class CameraManagerService {

  constructor() { }

  public createCamera(
    aspectRatio: number,
    fieldOfView: number,
    nearClipping: number,
    farClipping: number
  ): CameraWithHelper { // <-- Retornamos el objeto CameraWithHelper
    const camera = new THREE.PerspectiveCamera(
      fieldOfView,
      aspectRatio,
      nearClipping,
      farClipping
    );
    camera.position.set(0, 5, 10);

    const cameraHelper = new THREE.CameraHelper(camera);
    cameraHelper.visible = false; 

    // Ya no adjuntamos el helper a la cámara.
    // Los mantenemos separados para un mejor control en la escena.
    return { camera, helper: cameraHelper };
  }
}