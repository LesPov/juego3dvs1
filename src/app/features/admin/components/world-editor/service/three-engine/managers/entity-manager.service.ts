import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BehaviorSubject, Observable } from 'rxjs';
import { CelestialInstanceData, ObjectManagerService } from './object-manager.service';
import { SceneObjectResponse } from '../../../../../services/admin.service';
import { SelectionManagerService } from '../interactions/selection-manager.service';
import { LabelManagerService } from './label-manager.service';

/**
 * @interface SceneEntity
 * @description Define una representación simplificada de un objeto en la escena.
 */
export interface SceneEntity {
  uuid: string;
  name: string;
  type: SceneObjectResponse['type'] | 'Model' | 'camera' | 'directionalLight';
}

// ====================================================================
// CONSTANTES
// ====================================================================

const PROXY_SCALE_MULTIPLIER = 1.1;
const DEEP_SPACE_SCALE_BOOST = 10.0;
const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';

/**
 * @class EntityManagerService
 * @description
 * Actúa como una "base de datos" para las entidades de la escena.
 */
@Injectable({ providedIn: 'root' })
export class EntityManagerService {

  private scene!: THREE.Scene;
  private gltfLoader!: GLTFLoader;
  private sceneEntities = new BehaviorSubject<SceneEntity[]>([]);
  private hoverProxy: THREE.Mesh | null = null;
  private unselectableNames = ['Luz Ambiental', 'FocusPivot', 'EditorGrid', 'SelectionProxy', 'HoverProxy'];
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private lastHoveredUuid: string | null = null;

  constructor(
    public objectManager: ObjectManagerService,
    private selectionManager: SelectionManagerService,
    private labelManager: LabelManagerService
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
        const objectType = object.type === 'Group' ? 'Model' : apiType;
        const finalType = objectType || (object instanceof THREE.PerspectiveCamera ? 'camera' : (object instanceof THREE.Light ? 'directionalLight' : 'Model'));
        entities.push({ uuid: object.uuid, name: object.name, type: finalType });
      }

      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        const allInstanceData: CelestialInstanceData[] = object.userData["celestialData"];
        if (allInstanceData) {
          allInstanceData.forEach(instance => {
            entities.push({ uuid: instance.originalUuid, name: instance.originalName, type: instance.type as SceneObjectResponse['type'] });
          });
        }
      }
    });

    entities.sort((a, b) => a.name.localeCompare(b.name));
    setTimeout(() => this.sceneEntities.next(entities), 0);
  }

  public _findCelestialInstance(uuid: string): { mesh: THREE.InstancedMesh, instanceIndex: number, data: CelestialInstanceData } | null {
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
      if (existingProxy instanceof THREE.Mesh) {
        if (!this.objectManager.isSharedGeometry(existingProxy.geometry)) {
          existingProxy.geometry.dispose();
        }
        (existingProxy.material as THREE.Material).dispose();
      }
    }

    if (!uuid) {
      this.selectionManager.setSelectedObjects([]);
      return;
    }

    const mainObject = this.scene.getObjectByProperty('uuid', uuid);
    if (mainObject) {
      this.selectionManager.setSelectedObjects([mainObject]);
      focusPivot.position.copy(mainObject.getWorldPosition(new THREE.Vector3()));
      return;
    }

    const celestialInstance = this._findCelestialInstance(uuid);
    if (celestialInstance) {
      const { data, mesh } = celestialInstance;
      const selectionProxy = this.objectManager.createSelectionProxy(mesh.geometry);
      // Usamos data.position y data.scale para asegurar que no hay mutaciones.
      selectionProxy.position.copy(data.position);
      selectionProxy.scale.copy(data.scale)
        .multiplyScalar(PROXY_SCALE_MULTIPLIER)
        .multiplyScalar(DEEP_SPACE_SCALE_BOOST);
      selectionProxy.uuid = data.originalUuid;

      this.scene.add(selectionProxy);
      this.selectionManager.setSelectedObjects([selectionProxy]);
      focusPivot.position.copy(selectionProxy.position);
      return;
    }

    this.selectionManager.setSelectedObjects([]);
  }

  public createOrUpdateHoverProxy(instancedMesh: THREE.InstancedMesh, instanceId: number): THREE.Mesh {
    if (!this.hoverProxy) {
      // El ObjectManager crea el aro con su material azul.
      const newProxy = this.objectManager.createHoverProxy(instancedMesh.geometry);
      newProxy.name = 'HoverProxy';
      this.scene.add(newProxy);
      this.hoverProxy = newProxy;
    }

    const allData: CelestialInstanceData[] = instancedMesh.userData['celestialData'];
    const data = allData[instanceId];
    if (data) {
      // Si el objeto que estamos sobrevolando es el que ya está seleccionado, no hacemos nada.
      // Esto evita que el aro azul aparezca encima del amarillo.
      if (this.selectionManager.isObjectSelected(data.originalUuid)) {
        if (this.hoverProxy) {
          this.hoverProxy.visible = false; // Simplemente ocultamos el proxy.
        }
        // Limpiamos el estado del hover anterior si lo hubiera.
        if (this.lastHoveredUuid && this.lastHoveredUuid !== data.originalUuid) {
            if (!this.selectionManager.isObjectSelected(this.lastHoveredUuid)) {
                this.labelManager.hideLabel(this.lastHoveredUuid);
            }
        }
        this.lastHoveredUuid = null;
        return this.hoverProxy!; // Devolvemos el proxy existente pero oculto.
      }
        
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
      data.originalMatrix.decompose(pos, quat, scale);

      this.hoverProxy.position.copy(pos);
      // La escala se RECALCULA desde cero cada vez, esto evita el bug de "crecimiento".
      // Se usa data.scale en lugar de decomponer la matriz para mayor seguridad.
      this.hoverProxy.scale.copy(data.scale)
        .multiplyScalar(PROXY_SCALE_MULTIPLIER)
        .multiplyScalar(DEEP_SPACE_SCALE_BOOST);
      this.hoverProxy.uuid = data.originalUuid;
      this.hoverProxy.visible = true; // ✨ Nos aseguramos de que sea visible

      if (this.lastHoveredUuid && this.lastHoveredUuid !== data.originalUuid) {
        if (!this.selectionManager.isObjectSelected(this.lastHoveredUuid)) {
            this.labelManager.hideLabel(this.lastHoveredUuid);
        }
      }
      this.labelManager.showLabel(data.originalUuid);
      this.lastHoveredUuid = data.originalUuid;
    }
    return this.hoverProxy;
  }

  public removeHoverProxy(): void {
    if (this.lastHoveredUuid) {
        const isSelected = this.selectionManager.isObjectSelected(this.lastHoveredUuid);
        if (!isSelected) {
            this.labelManager.hideLabel(this.lastHoveredUuid);
        }
        this.lastHoveredUuid = null;
    }

    if (this.hoverProxy) {
      this.scene.remove(this.hoverProxy);
      this.hoverProxy = null;
    }
  }

  public setGroupVisibility(uuids: string[], visible: boolean): void {
    if (!this.scene) return;
    const meshesToUpdate = new Set<THREE.InstancedMesh>();

    uuids.forEach(uuid => {
      const standardObject = this.scene.getObjectByProperty('uuid', uuid);
      if (standardObject) {
        standardObject.visible = visible;
        return;
      }

      const instanceInfo = this._findCelestialInstance(uuid);
      if (instanceInfo) {
        instanceInfo.data.isManuallyHidden = !visible;
        const matrixToApply = visible ? instanceInfo.data.originalMatrix : this.zeroMatrix;
        instanceInfo.mesh.setMatrixAt(instanceInfo.instanceIndex, matrixToApply);
        meshesToUpdate.add(instanceInfo.mesh);
      }
    });

    meshesToUpdate.forEach(mesh => mesh.instanceMatrix.needsUpdate = true);
  }

  public setGroupBrightness(uuids: string[], brightness: number): void {
    if (!this.scene) return;
    uuids.forEach(uuid => {
      const standardObject = this.scene.getObjectByProperty('uuid', uuid);
      if (standardObject) {
        standardObject.traverse(child => {
          if (child instanceof THREE.Mesh) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => { mat.transparent = brightness < 1.0; mat.opacity = brightness; });
          }
        });
        return;
      }
      const instanceInfo = this._findCelestialInstance(uuid);
      if (instanceInfo) {
        instanceInfo.data.brightness = brightness;
      }
    });
  }

  public resetAllGroupsBrightness(): void {
    if (!this.scene) return;
    this.scene.children.forEach(object => {
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        const allInstanceData = (object as THREE.InstancedMesh).userData["celestialData"] as CelestialInstanceData[] | undefined;
        if (allInstanceData) { allInstanceData.forEach(data => data.brightness = 1.0); }
      } else if (!this.unselectableNames.includes(object.name)) {
        object.traverse(child => {
          if (child instanceof THREE.Mesh) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => { if (mat.transparent) { mat.transparent = false; mat.opacity = 1.0; } });
          }
        });
      }
    });
  }

  public clearScene(): void {
    if (!this.scene) return;
    this.removeHoverProxy();
    this.labelManager.clear();

    const objectsToKeep = ['Cámara del Editor', 'Cámara Principal'];

    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const object = this.scene.children[i];
      if (this.unselectableNames.includes(object.name) || objectsToKeep.includes(object.name) || object.name.endsWith('_helper')) {
        continue;
      }

      if (object.userData['helper']) {
        this.scene.remove(object.userData['helper']);
      }

      this.scene.remove(object);

      if ((object as THREE.Mesh).isMesh || (object as THREE.InstancedMesh).isInstancedMesh) {
        const mesh = object as THREE.Mesh | THREE.InstancedMesh;
        if (!this.objectManager.isSharedGeometry(mesh.geometry)) {
          mesh.geometry?.dispose();
        }
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(m => m?.dispose());
      }
    }
    this.publishSceneEntities();
  }

  public updateObjectName(uuid: string, newName: string): void {
    const objectToUpdate = this.getObjectByUuid(uuid);
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
    this.labelManager.updateLabelText(uuid, newName);
    this.publishSceneEntities();
  }

  public createObjectFromData(objData: SceneObjectResponse): THREE.Object3D | null {
    const obj = this.objectManager.createObjectFromData(this.scene, objData, this.gltfLoader);
    setTimeout(() => this.publishSceneEntities(), 100);
    return obj;
  }

  public getLoadingManager(): THREE.LoadingManager { return this.gltfLoader.manager; }
  public getGltfLoader(): GLTFLoader { return this.gltfLoader; }
  public getSceneEntities(): Observable<SceneEntity[]> { return this.sceneEntities.asObservable(); }
  public getObjectByUuid(uuid: string): THREE.Object3D | undefined { return this.scene.getObjectByProperty('uuid', uuid); }
}