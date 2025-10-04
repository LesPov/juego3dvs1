import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { environment } from '../../../../../../../../environments/environment';
import { SceneObjectResponse, AssetResponse } from '../../../../../services/admin.service';
import { LabelManagerService } from './label-manager.service';

/**
 * @constant BLOOM_LAYER
 * @description Define la capa de renderizado para objetos con efecto de brillo (bloom).
 */
export const BLOOM_LAYER = 1;

/**
 * @interface CelestialInstanceData
 * @description Almacena la información de una sola instancia dentro de un `InstancedMesh`.
 */
export interface CelestialInstanceData {
  originalColor: THREE.Color;
  emissiveIntensity: number;
  baseEmissiveIntensity: number;
  position: THREE.Vector3;
  originalMatrix: THREE.Matrix4;
  originalUuid: string;
  originalName: string;
  scale: THREE.Vector3;
  isDominant: boolean;
  luminosity: number;
  type: string;
  isManuallyHidden: boolean;
  brightness: number;
  currentIntensity: number;
}

/**
 * @function sanitizeHexColor
 * @description Valida y limpia un valor de color hexadecimal.
 */
function sanitizeHexColor(color: any, defaultColor: string = '#ffffff'): string {
  if (typeof color !== 'string' || !color.startsWith('#')) { return defaultColor; }
  const hex = color.substring(1).toLowerCase();
  if (!(/^([0-9a-f]{3}){1,2}$/.test(hex))) { return defaultColor; }
  return `#${hex}`;
}

/**
 * @class ObjectManagerService
 * @description Fábrica de objetos 3D a partir de datos de la API.
 */
@Injectable({ providedIn: 'root' })
export class ObjectManagerService {

  private readonly backendUrl = environment.endpoint.endsWith('/')
    ? environment.endpoint.slice(0, -1)
    : environment.endpoint;

  private textureLoader = new THREE.TextureLoader();
  private textureCache = new Map<string, THREE.Texture>();
  private wmtsTextureCache = new Map<string, Promise<THREE.Texture>>();

  private glowTexture: THREE.CanvasTexture | null = null;
  private sharedPlaneGeometry = new THREE.PlaneGeometry(1, 1);
  private sharedCircleGeometry = new THREE.CircleGeometry(12.0, 32);

  private tempBox = new THREE.Box3();
  private tempSize = new THREE.Vector3();
  private tempCenter = new THREE.Vector3();

  constructor(private labelManager: LabelManagerService) { }

  public createObjectFromData(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): THREE.Object3D | null {
    let createdObject: THREE.Object3D | null = null;
    
    // La regla de oro: si tiene un asset WMTS, es un planeta.
    if (objData.asset && objData.asset.path.includes('{TileMatrix}')) {
        console.log(`[ObjectManager] Detectado asset WMTS para '${objData.name}'. Creando como cuerpo planetario.`);
        this._createWmtsCelestialBody(scene, objData);
        return null; // El objeto se añade a la escena internamente.
    }

    // Si tiene un asset de modelo 3D.
    if (objData.asset?.type === 'model_glb') {
        console.log(`[ObjectManager] Creando '${objData.name}' como modelo GLB.`);
        this.loadGltfModel(scene, objData, loader);
        return null;
    }

    // Para todos los demás objetos (primitivas estándar, luces, etc.).
    switch (objData.type) {
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
        // Si no es ninguno de los anteriores, se asume que es un billboard y se ignora aquí,
        // ya que debería haber sido procesado por `createCelestialObjectsInstanced`.
        console.warn(`[ObjectManager] Tipo '${objData.type}' no es un objeto individual y será ignorado en este método.`);
        break;
    }

    if (createdObject) {
      this.labelManager.registerObject(createdObject);
    }

    return createdObject;
  }
  public createCelestialObjectsInstanced(scene: THREE.Scene, objectsData: SceneObjectResponse[], loader: GLTFLoader): void {
    if (!objectsData.length) return;
  
    const groupedByTexture = new Map<string, SceneObjectResponse[]>();
    const defaultGroup: SceneObjectResponse[] = [];

    for (const obj of objectsData) {
      // Agrupamos por textura de imagen (PNG/JPG) o los ponemos en el grupo por defecto.
      const assetPath = (obj.asset?.type === 'texture_png' || obj.asset?.type === 'texture_jpg') 
        ? obj.asset.path 
        : null;
      
      if (assetPath) {
        if (!groupedByTexture.has(assetPath)) {
          groupedByTexture.set(assetPath, []);
        }
        groupedByTexture.get(assetPath)!.push(obj);
      } else {
        defaultGroup.push(obj);
      }
    }
  
    // Creamos un InstancedMesh para el grupo por defecto (puntos de luz)
    if (defaultGroup.length > 0) {
      this._createDefaultGlowInstancedMesh(scene, defaultGroup);
    }

    // Creamos un InstancedMesh para cada grupo de texturas
    groupedByTexture.forEach((groupData, texturePath) => {
      this._createTexturedInstancedMesh(scene, groupData, texturePath);
    });
  }
  private _createWmtsCelestialBody(scene: THREE.Scene, objData: SceneObjectResponse): void {
    if (!objData.asset) { 
        console.error(`[ObjectManager] Objeto '${objData.name}' no tiene 'asset' y no se puede crear como cuerpo WMTS.`);
        return;
    }

    // ✨ LÓGICA DE ESCALA CORREGIDA ✨
    // Se asume que el valor de `objData.scale.x` representa directamente el RADIO deseado del planeta.
    // Creamos la geometría con este radio y evitamos escalar un grupo padre para mayor simplicidad y robustez.
    const radius = objData.scale.x;

    if (radius <= 0) {
        console.warn(`[ObjectManager] WMTS object '${objData.name}' has an invalid radius of ${radius}.`);
        return;
    }

    // La calidad de la geometría se mantiene alta.
    const geometry = new THREE.SphereGeometry(radius, 128, 64); 
    const material = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.9,
      metalness: 0.1,
      transparent: false,
      depthWrite: true,
      side: THREE.FrontSide,
    });

    // Creamos el Mesh directamente. Ya no se necesita un grupo contenedor solo para escalar.
    const planetMesh = new THREE.Mesh(geometry, material);
    
    // Aplicamos las transformaciones de posición y rotación. La escala ya está en la geometría.
    planetMesh.name = objData.name;
    planetMesh.uuid = objData.id.toString();
    planetMesh.position.set(objData.position.x, objData.position.y, objData.position.z);
    planetMesh.rotation.set(objData.rotation.x, objData.rotation.y, objData.rotation.z);
    // La escala del mesh se queda en (1, 1, 1).
    
    planetMesh.userData['apiType'] = objData.type;
    planetMesh.userData['properties'] = objData.properties || {};
    planetMesh.userData['isWmtsCelestialBody'] = true;
    planetMesh.userData['apiData'] = objData;

    planetMesh.frustumCulled = false;
    planetMesh.layers.enable(BLOOM_LAYER);

    console.log(`[ObjectManager] 🔵 Creando cuerpo WMTS '${objData.name}' con radio directo de la escala: ${radius}`);

    this._loadWmtsTexture(objData.asset).then(texture => {
        console.log(`[ObjectManager] ✅ Textura WMTS para '${objData.name}' cargada y aplicada.`);
        material.map = texture;
        material.color.set(0xffffff);
        
        const haloColor = objData.galaxyData?.emissiveColor ? objData.galaxyData.emissiveColor : '#88aaff';
        material.emissiveMap = texture;
        material.emissive = new THREE.Color(sanitizeHexColor(haloColor));
        material.emissiveIntensity = 1.2;

        material.needsUpdate = true;
    }).catch(error => {
        console.error(`[ObjectManager] ❌ Fallo al cargar textura WMTS para '${objData.name}':`, error);
    });
    
    scene.add(planetMesh);
    this.labelManager.registerObject(planetMesh);
  }

  private _loadWmtsTexture(asset: AssetResponse): Promise<THREE.Texture> {
    const cacheKey = asset.path;
    if (this.wmtsTextureCache.has(cacheKey)) {
        console.log(`[ObjectManager] Reutilizando textura WMTS desde caché para: ${cacheKey}`);
        return this.wmtsTextureCache.get(cacheKey)!;
    }

    const texturePromise = new Promise<THREE.Texture>(async (resolve, reject) => {
      try {
        const templateUrl = asset.path;
        // Aumentamos el nivel de zoom para obtener texturas de mayor resolución y calidad.
        const zoomLevel = 2; // Nivel 2 (8x4 = 32 tiles) para máxima compatibilidad y rendimiento.
        const numCols = Math.pow(2, zoomLevel + 1);
        const numRows = Math.pow(2, zoomLevel);
        
        console.log(`[ObjectManager] Descargando ${numCols * numRows} mosaicos para el nivel de zoom ${zoomLevel}...`);

        const tileUrls: { url: string, row: number, col: number }[] = [];
        for (let row = 0; row < numRows; row++) {
            for (let col = 0; col < numCols; col++) {
                const url = templateUrl
                    .replace('{TileMatrix}', String(zoomLevel))
                    .replace('{TileRow}', String(row))
                    .replace('{TileCol}', String(col));
                tileUrls.push({ url, row, col });
            }
        }

        const imagePromises = tileUrls.map(tile => this._loadImagePromise(tile.url).then(img => ({ ...tile, img })));
        const loadedTiles = await Promise.all(imagePromises);

        const tileWidth = 256;
        const tileHeight = 256;
        const totalWidth = tileWidth * numCols;
        const totalHeight = tileHeight * numRows;

        const canvas = document.createElement('canvas');
        canvas.width = totalWidth;
        canvas.height = totalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error("No se pudo obtener el contexto 2D del canvas."));
        
        console.log(`[ObjectManager] Ensamblando textura final de ${totalWidth}x${totalHeight}px...`);
        loadedTiles.forEach(tile => {
            ctx.drawImage(tile.img, tile.col * tileWidth, tile.row * tileHeight);
        });
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        // Habilitamos mipmaps y filtro anisotrópico para una calidad de textura superior.
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        // Un valor de anisotropía mayor mejora la claridad de la textura en ángulos de visión oblicuos.
        // No podemos acceder al renderer aquí, pero 16 es un valor seguro y de alta calidad.
        texture.anisotropy = 16;
        
        texture.needsUpdate = true;
        
        resolve(texture);
      } catch (error) {
        reject(error);
      }
    });

    this.wmtsTextureCache.set(cacheKey, texturePromise);
    return texturePromise;
  }
  
  private _loadImagePromise(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`No se pudo cargar la imagen: ${url}`));
        img.src = url;
    });
  }
  
  private loadGltfModel(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): void {
    if (!objData.asset?.path) {
      console.error(`[ObjectManager] '${objData.name}' es un modelo pero no tiene asset válido.`);
      return;
    };
    const modelUrl = `${this.backendUrl}${objData.asset.path}`;
    loader.load(modelUrl, (gltf) => {
      const modelWrapper = new THREE.Group();
      this._normalizeAndCenterModel(gltf.scene);
      modelWrapper.add(gltf.scene);
      this._setupCelestialModel(modelWrapper, gltf, objData);
      this.applyTransformations(modelWrapper, objData);
      modelWrapper.userData['isNormalizedModel'] = true;
      this.labelManager.registerObject(modelWrapper);
      scene.add(modelWrapper);
    });
  }

  private _normalizeAndCenterModel(model: THREE.Object3D): void {
    this.tempBox.setFromObject(model);
    this.tempBox.getSize(this.tempSize);
    this.tempBox.getCenter(this.tempCenter);
    const maxDimension = Math.max(this.tempSize.x, this.tempSize.y, this.tempSize.z);
    const scaleFactor = maxDimension > 0 ? (1.0 / maxDimension) : 1.0;
    model.position.sub(this.tempCenter);
    model.scale.set(scaleFactor, scaleFactor, scaleFactor);
  }

  private _setupCelestialModel(modelWrapper: THREE.Group, gltf: GLTF, objData: SceneObjectResponse): void {
    const galaxyInfo = objData.galaxyData;
    modelWrapper.userData['isDynamicCelestialModel'] = true;
    modelWrapper.userData['originalEmissiveIntensity'] = galaxyInfo ? THREE.MathUtils.clamp(galaxyInfo.emissiveIntensity, 1.0, 7.0) : 1.0;
    modelWrapper.userData['baseEmissiveIntensity'] = 0.1;
    modelWrapper.renderOrder = 2;
    modelWrapper.traverse(child => {
      if (child instanceof THREE.Mesh) {
        if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial;
          material.emissive.setHex(0x000000); material.emissiveIntensity = 0;
          material.envMapIntensity = 0.5; material.metalness = 0.3; material.roughness = 0.7;
          material.transparent = material.transparent || false;
          material.depthWrite = true; material.depthTest = true; material.alphaTest = 0.0;
          material.blending = THREE.NormalBlending; material.flatShading = true;
          material.fog = false; material.dithering = false;
          if (material.map) {
            material.map.minFilter = THREE.LinearFilter; material.map.magFilter = THREE.LinearFilter;
            material.map.generateMipmaps = false; material.map.colorSpace = THREE.SRGBColorSpace;
            material.map.needsUpdate = true;
          }
        }
        if (child.geometry) { child.geometry.computeBoundingSphere(); child.geometry.computeBoundingBox(); }
        child.layers.enable(BLOOM_LAYER); child.renderOrder = 2; child.frustumCulled = true;
        child.castShadow = false; child.receiveShadow = false;
      }
    });
    const coreLight = modelWrapper.getObjectByName(`${objData.name}_CoreLight`);
    if (coreLight) modelWrapper.remove(coreLight);
    this._setupAnimations(gltf, modelWrapper);
  }

  private _setupAnimations(gltf: GLTF, modelWrapper: THREE.Group): void {
    if (gltf.animations?.length > 0) {
      const mixer = new THREE.AnimationMixer(modelWrapper);
      gltf.animations.forEach(clip => mixer.clipAction(clip).play());
      modelWrapper.userData['animationMixer'] = mixer;
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
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, side: THREE.DoubleSide, alphaTest: 0.01 });
    const instancedMesh = new THREE.InstancedMesh(this.sharedCircleGeometry, material, objectsData.length);
    instancedMesh.name = `CelestialObjects_Texture_${texturePath.replace(/[^a-zA-Z0-9]/g, '_')}`;
    instancedMesh.frustumCulled = false;
    instancedMesh.layers.enable(BLOOM_LAYER);
    instancedMesh.renderOrder = 1;
    this._populateInstanceData(instancedMesh, objectsData);
    scene.add(instancedMesh);
  }

  private _createDefaultGlowInstancedMesh(scene: THREE.Scene, objectsData: SceneObjectResponse[]): void {
    const material = new THREE.MeshBasicMaterial({ map: this._createGlowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, alphaTest: 0.01 });
    const instancedMesh = new THREE.InstancedMesh(this.sharedCircleGeometry, material, objectsData.length);
    instancedMesh.name = 'CelestialObjects_Default';
    instancedMesh.frustumCulled = false;
    instancedMesh.layers.enable(BLOOM_LAYER);
    instancedMesh.renderOrder = 1;
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
      if (!galaxyInfo) { continue; }
      const visualColor = new THREE.Color(sanitizeHexColor(galaxyInfo.emissiveColor));
      position.set(objData.position.x, objData.position.y, objData.position.z);
      quaternion.identity();
      scale.set(objData.scale.x, objData.scale.y, objData.scale.z);
      matrix.compose(position, quaternion, scale);
      instancedMesh.setMatrixAt(i, matrix);
      instancedMesh.setColorAt(i, new THREE.Color(0x000000));
      const scaleLuminosity = Math.max(1.0, objData.scale.x / 600.0);
      const snr = galaxyInfo.snr || 0;
      const luminosityBoost = 1.0 + Math.log1p(snr / 50.0) * 2.0;
      const instanceData: CelestialInstanceData = {
        originalColor: visualColor.clone(), emissiveIntensity: THREE.MathUtils.clamp(galaxyInfo.emissiveIntensity, 1.0, 5.0), baseEmissiveIntensity: 1.0,
        position: position.clone(), scale: scale.clone(), originalMatrix: matrix.clone(), originalUuid: objData.id.toString(), originalName: objData.name,
        luminosity: scaleLuminosity * luminosityBoost, isDominant: galaxyInfo.isDominant ?? false, type: objData.type, isManuallyHidden: false, brightness: 1.0, currentIntensity: 0.0
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
      default: geometry = new THREE.SphereGeometry(0.5, 64, 32);
    }
    const material = new THREE.MeshStandardMaterial({ color: color, roughness: 0.8, metalness: 0.2 });
    if (objData.type === 'floor') { material.side = THREE.DoubleSide; }
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

  public createHoverProxy(geometry: THREE.BufferGeometry): THREE.Mesh {
    const proxyMaterial = new THREE.MeshBasicMaterial({ color: 0x0099ff, wireframe: true, transparent: true, opacity: 0.7, depthWrite: false });
    const proxyMesh = new THREE.Mesh(geometry, proxyMaterial);
    proxyMesh.name = 'HoverProxy';
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