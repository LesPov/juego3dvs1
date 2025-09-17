// src/app/features/admin/views/world-editor/world-view/service/three-engine/managers/entity-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BehaviorSubject, Observable } from 'rxjs';
import { CelestialInstanceData, ObjectManagerService } from './object-manager.service';
import { SceneObjectResponse } from '../../../../../services/admin.service';
import { SelectionManagerService } from '../interactions/selection-manager.service';

/**
 * @interface SceneEntity
 * @description Define una representación simplificada de un objeto en la escena,
 * utilizada principalmente para mostrar en listas en la interfaz de usuario.
 * @property {string} uuid - El identificador único del objeto.
 * @property {string} name - El nombre del objeto.
 * @property {SceneObjectResponse['type'] | ...} type - El tipo de objeto, para visualización de iconos, etc.
 */
export interface SceneEntity {
  uuid: string;
  name: string;
  type: SceneObjectResponse['type'] | 'Model' | 'camera' | 'directionalLight';
}

// ====================================================================
// CONSTANTES
// ====================================================================

const PROXY_SCALE_MULTIPLIER = 1.1;               // Factor de escala para que los proxies sean ligeramente más grandes que el objeto original.
const DEEP_SPACE_SCALE_BOOST = 10.0;             // Multiplicador de escala para proxies de objetos lejanos.
const CELESTIAL_MESH_PREFIX = 'CelestialObjects_'; // Prefijo para identificar los InstancedMesh de objetos celestes.

/**
 * @class EntityManagerService
 * @description
 * Este servicio actúa como una "base de datos" para los objetos (`entidades`) dentro de la escena de Three.js.
 * Su principal responsabilidad es gestionar el ciclo de vida de los objetos, buscarlos, y abstraer la complejidad
 * de tratar con objetos estándar (como `THREE.Mesh`) y objetos instanciados (dentro de `THREE.InstancedMesh`).
 *
 * Funciones clave:
 * - Mantiene una lista (`sceneEntities`) actualizada de todos los objetos seleccionables para la UI.
 * - Centraliza la lógica para seleccionar objetos, creando "proxies" visuales para las instancias celestes.
 * - Gestiona la creación y destrucción de objetos proxy para `hover` y `selection`.
 * - Aplica operaciones en grupo como cambiar visibilidad o brillo.
 * - Limpia y reinicia la escena de forma segura, liberando memoria.
 */
@Injectable({ providedIn: 'root' })
export class EntityManagerService {
  
  // ====================================================================
  // ESTADO INTERNO
  // ====================================================================

  private scene!: THREE.Scene;
  private gltfLoader!: GLTFLoader;
  
  /** BehaviorSubject que emite la lista actual de entidades en la escena. */
  private sceneEntities = new BehaviorSubject<SceneEntity[]>([]);

  /** Proxy visual temporal que aparece al pasar el cursor sobre un objeto instanciado. */
  private hoverProxy: THREE.Mesh | null = null;
  
  /** Nombres de objetos que no deben ser seleccionables ni aparecer en la lista de entidades. */
  private unselectableNames = ['Luz Ambiental', 'FocusPivot', 'EditorGrid', 'SelectionProxy', 'HoverProxy'];
  
  /** Una matriz de transformación que escala un objeto a cero, haciéndolo efectivamente invisible. */
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  /**
   * @constructor
   * Inyecta dependencias para la creación de objetos y la gestión visual de la selección.
   * @param objectManager - La "fábrica" de objetos.
   * @param selectionManager - Gestiona los efectos visuales de outline.
   */
  constructor(
    public objectManager: ObjectManagerService,
    private selectionManager: SelectionManagerService
  ) { }

  // ====================================================================
  // INICIALIZACIÓN
  // ====================================================================

  /**
   * Inicializa el servicio con la escena de Three.js y configura el loader de modelos.
   * @param scene - La instancia de la escena principal.
   */
  public init(scene: THREE.Scene): void {
    this.scene = scene;
    const loadingManager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(loadingManager);
  }

  // ====================================================================
  // GESTIÓN DE LA LISTA DE ENTIDADES
  // ====================================================================

  /**
   * Recorre la escena, recopila todos los objetos válidos (incluyendo instancias celestes),
   * los formatea como `SceneEntity` y emite la lista a través del `sceneEntities` observable.
   * Se llama después de poblar o modificar significativamente la escena.
   */
  public publishSceneEntities(): void {
    const entities: SceneEntity[] = [];
    this.scene.children.forEach(object => {
      // Caso 1: Objetos estándar
      if (!object.name.endsWith('_helper') && !this.unselectableNames.includes(object.name) && !object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        const apiType = object.userData['apiType'] as SceneEntity['type'] | undefined;
        const objectType = object.type === 'Group' ? 'Model' : apiType; 
        const finalType = objectType || (object instanceof THREE.PerspectiveCamera ? 'camera' : (object instanceof THREE.Light ? 'directionalLight' : 'Model'));
        entities.push({ uuid: object.uuid, name: object.name, type: finalType });
      }
      
      // Caso 2: Instancias celestes dentro de un InstancedMesh
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
    setTimeout(() => this.sceneEntities.next(entities), 0); // Asincrónico para evitar ExpressionChangedAfterItHasBeenCheckedError
  }
  
  // ====================================================================
  // BÚSQUEDA Y SELECCIÓN DE ENTIDADES
  // ====================================================================
  
  /**
   * Encuentra la información de una instancia celeste específica por su UUID original.
   * Busca dentro de todos los `InstancedMesh` de la escena.
   * @param uuid - El UUID original de la instancia a buscar.
   * @returns Un objeto con la referencia al mesh, el índice de la instancia y sus datos, o `null` si no se encuentra.
   */
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
    
  /**
   * Gestiona la lógica de selección de un objeto por UUID, manejando tanto objetos estándar como instancias celestes.
   * Si el objeto es una instancia, crea un `SelectionProxy` para visualizarlo y permitir su manipulación.
   * @param uuid - El UUID del objeto a seleccionar, o `null` para deseleccionar.
   * @param focusPivot - El objeto pivote de la cámara, para centrarlo en la selección.
   */
  public selectObjectByUuid(uuid: string | null, focusPivot: THREE.Object3D): void {
    // 1. Limpia cualquier proxy de selección existente.
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

    // 2. Si el UUID es nulo, simplemente deselecciona todo.
    if (!uuid) {
      this.selectionManager.setSelectedObjects([]);
      return;
    }

    // 3. Intenta encontrarlo como un objeto estándar.
    const mainObject = this.scene.getObjectByProperty('uuid', uuid);
    if (mainObject) {
      this.selectionManager.setSelectedObjects([mainObject]);
      focusPivot.position.copy(mainObject.getWorldPosition(new THREE.Vector3()));
      return;
    }

    // 4. Si no se encontró, búscalo como una instancia celeste.
    const celestialInstance = this._findCelestialInstance(uuid);
    if (celestialInstance) {
      const { data, mesh } = celestialInstance;
      
      // Crea un proxy usando la misma geometría que el InstancedMesh (¡importante!).
      const selectionProxy = this.objectManager.createSelectionProxy(mesh.geometry);
      
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
      data.originalMatrix.decompose(pos, quat, scale);
      
      // Posiciona y escala el proxy para que coincida con la instancia.
      selectionProxy.position.copy(pos);
      selectionProxy.scale.copy(scale)
        .multiplyScalar(PROXY_SCALE_MULTIPLIER)
        .multiplyScalar(DEEP_SPACE_SCALE_BOOST);
      selectionProxy.uuid = data.originalUuid; // El proxy "hereda" el UUID de la instancia.
      
      this.scene.add(selectionProxy);
      this.selectionManager.setSelectedObjects([selectionProxy]);
      focusPivot.position.copy(selectionProxy.position);
      return;
    }

    // 5. Si no se encontró de ninguna forma, deselecciona.
    this.selectionManager.setSelectedObjects([]);
  }

  // ====================================================================
  // GESTIÓN DE PROXIES DE HOVER
  // ====================================================================

  /**
   * Crea un nuevo `HoverProxy` o actualiza el existente para que coincida con la posición
   * y escala de una instancia celeste sobre la que se está pasando el cursor.
   * @param instancedMesh - El mesh al que pertenece la instancia.
   * @param instanceId - El índice de la instancia.
   * @returns La referencia al proxy de hover creado o actualizado.
   */
  public createOrUpdateHoverProxy(instancedMesh: THREE.InstancedMesh, instanceId: number): THREE.Mesh {
    if (!this.hoverProxy) {
        this.hoverProxy = this.objectManager.createSelectionProxy(instancedMesh.geometry);
        this.hoverProxy.name = 'HoverProxy';
        this.scene.add(this.hoverProxy);
    }

    const allData: CelestialInstanceData[] = instancedMesh.userData['celestialData'];
    const data = allData[instanceId];
    if (data) {
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
        data.originalMatrix.decompose(pos, quat, scale);
        
        this.hoverProxy.position.copy(pos);
        this.hoverProxy.scale.copy(scale)
            .multiplyScalar(PROXY_SCALE_MULTIPLIER)
            .multiplyScalar(DEEP_SPACE_SCALE_BOOST);
        
        this.hoverProxy.uuid = data.originalUuid; 
    }
    return this.hoverProxy;
  }

  /**
   * Elimina el proxy de hover de la escena.
   */
  public removeHoverProxy(): void {
    if (this.hoverProxy) {
      this.scene.remove(this.hoverProxy);
      this.hoverProxy = null;
    }
  }
  
  // ====================================================================
  // OPERACIONES EN GRUPO
  // ====================================================================

  /**
   * Cambia la visibilidad de un grupo de objetos, manejando tanto objetos estándar como instancias.
   * Para las instancias, en lugar de `visible = false`, se aplica una matriz de escala cero.
   * @param uuids - Lista de UUIDs de los objetos a modificar.
   * @param visible - El nuevo estado de visibilidad.
   */
  public setGroupVisibility(uuids: string[], visible: boolean): void {
    if (!this.scene) return;
    const meshesToUpdate = new Set<THREE.InstancedMesh>();
    
    uuids.forEach(uuid => {
      // Caso 1: Objeto estándar
      const standardObject = this.scene.getObjectByProperty('uuid', uuid);
      if (standardObject) {
        standardObject.visible = visible;
        return;
      }

      // Caso 2: Instancia celeste
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

  /**
   * Cambia el brillo de un grupo de objetos. Para objetos estándar, esto se traduce en opacidad.
   * Para instancias, se actualiza un factor de brillo que se usa en el shader de visibilidad.
   * @param uuids - Lista de UUIDs de los objetos a modificar.
   * @param brightness - Valor de brillo entre 0.0 y 1.0.
   */
  public setGroupBrightness(uuids: string[], brightness: number): void {
    if (!this.scene) return;
    uuids.forEach(uuid => {
      // Caso 1: Objeto estándar
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
      // Caso 2: Instancia celeste
      const instanceInfo = this._findCelestialInstance(uuid);
      if(instanceInfo) {
        instanceInfo.data.brightness = brightness;
      }
    });
  }

  /**
   * Restablece el brillo de todos los objetos de la escena a su valor por defecto (1.0).
   */
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
  // GESTIÓN DEL CICLO DE VIDA DE LA ESCENA
  // ====================================================================
  
  /**
   * Limpia la escena de todos los objetos creados dinámicamente, liberando
   * geometrías y materiales para prevenir fugas de memoria.
   */
  public clearScene(): void {
    if (!this.scene) return;
    this.removeHoverProxy();
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

  // ====================================================================
  // API PÚBLICA (Accesos directos y getters)
  // ====================================================================

  /**
   * Actualiza el nombre de un objeto y su helper asociado si lo tiene.
   * Funciona para objetos estándar e instancias.
   * @param uuid - El UUID del objeto a renombrar.
   * @param newName - El nuevo nombre.
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

  /**
   * Delega la creación de un nuevo objeto al `ObjectManager` y luego
   * actualiza la lista de entidades de la escena.
   * @param objData - Los datos del objeto a crear, provenientes de la API.
   * @returns La referencia al objeto 3D creado o `null`.
   */
  public createObjectFromData(objData: SceneObjectResponse): THREE.Object3D | null {
    const obj = this.objectManager.createObjectFromData(this.scene, objData, this.gltfLoader);
    setTimeout(() => this.publishSceneEntities(), 100);
    return obj;
  }

  /** Devuelve la instancia del LoadingManager para monitorear el progreso de carga. */
  public getLoadingManager(): THREE.LoadingManager { return this.gltfLoader.manager; }

  /** Devuelve la instancia del GLTFLoader. */
  public getGltfLoader(): GLTFLoader { return this.gltfLoader; }
  
  /** Devuelve un observable que emite la lista de entidades de la escena. */
  public getSceneEntities(): Observable<SceneEntity[]> { return this.sceneEntities.asObservable(); }

  /**
   * Busca un objeto estándar en la escena por su UUID.
   * Nota: Este método no encuentra instancias celestes.
   */
  public getObjectByUuid(uuid: string): THREE.Object3D | undefined { return this.scene.getObjectByProperty('uuid', uuid); }
}