// src/app/..../object-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SceneObjectResponse } from '../../../../../services/admin.service';
import { environment } from '../../../../../../../../environments/environment';

/**
 * Interface para almacenar los datos mínimos y esenciales de cada objeto celeste.
 * Esto es mucho más eficiente en memoria que guardar todo el objeto `SceneObjectResponse`.
 */
export interface CelestialInstanceData {
  originalColor: THREE.Color;
  absoluteMagnitude: number;
  position: THREE.Vector3;
  originalMatrix: THREE.Matrix4;
  originalUuid: string;
  originalName: string; // Añadimos el nombre para futuras referencias
}

function sanitizeHexColor(color: any, defaultColor: string = '#ffffff'): string {
  if (typeof color !== 'string' || !color.startsWith('#')) { return defaultColor; }
  const hex = color.substring(1).toLowerCase();
  if (!(/^([0-9a-f]{3}){1,2}$/.test(hex))) { return defaultColor; }
  return `#${hex}`;
}

@Injectable({ providedIn: 'root' })
export class ObjectManagerService {
  private readonly backendUrl = environment.endpoint.endsWith('/')
    ? environment.endpoint.slice(0, -1)
    : environment.endpoint;

  /**
   * Crea objetos 3D a partir de datos, EXCLUYENDO los objetos celestes
   * que se manejarán por lotes.
   */
  public createObjectFromData(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): THREE.Object3D | null {
    let createdObject: THREE.Object3D | null = null;
    switch (objData.type) {
      case 'model':
        this.loadGltfModel(scene, objData, loader);
        return null;
      case 'star': case 'galaxy': case 'meteor':
        console.warn(`[ObjectManager] Creación individual de '${objData.type}' obsoleta. Se maneja por InstancedMesh.`);
        break;
      case 'cube': case 'sphere': case 'cone': case 'torus': case 'floor':
        createdObject = this.createStandardPrimitive(scene, objData);
        break;
      default:
        console.warn(`[ObjectManager] Tipo '${objData.type}' no manejado y será ignorado.`);
        break;
    }
    return createdObject;
  }

  /**
   * Crea un único `InstancedMesh` para renderizar miles de objetos celestes
   * en una sola llamada de dibujado, mejorando drásticamente el rendimiento.
   */
  public createCelestialObjectsInstanced(scene: THREE.Scene, objectsData: SceneObjectResponse[]): void {
    if (!objectsData.length) return;

    const count = objectsData.length;
    const geometry = new THREE.IcosahedronGeometry(0.5, 1);
    const material = new THREE.MeshBasicMaterial();

    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    instancedMesh.name = 'CelestialObjectsInstanced';

    const celestialData: CelestialInstanceData[] = [];
    instancedMesh.userData['celestialData'] = celestialData;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Euler();

    for (let i = 0; i < count; i++) {
      const objData = objectsData[i];
      const properties = objData.properties || {};
      const originalColor = new THREE.Color(sanitizeHexColor(properties['color']));

      position.set(objData.position.x, objData.position.y, objData.position.z);
      rotation.set(objData.rotation.x, objData.rotation.y, objData.rotation.z);
      quaternion.setFromEuler(rotation);
      scale.set(objData.scale.x, objData.scale.y, objData.scale.z);
      matrix.compose(position, quaternion, scale);

      instancedMesh.setMatrixAt(i, matrix);
      instancedMesh.setColorAt(i, originalColor);

      celestialData.push({
        originalColor: originalColor.clone(),
        absoluteMagnitude: properties['absolute_magnitude'] as number || 0,
        position: position.clone(),
        originalMatrix: matrix.clone(),
        originalUuid: objData.id.toString(),
        originalName: objData.name,
      });
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }

    scene.add(instancedMesh);
  }

  /**
   * Crea un objeto "proxy" visualmente simple para la selección de instancias.
   * Este objeto temporal será usado para adjuntar el gizmo de transformación y mostrar el outline.
   */
  public createSelectionProxy(): THREE.Mesh {
    const proxyGeometry = new THREE.SphereGeometry(0.55, 16, 8); // Ligeramente más grande que la instancia original.
    const proxyMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,       // Color de referencia (no se ve).
      transparent: true,
      opacity: 0,            // Totalmente invisible, solo sirve como objetivo.
      depthTest: true,
    });
    const proxyMesh = new THREE.Mesh(proxyGeometry, proxyMaterial);
    proxyMesh.name = 'SelectionProxy';
    return proxyMesh;
  }
  
  private createStandardPrimitive(scene: THREE.Scene, objData: SceneObjectResponse): THREE.Mesh {
    const properties = objData.properties || {};
    const color = new THREE.Color(sanitizeHexColor(properties['color']));
    let geometry: THREE.BufferGeometry;

    switch(objData.type) {
        case 'cube': geometry = new THREE.BoxGeometry(1, 1, 1); break;
        case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 32); break;
        case 'floor': geometry = new THREE.PlaneGeometry(1, 1); break;
        default: geometry = new THREE.SphereGeometry(0.5, 32, 16);
    }

    const material = new THREE.MeshStandardMaterial({ color });
    if (objData.type === 'floor') {
      (material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    }
    
    const mesh = new THREE.Mesh(geometry, material);
    this.applyTransformations(mesh, objData);
    scene.add(mesh);
    return mesh;
  }
  
  private loadGltfModel(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): void {
    if (!objData.asset?.path) return;
    const modelUrl = `${this.backendUrl}${objData.asset.path}`;
    loader.load(modelUrl, (gltf) => {
      const model = gltf.scene;
      this.applyTransformations(model, objData);
      scene.add(model);
    });
  }

  private applyTransformations(object: THREE.Object3D, data: SceneObjectResponse): void {
    object.name = data.name;
    object.uuid = data.id.toString();
    object.position.set(data.position.x, data.position.y, data.position.z);
    object.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
    object.scale.set(data.scale.x, data.scale.y, data.scale.z);
    object.userData['apiType'] = data.type;
    object.userData['properties'] = data.properties || {};
  }
}