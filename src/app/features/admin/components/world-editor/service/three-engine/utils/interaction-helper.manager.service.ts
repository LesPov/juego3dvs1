// RUTA: .../utils/interaction-helper.manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { CameraMode } from '../engine.service';

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
  private isSpecialObject = false; 

  // ⭐️ MEJORA CLAVE: Valores ajustados para que los helpers sean más pequeños y estéticos.
  private readonly AXES_HELPER_SIZE_MULTIPLIER = 0.6;  // Los ejes ahora serán un 60% del radio del objeto (sobresalen un poco).
  private readonly PIVOT_POINT_RADIUS_MULTIPLIER = 0.03; // El punto amarillo tendrá un 3% del radio, más pequeño y sutil.

  constructor() { }

  public init(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
  }

  public createHelpers(object: THREE.Object3D): void {
    if (this.centerPivotHelper) this.cleanupHelpers();

    object.updateMatrixWorld(true);

    let center: THREE.Vector3;
    let objectRadius: number;

    if (isGeometyObject(object)) {
      this.isSpecialObject = false;
      const boundingBox = new THREE.Box3().setFromObject(object);
      const boundingSphere = new THREE.Sphere();
      boundingBox.getBoundingSphere(boundingSphere);
      center = boundingSphere.center;
      // Usamos la mitad del tamaño más grande del objeto como nuestro radio base.
      objectRadius = boundingSphere.radius;
    } else {
      this.isSpecialObject = true;
      center = object.position.clone();
      objectRadius = 1.0;
    }
    // Aseguramos un radio mínimo para objetos muy pequeños o planos.
    objectRadius = Math.max(objectRadius, 0.2);


    this.centerPivotHelper = new THREE.Group();
    this.centerPivotHelper.position.copy(center);
    this.scene.add(this.centerPivotHelper);
    this.centerPivotHelper.layers.set(HELPER_LAYER);
    this.centerPivotHelper.traverse(child => child.layers.set(HELPER_LAYER));

    const axesSize = objectRadius * this.AXES_HELPER_SIZE_MULTIPLIER;
    this.axesHelper = new THREE.AxesHelper(axesSize);
    
    (this.axesHelper.material as THREE.Material).depthTest = false;
    this.axesHelper.renderOrder = 999;
    
    this.centerPivotHelper.add(this.axesHelper);

    const pivotRadius = objectRadius * this.PIVOT_POINT_RADIUS_MULTIPLIER;
    const sphereGeo = new THREE.SphereGeometry(pivotRadius, 16, 16);
    
    const sphereMat = new THREE.MeshBasicMaterial({ 
        color: 0xffff00, 
        depthTest: false 
    });
    
    this.pivotPoint = new THREE.Mesh(sphereGeo, sphereMat);
    this.pivotPoint.renderOrder = 999;
    this.centerPivotHelper.add(this.pivotPoint);
    
    // La esfera de interacción la mantenemos un poco más grande que el objeto para facilitar el click.
    const interactionGeo = new THREE.SphereGeometry(objectRadius * 1.2, 16, 16); 
    const interactionMat = new THREE.MeshBasicMaterial({ visible: false, depthTest: false });
    this.interactionSphere = new THREE.Mesh(interactionGeo, interactionMat);
    this.interactionSphere.position.copy(center);
    this.scene.add(this.interactionSphere);
  }

  public cleanupHelpers(): void {
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
    this.isSpecialObject = false;
  }
  
  public updateScale(cameraMode: CameraMode): void {}
  public updateHelperPositions(object: THREE.Object3D): void { let center: THREE.Vector3; if (isGeometyObject(object)) { const box=new THREE.Box3().setFromObject(object); center=new THREE.Vector3(); box.getCenter(center); } else { center=object.position.clone(); } if (this.centerPivotHelper) this.centerPivotHelper.position.copy(center); if (this.interactionSphere) this.interactionSphere.position.copy(center); }
  public getInteractionSphere = (): THREE.Mesh | undefined => this.interactionSphere;
  public getPivotPoint = (): THREE.Mesh | undefined => this.pivotPoint;
}