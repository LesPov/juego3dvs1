import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { environment } from '../../../../../../../../environments/environment';
import { SceneObjectResponse } from '../../../../../services/admin.service';
import { LabelManagerService } from './label-manager.service';

/**
 * @constant BLOOM_LAYER
 * @description
 * Define la capa de renderizado para los objetos que deben ser procesados por el `UnrealBloomPass`.
 * Los objetos que no estén en esta capa no generarán el efecto de brillo (bloom).
 */
export const BLOOM_LAYER = 1;

/**
 * @interface CelestialInstanceData
 * @description Almacena toda la información relevante de una sola instancia dentro de un `InstancedMesh`.
 * Esto evita tener que acceder a datos de la API repetidamente y permite mantener estados
 * como la visibilidad o el brillo de forma individual.
 */
export interface CelestialInstanceData {
  originalColor: THREE.Color;    // Color base del objeto.
  emissiveIntensity: number;     // Intensidad emisiva máxima (cuando está cerca).
  baseEmissiveIntensity: number; // Intensidad emisiva mínima (cuando está lejos).
  position: THREE.Vector3;       // Posición en el mundo.
  originalMatrix: THREE.Matrix4; // Matriz de transformación original y completa.
  originalUuid: string;          // UUID de la base de datos.
  originalName: string;          // Nombre original.
  scale: THREE.Vector3;          // Escala del objeto.
  isDominant: boolean;           // Si es un objeto "dominante" (más luminoso).
  luminosity: number;            // Factor calculado que afecta a la distancia de visibilidad.
  type: string;                  // Tipo de objeto (e.g., 'galaxy_far').
  isManuallyHidden: boolean;     // Si el usuario lo ha ocultado explícitamente.
  brightness: number;            // Factor de brillo manual (0.0 a 1.0).
  currentIntensity: number;      // Intensidad de renderizado actual para el efecto de fade.
}

/**
 * Función de utilidad para validar y limpiar un valor de color hexadecimal.
 * @param color - El valor de color a procesar.
 * @param defaultColor - Un color por defecto si el valor de entrada es inválido.
 * @returns Un string de color hexadecimal válido (e.g., '#ffffff').
 */
function sanitizeHexColor(color: any, defaultColor: string = '#ffffff'): string {
  if (typeof color !== 'string' || !color.startsWith('#')) { return defaultColor; }
  const hex = color.substring(1).toLowerCase();
  if (!(/^([0-9a-f]{3}){1,2}$/.test(hex))) { return defaultColor; }
  return `#${hex}`;
}

/**
 * @class ObjectManagerService
 * @description
 * Este servicio es la **fábrica** de objetos del motor 3D. Su única responsabilidad es
 * crear objetos de Three.js (`THREE.Object3D`) a partir de los datos crudos
 * que provienen de la API (`SceneObjectResponse`).
 */
@Injectable({ providedIn: 'root' })
export class ObjectManagerService {

  private readonly backendUrl = environment.endpoint.endsWith('/')
    ? environment.endpoint.slice(0, -1)
    : environment.endpoint;

  private textureLoader = new THREE.TextureLoader();
  private textureCache = new Map<string, THREE.Texture>();
  private glowTexture: THREE.CanvasTexture | null = null;
  
  private sharedPlaneGeometry = new THREE.PlaneGeometry(1, 1);
  private sharedCircleGeometry = new THREE.CircleGeometry(6.0, 32);

  constructor(private labelManager: LabelManagerService) {}

  public createObjectFromData(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): THREE.Object3D | null {
    let createdObject: THREE.Object3D | null = null;
    switch (objData.type) {
      case 'model':
      case 'galaxy_normal':
      case 'galaxy_bright':
      case 'galaxy_medium':
      case 'galaxy_far':
        if (objData.asset?.type === 'model_glb') {
            this.loadGltfModel(scene, objData, loader);
        } else if (objData.properties?.['is_black_hole']) {
            createdObject = this.createBlackHolePrimitive(scene, objData);
        }
        break;
      case 'cube': case 'sphere': case 'cone': case 'torus': case 'floor':
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

    if (createdObject) {
      this.labelManager.registerObject(createdObject);
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
        key === '__DEFAULT__' 
          ? this._createDefaultGlowInstancedMesh(scene, groupData) 
          : this._createTexturedInstancedMesh(scene, groupData, key);
      });
    }
  }

  private loadGltfModel(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): void {
    if (!objData.asset?.path) {
      console.error(`[ObjectManager] '${objData.name}' es un modelo pero no tiene asset válido.`);
      return;
    };
    const modelUrl = `${this.backendUrl}${objData.asset.path}`;
    loader.load( modelUrl, (gltf) => {
      this._setupCelestialModel(gltf, objData);
      this.applyTransformations(gltf.scene, objData);
      this.labelManager.registerObject(gltf.scene);
      scene.add(gltf.scene);
    });
  }

   private _setupCelestialModel(gltf: GLTF, objData: SceneObjectResponse): void {
    const galaxyInfo = objData.galaxyData;
    const farIntensity = galaxyInfo ? THREE.MathUtils.clamp(galaxyInfo.emissiveIntensity, 1.0, 7.0) : 1.0;
    
    gltf.scene.userData['isDynamicCelestialModel'] = true;
    gltf.scene.userData['originalEmissiveIntensity'] = farIntensity;
    gltf.scene.userData['baseEmissiveIntensity'] = 0.5;

    gltf.scene.layers.enable(BLOOM_LAYER);
    gltf.scene.traverse(child => {
      if (child instanceof THREE.Mesh) {
          child.layers.enable(BLOOM_LAYER);
      }
    });

    const auraColor = new THREE.Color(sanitizeHexColor(galaxyInfo?.emissiveColor, '#ffffff'));
    const lightPower = (galaxyInfo?.emissiveIntensity || 1.0) * 20.0;
    const lightDistance = Math.max(objData.scale.x, objData.scale.y, objData.scale.z) * 50;
    const coreLight = new THREE.PointLight(auraColor, lightPower, lightDistance);
    coreLight.name = `${objData.name}_CoreLight`;
    coreLight.layers.enable(BLOOM_LAYER);
    gltf.scene.add(coreLight);
    this._setupAnimations(gltf);
  }
  private _setupAnimations(gltf: GLTF): void {
    if (gltf.animations?.length > 0) {
      const mixer = new THREE.AnimationMixer(gltf.scene);
      gltf.animations.forEach(clip => mixer.clipAction(clip).play());
      gltf.scene.userData['animationMixer'] = mixer;
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
    
    const material = new THREE.MeshBasicMaterial({ 
        map: texture, 
        transparent: true, 
        blending: THREE.AdditiveBlending, 
        depthWrite: false, 
        side: THREE.DoubleSide 
    });
    
    const instancedMesh = new THREE.InstancedMesh(this.sharedCircleGeometry, material, objectsData.length);
    
    instancedMesh.name = `CelestialObjects_Texture_${texturePath.replace(/[^a-zA-Z0-9]/g, '_')}`;
    instancedMesh.frustumCulled = false;
    instancedMesh.layers.enable(BLOOM_LAYER);
    // ================== SOLUCIÓN PARPADEO ==================
    instancedMesh.renderOrder = 1; // Damos prioridad de renderizado para evitar Z-fighting
    // ================== FIN SOLUCIÓN PARPADEO ==================
    this._populateInstanceData(instancedMesh, objectsData);
    scene.add(instancedMesh);
  }

  private _createDefaultGlowInstancedMesh(scene: THREE.Scene, objectsData: SceneObjectResponse[]): void {
    const material = new THREE.MeshBasicMaterial({ 
        map: this._createGlowTexture(), 
        transparent: true, 
        blending: THREE.AdditiveBlending, 
        depthWrite: false 
    });
    const instancedMesh = new THREE.InstancedMesh(this.sharedCircleGeometry, material, objectsData.length);

    instancedMesh.name = 'CelestialObjects_Default';
    instancedMesh.frustumCulled = false;
    instancedMesh.layers.enable(BLOOM_LAYER);
    // ================== SOLUCIÓN PARPADEO ==================
    instancedMesh.renderOrder = 1; // Damos prioridad de renderizado para evitar Z-fighting
    // ================== FIN SOLUCIÓN PARPADEO ==================
    this._populateInstanceData(instancedMesh, objectsData);
    scene.add(instancedMesh);
  }

   private _populateInstanceData(instancedMesh: THREE.InstancedMesh, objectsData: SceneObjectResponse[]): void {
    const celestialData: CelestialInstanceData[] = [];
    instancedMesh.userData['celestialData'] = celestialData;

    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();

    for (let i = 0; i < objectsData.length; i++) {
      const objData = objectsData[i];
      const galaxyInfo = objData.galaxyData;

      if (!galaxyInfo) {
        console.warn(`[ObjectManager] Objeto '${objData.name}' es de tipo galaxia pero no tiene 'galaxyData'. Se omitirá.`);
        continue;
      }
      
      const visualColor = new THREE.Color(sanitizeHexColor(galaxyInfo.emissiveColor));

      position.set(objData.position.x, objData.position.y, objData.position.z);
      quaternion.identity();
      scale.set(objData.scale.x, objData.scale.y, objData.scale.z);
      matrix.compose(position, quaternion, scale);
      instancedMesh.setMatrixAt(i, matrix);
      instancedMesh.setColorAt(i, new THREE.Color(0x000000));

      const scaleLuminosity = Math.max(1.0, objData.scale.x / 600.0);
      const dominantBoost = (galaxyInfo.isDominant ?? false) ? 5.0 : 1.0;

      const instanceData: CelestialInstanceData = {
          originalColor: visualColor.clone(),
          emissiveIntensity: THREE.MathUtils.clamp(galaxyInfo.emissiveIntensity, 1.0, 5.0),
          baseEmissiveIntensity: 1.0,
          position: position.clone(),
          scale: scale.clone(),
          originalMatrix: matrix.clone(),
          originalUuid: objData.id.toString(),
          originalName: objData.name,
          isDominant: galaxyInfo.isDominant ?? false,
          luminosity: scaleLuminosity * dominantBoost,
          type: objData.type,
          isManuallyHidden: false,
          brightness: 1.0,
          currentIntensity: 0.0
      };
      celestialData.push(instanceData);

      this.labelManager.registerInstancedObject(instanceData);
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
  
  public createSelectionProxy(geometry: THREE.BufferGeometry = new THREE.SphereGeometry(1.1, 16, 8)): THREE.Mesh {
    const proxyMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0, depthWrite: false });
    const proxyMesh = new THREE.Mesh(geometry, proxyMaterial);
    proxyMesh.name = 'SelectionProxy';
    return proxyMesh;
  }
  
  public isSharedGeometry(geometry: THREE.BufferGeometry): boolean {
    return geometry === this.sharedCircleGeometry || geometry === this.sharedPlaneGeometry;
  }

  private _createGlowTexture(): THREE.CanvasTexture {
    if (this.glowTexture) return this.glowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(256, 256, 0, 256, 256, 256);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.7)');
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);
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