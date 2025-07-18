// src/app/features/admin/services/three-engine/light-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';

@Injectable({
  providedIn: 'root'
})
export class LightManagerService {
  constructor() { }

  /**
   * Ahora solo añadimos una iluminación ambiental básica.
   * Las demás luces las crearás tú con tus objetos de tipo 'directionalLight', 'pointLight', etc.
   */
  public addLightsToScene(scene: THREE.Scene): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    ambient.name = 'Luz Ambiental';
    scene.add(ambient);

    // ¡Luz direccional por defecto QUITADA!
    // Si quieres poner otra por defecto, hazlo desde tu editor como un objeto más.
  }
}
