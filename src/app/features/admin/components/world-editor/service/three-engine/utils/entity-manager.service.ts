// src/app/features/admin/components/world-editor/service/three-engine/utils/entity-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BehaviorSubject, Observable } from 'rxjs';
import { ObjectManagerService } from './object-manager.service';
import { SelectionManagerService } from './selection-manager.service';
import { ControlsManagerService } from './controls-manager.service';
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
    private selectionManager: SelectionManagerService,
    private controlsManager: ControlsManagerService
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

  // --- ¡NUEVO MÉTODO AÑADIDO! ---
  /**
   * Busca y devuelve un objeto 3D en la escena por su UUID.
   * @param uuid El UUID del objeto a buscar.
   * @returns El objeto THREE.Object3D si se encuentra, o undefined si no.
   */
  public getObjectByUuid(uuid: string): THREE.Object3D | undefined {
    return this.scene.getObjectByProperty('uuid', uuid);
  }
  // -----------------------------

  public createObjectFromData(objData: SceneObjectResponse): void {
    switch (objData.type) {
      case 'cube': case 'sphere': case 'floor': case 'model':
        this.objectManager.createObjectFromData(this.scene, objData, this.gltfLoader);
        break;
      case 'camera': this.createCameraFromData(objData); break;
      case 'directionalLight': case 'pointLight': case 'ambientLight':
        this.createLightFromData(objData);
        break;
      default: console.warn(`[EntityManager] Tipo de objeto desconocido: '${objData.type}'.`); break;
    }
  }

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
     
    let objectsToOutline: THREE.Object3D[] = [];
    const helperToShow = this.scene.getObjectByName(`${mainObject.name}_helper`);

    if (helperToShow) {
      helperToShow.visible = true;
      this.selectedHelper = helperToShow;
      objectsToOutline = [helperToShow];
    } else {
      objectsToOutline = [mainObject];
    }
    this.selectionManager.selectObjects(objectsToOutline);
  }
  
  // ... (el resto del archivo entity-manager.service.ts no necesita cambios) ...

  public updateObjectColor(uuid: string, newColor: string): void {
    const object = this.scene.getObjectByProperty('uuid', uuid);
    if (!object) return;

    if ((object as THREE.Mesh).isMesh) {
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(newColor) });
      object.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).material = material;
        }
      });
    }

    if (object instanceof THREE.Light && 'color' in object) {
      (object as THREE.PointLight | THREE.DirectionalLight | THREE.AmbientLight).color.set(newColor);
      const helper = this.scene.getObjectByName(`${object.name}_helper`);
      if (helper && 'update' in helper) {
        (helper as THREE.PointLightHelper | THREE.DirectionalLightHelper).update();
      }
    }
  }

  public publishSceneEntities(): void {
    const unselectableNames = ['Cámara del Editor', 'Luz Ambiental', 'FocusPivot', 'EditorGrid'];
    const entities: SceneEntity[] = [];

    this.scene.children.forEach(object => {
        if ((object as THREE.Mesh).isMesh) {
            const mesh = object as THREE.Mesh;
            const isAxisCylinder = mesh.geometry instanceof THREE.CylinderGeometry &&
                                 (mesh.material as THREE.MeshBasicMaterial).isMeshBasicMaterial;

            if (!isAxisCylinder && !unselectableNames.includes(mesh.name)) {
                entities.push({ uuid: mesh.uuid, name: mesh.name, type: 'Model' });
            }
        } else if (object.name && !object.name.endsWith('_helper') && !unselectableNames.includes(object.name)) {
            let type: SceneEntity['type'] = 'Model';
            if (object instanceof THREE.Camera) type = 'Camera';
            else if (object instanceof THREE.Light) type = 'Light';
            
            entities.push({ uuid: object.uuid, name: object.name, type: type });
        }
    });

    setTimeout(() => this.sceneEntities.next(entities));
  }
// --- ¡NUEVO MÉTODO AÑADIDO! ---
/**
 * Actualiza el nombre de un objeto en la escena 3D y en la lista de entidades.
 * @param uuid El UUID del objeto a actualizar.
 * @param newName El nuevo nombre para el objeto.
 */
public updateObjectName(uuid: string, newName: string): void {
  const object = this.getObjectByUuid(uuid);
  if (object) {
    object.name = newName;
    // Después de cambiar el nombre, debemos volver a publicar la lista de entidades
    // para que la UI (la lista de objetos en la sidebar) se actualice.
    this.publishSceneEntities();
  }
}
  private createCameraFromData(data: SceneObjectResponse): void {
    const props = data.properties || {};
    const camera = new THREE.PerspectiveCamera(props['fov'] || 75, 1, props['near'] || 0.1, props['far'] || 1000);
    this.applyTransformations(camera, data);
    const helper = new THREE.CameraHelper(camera);
    helper.name = `${data.name}_helper`;
    helper.visible = false;
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
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        const shadowCamSize = 15;
        dirLight.shadow.camera.left = -shadowCamSize;
        dirLight.shadow.camera.right = shadowCamSize;
        dirLight.shadow.camera.top = shadowCamSize;
        dirLight.shadow.camera.bottom = -shadowCamSize;
        dirLight.shadow.bias = -0.0005;

        light = dirLight;
        helper = new THREE.DirectionalLightHelper(dirLight, 2, color);
        helper.name = `${data.name}_helper`;
        helper.visible = false;
        break;
      case 'pointLight':
        const pointLight = new THREE.PointLight(color, intensity, props['distance'] || 0, props['decay'] || 2);
        pointLight.castShadow = true;
        pointLight.shadow.mapSize.width = 1024;
        pointLight.shadow.mapSize.height = 1024;
        pointLight.shadow.bias = -0.0005;
        light = pointLight;
        helper = new THREE.PointLightHelper(pointLight, 1, color);
        helper.name = `${data.name}_helper`;
        helper.visible = false;
        break;
      case 'ambientLight':
        light = new THREE.AmbientLight(color, intensity);
        break;
      default: return;
    }
    this.applyTransformations(light, data);
    this.scene.add(light);
    if (helper) {
      this.scene.add(helper);
    }
  }

  private applyTransformations(object: THREE.Object3D, data: SceneObjectResponse): void {
    object.uuid = data.id.toString();
    object.name = data.name;
    object.position.set(data.position.x, data.position.y, data.position.z);
    object.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
    object.scale.set(data.scale.x, data.scale.y, data.scale.z);
  }
}