// src/app/features/admin/views/world-editor/world-view/service/three-engine/interactions/interaction-helper.manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';

// ====================================================================
// CONSTANTES Y HELPERS DE TIPO
// ====================================================================

/** Capa de renderizado específica para los helpers, para poder ocultarlos si es necesario. */
const HELPER_LAYER = 1;

/**
 * @internal Función de guarda de tipo para verificar si un Object3D puede tener geometría/material.
 * @param object - El objeto a verificar.
 * @returns `true` si el objeto es un Mesh, Group o Scene.
 */
function isGeometryObject(object: THREE.Object3D): object is THREE.Mesh | THREE.Group | THREE.Scene {
  return 'isMesh' in object || 'isGroup' in object || 'isScene' in object;
}


/**
 * @class InteractionHelperManagerService
 * @description
 * Este servicio se especializa en la creación, gestión y limpieza de los **ayudantes visuales (helpers)**
 * que se muestran cuando un objeto está seleccionado y la herramienta de movimiento está activa.
 * Estos helpers (ejes de colores y un pivote central) proporcionan una referencia visual para la manipulación.
 *
 * Funciones clave:
 * - Crea un grupo de helpers (`AxesHelper`, punto de pivote) centrado en el objeto seleccionado.
 * - Crea una esfera de interacción invisible que facilita el "clic" en objetos sin geometría visible (como luces o cámaras).
 * - **Lógica de escalado dinámico**: Asegura que los helpers mantengan un tamaño visible y útil en pantalla,
 *   sin importar la distancia de la cámara o si la vista es de perspectiva u ortográfica.
 * - Gestiona el ciclo de vida de los helpers, creándolos al seleccionar y limpiándolos al deseleccionar.
 * - Proporciona utilidades para hacer un objeto semi-transparente durante el arrastre.
 */
@Injectable({
  providedIn: 'root'
})
export class InteractionHelperManagerService {

  // ====================================================================
  // ESTADO INTERNO Y DEPENDENCIAS
  // ====================================================================

  private scene!: THREE.Scene;
  private camera!: THREE.Camera;

  // Referencias a los helpers creados
  private interactionSphere?: THREE.Mesh;
  private centerPivotHelper?: THREE.Group;
  private pivotPoint?: THREE.Mesh;
  private axesHelper?: THREE.AxesHelper;

  // Estado de los helpers
  private objectBaseSize = 1.0;
  private isSpecialObject = false; // Flag para objetos sin bounding box (luces, cámaras)

  // Mapa para guardar los materiales originales de un objeto antes de hacerlo transparente
  private originalMaterials = new Map<string, THREE.Material | THREE.Material[]>();

  // Constantes de escalado para los helpers
  private readonly AXES_SCREEN_SCALE_FACTOR = 0.07;
  private readonly AXES_OBJECT_SIZE_MULTIPLIER = 1.5;
  private readonly PIVOT_SCALE_RATIO = 0.08;

  // ====================================================================
  // INICIALIZACIÓN
  // ====================================================================

  /**
   * Inicializa el servicio con la escena y la cámara.
   * @param scene - La escena principal de Three.js.
   * @param camera - La cámara activa inicial.
   */
  public init(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;
  }

  /**
   * Actualiza la referencia a la cámara activa.
   * Es crucial llamarlo cuando la cámara cambia (ej. de perspectiva a ortográfica).
   * @param newCamera - La nueva cámara activa.
   */
  public setCamera(newCamera: THREE.Camera): void {
    this.camera = newCamera;
  }

  // ====================================================================
  // CICLO DE VIDA DE LOS HELPERS
  // ====================================================================

  /**
   * Crea todos los helpers visuales para un objeto 3D específico.
   * @param object - El objeto seleccionado para el cual se crearán los helpers.
   */
  public createHelpers(object: THREE.Object3D): void {
    this.cleanupHelpers(); // Limpia cualquier helper anterior

    object.updateMatrixWorld(true);

    let center: THREE.Vector3;
    let interactionRadius: number;

    // 1. Calcula el centro y el radio del objeto.
    const boundingBox = new THREE.Box3().setFromObject(object);
    if (boundingBox.isEmpty()) {
      // Caso para objetos sin geometría visible (luces, cámaras)
      center = object.position.clone();
      interactionRadius = 1.0;
      this.isSpecialObject = true;
    } else {
      // Caso para objetos con geometría
      const boundingSphere = new THREE.Sphere();
      boundingBox.getBoundingSphere(boundingSphere);
      center = boundingSphere.center;
      interactionRadius = Math.max(boundingSphere.radius, 0.2);
      this.isSpecialObject = false;
    }
    this.objectBaseSize = interactionRadius;

    // 2. Crea el grupo principal de helpers
    this.centerPivotHelper = new THREE.Group();
    this.centerPivotHelper.position.copy(center);
    this.scene.add(this.centerPivotHelper);
    this.centerPivotHelper.layers.set(HELPER_LAYER);
    this.centerPivotHelper.traverse(child => child.layers.set(HELPER_LAYER));

    // 3. Crea los ejes (rojo, verde, azul)
    this.axesHelper = new THREE.AxesHelper(5.0);
    const axesMaterial = this.axesHelper.material as THREE.LineBasicMaterial;
    axesMaterial.depthTest = false;
    axesMaterial.transparent = true;
    axesMaterial.opacity = 0.8;
    this.axesHelper.renderOrder = 999;
    this.centerPivotHelper.add(this.axesHelper);

    // 4. Crea el punto de pivote central (esfera amarilla)
    const sphereGeo = new THREE.SphereGeometry(5, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true, opacity: 0.9 });
    this.pivotPoint = new THREE.Mesh(sphereGeo, sphereMat);
    this.pivotPoint.renderOrder = 1000;
    this.centerPivotHelper.add(this.pivotPoint);

    // 5. Crea la esfera de interacción invisible (para facilitar el clic)
    const interactionGeo = new THREE.SphereGeometry(interactionRadius * 1.2, 16, 16);
    const interactionMat = new THREE.MeshBasicMaterial({ visible: false, depthTest: false });
    this.interactionSphere = new THREE.Mesh(interactionGeo, interactionMat);
    this.interactionSphere.position.copy(center);
    this.scene.add(this.interactionSphere);

    // 6. Calcula la escala inicial
    this.updateScale();
  }

  /**
   * Elimina todos los helpers de la escena y libera sus recursos.
   * @param object - Opcional, el objeto del cual se restaurará el material si se había hecho opaco.
   */
  public cleanupHelpers(object?: THREE.Object3D): void {
    if (object) this.restoreObjectMaterial(object);

    if (this.interactionSphere) {
      this.interactionSphere.geometry.dispose();
      (this.interactionSphere.material as THREE.Material).dispose();
      this.scene.remove(this.interactionSphere);
      this.interactionSphere = undefined;
    }

    if (this.centerPivotHelper) {
      this.axesHelper?.geometry.dispose();
      (this.axesHelper?.material as THREE.Material)?.dispose();
      this.pivotPoint?.geometry.dispose();
      (this.pivotPoint?.material as THREE.Material)?.dispose();
      this.scene.remove(this.centerPivotHelper);
      this.centerPivotHelper = undefined;
      this.pivotPoint = undefined;
    }
    
    this.isSpecialObject = false;
  }
  
  // ====================================================================
  // LÓGICA DE ACTUALIZACIÓN
  // ====================================================================

  /**
   * Actualiza la escala de los helpers para que mantengan un tamaño consistente en pantalla.
   * Esta es la lógica central que hace que los helpers sean siempre visibles y usables.
   */
  public updateScale(): void {
    if (!this.centerPivotHelper) return;

    const targetPosition = this.centerPivotHelper.position;
    let screenSpaceDerivedScale: number;

    // Distingue entre cámara ortográfica y de perspectiva para calcular la escala
    if ((this.camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const orthoCam = this.camera as THREE.OrthographicCamera;
      // La "escala" en vista 2D depende del alto visible (controlado por el zoom)
      const viewHeight = orthoCam.top - orthoCam.bottom;
      screenSpaceDerivedScale = viewHeight * this.AXES_SCREEN_SCALE_FACTOR;
    } else {
      // La escala en vista 3D depende de la distancia a la cámara
      const distance = this.camera.position.distanceTo(targetPosition);
      screenSpaceDerivedScale = distance * this.AXES_SCREEN_SCALE_FACTOR;
    }

    // El helper nunca será más pequeño que un tamaño relativo al objeto mismo para evitar que desaparezca
    const objectRelativeScale = this.objectBaseSize * this.AXES_OBJECT_SIZE_MULTIPLIER;
    const finalAxesScale = Math.max(objectRelativeScale, screenSpaceDerivedScale);

    // Aplica la escala calculada a todo el grupo de helpers
    this.centerPivotHelper.scale.setScalar(finalAxesScale);

    // El pivote central ahora tiene una escala relativa al tamaño de los ejes
    this.pivotPoint?.scale.setScalar(this.PIVOT_SCALE_RATIO);

    // La esfera de interacción invisible también se escala (solo para objetos especiales)
    if (this.isSpecialObject && this.interactionSphere) {
      const interactionScale = Math.max(screenSpaceDerivedScale, this.objectBaseSize * 1.2);
      this.interactionSphere.scale.setScalar(interactionScale);
    }
  }

  /**
   * Actualiza la posición de los helpers para que coincida con el centro del objeto.
   * Debe llamarse cuando el objeto se mueve.
   * @param object - El objeto cuya posición ha cambiado.
   */
  public updateHelperPositions(object: THREE.Object3D): void {
    let center: THREE.Vector3;
    if (isGeometryObject(object)) {
      const box = new THREE.Box3().setFromObject(object);
      center = box.getCenter(new THREE.Vector3());
    } else {
      center = object.position.clone();
    }

    if (this.centerPivotHelper) this.centerPivotHelper.position.copy(center);
    if (this.interactionSphere) this.interactionSphere.position.copy(center);
  }

  // ====================================================================
  // UTILIDADES DE MATERIAL
  // ====================================================================

  /**
   * Hace que un objeto sea semi-transparente. Útil durante una operación de arrastre.
   * Guarda los materiales originales para poder restaurarlos después.
   * @param object - El objeto a modificar.
   */
  public makeObjectOpaque(object: THREE.Object3D): void {
    if (!isGeometryObject(object)) return;
    this.originalMaterials.clear();

    object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        this.originalMaterials.set(child.uuid, child.material);
        const baseMaterial = Array.isArray(child.material) ? child.material[0] : child.material;
        const newMaterial = baseMaterial.clone();
        
        // Aplica propiedades de transparencia
        (newMaterial as THREE.MeshStandardMaterial).color.set(0xaaaaaa);
        newMaterial.transparent = true;
        newMaterial.opacity = 0.6;
        newMaterial.depthWrite = false;
        
        child.material = newMaterial;
      }
    });
  }

  /**
   * Restaura los materiales originales de un objeto que fue hecho opaco.
   * @param object - El objeto a restaurar.
   */
  public restoreObjectMaterial(object: THREE.Object3D): void {
    if (!isGeometryObject(object)) return;
    object.traverse(child => {
      if (child instanceof THREE.Mesh && this.originalMaterials.has(child.uuid)) {
        child.material = this.originalMaterials.get(child.uuid)!;
      }
    });
    this.originalMaterials.clear();
  }

  // ====================================================================
  // GETTERS
  // ====================================================================

  /** Devuelve la esfera de interacción invisible. */
  public getInteractionSphere(): THREE.Mesh | undefined {
    return this.interactionSphere;
  }

  /** Devuelve el punto de pivote central visible. */
  public getPivotPoint(): THREE.Mesh | undefined {
    return this.pivotPoint;
  }
}