// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/entity-manager.service.ts
import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BehaviorSubject, Observable } from 'rxjs';
import { CelestialInstanceData, ObjectManagerService } from './object-manager.service';
import { SelectionManagerService } from './selection-manager.service';
import { SceneObjectResponse } from '../../../../../services/admin.service';

export interface SceneEntity {
  uuid: string;
  name: string;
  type: SceneObjectResponse['type'] | 'Model' | 'camera' | 'directionalLight';
}

const PROXY_SCALE_MULTIPLIER = 7.0;
const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';

@Injectable({
  providedIn: 'root'
})
export class EntityManagerService {
  private scene!: THREE.Scene;
  private gltfLoader!: GLTFLoader;
  private sceneEntities = new BehaviorSubject<SceneEntity[]>([]);
  
  // ✅ MODIFICADO: Se han quitado las cámaras principales de esta lista
  private unselectableNames = ['Luz Ambiental', 'FocusPivot', 'EditorGrid', 'SelectionProxy'];
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    public objectManager: ObjectManagerService,
    private selectionManager: SelectionManagerService
  ) { }

  public init(scene: THREE.Scene): void {
    this.scene = scene;
    const loadingManager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(loadingManager);
  }

  public publishSceneEntities(): void {
    const entities: SceneEntity[] = [];
    
    this.scene.children.forEach(object => {
      if (!object.name.endsWith('_helper') && !this.unselectableNames.includes(object.name) && !object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        const apiType = object.userData['apiType'] as SceneEntity['type'] | undefined;
        const finalType = apiType || (object instanceof THREE.PerspectiveCamera ? 'camera' : (object instanceof THREE.Light ? 'directionalLight' : 'Model'));
        entities.push({
          uuid: object.uuid,
          name: object.name,
          type: finalType
        });
      }
      
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        const allInstanceData: CelestialInstanceData[] = object.userData["celestialData"];
        if (allInstanceData) {
          allInstanceData.forEach(instance => {
            entities.push({
              uuid: instance.originalUuid,
              name: instance.originalName,
              type: instance.type as SceneObjectResponse['type']
            });
          });
        }
      }
    });

    entities.sort((a, b) => a.name.localeCompare(b.name));
    setTimeout(() => this.sceneEntities.next(entities));
  }

  private _findCelestialInstance(uuid: string): { mesh: THREE.InstancedMesh, instanceIndex: number, data: CelestialInstanceData } | null {
    for (const object of this.scene.children) {
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX) && object instanceof THREE.InstancedMesh) {
        const allInstanceData: CelestialInstanceData[] = object.userData["celestialData"];
        if (allInstanceData) {
          const instanceIndex = allInstanceData.findIndex(d => d.originalUuid === uuid);
          if (instanceIndex > -1) {
            return { mesh: object, instanceIndex, data: allInstanceData[instanceIndex] };
          }
        }
      }
    }
    return null;
  }

  public selectObjectByUuid(uuid: string | null, focusPivot: THREE.Object3D): void {
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
      this.selectionManager.selectObjects([mainObject]);
      return;
    }
    
    const celestialInstance = this._findCelestialInstance(uuid);
    if (celestialInstance) {
      const { data } = celestialInstance;
      const selectionProxy = this.objectManager.createSelectionProxy();
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
      data.originalMatrix.decompose(pos, quat, scale);
      selectionProxy.position.copy(pos);
      selectionProxy.scale.copy(scale).multiplyScalar(PROXY_SCALE_MULTIPLIER);
      selectionProxy.uuid = data.originalUuid;
      this.scene.add(selectionProxy);
      this.selectionManager.selectObjects([selectionProxy]);
      focusPivot.position.copy(selectionProxy.position);
      return;
    }

    this.selectionManager.selectObjects([]);
  }
  
  public resetAllGroupsBrightness(): void { if (!this.scene) return; this.scene.children.forEach(object => { if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) { const allInstanceData = (object as THREE.InstancedMesh).userData["celestialData"] as CelestialInstanceData[] | undefined; if (allInstanceData) { allInstanceData.forEach(data => data.brightness = 1.0); } } else if (!this.unselectableNames.includes(object.name)) { object.traverse(child => { if (child instanceof THREE.Mesh) { const materials = Array.isArray(child.material) ? child.material : [child.material]; materials.forEach(mat => { if (mat.transparent) { mat.transparent = false; mat.opacity = 1.0; } }); } }); } }); }
  public setGroupBrightness(uuids: string[], brightness: number): void { if (!this.scene) return; const celestialMeshes = this.scene.children.filter(o => o.name.startsWith(CELESTIAL_MESH_PREFIX)) as THREE.InstancedMesh[]; uuids.forEach(uuid => { const standardObject = this.scene.getObjectByProperty('uuid', uuid); if (standardObject) { standardObject.traverse(child => { if (child instanceof THREE.Mesh) { const materials = Array.isArray(child.material) ? child.material : [child.material]; materials.forEach(mat => { mat.transparent = brightness < 1.0; mat.opacity = brightness; }); } }); return; } for (const mesh of celestialMeshes) { const instanceData = (mesh.userData["celestialData"] as CelestialInstanceData[]).find(d => d.originalUuid === uuid); if (instanceData) { instanceData.brightness = brightness; break; } } }); }
  public setGroupVisibility(uuids: string[], visible: boolean): void { if (!this.scene) return; const celestialMeshes = this.scene.children.filter(o => o.name.startsWith(CELESTIAL_MESH_PREFIX)) as THREE.InstancedMesh[]; const instanceMapByMesh = new Map<string, Map<string, { data: CelestialInstanceData, index: number }>>(); celestialMeshes.forEach(mesh => { const map = new Map<string, { data: CelestialInstanceData, index: number }>(); (mesh.userData["celestialData"] as CelestialInstanceData[]).forEach((data, index) => map.set(data.originalUuid, { data, index })); instanceMapByMesh.set(mesh.uuid, map); }); const meshesToUpdate = new Set<THREE.InstancedMesh>(); uuids.forEach(uuid => { const standardObject = this.scene.getObjectByProperty('uuid', uuid); if (standardObject) { standardObject.visible = visible; return; } for (const mesh of celestialMeshes) { const instance = instanceMapByMesh.get(mesh.uuid)?.get(uuid); if (instance) { instance.data.isManuallyHidden = !visible; const matrixToApply = visible ? instance.data.originalMatrix : this.zeroMatrix; mesh.setMatrixAt(instance.index, matrixToApply); meshesToUpdate.add(mesh); break; } } }); meshesToUpdate.forEach(mesh => mesh.instanceMatrix.needsUpdate = true); }
  
  public clearScene(): void {
    if (!this.scene) return;
    
    // ✅ MODIFICADO: Lista de objetos a mantener en la escena
    const objectsToKeep = ['Cámara del Editor', 'Cámara Principal'];

    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const object = this.scene.children[i];
      // Si el objeto está en la lista de no seleccionables o en la de mantener, lo saltamos
      if (this.unselectableNames.includes(object.name) || objectsToKeep.includes(object.name)) {
        continue;
      }
      
      // Evitamos borrar los helpers de las cámaras principales
      if (object.name === 'Cámara del Editor_helper' || object.name === 'Cámara Principal_helper') {
        continue;
      }

      if (object.userData['helper']) {
          const helper = object.userData['helper'];
          this.scene.remove(helper);
      }
      
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
  public getObjectByUuid(uuid: string): THREE.Object3D | undefined { return this.scene.getObjectByProperty('uuid', uuid); }
  public createObjectFromData(objData: SceneObjectResponse): THREE.Object3D | null { const obj = this.objectManager.createObjectFromData(this.scene, objData, this.gltfLoader); if (obj) this.publishSceneEntities(); return obj; }
  
  public updateObjectName(uuid: string, newName: string): void {
    const objectToUpdate: THREE.Object3D | undefined = this.getObjectByUuid(uuid);
    if (objectToUpdate) {
      objectToUpdate.name = newName;
      if (objectToUpdate.userData['helper']) {
        objectToUpdate.userData['helper'].name = `${newName}_helper`;
      }
    } else {
      const instance = this._findCelestialInstance(uuid);
      if (instance) {
        instance.data.originalName = newName;
      }
    }
    this.publishSceneEntities();
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