// src/app/features/admin/services/three-engine/selection-manager.service.ts

import { Injectable, ElementRef } from '@angular/core';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

@Injectable({
  providedIn: 'root'
})
export class SelectionManagerService {
  public composer!: EffectComposer;
  private outlinePass!: OutlinePass;

  constructor() {}

  public init(
    scene: THREE.Scene, 
    camera: THREE.PerspectiveCamera, 
    renderer: THREE.WebGLRenderer,
    canvas: HTMLCanvasElement
  ): void {
    // 1. Composer: Orquesta los efectos de post-procesamiento.
    this.composer = new EffectComposer(renderer);

    // 2. RenderPass: El primer paso es renderizar la escena normal.
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // 3. OutlinePass: Dibuja el contorno.
    this.outlinePass = new OutlinePass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), 
      scene, 
      camera
    );
    
    // Configuración del contorno
    this.outlinePass.edgeStrength = 6.0;      // Fuerza del borde
    this.outlinePass.edgeGlow = 0.7;          // Resplandor
    this.outlinePass.edgeThickness = 2.0;     // Grosor
    this.outlinePass.pulsePeriod = 0;         // 0 para que no parpadee
    this.outlinePass.visibleEdgeColor.set('#ffff00'); // Color amarillo brillante
    this.outlinePass.hiddenEdgeColor.set('#444400');  // Color más oscuro si está oculto

    this.composer.addPass(this.outlinePass);
  }

  // Actualiza los objetos a los que se les aplicará el contorno.
  public selectObjects(objects: THREE.Object3D[]): void {
    if (this.outlinePass) {
      this.outlinePass.selectedObjects = objects;
    }
  }

  // Se llama cuando la ventana cambia de tamaño.
  public onResize(width: number, height: number): void {
    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }
}