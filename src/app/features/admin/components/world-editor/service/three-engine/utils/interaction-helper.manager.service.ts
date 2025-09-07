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
  private centerPivotHelper?: THREE.Group; // Contendrá solo los ejes
  private pivotPoint?: THREE.Mesh;       // La esfera amarilla ahora es independiente
  private axesHelper?: THREE.AxesHelper;

  // Estado
  private objectBaseSize = 1.0;
  private isSpecialObject = false;
  private readonly AXES_SCREEN_SCALE_FACTOR = 0.08;
  private readonly AXES_OBJECT_SIZE_MULTIPLIER = 2.5;

  private originalMaterials = new Map<string, THREE.Material | THREE.Material[]>();

  constructor() { }

  public init(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
  }

  // 💡 LÓGICA MODIFICADA
  public createHelpers(object: THREE.Object3D): void {
    if (this.centerPivotHelper || this.pivotPoint) this.cleanupHelpers();

    object.updateMatrixWorld(true);

    let center: THREE.Vector3;
    let interactionRadius: number;

    const boundingBox = new THREE.Box3().setFromObject(object);
    if (boundingBox.isEmpty()) {
      center = object.position.clone();
      interactionRadius = 1.0;
      this.isSpecialObject = true;
    } else {
      const boundingSphere = new THREE.Sphere();
      boundingBox.getBoundingSphere(boundingSphere);
      center = boundingSphere.center;
      interactionRadius = Math.max(boundingSphere.radius, 0.2);
      this.isSpecialObject = false;
    }

    this.objectBaseSize = interactionRadius;

    // 1. Creamos el helper de ejes (sin la esfera)
    this.centerPivotHelper = new THREE.Group();
    this.centerPivotHelper.position.copy(center);
    this.scene.add(this.centerPivotHelper);
    this.centerPivotHelper.layers.set(HELPER_LAYER);
    this.centerPivotHelper.traverse(child => child.layers.set(HELPER_LAYER));

    this.axesHelper = new THREE.AxesHelper(10.0); // Tamaño base 1
    (this.axesHelper.material as THREE.LineBasicMaterial).depthTest = false;
    (this.axesHelper.material as THREE.LineBasicMaterial).transparent = true;
    (this.axesHelper.material as THREE.LineBasicMaterial).opacity = 0.8;
    this.axesHelper.renderOrder = 999; 
    this.centerPivotHelper.add(this.axesHelper);

    // 2. ✅ ¡NUEVO! Creamos la esfera amarilla (pivotPoint) como un objeto separado.
    // Esto nos permite controlar su escala y posición de forma independiente.
    const sphereGeo = new THREE.SphereGeometry(5, 16, 16); // Geometría con radio 1
    const sphereMat = new THREE.MeshBasicMaterial({ 
        color: 0xffff00, 
        depthTest: false, 
        transparent: true, 
        opacity: 0.9 
    });
    this.pivotPoint = new THREE.Mesh(sphereGeo, sphereMat);
    this.pivotPoint.position.copy(center); // Se posiciona en el centro
    this.pivotPoint.renderOrder = 1000; // Un poco más alto para estar sobre los ejes
    this.scene.add(this.pivotPoint);
    
    // 3. La esfera de interacción sigue siendo la misma.
    const interactionGeo = new THREE.SphereGeometry(interactionRadius * 1.2, 16, 16); 
    const interactionMat = new THREE.MeshBasicMaterial({ visible: false, depthTest: false });
    this.interactionSphere = new THREE.Mesh(interactionGeo, interactionMat);
    this.interactionSphere.position.copy(center);
    this.scene.add(this.interactionSphere);

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
    
    // ✅ ¡NUEVO! Limpiamos el pivotPoint por separado.
    if (this.pivotPoint) {
      this.pivotPoint.geometry.dispose();
      (this.pivotPoint.material as THREE.Material).dispose();
      this.scene.remove(this.pivotPoint);
      this.pivotPoint = undefined;
    }

    if (this.centerPivotHelper) {
      this.axesHelper?.dispose();
      this.scene.remove(this.centerPivotHelper);
      this.centerPivotHelper = undefined;
    }
    this.isSpecialObject = false;
  }

  // 💡 LÓGICA DE ESCALADO SEPARADA Y DEFINITIVA
  public updateScale(): void {
    const distance = this.camera.position.distanceTo(
        this.centerPivotHelper?.position || this.pivotPoint?.position || new THREE.Vector3()
    );

    // 1. Lógica para los EJES (centerPivotHelper) - se mantiene como estaba.
    if (this.centerPivotHelper) {
      const perspectiveScale = distance * this.AXES_SCREEN_SCALE_FACTOR;
      const objectRelativeScale = this.objectBaseSize * this.AXES_OBJECT_SIZE_MULTIPLIER;
      const finalScale = Math.max(objectRelativeScale, perspectiveScale);
      this.centerPivotHelper.scale.set(finalScale, finalScale, finalScale);
    }
    
    // 2. ✅ ¡NUEVA LÓGICA EXCLUSIVA PARA EL PIVOTE AMARILLO (pivotPoint)!
    if (this.pivotPoint) {
      // Su escala será SIEMPRE el radio del objeto. Ni más, ni menos.
      // Esto hace que siempre ocupe el tamaño del objeto seleccionado.
      const finalScale = this.objectBaseSize;
      this.pivotPoint.scale.set(finalScale, finalScale, finalScale);
    }

    // Lógica para la esfera de interacción no cambia.
    if (this.isSpecialObject && this.interactionSphere) {
      const interactionScale = Math.max(distance * 0.15, this.objectBaseSize * 1.2);
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
    
    // ✅ ¡NUEVO! Actualizamos las posiciones de ambos helpers.
    if (this.centerPivotHelper) this.centerPivotHelper.position.copy(center);
    if (this.pivotPoint) this.pivotPoint.position.copy(center);
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
    // La esfera de interacción ahora apunta al pivotPoint amarillo, que es el que se usa para arrastrar.
    return this.pivotPoint;
  }
}