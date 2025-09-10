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

@Injectable({ providedIn: 'root' })
export class EntityManagerService {

  // ====================================================================
  // SECTION: Properties & Initialization
  // ====================================================================

  private scene!: THREE.Scene;
  private gltfLoader!: GLTFLoader;
  private sceneEntities = new BehaviorSubject<SceneEntity[]>([]);
  
  private unselectableNames = ['Luz Ambiental', 'FocusPivot', 'EditorGrid', 'SelectionProxy'];
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0); // Matriz para ocultar instancias

  constructor(
    public objectManager: ObjectManagerService,
    private selectionManager: SelectionManagerService
  ) { }

  /**
   * Inicializa el manager con la escena de Three.js.
   * @param scene La instancia de la escena principal.
   */
  public init(scene: THREE.Scene): void {
    this.scene = scene;
    const loadingManager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(loadingManager);
  }
  
  // ====================================================================
  // SECTION: Entity Publication & Discovery
  // ====================================================================

  /**
   * Recorre la escena, recopila todos los objetos relevantes (incluyendo los instanciados)
   * y emite una nueva lista de entidades para que la UI se actualice.
   */
  public publishSceneEntities(): void {
    const entities: SceneEntity[] = [];
    
    this.scene.children.forEach(object => {
      // Agrega objetos estándar (mallas, luces, cámaras)
      if (!object.name.endsWith('_helper') && !this.unselectableNames.includes(object.name) && !object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        const apiType = object.userData['apiType'] as SceneEntity['type'] | undefined;
        const finalType = apiType || (object instanceof THREE.PerspectiveCamera ? 'camera' : (object instanceof THREE.Light ? 'directionalLight' : 'Model'));
        entities.push({
          uuid: object.uuid,
          name: object.name,
          type: finalType
        });
      }
      
      // Extrae las entidades de los objetos celestes instanciados
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

  /**
   * Busca una instancia específica dentro de todos los `InstancedMesh` celestes por su UUID original.
   * @param uuid El UUID original de la instancia a buscar.
   * @returns Un objeto con la malla, el índice y los datos de la instancia, o null si no se encuentra.
   */
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
  
  // ====================================================================
  // SECTION: Object Selection & Proxy Management
  // ====================================================================

  /**
   * Maneja la lógica de selección de un objeto por su UUID.
   * Para objetos estándar, los selecciona directamente.
   * Para objetos instanciados, crea un 'SelectionProxy' en su lugar para poder manipularlo.
   * @param uuid El UUID del objeto a seleccionar, o null para deseleccionar todo.
   * @param focusPivot Un objeto 3D que se mueve al centro del objeto seleccionado.
   */
  public selectObjectByUuid(uuid: string | null, focusPivot: THREE.Object3D): void {
    // Limpia cualquier proxy de selección anterior
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

    // Intenta encontrar un objeto estándar en la escena
    const mainObject = this.scene.getObjectByProperty('uuid', uuid);
    if (mainObject) {
      focusPivot.position.copy(mainObject.position);
      this.selectionManager.selectObjects([mainObject]);
      return;
    }
    
    // Si no se encuentra, busca en los objetos instanciados y crea un proxy
    const celestialInstance = this._findCelestialInstance(uuid);
    if (celestialInstance) {
      const { data } = celestialInstance;
      const selectionProxy = this.objectManager.createSelectionProxy();
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
      data.originalMatrix.decompose(pos, quat, scale);
      selectionProxy.position.copy(pos);
      selectionProxy.scale.copy(scale).multiplyScalar(PROXY_SCALE_MULTIPLIER);
      selectionProxy.uuid = data.originalUuid; // Asigna el UUID original al proxy
      this.scene.add(selectionProxy);
      this.selectionManager.selectObjects([selectionProxy]);
      focusPivot.position.copy(selectionProxy.position);
      return;
    }

    this.selectionManager.selectObjects([]);
  }
  
  // ====================================================================
  // SECTION: Group Manipulation
  // ====================================================================

  /**
   * Modifica la visibilidad de un grupo de objetos.
   * @param uuids Array de UUIDs de los objetos a modificar.
   * @param visible El nuevo estado de visibilidad.
   */
  public setGroupVisibility(uuids: string[], visible: boolean): void {
    if (!this.scene) return;
    const celestialMeshes = this.scene.children.filter(o => o.name.startsWith(CELESTIAL_MESH_PREFIX)) as THREE.InstancedMesh[];
    
    // Optimización: Pre-mapear las instancias para una búsqueda más rápida
    const instanceMapByMesh = new Map<string, Map<string, { data: CelestialInstanceData, index: number }>>();
    celestialMeshes.forEach(mesh => {
      const map = new Map<string, { data: CelestialInstanceData, index: number }>();
      (mesh.userData["celestialData"] as CelestialInstanceData[]).forEach((data, index) => map.set(data.originalUuid, { data, index }));
      instanceMapByMesh.set(mesh.uuid, map);
    });

    const meshesToUpdate = new Set<THREE.InstancedMesh>();
    uuids.forEach(uuid => {
      const standardObject = this.scene.getObjectByProperty('uuid', uuid);
      if (standardObject) {
        standardObject.visible = visible;
        return;
      }
      for (const mesh of celestialMeshes) {
        const instance = instanceMapByMesh.get(mesh.uuid)?.get(uuid);
        if (instance) {
          instance.data.isManuallyHidden = !visible;
          // Para ocultar una instancia, escalamos su matriz a cero.
          const matrixToApply = visible ? instance.data.originalMatrix : this.zeroMatrix;
          mesh.setMatrixAt(instance.index, matrixToApply);
          meshesToUpdate.add(mesh);
          break;
        }
      }
    });
    meshesToUpdate.forEach(mesh => mesh.instanceMatrix.needsUpdate = true);
  }

  /**
   * Modifica el brillo (opacidad) de un grupo de objetos.
   * @param uuids Array de UUIDs.
   * @param brightness Valor de brillo/opacidad de 0 a 1.
   */
  public setGroupBrightness(uuids: string[], brightness: number): void {
    if (!this.scene) return;
    const celestialMeshes = this.scene.children.filter(o => o.name.startsWith(CELESTIAL_MESH_PREFIX)) as THREE.InstancedMesh[];
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
      for (const mesh of celestialMeshes) {
        const instanceData = (mesh.userData["celestialData"] as CelestialInstanceData[]).find(d => d.originalUuid === uuid);
        if (instanceData) {
          instanceData.brightness = brightness;
          break;
        }
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

  // ====================================================================
  // SECTION: Public API & Scene Modification
  // ====================================================================

  /**
   * Limpia la escena, eliminando todos los objetos excepto los esenciales (cámaras, etc.).
   */
  public clearScene(): void {
    if (!this.scene) return;
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
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(m => m?.dispose());
      }
    }
    this.publishSceneEntities();
  }
  
  /**
   * Actualiza el nombre de un objeto en la escena y en los datos internos.
   * @param uuid El UUID del objeto a renombrar.
   * @param newName El nuevo nombre para el objeto.
   */
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
    this.publishSceneEntities();
  }

  public createObjectFromData(objData: SceneObjectResponse): THREE.Object3D | null {
    const obj = this.objectManager.createObjectFromData(this.scene, objData, this.gltfLoader);
    if (obj) this.publishSceneEntities();
    return obj;
  }

  public getLoadingManager(): THREE.LoadingManager { return this.gltfLoader.manager; }
  public getSceneEntities(): Observable<SceneEntity[]> { return this.sceneEntities.asObservable(); }
  public getObjectByUuid(uuid: string): THREE.Object3D | undefined { return this.scene.getObjectByProperty('uuid', uuid); }
}