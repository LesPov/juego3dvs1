// src/app/features/admin/components/world-editor/service/three-engine/utils/object-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SceneObjectResponse } from '../../../../../services/admin.service';
import { environment } from '../../../../../../../../environments/environment';

/**
 * ✅ NUEVA FUNCIÓN DE AYUDA
 * Valida y limpia un string de color hexadecimal. Si no es válido, devuelve un color por defecto.
 * @param color - El string de color de entrada (ej. '#fffff', 'blue', null).
 * @param defaultColor - El color a devolver si la entrada es inválida.
 * @returns Un string de color hexadecimal válido (ej. '#ffffff').
 */
function sanitizeHexColor(color: any, defaultColor: string = '#ffffff'): string {
  if (typeof color !== 'string' || !color.startsWith('#')) {
    return defaultColor;
  }
  const hex = color.substring(1);
  // Un hexadecimal válido tiene 3 o 6 caracteres y solo contiene 0-9 y a-f.
  if (!(/^([0-9a-fA-F]{3}){1,2}$/.test(hex))) {
    return defaultColor;
  }
  return color;
}


@Injectable({ providedIn: 'root' })
export class ObjectManagerService {
  private readonly backendUrl = environment.endpoint.endsWith('/')
    ? environment.endpoint.slice(0, -1)
    : environment.endpoint;

  public createObjectFromData(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): void {
    switch (objData.type) {
      case 'model':
        this.loadGltfModel(scene, objData, loader);
        break;
      case 'cube':
      case 'sphere':
      case 'floor':
        this.createPrimitive(scene, objData);
        break;
      default:
        console.warn(`[ObjectManager] Tipo '${objData.type}' no es una malla manejable.`);
        break;
    }
  }

  private createPrimitive(scene: THREE.Scene, objData: SceneObjectResponse): void {
    // ✅ CORRECCIÓN LÓGICA: Usamos la nueva función para garantizar un color válido.
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
      case 'sphere': geometry = new THREE.SphereGeometry(0.5, 32, 16); break;
      case 'floor':
      default: geometry = new THREE.PlaneGeometry(1, 1); break;
    }

    const mesh = new THREE.Mesh(geometry, material);

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.applyTransformations(mesh, objData);

    if (objData.type === 'floor') {
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = false;
    }

    scene.add(mesh);
  }

  private loadGltfModel(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): void {
    if (!objData.asset?.path) {
      console.error(`El objeto '${objData.name}' (ID: ${objData.id}) es de tipo 'model' pero no tiene un asset válido.`);
      return;
    }

    const modelUrl = `${this.backendUrl}${objData.asset.path}`;

    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        console.log(`[ObjectManager] Modelo '${objData.name}' cargado desde ${modelUrl}`);

        this.applyTransformations(model, objData);

        const overrideColor = objData.properties?.['overrideColor'];
        let finalMaterial: THREE.Material | undefined;

        if (overrideColor) {
          console.log(`[ObjectManager] Aplicando overrideColor '${overrideColor}' al modelo '${objData.name}'.`);
          // ✅ CORRECCIÓN LÓGICA: También sanitizamos el color de override.
          const validOverrideColor = sanitizeHexColor(overrideColor);
          finalMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(validOverrideColor) });
        }

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            if (finalMaterial) {
              mesh.material = finalMaterial;
            }
          }
        });

        scene.add(model);
      },
      undefined,
      (error) => {
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
  }
}