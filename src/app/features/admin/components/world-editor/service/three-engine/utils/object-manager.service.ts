import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SceneObjectResponse } from '../../../../../services/admin.service';
import { environment } from '../../../../../../../../environments/environment';

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

  private glowTexture: THREE.CanvasTexture | null = null;

  public createObjectFromData(scene: THREE.Scene, objData: SceneObjectResponse, loader: GLTFLoader): THREE.Object3D | null {
    let createdObject: THREE.Object3D | null = null;
    switch (objData.type) {
      case 'model':
        if (objData.properties?.['is_black_hole']) {
          createdObject = this.createBlackHolePrimitive(scene, objData);
        } else {
          this.loadGltfModel(scene, objData, loader);
        }
        break;
      case 'star': case 'galaxy': case 'meteor':
        console.warn(`[ObjectManager] La creación individual de '${objData.type}' se maneja por InstancedMesh.`);
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

  public createCelestialObjectsInstanced(scene: THREE.Scene, objectsData: SceneObjectResponse[]): void {
    if (!objectsData.length) return;
    const count = objectsData.length;

    const geometry = new THREE.PlaneGeometry(10, 10);

    const material = new THREE.MeshBasicMaterial({
      map: this._createGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // <<< SOLUCIÓN FINAL: SHADER DE MEZCLA DE COLOR + MÁSCARA CIRCULAR >>>
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec2 vUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvUv = uv;'
      );

      // Reemplazamos toda la lógica de color y transparencia
      shader.fragmentShader = 'varying vec2 vUv;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
          // 1. OBTENER EL FACTOR DE MEZCLA DE LA TEXTURA
          // La textura ahora es un simple gradiente de blanco a negro.
          // El valor .r nos da un número entre 0.0 (borde) y 1.0 (centro).
          float mixFactor = texture2D(map, vUv).r;

          // 2. DEFINIR LOS COLORES A MEZCLAR
          // 'vColor' es el color del resplandor (emissive_color) que viene de la instancia.
          vec3 haloColor = vColor;
          // El núcleo del objeto siempre será blanco puro, como en tu backend.
          vec3 coreColor = vec3(1.0, 1.0, 1.0);

          // 3. MEZCLAR LOS COLORES
          // 'mix(A, B, factor)' mezcla entre A y B.
          // Si factor=0, el resultado es A (haloColor).
          // Si factor=1, el resultado es B (coreColor).
          vec3 finalColor = mix(haloColor, coreColor, mixFactor);

          // 4. APLICAR LA MÁSCARA CIRCULAR PARA LA FORMA
          float dist = distance(vUv, vec2(0.5));
          float alphaMask = 1.0 - smoothstep(0.48, 0.5, dist);

          // El color final se asigna a diffuseColor. La transparencia es la del gradiente original
          // multiplicada por nuestra máscara circular perfecta.
          diffuseColor = vec4(finalColor, mixFactor * alphaMask);
        `
      );
    };

    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    instancedMesh.name = 'CelestialObjectsInstanced';
    instancedMesh.frustumCulled = false;
    const celestialData: CelestialInstanceData[] = [];
    instancedMesh.userData['celestialData'] = celestialData;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const objData = objectsData[i];
      const properties = objData.properties || {};
      // ¡IMPORTANTE! Ahora usamos 'emissive_color' como el color principal.
      // El color del núcleo (blanco) se maneja en el shader.
      const visualColorHex = properties['emissive_color'] || properties['color'];
      const visualColor = new THREE.Color(sanitizeHexColor(visualColorHex));
      const emissiveIntensity = properties['emissive_intensity'] as number || 0.0;
      const isDominant = properties['is_dominant_object'] as boolean || false;

      position.set(objData.position.x, objData.position.y, objData.position.z);
      quaternion.identity();
      scale.set(objData.scale.x, objData.scale.y, objData.scale.z);
      matrix.compose(position, quaternion, scale);
      instancedMesh.setMatrixAt(i, matrix);
      instancedMesh.setColorAt(i, new THREE.Color(0x000000));

      celestialData.push({
        originalColor: visualColor.clone(),
        emissiveIntensity: emissiveIntensity,
        position: position.clone(),
        scale: scale.clone(),
        originalMatrix: matrix.clone(),
        originalUuid: objData.id.toString(),
        originalName: objData.name,
        isVisible: false,
        isDominant: isDominant
      });
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
    scene.add(instancedMesh);
  }

  // <<< MEJORA CLAVE: TEXTURA DE MAPA DE MEZCLA >>>
  // Esta textura ya no es un "resplandor", sino un simple gradiente que el shader
  // usará para mezclar entre el color del núcleo y el color del resplandor.
  private _createGlowTexture(): THREE.CanvasTexture {
    if (this.glowTexture) return this.glowTexture;

    const canvas = document.createElement('canvas');
    const size = 256;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d')!;

    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);

    // Un gradiente simple y suave: blanco en el centro (valor 1.0), negro en el borde (valor 0.0).
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)'); // Núcleo
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');     // Borde

    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    this.glowTexture = new THREE.CanvasTexture(canvas);
    this.glowTexture.needsUpdate = true;
    return this.glowTexture;
  }

  public createSelectionProxy(): THREE.Mesh {
    const proxyGeometry = new THREE.SphereGeometry(1.1, 16, 8);
    const proxyMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0, depthTest: true });
    const proxyMesh = new THREE.Mesh(proxyGeometry, proxyMaterial);
    proxyMesh.name = 'SelectionProxy';
    return proxyMesh;
  }

  private createBlackHolePrimitive(scene: THREE.Scene, objData: SceneObjectResponse): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.5, 32, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const mesh = new THREE.Mesh(geometry, material);
    this.applyTransformations(mesh, objData);
    scene.add(mesh);
    return mesh;
  }

  private createStandardPrimitive(scene: THREE.Scene, objData: SceneObjectResponse): THREE.Mesh {
    const properties = objData.properties || {};
    const color = new THREE.Color(sanitizeHexColor(properties['color']));
    let geometry: THREE.BufferGeometry;
    switch (objData.type) {
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