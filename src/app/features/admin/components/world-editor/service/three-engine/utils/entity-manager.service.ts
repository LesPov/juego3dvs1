// entity-manager.service.ts
import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BehaviorSubject, Observable } from 'rxjs';
import { ObjectManagerService } from './object-manager.service';
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
  private unselectableNames = ['Cámara del Editor', 'Luz Ambiental', 'FocusPivot', 'EditorGrid'];

  constructor(
    private objectManager: ObjectManagerService,
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
        if (this.unselectableNames.includes(object.name)) {
            continue;
        }
        if (object.type !== 'Scene' && object.type !== 'GridHelper') {
            this.scene.remove(object);
            if ((object as THREE.Mesh).isMesh) {
                const mesh = object as THREE.Mesh;
                mesh.geometry?.dispose();
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(material => material.dispose());
                } else {
                    (mesh.material as THREE.Material)?.dispose();
                }
            }
        }
    }
    this.publishSceneEntities();
  }

  // --- LÓGICA DE OPTIMIZACIÓN: Nueva función para el EngineService ---
  /**
   * Devuelve una lista de todos los objetos en la escena que son elegibles para el culling.
   * Filtra luces, cámaras, helpers y otros objetos no visuales.
   */
   public getAllCullableObjects(): THREE.Object3D[] {
    if (!this.scene) return [];
    return this.scene.children.filter(obj => 
      (obj instanceof THREE.Mesh || obj instanceof THREE.Group) &&
      !this.unselectableNames.includes(obj.name) &&
      !obj.name.endsWith('_helper')
    );
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

  /**
   * Modificado para devolver el objeto recién creado.
   * @returns El THREE.Object3D creado, o null si no se creó una malla.
   */
  public createObjectFromData(objData: SceneObjectResponse): THREE.Object3D | null {
    let createdObject: THREE.Object3D | null = null;
    switch (objData.type) {
      case 'cube':
      case 'sphere':
      case 'floor':
      case 'model':
      case 'cone':
      case 'torus':
      case 'star':
      case 'galaxy':
      case 'meteor':
        createdObject = this.objectManager.createObjectFromData(this.scene, objData, this.gltfLoader);
        break;
      case 'camera': 
        this.createCameraFromData(objData); 
        break;
      case 'directionalLight': 
      case 'ambientLight':
        this.createLightFromData(objData);
        break;
      default: 
        console.warn(`[EntityManager] Tipo de objeto desconocido: '${objData.type}'.`); 
        break;
    }
    return createdObject;
  }
  
  public selectObjectByUuid(uuid: string | null, focusPivot: THREE.Object3D): void {
    // La lógica de selección se mantiene, pero no podrá seleccionar estrellas/galaxias individuales,
    // lo cual es correcto para la optimización de rendimiento.
    if (this.selectedHelper) {
      this.selectedHelper.visible = false;
      this.selectedHelper = null;
    }
    if (!uuid) {
      this.selectionManager.selectObjects([]);
      return;
    }
    const mainObject = this.getObjectByUuid(uuid);
    if (!mainObject) {
      this.selectionManager.selectObjects([]);
      return;
    }
    focusPivot.position.copy(mainObject.position);
    const helperToShow = mainObject.userData['helper'] as THREE.Object3D | undefined;
    const objectsToOutline: THREE.Object3D[] = helperToShow ? [helperToShow] : [mainObject];
    if (helperToShow) {
      helperToShow.visible = true;
      this.selectedHelper = helperToShow;
    }
    this.selectionManager.selectObjects(objectsToOutline);
  }
  
  public updateObjectColor(uuid: string, newColor: string): void {
    const object = this.getObjectByUuid(uuid);
    if (!object) return;

    const sanitizedColor = sanitizeHexColor(newColor, '#ffffff');

    if ((object as THREE.Mesh).isMesh) {
      const mesh = object as THREE.Mesh;
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => (m as THREE.MeshStandardMaterial).color.set(sanitizedColor));
      } else {
        ((mesh.material as THREE.MeshStandardMaterial).color as THREE.Color).set(sanitizedColor);
      }
    }
    if (object instanceof THREE.Light && 'color' in object) {
      (object as THREE.Light).color.set(sanitizedColor);
      const helper = object.userData['helper'] as THREE.PointLightHelper | THREE.DirectionalLightHelper;
      if (helper) {
        if (helper.color && helper.color instanceof THREE.Color) {
            helper.color.set(sanitizedColor);
        }
        if ('update' in helper) (helper as any).update();
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
    const entities: SceneEntity[] = [];
    this.scene.children.forEach(object => {
        if (!object.name.endsWith('_helper') && !this.unselectableNames.includes(object.name)) {
            const apiType = object.userData['apiType'] as SceneEntity['type'] | undefined;
            let entityType: SceneEntity['type'];
            
            if (apiType) {
              entityType = apiType;
            } else {
              entityType = object instanceof THREE.Camera ? 'Camera' : (object instanceof THREE.Light ? 'Light' : 'Model');
            }
            entities.push({ uuid: object.uuid, name: object.name, type: entityType });
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
    const color = new THREE.Color(sanitizeHexColor(props['color']));
    const intensity = props['intensity'] || 1;

    switch (data.type) {
      case 'directionalLight':
        const dirLight = new THREE.DirectionalLight(color, intensity);
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
    object.userData['apiType'] = data.type;
  }
}