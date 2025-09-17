// src/app/features/admin/views/world-editor/world-view/service/three-engine/interactions/selection-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { CameraMode } from '../managers/camera-manager.service';

// ====================================================================
// CONSTANTES DE ESTILO
// ====================================================================

/** Parámetros de contorno para la vista de perspectiva, más sutiles. */
const PERSPECTIVE_PARAMS = {
  edgeStrength: 10.0,
  edgeGlow: 1.0, 
  edgeThickness: 2.5,
};

/** Parámetros de contorno para la vista ortográfica, más gruesos y visibles. */
const ORTHOGRAPHIC_PARAMS = {
  edgeStrength: 25.0,
  edgeGlow: 1.5,
  edgeThickness: 5.0,
};

/**
 * @class SelectionManagerService
 * @description
 * Este servicio se especializa en gestionar la **retroalimentación visual para la selección y el hover** de objetos.
 * Utiliza dos instancias de `OutlinePass` (un efecto de post-procesado de Three.js) para dibujar contornos
 * alrededor de los objetos, uno para el estado de "hover" (pre-selección) y otro para la selección activa.
 *
 * Funciones clave:
 * - Crea y configura los pases de renderizado para los contornos.
 * - Proporciona una API para establecer qué objetos deben mostrar el contorno de hover (azul) o de selección (amarillo).
 * - Adapta la apariencia de los contornos según el modo de la cámara (perspectiva vs. ortográfica) para una mejor visibilidad.
 * - Maneja la lógica para evitar mostrar el contorno de hover en un objeto que ya está seleccionado.
 */
@Injectable({
  providedIn: 'root'
})
export class SelectionManagerService {

  // ====================================================================
  // ESTADO INTERNO (PASES DE RENDERIZADO)
  // ====================================================================

  /** El pase de renderizado para el contorno de "hover" (color azul). */
  private hoverOutlinePass!: OutlinePass;
  /** El pase de renderizado para el contorno de selección activa (color amarillo). */
  private selectOutlinePass!: OutlinePass;
  
  // ====================================================================
  // INICIALIZACIÓN
  // ====================================================================

  /**
   * Inicializa el servicio, creando y configurando los dos pases de `OutlinePass`.
   * @param scene - La escena principal de Three.js.
   * @param camera - La cámara activa inicial.
   * @param initialSize - El tamaño inicial del canvas (ancho y alto).
   */
  public init(scene: THREE.Scene, camera: THREE.Camera, initialSize: THREE.Vector2): void {
    // Configuración del pase de HOVER
    this.hoverOutlinePass = new OutlinePass(initialSize, scene, camera);
    this.hoverOutlinePass.pulsePeriod = 0; // Sin animación de pulso
    this.hoverOutlinePass.visibleEdgeColor.set('#00aaff'); // Azul cian
    this.hoverOutlinePass.hiddenEdgeColor.set('#00aaff');
    this.hoverOutlinePass.enabled = false;

    // Configuración del pase de SELECCIÓN
    this.selectOutlinePass = new OutlinePass(initialSize, scene, camera);
    this.selectOutlinePass.pulsePeriod = 0; // Sin animación de pulso
    this.selectOutlinePass.visibleEdgeColor.set('#ffff00'); // Amarillo
    this.selectOutlinePass.hiddenEdgeColor.set('#ffff00');
    this.selectOutlinePass.enabled = false;

    // Establece los parámetros iniciales para el modo perspectiva
    this.updateOutlineParameters('perspective');
  }

  // ====================================================================
  // API PÚBLICA
  // ====================================================================

  /**
   * Devuelve los pases de renderizado para que puedan ser añadidos al `EffectComposer`.
   * @returns Un array que contiene el pase de hover y el pase de selección.
   */
  public getPasses(): OutlinePass[] {
    return [this.hoverOutlinePass, this.selectOutlinePass];
  }
  
  /**
   * Actualiza los parámetros visuales (grosor, brillo) de los contornos
   * para adaptarse al modo de cámara actual.
   * @param mode - El modo de cámara actual: 'perspective' o 'orthographic'.
   */
  public updateOutlineParameters(mode: CameraMode): void {
    if (!this.hoverOutlinePass || !this.selectOutlinePass) return;
    
    const params = mode === 'orthographic' ? ORTHOGRAPHIC_PARAMS : PERSPECTIVE_PARAMS;
    
    [this.hoverOutlinePass, this.selectOutlinePass].forEach(pass => {
        pass.edgeStrength = params.edgeStrength;
        pass.edgeGlow = params.edgeGlow;
        pass.edgeThickness = params.edgeThickness;
    });
  }

  /**
   * Establece qué objetos deben mostrar el contorno de "hover".
   * Incluye una lógica para no mostrar el contorno de hover si el objeto ya está seleccionado.
   * @param objects - Un array de objetos 3D a los que se les aplicará el contorno. Array vacío para limpiar.
   */
  public setHoveredObjects(objects: THREE.Object3D[]): void {
    if (!this.hoverOutlinePass) return;

    // Comprueba si el objeto sobre el que se hace hover es el mismo que ya está seleccionado.
    const currentlySelectedUuid = this.selectOutlinePass.selectedObjects[0]?.uuid;
    const isHoveringSelected = objects.length > 0 && objects[0].uuid === currentlySelectedUuid;
    
    // Activa el contorno de hover solo si hay objetos y no se está haciendo hover sobre el seleccionado.
    if (objects.length > 0 && !isHoveringSelected) {
      this.hoverOutlinePass.selectedObjects = objects;
      this.hoverOutlinePass.enabled = true;
    } else {
      this.hoverOutlinePass.selectedObjects = [];
      this.hoverOutlinePass.enabled = false;
    }
  }

  /**
   * Establece qué objetos deben mostrar el contorno de selección activa.
   * Al seleccionar un objeto, se limpia automáticamente el contorno de "hover".
   * @param objects - Un array de objetos 3D a seleccionar. Array vacío para deseleccionar todo.
   */
  public setSelectedObjects(objects: THREE.Object3D[]): void {
    if (!this.selectOutlinePass) return;

    // Si se está seleccionando algo, nos aseguramos de que no haya un contorno de hover activo.
    if (objects.length > 0) {
      this.setHoveredObjects([]);
    }

    this.selectOutlinePass.selectedObjects = objects;
    this.selectOutlinePass.enabled = objects.length > 0;
  }
  
  /**
   * Actualiza la cámara que utilizan los pases de contorno.
   * Debe llamarse cada vez que la cámara activa cambia.
   * @param camera - La nueva cámara activa.
   */
  public setCamera(camera: THREE.Camera): void {
    if (this.hoverOutlinePass) this.hoverOutlinePass.renderCamera = camera;
    if (this.selectOutlinePass) this.selectOutlinePass.renderCamera = camera;
  }

  /**
   * Actualiza el tamaño de los pases de contorno.
   * Debe llamarse cuando la ventana del navegador cambia de tamaño.
   * @param width - El nuevo ancho en píxeles.
   * @param height - El nuevo alto en píxeles.
   */
  public setSize(width: number, height: number): void {
    if (this.hoverOutlinePass) this.hoverOutlinePass.setSize(width, height);
    if (this.selectOutlinePass) this.selectOutlinePass.setSize(width, height);
  }
}