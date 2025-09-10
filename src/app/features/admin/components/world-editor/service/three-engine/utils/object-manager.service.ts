// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/object-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
  
  public createObjectFromData(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): THREE.Object3D | null {
    let createdObject: THREE.Object3D | null = null;
    switch (objData.type) {
      case 'model':
      case 'star':
      case 'galaxy':
      case 'supernova':
      case 'diffraction_star':
        if (objData.asset?.type === 'model_glb') {
            this.loadGltfModel(scene, objData, loader);
        } else if (objData.type !== 'model' || objData.properties?.['is_black_hole']) {
           if(objData.properties?.['is_black_hole']) createdObject = this.createBlackHolePrimitive(scene, objData);
        }
        break;
      
      case 'cube':
      case 'sphere':
      case 'cone':
      case 'torus':
      case 'floor':
        createdObject = this.createStandardPrimitive(scene, objData);
        break;
      case 'camera':
        createdObject = this.createCamera(scene, objData);
        break;
      case 'directionalLight':
        createdObject = this.createDirectionalLight(scene, objData);
        break;

      default:
        console.warn(`[ObjectManager] Tipo '${objData.type}' no manejado y será ignorado.`);
        break;
    }
    return createdObject;
  }
  
  public createCelestialObjectsInstanced(scene: THREE.Scene, objectsData: SceneObjectResponse[], loader: GLTFLoader): void {
    if (!objectsData.length) return;

    const modelBasedCelestials = objectsData.filter(obj => obj.asset?.type === 'model_glb');
    const billboardCelestials = objectsData.filter(obj => obj.asset?.type !== 'model_glb');

    if (modelBasedCelestials.length > 0) {
      modelBasedCelestials.forEach(objData => this.loadGltfModel(scene, objData, loader));
    }

    if (billboardCelestials.length > 0) {
      const groupedObjects = new Map<string, SceneObjectResponse[]>();
      groupedObjects.set('__DEFAULT__', []);
      for (const obj of billboardCelestials) {
        const assetPath = (obj.asset?.type === 'texture_png' || obj.asset?.type === 'texture_jpg') ? obj.asset.path : null;
        if (assetPath) {
          if (!groupedObjects.has(assetPath)) groupedObjects.set(assetPath, []);
          groupedObjects.get(assetPath)!.push(obj);
        } else {
          groupedObjects.get('__DEFAULT__')!.push(obj);
        }
      }
      groupedObjects.forEach((groupData, key) => {
        if (groupData.length === 0) return;
        key === '__DEFAULT__' ? this._createDefaultGlowInstancedMesh(scene, groupData) : this._createTexturedInstancedMesh(scene, groupData, key);
      });
    }
  }

  private loadGltfModel(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): void {
    if (!objData.asset?.path) {
      console.error(`[ObjectManager] '${objData.name}' es un modelo pero no tiene asset válido.`);
      return;
    };
    const modelUrl = `${this.backendUrl}${objData.asset.path}`;
    
    loader.load(
        modelUrl, 
        (gltf) => {
            this._setupCelestialModel(gltf, objData);
            this.applyTransformations(gltf.scene, objData);
            scene.add(gltf.scene);
            console.log(`[ObjectManager] ✅ Modelo '${objData.name}' cargado.`, {
                scene: gltf.scene,
                animations: gltf.animations.length
            });
        },
        undefined, 
        (error) => {
            console.error(`[ObjectManager] Error al cargar ${modelUrl}:`, error);
        }
    );
  }
  
  private _setupCelestialModel(gltf: GLTF, objData: SceneObjectResponse): void {
    const emissiveColor = new THREE.Color(sanitizeHexColor(objData.emissiveColor, '#ffffff'));
      
    const farIntensity = THREE.MathUtils.clamp(objData.emissiveIntensity, 1.0, 7.0);
    const nearIntensity = 0.25;

    gltf.scene.userData['isDynamicCelestialModel'] = true;
    gltf.scene.userData['originalEmissiveIntensity'] = farIntensity;
    gltf.scene.userData['baseEmissiveIntensity'] = nearIntensity;
      
    gltf.scene.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.renderOrder = 1;

        if (child.material) {
          const processMaterial = (material: THREE.Material) => {
            const newMaterial = material.clone();
            newMaterial.transparent = true;
            newMaterial.depthWrite = true;
            newMaterial.alphaTest = 0.1;
            newMaterial.blending = THREE.NormalBlending;
            newMaterial.side = THREE.DoubleSide;

            if (newMaterial instanceof THREE.MeshStandardMaterial || newMaterial instanceof THREE.MeshPhysicalMaterial) {
              newMaterial.emissive = emissiveColor;
              newMaterial.emissiveMap = newMaterial.map; 
              newMaterial.emissiveIntensity = farIntensity;
              newMaterial.toneMapped = true; 

              if (newMaterial.map) {
                // --- ¡SOLUCIÓN A LA DISTORSIÓN DE TEXTURA! ---
                // Activa el filtrado anisotrópico para mejorar la nitidez de la textura en ángulos extremos.
                // 16 es un valor estándar de alta calidad.
                newMaterial.map.anisotropy = 16;
                newMaterial.map.needsUpdate = true;
              }
            }
            
            newMaterial.needsUpdate = true;
            return newMaterial;
          };
          child.material = Array.isArray(child.material) ? child.material.map(processMaterial) : processMaterial(child.material);
        }
      }
    });
      
    const lightPower = objData.emissiveIntensity * 20.0;
    const lightDistance = Math.max(objData.scale.x, objData.scale.y, objData.scale.z) * 50;
    const coreLight = new THREE.PointLight(emissiveColor, lightPower, lightDistance);
    coreLight.name = `${objData.name}_CoreLight`;
    gltf.scene.add(coreLight);
      
    this._setupAnimations(gltf);
  }
  
  private _setupAnimations(gltf: GLTF): void {
    if (gltf.animations && gltf.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(gltf.scene);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play();
      gltf.scene.userData['animationMixer'] = mixer;
      console.log(`[ObjectManager] Animación '${gltf.animations[0].name}' iniciada para ${gltf.scene.name}.`);
    }
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
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const instancedMesh = new THREE.InstancedMesh(geometry, material, objectsData.length);
    instancedMesh.name = `CelestialObjects_Texture_${texturePath.replace(/[^a-zA-Z0-9]/g, '_')}`;
    instancedMesh.frustumCulled = false;
    this._populateInstanceData(instancedMesh, objectsData);
    scene.add(instancedMesh);
  }
  
  private _createDefaultGlowInstancedMesh(scene: THREE.Scene, objectsData: SceneObjectResponse[]): void {
    const geometry = new THREE.CircleGeometry(6.0, 32); 
    const material = new THREE.MeshBasicMaterial({ map: this._createGlowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const instancedMesh = new THREE.InstancedMesh(geometry, material, objectsData.length);
    instancedMesh.name = 'CelestialObjects_Default';
    instancedMesh.frustumCulled = false;
    this._populateInstanceData(instancedMesh, objectsData);
    scene.add(instancedMesh);
  }
  
  private _populateInstanceData(instancedMesh: THREE.InstancedMesh, objectsData: SceneObjectResponse[]): void {
    const celestialData: CelestialInstanceData[] = [];
    instancedMesh.userData['celestialData'] = celestialData;

    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    const BASE_SCALE = 600.0, DOMINANT_LUMINOSITY_MULTIPLIER = 5.0;

    for (let i = 0; i < objectsData.length; i++) {
      const objData = objectsData[i];
      const visualColor = new THREE.Color(sanitizeHexColor(objData.emissiveColor));
      
      position.set(objData.position.x, objData.position.y, objData.position.z);
      quaternion.identity();
      scale.set(objData.scale.x, objData.scale.y, objData.scale.z);
      matrix.compose(position, quaternion, scale);
      instancedMesh.setMatrixAt(i, matrix);
      instancedMesh.setColorAt(i, new THREE.Color(0x000000));
      
      const scaleLuminosity = Math.max(1.0, objData.scale.x / BASE_SCALE);
      const dominantBoost = (objData.isDominant ?? false) ? DOMINANT_LUMINOSITY_MULTIPLIER : 1.0;
      
      celestialData.push({
          originalColor: visualColor.clone(),
          emissiveIntensity: objData.emissiveIntensity,
          position: position.clone(),
          scale: scale.clone(),
          originalMatrix: matrix.clone(),
          originalUuid: objData.id.toString(),
          originalName: objData.name,
          isVisible: false,
          isDominant: objData.isDominant ?? false,
          luminosity: scaleLuminosity * dominantBoost,
          type: objData.type,
          isManuallyHidden: false,
          brightness: 1.0
      });
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
  }
  
  private createCamera(scene: THREE.Scene, objData: SceneObjectResponse): THREE.PerspectiveCamera {
    const props = objData.properties || {};
    const camera = new THREE.PerspectiveCamera(props['fov'] ?? 50, 16 / 9, props['near'] ?? 0.1, props['far'] ?? 1000);
    this.applyTransformations(camera, objData);
    const helper = new THREE.CameraHelper(camera);
    helper.name = `${objData.name}_helper`;
    camera.userData['helper'] = helper;
    scene.add(camera, helper);
    return camera;
  }
  
  private createDirectionalLight(scene: THREE.Scene, objData: SceneObjectResponse): THREE.DirectionalLight {
    const props = objData.properties || {};
    const light = new THREE.DirectionalLight(new THREE.Color(sanitizeHexColor(props['color'])), props['intensity'] ?? 1.0);
    this.applyTransformations(light, objData);
    const helper = new THREE.DirectionalLightHelper(light, 5, 0xffffff);
    helper.name = `${objData.name}_helper`;
    light.userData['helper'] = helper;
    scene.add(light, helper);
    return light;
  }
  
  private createStandardPrimitive(scene: THREE.Scene, objData: SceneObjectResponse): THREE.Mesh {
    const properties = objData.properties || {};
    const color = new THREE.Color(sanitizeHexColor(properties['color']));
    let geometry: THREE.BufferGeometry;
    switch (objData.type) {
      case 'cube': geometry = new THREE.BoxGeometry(1, 1, 1); break;
      case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 32); break;
      case 'floor': geometry = new THREE.PlaneGeometry(1, 1); break;
      case 'torus': geometry = new THREE.TorusGeometry(0.4, 0.1, 16, 100); break;
      default: geometry = new THREE.SphereGeometry(0.5, 32, 16);
    }
    const material = new THREE.MeshStandardMaterial({ color });
    if (objData.type === 'floor') { material.side = THREE.DoubleSide; }
    const mesh = new THREE.Mesh(geometry, material);
    this.applyTransformations(mesh, objData);
    scene.add(mesh);
    return mesh;
  }
  
  private createBlackHolePrimitive(scene: THREE.Scene, objData: SceneObjectResponse): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.5, 32, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const mesh = new THREE.Mesh(geometry, material);
    this.applyTransformations(mesh, objData);
    scene.add(mesh);
    return mesh;
  }
      
  public createSelectionProxy(): THREE.Mesh {
    const proxyGeometry = new THREE.SphereGeometry(1.1, 16, 8);
    const proxyMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0, depthWrite: true });
    const proxyMesh = new THREE.Mesh(proxyGeometry, proxyMaterial);
    proxyMesh.name = 'SelectionProxy';
    return proxyMesh;
  }
  
  private _createGlowTexture(): THREE.CanvasTexture {
    if (this.glowTexture) return this.glowTexture;
    const canvas = document.createElement('canvas');
    const size = 512;
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.7)');
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    this.glowTexture = new THREE.CanvasTexture(canvas);
    this.glowTexture.needsUpdate = true;
    return this.glowTexture;
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