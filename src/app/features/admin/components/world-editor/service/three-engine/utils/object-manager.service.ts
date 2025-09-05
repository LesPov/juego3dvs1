// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/object-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { environment } from '../../../../../../../../environments/environment';
import { SceneObjectResponse } from '../../../../../services/admin.service';

export interface CelestialInstanceData {
  originalColor: THREE.Color;
  emissiveIntensity: number;
  position: THREE.Vector3;
  originalMatrix: THREE.Matrix4;
  originalUuid: string;
  originalName: string;
  scale: THREE.Vector3;
  isVisible: boolean;
  isDominant: boolean;
  luminosity: number;
  type: string;
  isManuallyHidden: boolean;
  brightness: number;
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

  private textureLoader = new THREE.TextureLoader();
  private textureCache = new Map<string, THREE.Texture>();
  private glowTexture: THREE.CanvasTexture | null = null;

  public createCelestialObjectsInstanced(scene: THREE.Scene, objectsData: SceneObjectResponse[]): void {
    if (!objectsData.length) return;

    const groupedObjects = new Map<string, SceneObjectResponse[]>();
    groupedObjects.set('__DEFAULT__', []); 

    for (const obj of objectsData) {
      const assetPath = (obj.asset?.type === 'texture_png' || obj.asset?.type === 'texture_jpg') 
        ? obj.asset.path 
        : null;

      if (assetPath) {
        if (!groupedObjects.has(assetPath)) {
          groupedObjects.set(assetPath, []);
        }
        groupedObjects.get(assetPath)!.push(obj);
      } else {
        groupedObjects.get('__DEFAULT__')!.push(obj);
      }
    }

    groupedObjects.forEach((groupData, key) => {
      if (groupData.length === 0) return;

      if (key === '__DEFAULT__') {
        this._createDefaultGlowInstancedMesh(scene, groupData);
      } else {
        this._createTexturedInstancedMesh(scene, groupData, key);
      }
    });
  }

  private _createTexturedInstancedMesh(scene: THREE.Scene, objectsData: SceneObjectResponse[], texturePath: string): void {
      const textureUrl = `${this.backendUrl}${texturePath}`;
      let texture = this.textureCache.get(textureUrl);
      if (!texture) {
        texture = this.textureLoader.load(textureUrl);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.textureCache.set(textureUrl, texture);
      }

      const geometry = new THREE.PlaneGeometry(1, 1);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      material.onBeforeCompile = (shader) => { /* shader sigue igual */ };

      const instancedMesh = new THREE.InstancedMesh(geometry, material, objectsData.length);
      const sanitizedName = texturePath.replace(/[^a-zA-Z0-9]/g, '_');
      instancedMesh.name = `CelestialObjects_Texture_${sanitizedName}`;
      instancedMesh.frustumCulled = false;

      this._populateInstanceData(instancedMesh, objectsData);
      scene.add(instancedMesh);
  }

  private _createDefaultGlowInstancedMesh(scene: THREE.Scene, objectsData: SceneObjectResponse[]): void {
      const geometry = new THREE.CircleGeometry(4.0, 32); 
      const material = new THREE.MeshBasicMaterial({
        map: this._createGlowTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      material.onBeforeCompile = (shader) => { /* shader sigue igual */ };

      const instancedMesh = new THREE.InstancedMesh(geometry, material, objectsData.length);
      instancedMesh.name = 'CelestialObjects_Default';
      instancedMesh.frustumCulled = false;
      
      this._populateInstanceData(instancedMesh, objectsData);
      scene.add(instancedMesh);
  }
  
  private _populateInstanceData(instancedMesh: THREE.InstancedMesh, objectsData: SceneObjectResponse[]): void {
    const celestialData: CelestialInstanceData[] = [];
    instancedMesh.userData['celestialData'] = celestialData;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    const BASE_SCALE = 600.0;
    const DOMINANT_LUMINOSITY_MULTIPLIER = 5.0;

    for (let i = 0; i < objectsData.length; i++) {
      const objData = objectsData[i];
      const visualColor = new THREE.Color(sanitizeHexColor(objData.emissiveColor));
      const emissiveIntensity = objData.emissiveIntensity;
      const isDominant = objData.isDominant ?? false;
      
      position.set(objData.position.x, objData.position.y, objData.position.z);
      quaternion.identity();
      scale.set(objData.scale.x, objData.scale.y, objData.scale.z);
      matrix.compose(position, quaternion, scale);
      instancedMesh.setMatrixAt(i, matrix);
      instancedMesh.setColorAt(i, new THREE.Color(0x000000));
      
      const scaleLuminosity = Math.max(1.0, objData.scale.x / BASE_SCALE);
      const dominantBoost = isDominant ? DOMINANT_LUMINOSITY_MULTIPLIER : 1.0;
      const finalLuminosity = scaleLuminosity * dominantBoost;

      celestialData.push({
          originalColor: visualColor.clone(),
          emissiveIntensity: emissiveIntensity,
          position: position.clone(),
          scale: scale.clone(),
          originalMatrix: matrix.clone(),
          originalUuid: objData.id.toString(),
          originalName: objData.name,
          isVisible: false,
          isDominant: isDominant,
          luminosity: finalLuminosity,
          type: objData.type,
          isManuallyHidden: false,
          brightness: 1.0
      });
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
  }

  // ... El resto de tus métodos permanecen igual ...
  private _createGlowTexture(): THREE.CanvasTexture { if (this.glowTexture) return this.glowTexture; const canvas = document.createElement('canvas'); const size = 256; canvas.width = size; canvas.height = size; const context = canvas.getContext('2d')!; const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); gradient.addColorStop(0, 'rgba(255, 255, 255, 1)'); gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)'); gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)'); gradient.addColorStop(1, 'rgba(0, 0, 0, 0)'); context.fillStyle = gradient; context.fillRect(0, 0, size, size); this.glowTexture = new THREE.CanvasTexture(canvas); this.glowTexture.needsUpdate = true; return this.glowTexture; }
  public createObjectFromData(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): THREE.Object3D | null { let createdObject: THREE.Object3D | null = null; switch (objData.type) { case 'model': if (objData.properties?.['is_black_hole']) { createdObject = this.createBlackHolePrimitive(scene, objData); } else { this.loadGltfModel(scene, objData, loader); } break; case 'star': case 'galaxy': case 'supernova': case 'diffraction_star': console.warn(`[ObjectManager] La creación individual de '${objData.type}' se maneja por InstancedMesh.`); break; case 'cube': case 'sphere': case 'cone': case 'torus': case 'floor': createdObject = this.createStandardPrimitive(scene, objData); break; default: console.warn(`[ObjectManager] Tipo '${objData.type}' no manejado y será ignorado.`); break; } return createdObject; }
  public createSelectionProxy(): THREE.Mesh { const proxyGeometry = new THREE.SphereGeometry(1.1, 16, 8); const proxyMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0, depthWrite: true, depthTest: true }); const proxyMesh = new THREE.Mesh(proxyGeometry, proxyMaterial); proxyMesh.name = 'SelectionProxy'; return proxyMesh; }
  private createBlackHolePrimitive(scene: THREE.Scene, objData: SceneObjectResponse): THREE.Mesh { const geometry = new THREE.SphereGeometry(0.5, 32, 16); const material = new THREE.MeshBasicMaterial({ color: 0x000000 }); const mesh = new THREE.Mesh(geometry, material); this.applyTransformations(mesh, objData); scene.add(mesh); return mesh; }
  private createStandardPrimitive(scene: THREE.Scene, objData: SceneObjectResponse): THREE.Mesh { const properties = objData.properties || {}; const color = new THREE.Color(sanitizeHexColor(properties['color'])); let geometry: THREE.BufferGeometry; switch (objData.type) { case 'cube': geometry = new THREE.BoxGeometry(1, 1, 1); break; case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 32); break; case 'floor': geometry = new THREE.PlaneGeometry(1, 1); break; default: geometry = new THREE.SphereGeometry(0.5, 32, 16); } const material = new THREE.MeshStandardMaterial({ color }); if (objData.type === 'floor') { (material as THREE.MeshStandardMaterial).side = THREE.DoubleSide; } const mesh = new THREE.Mesh(geometry, material); this.applyTransformations(mesh, objData); scene.add(mesh); return mesh; }
  private loadGltfModel(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): void { if (!objData.asset?.path) return; const modelUrl = `${this.backendUrl}${objData.asset.path}`; loader.load(modelUrl, (gltf) => { const model = gltf.scene; this.applyTransformations(model, objData); scene.add(model); }); }
  private applyTransformations(object: THREE.Object3D, data: SceneObjectResponse): void { object.name = data.name; object.uuid = data.id.toString(); object.position.set(data.position.x, data.position.y, data.position.z); object.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z); object.scale.set(data.scale.x, data.scale.y, data.scale.z); object.userData['apiType'] = data.type; object.userData['properties'] = data.properties || {}; }
}