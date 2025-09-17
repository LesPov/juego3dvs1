// src/app/features/admin/components/world-editor/service/three-engine/utils/interaction-helper.manager.service.ts
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
  private camera!: THREE.Camera; // <-- Cambiado a THREE.Camera genérico

  // Helpers
  private interactionSphere?: THREE.Mesh;
  private centerPivotHelper?: THREE.Group;
  private pivotPoint?: THREE.Mesh;
  private axesHelper?: THREE.AxesHelper;

  // Estado
  private objectBaseSize = 1.0;
  private isSpecialObject = false;
  // --- ¡LÓGICA MEJORADA! ---
  // Ajustamos los factores para un comportamiento menos agresivo.
  private readonly AXES_SCREEN_SCALE_FACTOR = 0.07; // Ligeramente más pequeño
  private readonly AXES_OBJECT_SIZE_MULTIPLIER = 1.5; // Menos multiplicador sobre el objeto
  private readonly PIVOT_SCALE_RATIO = 0.08; // El punto central será el 8% del tamaño de los ejes

  private originalMaterials = new Map<string, THREE.Material | THREE.Material[]>();

  constructor() { }

  public init(scene: THREE.Scene, camera: THREE.Camera): void { // <-- Cambiado
    this.scene = scene;
    this.camera = camera;
  }

  public setCamera(newCamera: THREE.Camera): void { // <-- Cambiado
    this.camera = newCamera;
  }

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

    this.centerPivotHelper = new THREE.Group();
    this.centerPivotHelper.position.copy(center);
    this.scene.add(this.centerPivotHelper);
    this.centerPivotHelper.layers.set(HELPER_LAYER);
    this.centerPivotHelper.traverse(child => child.layers.set(HELPER_LAYER));

    this.axesHelper = new THREE.AxesHelper(5.0);
    (this.axesHelper.material as THREE.LineBasicMaterial).depthTest = false;
    (this.axesHelper.material as THREE.LineBasicMaterial).transparent = true;
    (this.axesHelper.material as THREE.LineBasicMaterial).opacity = 0.8;
    this.axesHelper.renderOrder = 999;
    this.centerPivotHelper.add(this.axesHelper);

    const sphereGeo = new THREE.SphereGeometry(5, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      depthTest: false,
      transparent: true,
      opacity: 0.9
    });
    this.pivotPoint = new THREE.Mesh(sphereGeo, sphereMat);
    // Ya no se posiciona aquí, lo hace updateHelperPositions
    this.pivotPoint.renderOrder = 1000;
    this.centerPivotHelper.add(this.pivotPoint); // ¡NUEVO! Es hijo del pivote principal

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
    
    // pivotPoint se elimina cuando se elimina su padre (centerPivotHelper)
    this.pivotPoint = undefined;

    if (this.centerPivotHelper) {
      this.axesHelper?.dispose();
      this.scene.remove(this.centerPivotHelper);
      this.centerPivotHelper = undefined;
    }
    this.isSpecialObject = false;
  }
  
  // =========================================================================
  // --- ¡LÓGICA CENTRAL CORREGIDA! ---
  // Este método ha sido reescrito para manejar correctamente ambas cámaras.
  // =========================================================================
  public updateScale(): void {
    if (!this.centerPivotHelper) return; // Guard clause unificado

    const targetPosition = this.centerPivotHelper.position;
    let screenSpaceDerivedScale: number;

    // Distinguir entre cámara ortográfica y de perspectiva
    if ((this.camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const orthoCam = this.camera as THREE.OrthographicCamera;
      // La "escala" en vista 2D depende del ancho visible (zoom)
      const viewHeight = orthoCam.top - orthoCam.bottom;
      screenSpaceDerivedScale = viewHeight * this.AXES_SCREEN_SCALE_FACTOR;
    } else {
      // La escala en vista 3D depende de la distancia
      const distance = this.camera.position.distanceTo(targetPosition);
      screenSpaceDerivedScale = distance * this.AXES_SCREEN_SCALE_FACTOR;
    }

    // El helper nunca será más pequeño que un tamaño relativo al objeto mismo
    const objectRelativeScale = this.objectBaseSize * this.AXES_OBJECT_SIZE_MULTIPLIER;
    const finalAxesScale = Math.max(objectRelativeScale, screenSpaceDerivedScale);

    // Aplicar la escala calculada a todo el grupo de helpers
    this.centerPivotHelper.scale.set(finalAxesScale, finalAxesScale, finalAxesScale);

    // ¡NUEVO! El pivote central ahora tiene una escala relativa a los ejes
    if (this.pivotPoint) {
      this.pivotPoint.scale.setScalar(this.PIVOT_SCALE_RATIO);
    }

    // La esfera de interacción invisible (usada para el clic) también se escala
    if (this.isSpecialObject && this.interactionSphere) {
      const interactionScale = Math.max(screenSpaceDerivedScale, this.objectBaseSize * 1.2);
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
    // La esfera de interacción se mueve por separado porque no es hija del helper
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