import { Injectable } from '@angular/core';
import * as THREE from 'three';

const HELPER_LAYER = 1;

function isGeometyObject(object: THREE.Object3D): object is THREE.Mesh | THREE.Group | THREE.Scene {
  return 'isMesh' in object || 'isGroup' in object || 'isScene' in object;
}

@Injectable({
  providedIn: 'root'
})
export class InteractionHelperManagerService {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  // Helpers
  private interactionSphere?: THREE.Mesh;
  private centerPivotHelper?: THREE.Group;
  private pivotPoint?: THREE.Mesh;
  private axesHelper?: THREE.AxesHelper;
  
  // Estado
  private isSpecialObject = false; // Flag para saber si estamos manejando una luz/cámara.
  private readonly HELPER_SCREEN_SCALE_FACTOR = 0.08;
  private readonly SPECIAL_OBJECT_INTERACTION_SCALE_FACTOR = 0.15; // Factor más grande para la esfera invisible

  private originalMaterials = new Map<string, THREE.Material | THREE.Material[]>();

  constructor() { }

  public init(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
  }

  public createHelpers(object: THREE.Object3D): void {
    if (this.centerPivotHelper) this.cleanupHelpers();

    object.updateMatrixWorld(true);

    let center: THREE.Vector3;
    let interactionRadius: number;

    if (isGeometyObject(object)) {
      this.isSpecialObject = false; // Es un objeto normal
      const boundingBox = new THREE.Box3().setFromObject(object);
      const boundingSphere = new THREE.Sphere();
      boundingBox.getBoundingSphere(boundingSphere);
      center = boundingSphere.center;
      interactionRadius = Math.max(boundingSphere.radius, 0.2); 
    } else {
      this.isSpecialObject = true; // Es una luz, cámara, etc.
      center = object.position.clone();
      // El radio base es 1, pero se escalará dinámicamente.
      interactionRadius = 1.0;
    }

    // --- Creación de Helpers ---

    this.centerPivotHelper = new THREE.Group();
    this.centerPivotHelper.position.copy(center);
    this.scene.add(this.centerPivotHelper);
    this.centerPivotHelper.layers.set(HELPER_LAYER);
    this.centerPivotHelper.traverse(child => child.layers.set(HELPER_LAYER));

    this.axesHelper = new THREE.AxesHelper(1.5);
    (this.axesHelper.material as THREE.Material).depthTest = false;
    this.centerPivotHelper.add(this.axesHelper);

    const sphereGeo = new THREE.SphereGeometry(0.1, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true, opacity: 0.8 });
    this.pivotPoint = new THREE.Mesh(sphereGeo, sphereMat);
    this.centerPivotHelper.add(this.pivotPoint);
    
    const interactionGeo = new THREE.SphereGeometry(interactionRadius * 1.2, 16, 16); 
    const interactionMat = new THREE.MeshBasicMaterial({ visible: false, depthTest: false });
    this.interactionSphere = new THREE.Mesh(interactionGeo, interactionMat);
    this.interactionSphere.position.copy(center);
    this.scene.add(this.interactionSphere);

    // Primera actualización de escala al crear.
    this.updateScale();
  }

  public cleanupHelpers(object?: THREE.Object3D): void {
    if (object) this.restoreObjectMaterial(object);
    
    if (this.interactionSphere) {
      this.interactionSphere.geometry.dispose();
      (this.interactionSphere.material as THREE.Material).dispose();
      this.scene.remove(this.interactionSphere);
      this.interactionSphere = undefined;
    }

    if (this.centerPivotHelper) {
      this.centerPivotHelper.traverse(child => { if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } });
      this.scene.remove(this.centerPivotHelper);
      this.axesHelper?.dispose();
      this.centerPivotHelper = undefined;
      this.pivotPoint = undefined;
    }
    this.isSpecialObject = false; // Reseteamos el flag
  }

  /**
   * Actualiza la escala de los helpers para que mantengan un tamaño constante en pantalla.
   * Para objetos especiales (luz/cámara), también escala la esfera de interacción.
   */
  public updateScale(): void {
    if (!this.centerPivotHelper) return;

    const distance = this.centerPivotHelper.position.distanceTo(this.camera.position);
    const clampedDistance = Math.max(distance, 0.1);

    // 1. Escalar el helper visual (ejes, punto amarillo)
    const visualHelperScale = clampedDistance * this.HELPER_SCREEN_SCALE_FACTOR;
    this.centerPivotHelper.scale.set(visualHelperScale, visualHelperScale, visualHelperScale);

    // 2. 🎯 LÓGICA MEJORADA: Escalar la esfera de interacción SOLO para objetos especiales.
    if (this.isSpecialObject && this.interactionSphere) {
      const interactionScale = clampedDistance * this.SPECIAL_OBJECT_INTERACTION_SCALE_FACTOR;
      this.interactionSphere.scale.set(interactionScale, interactionScale, interactionScale);
    }
  }

  public updateHelperPositions(object: THREE.Object3D): void { 
    let center: THREE.Vector3;
    if (isGeometyObject(object)) {
      const box = new THREE.Box3().setFromObject(object); 
      center = new THREE.Vector3(); 
      box.getCenter(center); 
    } else {
      center = object.position.clone();
    }
    
    if (this.centerPivotHelper) this.centerPivotHelper.position.copy(center);
    if (this.interactionSphere) this.interactionSphere.position.copy(center);
  }

  public makeObjectOpaque(object: THREE.Object3D): void {
    if (!isGeometyObject(object)) return;
    this.originalMaterials.clear();
    object.traverse(child => { if (child instanceof THREE.Mesh) { this.originalMaterials.set(child.uuid, child.material); const newMaterial = (Array.isArray(child.material) ? child.material[0] : child.material).clone() as THREE.MeshStandardMaterial; newMaterial.color.set(0xaaaaaa); newMaterial.transparent = true; newMaterial.opacity = 0.6; newMaterial.depthWrite = false; child.material = newMaterial; } });
  }

  public restoreObjectMaterial(object: THREE.Object3D): void {
    if (!isGeometyObject(object)) return;
    object.traverse(child => { if (child instanceof THREE.Mesh && this.originalMaterials.has(child.uuid)) { child.material = this.originalMaterials.get(child.uuid)!; } });
    this.originalMaterials.clear();
  }
  
  public getInteractionSphere(): THREE.Mesh | undefined {
    return this.interactionSphere;
  }
  
  public getPivotPoint(): THREE.Mesh | undefined {
    return this.pivotPoint;
  }
}