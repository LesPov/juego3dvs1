// src/app/features/admin/components/world-editor/service/three-engine/utils/entity-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BehaviorSubject, Observable } from 'rxjs';
import { ObjectManagerService } from './object-manager.service';
import { SelectionManagerService } from './selection-manager.service';
import { SceneObjectResponse } from '../../../../../services/admin.service';

export interface SceneEntity {
  uuid: string;
  name: string;
  type: 'Camera' | 'Light' | 'Model';
}

@Injectable({
  providedIn: 'root'
})
export class EntityManagerService {
  private scene!: THREE.Scene;
  private gltfLoader!: GLTFLoader;
  private selectedHelper: THREE.Object3D | null = null;
  private sceneEntities = new BehaviorSubject<SceneEntity[]>([]);

  constructor(
    private objectManager: ObjectManagerService,
    private selectionManager: SelectionManagerService
  ) {}

  public init(scene: THREE.Scene): void {
    this.scene = scene;
    const loadingManager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(loadingManager);
  }

  public getLoadingManager(): THREE.LoadingManager {
    return this.gltfLoader.manager;
  }

  public getSceneEntities(): Observable<SceneEntity[]> {
    return this.sceneEntities.asObservable();
  }
  
  public getObjectByUuid(uuid: string): THREE.Object3D | undefined {
    return this.scene.getObjectByProperty('uuid', uuid);
  }

  public createObjectFromData(objData: SceneObjectResponse): void {
    switch (objData.type) {
      case 'cube': case 'sphere': case 'floor': case 'model': case 'cone': case 'torus':
        this.objectManager.createObjectFromData(this.scene, objData, this.gltfLoader);
        break;
      case 'camera': this.createCameraFromData(objData); break;
      case 'directionalLight': case 'ambientLight':
        this.createLightFromData(objData);
        break;
      default: console.warn(`[EntityManager] Tipo de objeto desconocido: '${objData.type}'.`); break;
    }
  }

  // El resto del archivo no necesita cambios hasta createLightFromData
  // ... (selectObjectByUuid, updateObjectColor, etc. se mantienen igual)
  
  public selectObjectByUuid(uuid: string | null, focusPivot: THREE.Object3D): void {
    if (this.selectedHelper) {
      this.selectedHelper.visible = false;
      this.selectedHelper = null;
    }
    if (!uuid) {
      this.selectionManager.selectObjects([]);
      return;
    }
    const mainObject = this.scene.getObjectByProperty('uuid', uuid);
    if (!mainObject) {
      this.selectionManager.selectObjects([]);
      return;
    }
    focusPivot.position.copy(mainObject.position);
    const helperToShow = mainObject.userData['helper'] as THREE.Object3D | undefined;
    let objectsToOutline: THREE.Object3D[] = helperToShow ? [helperToShow] : [mainObject];
    if (helperToShow) {
      helperToShow.visible = true;
      this.selectedHelper = helperToShow;
    }
    this.selectionManager.selectObjects(objectsToOutline);
  }
  
  public updateObjectColor(uuid: string, newColor: string): void {
    const object = this.getObjectByUuid(uuid);
    if (!object) return;
    if ((object as THREE.Mesh).isMesh) { /* ... */ }
    if (object instanceof THREE.Light && 'color' in object) {
      (object as THREE.Light).color.set(newColor);
      const helper = object.userData['helper'] as THREE.PointLightHelper | THREE.DirectionalLightHelper;
      if (helper) {
        if (helper.color && helper.color instanceof THREE.Color) {
            helper.color.set(newColor);
        }
        if ('update' in helper) helper.update();
      }
    }
  }

  public updateObjectName(uuid: string, newName: string): void {
    const object = this.getObjectByUuid(uuid);
    if (object) {
      object.name = newName;
      if (object.userData['helper']) {
        object.userData['helper'].name = `${newName}_helper`;
      }
      this.publishSceneEntities();
    }
  }

  public publishSceneEntities(): void {
    const unselectableNames = ['Cámara del Editor', 'Luz Ambiental', 'FocusPivot', 'EditorGrid'];
    const entities: SceneEntity[] = [];
    this.scene.children.forEach(object => {
        if (!object.name.endsWith('_helper') && !unselectableNames.includes(object.name)) {
            if ((object as THREE.Mesh).isMesh) {
                const mesh = object as THREE.Mesh;
                if (!(mesh.geometry instanceof THREE.CylinderGeometry && (mesh.material as THREE.MeshBasicMaterial).isMeshBasicMaterial)) {
                    entities.push({ uuid: mesh.uuid, name: mesh.name, type: 'Model' });
                }
            } else if (object.name) {
                let type: SceneEntity['type'] = object instanceof THREE.Camera ? 'Camera' : (object instanceof THREE.Light ? 'Light' : 'Model');
                entities.push({ uuid: object.uuid, name: object.name, type: type });
            }
        }
    });
    setTimeout(() => this.sceneEntities.next(entities));
  }

  private createCameraFromData(data: SceneObjectResponse): void {
    const props = data.properties || {};
    const camera = new THREE.PerspectiveCamera(props['fov'] || 75, 1, props['near'] || 0.1, props['far'] || 1000);
    this.applyTransformations(camera, data);
    const helper = new THREE.CameraHelper(camera);
    helper.name = `${data.name}_helper`;
    helper.visible = false;
    camera.userData['helper'] = helper;
    this.scene.add(camera, helper);
  }

  private createLightFromData(data: SceneObjectResponse): void {
    let light: THREE.Light;
    let helper: THREE.Object3D | undefined;
    const props = data.properties || {};
    const color = new THREE.Color(props['color'] || 0xffffff);
    const intensity = props['intensity'] || 1;
    switch (data.type) {
      case 'directionalLight':
        const dirLight = new THREE.DirectionalLight(color, intensity);
        
        // === CAMBIO CLAVE: ELIMINAMOS TODA LA CONFIGURACIÓN DE SOMBRAS ===
        // La propiedad 'castShadow' por defecto es 'false', así que no necesitamos hacer nada.
        // dirLight.castShadow = false; // Esto ya es el valor por defecto.

        light = dirLight;
        this.scene.add(dirLight.target);
        helper = new THREE.DirectionalLightHelper(dirLight, 2, color);
        helper.name = `${data.name}_helper`;
        helper.visible = false;
        light.userData['helper'] = helper;
        break;
  
      case 'ambientLight':
        light = new THREE.AmbientLight(color, intensity);
        break;
      default: return;
    }
    
    this.applyTransformations(light, data);
    this.scene.add(light);
    if (helper) this.scene.add(helper);
  }

  private applyTransformations(object: THREE.Object3D, data: SceneObjectResponse): void {
    object.uuid = data.id.toString();
    object.name = data.name;
    object.position.set(data.position.x, data.position.y, data.position.z);
    object.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
    object.scale.set(data.scale.x, data.scale.y, data.scale.z);
  }
}