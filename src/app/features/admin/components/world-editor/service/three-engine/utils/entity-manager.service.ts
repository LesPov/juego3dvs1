// src/app/features/admin/components/world-editor/service/three-engine/utils/entity-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BehaviorSubject, Observable } from 'rxjs';
import { CelestialInstanceData, ObjectManagerService } from './object-manager.service';
import { SelectionManagerService } from './selection-manager.service';
import { SceneObjectResponse } from '../../../../../services/admin.service';

function sanitizeHexColor(color: string | undefined, fallback: string = '#ffffff'): string {
  if (typeof color === 'string' && /^#([0-9A-Fa-f]{3}){1,2}$/.test(color)) {
    return color;
  }
  return fallback;
}

export interface SceneEntity {
  uuid: string;
  name: string;
  type: 'Camera' | 'Light' | 'Model' | 'star' | 'galaxy' | 'meteor';
}

@Injectable({
  providedIn: 'root'
})
export class EntityManagerService {
  private scene!: THREE.Scene;
  private gltfLoader!: GLTFLoader;
  private selectedHelper: THREE.Object3D | null = null;
  private sceneEntities = new BehaviorSubject<SceneEntity[]>([]);
  private unselectableNames = ['Cámara del Editor', 'Luz Ambiental', 'FocusPivot', 'EditorGrid', 'SelectionProxy'];
  private instancedObjectNames = ['CelestialObjectsInstanced'];

  constructor(
    public objectManager: ObjectManagerService,
    private selectionManager: SelectionManagerService
  ) {}

  public init(scene: THREE.Scene): void {
    this.scene = scene;
    const loadingManager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(loadingManager);
  }

  public clearScene(): void {
    if (!this.scene) return;
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
        const object = this.scene.children[i];
        if (this.unselectableNames.includes(object.name)) continue;
        
        this.scene.remove(object);
        if ((object as THREE.Mesh).isMesh || (object as THREE.InstancedMesh).isInstancedMesh) {
            const mesh = object as THREE.Mesh | THREE.InstancedMesh;
            mesh.geometry?.dispose();
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
            } else {
                (mesh.material as THREE.Material)?.dispose();
            }
        }
    }
    this.publishSceneEntities();
  }

  public getLoadingManager(): THREE.LoadingManager { return this.gltfLoader.manager; }
  public getSceneEntities(): Observable<SceneEntity[]> { return this.sceneEntities.asObservable(); }
  public getObjectByUuid(uuid: string): THREE.Object3D | undefined {
    return this.scene.getObjectByProperty('uuid', uuid);
  }

  public createObjectFromData(objData: SceneObjectResponse): THREE.Object3D | null {
    return this.objectManager.createObjectFromData(this.scene, objData, this.gltfLoader);
  }

  public selectObjectByUuid(uuid: string | null, focusPivot: THREE.Object3D): void {
    if (this.selectedHelper) {
      this.selectedHelper.visible = false;
      this.selectedHelper = null;
    }
    
    const existingProxy = this.scene.getObjectByName('SelectionProxy');
    if (existingProxy) {
      this.scene.remove(existingProxy);
      (existingProxy as THREE.Mesh).geometry.dispose();
      ((existingProxy as THREE.Mesh).material as THREE.Material).dispose();
    }
    
    if (!uuid) {
      this.selectionManager.selectObjects([]);
      return;
    }

    const mainObject = this.scene.getObjectByProperty('uuid', uuid);
    if (mainObject) {
      focusPivot.position.copy(mainObject.position);
      const helperToShow = mainObject.userData['helper'] as THREE.Object3D | undefined;
      const objectsToOutline: THREE.Object3D[] = helperToShow ? [helperToShow] : [mainObject];
      if (helperToShow) {
        helperToShow.visible = true;
        this.selectedHelper = helperToShow;
      }
      this.selectionManager.selectObjects(objectsToOutline);
      return;
    }
    
    const celestialInstancedMesh = this.scene.getObjectByName('CelestialObjectsInstanced') as THREE.InstancedMesh;
    if (celestialInstancedMesh) {
      const allInstanceData: CelestialInstanceData[] = celestialInstancedMesh.userData["celestialData"];
      const instanceData = allInstanceData.find(d => d.originalUuid === uuid);

      if (instanceData) {
        const selectionProxy = this.objectManager.createSelectionProxy();
        
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
        instanceData.originalMatrix.decompose(pos, quat, scale);
        selectionProxy.position.copy(pos);
        selectionProxy.quaternion.copy(quat);
        selectionProxy.scale.copy(scale);

        selectionProxy.uuid = instanceData.originalUuid; 
        
        this.scene.add(selectionProxy);
        this.selectionManager.selectObjects([selectionProxy]);
        focusPivot.position.copy(selectionProxy.position);
        return;
      }
    }
    
    this.selectionManager.selectObjects([]);
  }

  public updateObjectName(uuid: string, newName: string): void {
    let objectToUpdate: THREE.Object3D | undefined = this.getObjectByUuid(uuid);

    if (!objectToUpdate) {
        const celestialInstancedMesh = this.scene.getObjectByName('CelestialObjectsInstanced') as THREE.InstancedMesh;
        if (celestialInstancedMesh) {
            const allInstanceData: CelestialInstanceData[] = celestialInstancedMesh.userData["celestialData"];
            const instanceData = allInstanceData.find(d => d.originalUuid === uuid);
            if (instanceData) {
                instanceData.originalName = newName;
            }
        }
    } else {
        objectToUpdate.name = newName;
        if (objectToUpdate.userData['helper']) {
            objectToUpdate.userData['helper'].name = `${newName}_helper`;
        }
    }
    this.publishSceneEntities();
  }

  public publishSceneEntities(): void {
    const entities: SceneEntity[] = [];
    const celestialInstancedMesh = this.scene.getObjectByName('CelestialObjectsInstanced');
    
    this.scene.children.forEach(object => {
        if (!object.name.endsWith('_helper') && 
            !this.unselectableNames.includes(object.name) &&
            !this.instancedObjectNames.includes(object.name)) {
            const apiType = object.userData['apiType'] as SceneEntity['type'] | undefined;
            entities.push({ 
                uuid: object.uuid, 
                name: object.name, 
                type: apiType || (object instanceof THREE.Camera ? 'Camera' : (object instanceof THREE.Light ? 'Light' : 'Model'))
            });
        }
    });

    if (celestialInstancedMesh) {
        const allInstanceData: CelestialInstanceData[] = celestialInstancedMesh.userData["celestialData"];
        if (allInstanceData) {
            allInstanceData.forEach(instance => {
                entities.push({
                    uuid: instance.originalUuid,
                    name: instance.originalName,
                    type: 'star'
                });
            });
        }
    }

    entities.sort((a, b) => a.name.localeCompare(b.name));
    setTimeout(() => this.sceneEntities.next(entities));
  }

  private applyTransformations(object: THREE.Object3D, data: SceneObjectResponse): void {
    object.uuid = data.id.toString();
    object.name = data.name;
    object.position.set(data.position.x, data.position.y, data.position.z);
    object.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
    object.scale.set(data.scale.x, data.scale.y, data.scale.z);
    object.userData['apiType'] = data.type;
  }
}