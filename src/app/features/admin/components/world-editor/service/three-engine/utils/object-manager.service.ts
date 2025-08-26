// src/app/..../object-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SceneObjectResponse } from '../../../../../services/admin.service';
import { environment } from '../../../../../../../../environments/environment';

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

  public createObjectFromData(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): THREE.Object3D | null {
    let createdObject: THREE.Object3D | null = null;
    switch (objData.type) {
      case 'model':
        this.loadGltfModel(scene, objData, loader);
        return null;
      
      case 'star':
      case 'galaxy':
      case 'meteor': // Asumimos que los meteoros también son objetos celestes luminosos
        createdObject = this.createCelestialObject(scene, objData);
        break;
        
      case 'cube':
      case 'sphere':
      case 'cone':
      case 'torus':
      case 'floor':
        createdObject = this.createStandardPrimitive(scene, objData);
        break;
        
      default:
        console.warn(`[ObjectManager] Tipo '${objData.type}' no manejado y será ignorado.`);
        break;
    }
    return createdObject;
  }
  
  /**
   * Crea un objeto celeste (estrella, galaxia) con materiales y datos optimizados
   * para la lógica de luz dinámica en el EngineService.
   */
  private createCelestialObject(scene: THREE.Scene, objData: SceneObjectResponse): THREE.Mesh {
    const properties = objData.properties || {};
    const originalColor = new THREE.Color(sanitizeHexColor(properties['color']));
    const magnitude = properties['absolute_magnitude'] as number || 0;
    
    // Geometría optimizada para miles de objetos.
    const geometry = new THREE.IcosahedronGeometry(0.5, 1);
    
    // Usamos MeshBasicMaterial para todos para MÁXIMO rendimiento.
    // El EngineService se encargará de actualizar su color en cada fotograma.
    const material = new THREE.MeshBasicMaterial({ color: originalColor });
    const mesh = new THREE.Mesh(geometry, material);
    
    // Almacenamos toda la información necesaria para los cálculos de luz en userData.
    // Esto es mucho más eficiente que tener diferentes tipos de materiales.
    mesh.userData['isCelestialObject'] = true;
    mesh.userData['originalColor'] = originalColor.clone();
    mesh.userData['absoluteMagnitude'] = magnitude;
    
    this.applyTransformations(mesh, objData);
    scene.add(mesh);
    return mesh;
  }

  /**
   * Crea primitivas estándar que no tienen lógica de luz dinámica.
   */
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
      }
    );
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