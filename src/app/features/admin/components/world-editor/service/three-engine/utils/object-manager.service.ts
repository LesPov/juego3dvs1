// object-manager.service.ts
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

  /**
   * Modificado para devolver el objeto recién creado.
   * @returns El THREE.Object3D creado, o null si no se creó una malla.
   */
  public createObjectFromData(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): THREE.Object3D | null {
    let createdObject: THREE.Object3D | null = null;
    switch (objData.type) {
      case 'model':
        // La carga de modelos es asíncrona, por lo que no podemos devolver el objeto directamente.
        // La lógica de añadir a la lista de culling se manejará cuando se complete la carga.
        // Por ahora, devolvemos null y dejamos que el EngineService obtenga la lista completa después.
        this.loadGltfModel(scene, objData, loader);
        return null;
      
      case 'cube':
      case 'sphere':
      case 'floor':
      case 'cone':
      case 'torus':
      case 'star':
      case 'galaxy':
      case 'meteor':
        createdObject = this.createPrimitive(scene, objData);
        break;
        
      default:
        console.warn(`[ObjectManager] Tipo '${objData.type}' no es una malla manejable y será ignorado.`);
        break;
    }
    return createdObject;
  }

  private createPrimitive(scene: THREE.Scene, objData: SceneObjectResponse): THREE.Mesh {
    const validColorHex = sanitizeHexColor(objData.properties?.['color']);
    const color = new THREE.Color(validColorHex);
    
    const materialConfig: THREE.MeshStandardMaterialParameters = { color };
    if (objData.type === 'floor') {
      materialConfig.side = THREE.DoubleSide;
    }
    
    const material = new THREE.MeshStandardMaterial(materialConfig);
    let geometry: THREE.BufferGeometry;

    switch (objData.type) {
      case 'cube': geometry = new THREE.BoxGeometry(1, 1, 1); break;
      case 'sphere': case 'star': case 'galaxy': case 'meteor': geometry = new THREE.SphereGeometry(0.5, 32, 16); break;
      case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 32); break;
      case 'torus': geometry = new THREE.TorusGeometry(0.5, 0.2, 16, 32); break;
      case 'floor': geometry = new THREE.PlaneGeometry(1, 1); break;
      default: geometry = new THREE.BoxGeometry(1, 1, 1); // Fallback
    }
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    // Es una buena práctica para el culling interno de Three.js
    mesh.geometry.computeBoundingSphere();

    this.applyTransformations(mesh, objData);

    if (objData.type === 'floor') {
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = false;
    }
    
    scene.add(mesh);
    return mesh; // Devolvemos la malla creada
  }

  private loadGltfModel(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): void {
    if (!objData.asset?.path) {
      console.error(`El objeto '${objData.name}' (ID: ${objData.id}) es de tipo 'model' pero no tiene un asset válido.`);
      return;
    }

    const modelUrl = `${this.backendUrl}${objData.asset.path}`;
    
    loader.load( modelUrl, (gltf) => {
        const model = gltf.scene;
        this.applyTransformations(model, objData);
        
        const overrideColor = objData.properties?.['overrideColor'];
        if (overrideColor) {
          const finalMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(sanitizeHexColor(overrideColor)) });
          model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              (child as THREE.Mesh).material = finalMaterial;
            }
          });
        }
        
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            (child as THREE.Mesh).castShadow = true;
            (child as THREE.Mesh).receiveShadow = true;
            (child as THREE.Mesh).geometry.computeBoundingSphere(); // Buena práctica
          }
        });
        
        scene.add(model);
      }, undefined, (error) => {
        console.error(`[ObjectManager] ERROR al cargar modelo '${objData.name}' desde ${modelUrl}:`, error);
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
  }
}