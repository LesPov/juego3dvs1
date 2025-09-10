// src/app/features/admin/views/world-editor/world-view/service/three-engine/engine.service.ts

import { Injectable, ElementRef, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ControlsManagerService } from './utils/controls-manager.service';
import { EntityManagerService, SceneEntity } from './utils/entity-manager.service';
import { SceneManagerService } from './utils/scene-manager.service';
import { SelectionManagerService } from './utils/selection-manager.service';
import { StatsManagerService } from './utils/stats-manager.service';
import { ToolMode } from '../../toolbar/toolbar.component';
import { SceneObjectResponse } from '../../../../services/admin.service';
import { InteractionHelperManagerService } from './utils/interaction-helper.manager.service';
import { DragInteractionManagerService } from './utils/drag-interaction.manager.service';
import { CelestialInstanceData } from './utils/object-manager.service';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

// ====================================================================
// SECTION: Constants & Types
// ====================================================================
// Define constantes para el sistema de renderizado y optimización, y tipos de datos.

const INSTANCES_TO_CHECK_PER_FRAME = 20000000;
const BASE_VISIBILITY_DISTANCE = 1000000000000;
const MAX_PERCEPTUAL_DISTANCE = 10000000000000;
const DEEP_SPACE_SCALE_BOOST = 10.0;
const ORTHO_ZOOM_VISIBILITY_MULTIPLIER = 5.0;
const ORTHO_ZOOM_BLOOM_DAMPENING_FACTOR = 12.0;
const BRIGHTNESS_MULTIPLIER = 1.0;
const MAX_INTENSITY = 6.0;
const BRIGHTNESS_FALLOFF_START_DISTANCE = 500_000_000;
const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';
const NEAR_CULLING_THRESHOLD = 500_000; // Zona segura para evitar que objetos cercanos desaparezcan.

export type CameraMode = 'perspective' | 'orthographic';

@Injectable()
export class EngineService implements OnDestroy {

  // ====================================================================
  // SECTION: Public Observables & State
  // ====================================================================
  // Expone el estado del motor de forma reactiva para que los componentes puedan suscribirse.

  public onTransformEnd$: Observable<void>;
  public axisLockState$: Observable<'x' | 'y' | 'z' | null>;
  public cameraOrientation$: Observable<THREE.Quaternion>;
  public cameraPosition$: Observable<THREE.Vector3>;
  public isFlyModeActive$: Observable<boolean>;
  public cameraMode$: Observable<CameraMode>;

  // ====================================================================
  // SECTION: Private State & Subjects
  // ====================================================================
  // Estado interno y Subjects de RxJS para controlar los Observables públicos.

  private transformEndSubject = new Subject<void>();
  private axisLockStateSubject = new BehaviorSubject<'x' | 'y' | 'z' | null>(null);
  private cameraOrientationSubject = new BehaviorSubject<THREE.Quaternion>(new THREE.Quaternion());
  private cameraPositionSubject = new BehaviorSubject<THREE.Vector3>(new THREE.Vector3());
  private cameraModeSubject = new BehaviorSubject<CameraMode>('perspective');

  private selectedObject?: THREE.Object3D;
  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private keyMap = new Map<string, boolean>();
  private axisLock: 'x' | 'y' | 'z' | null = null;
  private originalProjectionMatrix = new THREE.Matrix4();
  private activeCamera: 'editor' | 'secondary' = 'editor';
  private lastPerspectiveState: { position: THREE.Vector3, target: THREE.Vector3 } | null = null;
  private lastOrthographicState: { position: THREE.Vector3, target: THREE.Vector3 } | null = null;
  private lastEditorTarget = new THREE.Vector3();
  private baseOrthoMatrixElement: number = 0;
  private controlsSubscription?: Subscription;
  private focusPivot: THREE.Object3D;

  // Propiedades temporales para evitar la creación de nuevos objetos en el bucle de renderizado (optimización).
  private tempColor = new THREE.Color();
  private tempQuaternion = new THREE.Quaternion();
  private tempMatrix = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private boundingSphere = new THREE.Sphere();
  private tempScale = new THREE.Vector3();
  private tempBoxSize = new THREE.Vector3();
  private tempWorldPos = new THREE.Vector3();
  
  // ====================================================================
  // SECTION: Constructor & Initialization
  // ====================================================================

  constructor(
    private sceneManager: SceneManagerService,
    private entityManager: EntityManagerService,
    private controlsManager: ControlsManagerService,
    private selectionManager: SelectionManagerService,
    private statsManager: StatsManagerService,
    private interactionHelperManager: InteractionHelperManagerService,
    private dragInteractionManager: DragInteractionManagerService
  ) {
    this.focusPivot = new THREE.Object3D();
    this.focusPivot.name = 'FocusPivot';
    
    // Configuración de los Observables públicos
    this.onTransformEnd$ = this.transformEndSubject.asObservable().pipe(debounceTime(500));
    this.isFlyModeActive$ = this.controlsManager.isFlyModeActive$;
    this.axisLockState$ = this.axisLockStateSubject.asObservable();
    this.cameraOrientation$ = this.cameraOrientationSubject.asObservable();
    this.cameraPosition$ = this.cameraPositionSubject.asObservable();
    this.cameraMode$ = this.cameraModeSubject.asObservable();
  }

  /**
   * Inicializa el motor 3D, configurando todos los servicios manager y arrancando el bucle de animación.
   * @param canvasRef Referencia al elemento canvas del DOM.
   */
  public init(canvasRef: ElementRef<HTMLCanvasElement>): void {
    const canvas = canvasRef.nativeElement;
    this.sceneManager.setupBasicScene(canvas);
    this.sceneManager.scene.add(this.focusPivot);
    this.entityManager.init(this.sceneManager.scene);
    this.statsManager.init();
    this.controlsManager.init(this.sceneManager.activeCamera, canvas, this.sceneManager.scene, this.focusPivot);
    this.sceneManager.setControls(this.controlsManager.getControls());
    this.interactionHelperManager.init(this.sceneManager.scene, this.sceneManager.activeCamera);
    this.dragInteractionManager.init(this.sceneManager.activeCamera, canvas, this.controlsManager);
    this.controlsManager.enableNavigation();
    this.addEventListeners();
    if (this.sceneManager.activeCamera) {
      this.originalProjectionMatrix.copy(this.sceneManager.activeCamera.projectionMatrix);
    }
    this.animate();
  }
  
  // ====================================================================
  // SECTION: Core Render Loop
  // ====================================================================

  /**
   * El bucle principal de animación que se ejecuta en cada frame.
   * Orquesta las actualizaciones de controles, renderizado y la lógica de optimización.
   */
  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    const delta = this.clock.getDelta();

    // Actualiza la posición del target de la cámara secundaria para que siga a la principal
    if (this.activeCamera === 'secondary') {
      const controls = this.controlsManager.getControls();
      this.sceneManager.editorCamera.getWorldPosition(controls.target);
    }
    
    // Actualiza los helpers visuales de las cámaras
    if (this.activeCamera === 'editor') {
        this.sceneManager.secondaryCamera.userData['helper']?.update();
    } else {
        this.sceneManager.editorCamera.userData['helper']?.update();
    }

    // Actualiza los controles de cámara y emite eventos si la cámara se mueve
    const cameraMoved = this.controlsManager.update(delta, this.keyMap);
    if (cameraMoved) {
      this.interactionHelperManager.updateScale();
      this.cameraPositionSubject.next(this.sceneManager.activeCamera.position);
    }
    
    // Actualiza la orientación de la cámara
    this.sceneManager.activeCamera.getWorldQuaternion(this.tempQuaternion);
    if (!this.tempQuaternion.equals(this.cameraOrientationSubject.getValue())) {
      this.cameraOrientationSubject.next(this.tempQuaternion.clone());
    }

    // Asegura que los objetos celestes (planos) siempre miren a la cámara
    const selectionProxy = this.sceneManager.scene.getObjectByName('SelectionProxy');
    if (selectionProxy) {
      selectionProxy.quaternion.copy(this.sceneManager.activeCamera.quaternion);
    }

    // Ejecuta la lógica de optimización para los objetos celestes instanciados
    this.sceneManager.scene.children.forEach(object => {
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        this.updateVisibleCelestialInstances(object as THREE.InstancedMesh);
      }
    });

    // Renderiza la escena a través del composer (para aplicar efectos como el bloom)
    this.sceneManager.composer.render();
    this.statsManager.end();
  };

  /**
   * Lógica de optimización para renderizar eficientemente millones de objetos celestes.
   * Utiliza frustum culling, culling por distancia, LOD simulado y procesamiento por lotes.
   * @param instancedMesh El `InstancedMesh` que contiene los objetos celestes.
   */
  private updateVisibleCelestialInstances(instancedMesh: THREE.InstancedMesh): void {
    if (!instancedMesh) return;
    const allData: CelestialInstanceData[] = instancedMesh.userData['celestialData'];
    if (!allData || allData.length === 0) return;
    
    this.updateCameraFrustum();
    
    let needsColorUpdate = false;
    let needsMatrixUpdate = false;
    const camera = this.sceneManager.activeCamera;
    let visibilityFactor = 1.0;
    let bloomDampeningFactor = 1.0; 
    const isOrthographic = this.cameraModeSubject.getValue() === 'orthographic';
    if (isOrthographic && this.baseOrthoMatrixElement > 0) {
      const currentZoomValue = camera.projectionMatrix.elements[0];
      const zoomRatio = this.baseOrthoMatrixElement / currentZoomValue;
      visibilityFactor = zoomRatio * ORTHO_ZOOM_VISIBILITY_MULTIPLIER;
      visibilityFactor = Math.max(0.1, visibilityFactor);
      bloomDampeningFactor = Math.min(1.0, ORTHO_ZOOM_BLOOM_DAMPENING_FACTOR / zoomRatio);
    }

    const totalInstances = allData.length;
    const startIndex = instancedMesh.userData['updateIndexCounter'] || 0;
    const checkCount = Math.min(totalInstances, Math.ceil(INSTANCES_TO_CHECK_PER_FRAME / 5));

    for (let i = 0; i < checkCount; i++) {
        const currentIndex = (startIndex + i) % totalInstances;
        const data = allData[currentIndex];
        
        if (data.isManuallyHidden) { continue; }
        
        const distance = data.position.distanceTo(camera.position);

        // Lógica de "zona segura" para objetos cercanos
        if (distance < NEAR_CULLING_THRESHOLD) {
            if (!data.isVisible) data.isVisible = true;

            const baseIntensity = data.emissiveIntensity * BRIGHTNESS_MULTIPLIER;
            const brightnessMultiplier = isOrthographic ? data.brightness : 1.0;
            const finalIntensity = Math.min(baseIntensity, MAX_INTENSITY) * bloomDampeningFactor * brightnessMultiplier;
            
            this.tempScale.copy(data.scale).multiplyScalar(DEEP_SPACE_SCALE_BOOST);
            this.tempMatrix.compose(data.position, camera.quaternion, this.tempScale);
            instancedMesh.setMatrixAt(currentIndex, this.tempMatrix);
            needsMatrixUpdate = true;
            
            this.tempColor.copy(data.originalColor).multiplyScalar(finalIntensity);
            instancedMesh.setColorAt(currentIndex, this.tempColor);
            needsColorUpdate = true;

            continue;
        }

        // Lógica de culling (frustum y distancia) para objetos lejanos
        this.boundingSphere.center.copy(data.position);
        this.boundingSphere.radius = Math.max(data.scale.x, data.scale.y, data.scale.z) * DEEP_SPACE_SCALE_BOOST;
        if (!this.frustum.intersectsSphere(this.boundingSphere)) {
            if (data.isVisible) { this.tempColor.setScalar(0); instancedMesh.setColorAt(currentIndex, this.tempColor); needsColorUpdate = true; data.isVisible = false; }
            continue;
        }

        const personalVisibilityDistance = Math.min(BASE_VISIBILITY_DISTANCE * data.luminosity, MAX_PERCEPTUAL_DISTANCE);
        const effectiveVisibilityDistance = personalVisibilityDistance * visibilityFactor;
        if (distance > effectiveVisibilityDistance) {
            if (data.isVisible) { this.tempColor.setScalar(0); instancedMesh.setColorAt(currentIndex, this.tempColor); needsColorUpdate = true; data.isVisible = false; }
            continue;
        }

        // Lógica de atenuación de brillo y visibilidad por distancia (LOD simulado)
        const visibilityFalloff = 1.0 - THREE.MathUtils.smoothstep(distance, 0, effectiveVisibilityDistance);
        const distanceFalloff = 1.0 - THREE.MathUtils.smoothstep(distance, BRIGHTNESS_FALLOFF_START_DISTANCE, effectiveVisibilityDistance);
        const baseIntensity = data.emissiveIntensity * BRIGHTNESS_MULTIPLIER * visibilityFalloff * distanceFalloff;
        const brightnessMultiplier = isOrthographic ? data.brightness : 1.0;
        const finalIntensity = Math.min(baseIntensity, MAX_INTENSITY) * bloomDampeningFactor * brightnessMultiplier;
        
        this.tempScale.copy(data.scale).multiplyScalar(DEEP_SPACE_SCALE_BOOST);
        if (finalIntensity > 0.01) {
            if (!data.isVisible) data.isVisible = true;
            this.tempMatrix.compose(data.position, camera.quaternion, this.tempScale);
            instancedMesh.setMatrixAt(currentIndex, this.tempMatrix);
            needsMatrixUpdate = true;
            this.tempColor.copy(data.originalColor).multiplyScalar(finalIntensity);
            instancedMesh.setColorAt(currentIndex, this.tempColor);
            needsColorUpdate = true;
        } else if (data.isVisible) {
            this.tempColor.setScalar(0);
            instancedMesh.setColorAt(currentIndex, this.tempColor);
            needsColorUpdate = true;
            data.isVisible = false;
        }
    }
    
    instancedMesh.userData['updateIndexCounter'] = (startIndex + checkCount) % totalInstances;

    if (needsColorUpdate && instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
    if (needsMatrixUpdate) instancedMesh.instanceMatrix.needsUpdate = true;
  }
  
  // ====================================================================
  // SECTION: Camera Management
  // ====================================================================

  /**
   * Cambia entre la cámara principal del editor y la cámara secundaria.
   */
  public toggleActiveCamera(): void {
    const editorHelper = this.sceneManager.editorCamera.userData['helper'];
    const secondaryHelper = this.sceneManager.secondaryCamera.userData['helper'];
    const controls = this.controlsManager.getControls();

    if (this.activeCamera === 'editor') {
      this.activeCamera = 'secondary';
      this.sceneManager.activeCamera = this.sceneManager.secondaryCamera;
      this.lastEditorTarget.copy(controls.target);

      const { editorCamera, secondaryCamera } = this.sceneManager;
      const offset = secondaryCamera.userData['initialOffset'] as THREE.Vector3;
      editorCamera.getWorldPosition(this.tempWorldPos);
      editorCamera.getWorldQuaternion(this.tempQuaternion);

      const newCamPos = offset.clone().applyQuaternion(this.tempQuaternion).add(this.tempWorldPos);
      secondaryCamera.position.copy(newCamPos);
      controls.target.copy(this.tempWorldPos);
      
      if (editorHelper) editorHelper.visible = true;
      if (secondaryHelper) secondaryHelper.visible = false;
      this.controlsManager.configureForSecondaryCamera();

    } else {
      this.activeCamera = 'editor';
      this.sceneManager.activeCamera = this.sceneManager.editorCamera;
      controls.target.copy(this.lastEditorTarget);

      if (editorHelper) editorHelper.visible = false;
      if (secondaryHelper) secondaryHelper.visible = true;
      this.controlsManager.configureForEditorCamera();
    }

    // Actualiza todos los servicios que dependen de la cámara activa
    const newActiveCamera = this.sceneManager.activeCamera;
    this.controlsManager.setCamera(newActiveCamera);
    (this.sceneManager.composer.passes[0] as RenderPass).camera = newActiveCamera;
    this.interactionHelperManager.setCamera(newActiveCamera);
    this.dragInteractionManager.setCamera(newActiveCamera);
    controls.update(); 
    
    if(this.selectedObject && this.selectedObject.uuid === newActiveCamera.uuid) {
        this.controlsManager.attach(this.selectedObject);
    }
  }

  /**
   * Cambia entre el modo de cámara 3D (perspectiva) y 2D (ortográfica).
   */
  public toggleCameraMode = () => {
    if (this.cameraModeSubject.getValue() === 'perspective') {
      const controls = this.controlsManager.getControls();
      this.lastPerspectiveState = {
        position: this.sceneManager.activeCamera.position.clone(),
        target: controls.target.clone()
      };
      this.setCameraView('axis-z'); // Vista frontal por defecto
    } else {
      this.switchToPerspectiveView();
    }
  };

  /**
   * Establece la cámara en una vista ortográfica específica (superior, frontal, lateral, etc.).
   * @param axisName El eje desde el cual mirar ('axis-x', 'axis-y-neg', etc.).
   * @param state Un estado de cámara opcional para restaurar.
   */
  public setCameraView = (axisName: string | null, state?: { position: THREE.Vector3, target: THREE.Vector3 }) => {
    const controls = this.controlsManager.getControls();
    const camera = this.sceneManager.activeCamera;
    if (!controls) return;
    
    if (this.cameraModeSubject.getValue() === 'perspective') {
      this.lastPerspectiveState = { position: camera.position.clone(), target: controls.target.clone() };
    }
    
    const boundingBox = this.sceneManager.getSceneBoundingBox();
    if (boundingBox.isEmpty()) return;
    const target = boundingBox.getCenter(new THREE.Vector3());
    const boxSize = boundingBox.getSize(this.tempBoxSize);
    const distance = boxSize.length() || 100;
    
    if (axisName) {
      const newPosition = new THREE.Vector3();
      switch (axisName) {
        case 'axis-x': newPosition.set(distance, 0, 0); break;
        case 'axis-x-neg': newPosition.set(-distance, 0, 0); break;
        case 'axis-y': newPosition.set(0, distance, 0.0001); break;
        case 'axis-y-neg': newPosition.set(0, -distance, 0.0001); break;
        case 'axis-z': newPosition.set(0, 0, distance); break;
        case 'axis-z-neg': newPosition.set(0, 0, -distance); break;
        default: return;
      }
      camera.position.copy(target).add(newPosition);
    } else if (state) {
      camera.position.copy(state.position);
    }
    
    camera.lookAt(target);
    this.lastOrthographicState = { position: camera.position.clone(), target: target.clone() };

    // Calcula el frustum ortográfico para que la escena entera sea visible
    const rendererDomElement = this.sceneManager.renderer.domElement;
    const aspect = rendererDomElement.clientWidth / rendererDomElement.clientHeight;
    let frustumWidth = Math.max(boxSize.x, 0.1);
    let frustumHeight = Math.max(boxSize.y, 0.1);
    const currentAxis = axisName || this.getAxisFromState(this.lastOrthographicState);
    switch (currentAxis) {
        case 'axis-x': case 'axis-x-neg': frustumHeight = boxSize.y; frustumWidth = boxSize.z; break;
        case 'axis-y': case 'axis-y-neg': frustumHeight = boxSize.z; frustumWidth = boxSize.x; break;
        case 'axis-z': case 'axis-z-neg': default: frustumHeight = boxSize.y; frustumWidth = boxSize.x; break;
    }
    frustumWidth *= 1.1;
    frustumHeight *= 1.1;
    if (frustumWidth / aspect > frustumHeight) { frustumHeight = frustumWidth / aspect; } else { frustumWidth = frustumHeight * aspect; }

    const sceneDepth = Math.max(boxSize.x, boxSize.y, boxSize.z);
    const cameraToCenterDist = camera.position.distanceTo(target);
    const nearPlane = 0.1;
    const farPlane = cameraToCenterDist + sceneDepth * 2;
    const orthoMatrix = new THREE.Matrix4().makeOrthographic(frustumWidth / -2, frustumWidth / 2, frustumHeight / 2, frustumHeight / -2, nearPlane, farPlane);
    
    camera.projectionMatrix.copy(orthoMatrix);
    camera.projectionMatrixInverse.copy(orthoMatrix).invert();
    this.baseOrthoMatrixElement = camera.projectionMatrix.elements[0];

    // Configura los controles para el modo ortográfico (pan y zoom, sin rotación)
    this.controlsManager.exitFlyMode();
    this.controlsManager.isFlyEnabled = false;
    controls.enabled = true;
    controls.enableRotate = false;
    controls.target.copy(target);
    controls.update();
    this.selectionManager.updateOutlineParameters('orthographic');
    this.cameraModeSubject.next('orthographic');
  };

  /**
   * Restaura la vista de cámara a perspectiva 3D.
   */
  public switchToPerspectiveView = () => {
    this.entityManager.resetAllGroupsBrightness();
    const camera = this.sceneManager.activeCamera;
    const controls = this.controlsManager.getControls();
    if (!controls) return;

    if (this.lastPerspectiveState) {
      camera.position.copy(this.lastPerspectiveState.position);
      controls.target.copy(this.lastPerspectiveState.target);
    } else if (this.lastOrthographicState) {
      const target = this.lastOrthographicState.target.clone();
      const direction = new THREE.Vector3().copy(this.lastOrthographicState.position).sub(target).normalize();
      const boundingBox = this.sceneManager.getSceneBoundingBox();
      const sceneSize = boundingBox.getSize(new THREE.Vector3()).length();
      const safeDistance = sceneSize > 0 ? sceneSize * 1.5 : 500000;
      const newPosition = new THREE.Vector3().copy(target).addScaledVector(direction, safeDistance);
      camera.position.copy(newPosition);
      controls.target.copy(target);
    }
    
    camera.near = 0.1;
    camera.far = 500000000000;
    camera.projectionMatrix.copy(this.originalProjectionMatrix);
    camera.projectionMatrixInverse.copy(this.originalProjectionMatrix).invert();

    this.controlsManager.isFlyEnabled = true;
    controls.enableRotate = true;
    controls.update();
    this.selectionManager.updateOutlineParameters('perspective');
    this.cameraModeSubject.next('perspective');
  };
  
  // ====================================================================
  // SECTION: Object Selection & Manipulation
  // ====================================================================

  /**
   * Selecciona un objeto en la escena por su UUID.
   * @param uuid El UUID del objeto a seleccionar, o null para deseleccionar.
   */
  public selectObjectByUuid(uuid: string | null): void {
    this.interactionHelperManager.cleanupHelpers(this.selectedObject);
    this.dragInteractionManager.stopListening();
    this.controlsManager.detach();
    this.axisLock = null;
    this.dragInteractionManager.setAxisConstraint(null);
    this.axisLockStateSubject.next(null);
    this.selectedObject = undefined;
    
    this.entityManager.selectObjectByUuid(uuid, this.focusPivot);
    if (uuid) {
      this.selectedObject = this.entityManager.getObjectByUuid(uuid);
      if (this.selectedObject) {
        this.setToolMode(this.controlsManager.getCurrentToolMode());
      }
    }
  }

  /**
   * Actualiza la transformación de un objeto en la escena.
   * @param uuid UUID del objeto.
   * @param path Propiedad a cambiar ('position', 'rotation', 'scale').
   * @param value Nuevo valor para la propiedad.
   */
  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number; y: number; z: number; }) => {
    // Lógica para objetos estándar
    const standardObject = this.entityManager.getObjectByUuid(uuid);
    if (standardObject && standardObject.name !== 'SelectionProxy') {
      standardObject[path].set(value.x, value.y, value.z);
      if (path === 'position') {
        this.interactionHelperManager.updateHelperPositions(standardObject);
      }
      return;
    }
    // Lógica para objetos instanciados
    const instanceInfo = this.entityManager['_findCelestialInstance'](uuid);
    if (instanceInfo) {
      const { mesh, instanceIndex, data } = instanceInfo;
      const tempQuaternion = new THREE.Quaternion();
      const tempScale = new THREE.Vector3();
      data.originalMatrix.decompose(new THREE.Vector3(), tempQuaternion, tempScale);
      switch (path) {
        case 'position': data.position.set(value.x, value.y, value.z); break;
        case 'rotation': tempQuaternion.setFromEuler(new THREE.Euler(value.x, value.y, value.z)); break;
        case 'scale': data.scale.set(value.x, value.y, value.z); tempScale.copy(data.scale); break;
      }
      data.originalMatrix.compose(data.position, tempQuaternion, tempScale);
      mesh.setMatrixAt(instanceIndex, data.originalMatrix);
      mesh.instanceMatrix.needsUpdate = true;
      const selectionProxy = this.sceneManager.scene.getObjectByName('SelectionProxy');
      if (selectionProxy && selectionProxy.uuid === uuid) {
        selectionProxy.position.copy(data.position);
        const PROXY_SCALE_MULTIPLIER = 7.0;
        selectionProxy.scale.copy(data.scale).multiplyScalar(PROXY_SCALE_MULTIPLIER);
      }
    }
  };

  /**
   * Actualiza el nombre de un objeto.
   * @param uuid UUID del objeto.
   * @param newName Nuevo nombre.
   */
  public updateObjectName = (uuid: string, newName: string) => this.entityManager.updateObjectName(uuid, newName);

  /**
   * Establece la herramienta de transformación activa (mover, rotar, escalar).
   * @param mode La herramienta a activar.
   */
  public setToolMode(mode: ToolMode): void {
    this.controlsManager.setTransformMode(mode);
    this.interactionHelperManager.cleanupHelpers(this.selectedObject);
    this.dragInteractionManager.stopListening();
    this.controlsManager.detach();
    this.axisLock = null;
    this.dragInteractionManager.setAxisConstraint(null);
    this.axisLockStateSubject.next(null);
    if (this.selectedObject) {
      switch (mode) {
        case 'move':
          this.interactionHelperManager.createHelpers(this.selectedObject);
          this.dragInteractionManager.startListening(this.selectedObject, this.interactionHelperManager);
          break;
        case 'rotate':
        case 'scale':
          this.controlsManager.attach(this.selectedObject);
          break;
      }
    }
  }

  // ====================================================================
  // SECTION: Scene Population & Management
  // ====================================================================

  /**
   * Llena la escena con objetos provenientes de la API.
   * @param objects Array de objetos de la escena.
   * @param onProgress Callback para el progreso de carga.
   * @param onLoaded Callback para cuando la carga ha finalizado.
   */
  public populateScene(objects: SceneObjectResponse[], onProgress: (p: number) => void, onLoaded: () => void): void {
    if (!this.sceneManager.scene) return;
    this.entityManager.clearScene();
    const celestialTypes = ['star', 'galaxy', 'meteor', 'supernova', 'diffraction_star'];
    const celestialObjectsData = objects.filter(o => celestialTypes.includes(o.type));
    const standardObjectsData = objects.filter(o => !celestialTypes.includes(o.type));
    
    // Crea los objetos celestes de forma optimizada
    this.entityManager.objectManager.createCelestialObjectsInstanced(this.sceneManager.scene, celestialObjectsData);
    
    // Maneja la carga de los objetos estándar (modelos 3D, etc.)
    const loadingManager = this.entityManager.getLoadingManager();
    loadingManager.onProgress = (_, loaded, total) => onProgress((loaded / total) * 100);
    loadingManager.onLoad = () => {
      onLoaded();
      this.entityManager.publishSceneEntities();
    };
    
    standardObjectsData.forEach(o => this.entityManager.createObjectFromData(o));
    // Si no hay modelos que cargar, finaliza la carga inmediatamente.
    if (!standardObjectsData.some(o => o.type === 'model' && o.asset?.path)) {
      setTimeout(() => { if (loadingManager.onLoad) loadingManager.onLoad(); }, 0);
    }
  }

  public setGroupVisibility = (uuids: string[], visible: boolean): void => this.entityManager.setGroupVisibility(uuids, visible);
  public setGroupBrightness = (uuids: string[], brightness: number): void => this.entityManager.setGroupBrightness(uuids, brightness);
  public addObjectToScene = (objData: SceneObjectResponse) => this.entityManager.createObjectFromData(objData);
  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  public frameScene = (width: number, height: number) => this.sceneManager.frameScene(width, height);
  
  // ====================================================================
  // SECTION: Event Handling & Lifecycle
  // ====================================================================

  private onKeyDown = (e: KeyboardEvent) => { 
    const key = e.key.toLowerCase(); 
    if (key === 'escape') { this.controlsManager.exitFlyMode(); return; } 
    this.keyMap.set(key, true); 
    
    // Atajo 'c' para cambiar de cámara
    if (key === 'c' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.toggleActiveCamera();
    }
    
    // Atajos 'x', 'y', 'z' para bloquear el movimiento en un eje
    if (this.controlsManager.getCurrentToolMode() === 'move' && ['x', 'y', 'z'].includes(key)) {
      this.axisLock = this.axisLock === key ? null : (key as 'x' | 'y' | 'z');
      this.dragInteractionManager.setAxisConstraint(this.axisLock);
      this.axisLockStateSubject.next(this.axisLock);
    } 
  };
  
  private onKeyUp = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), false);
  private onControlsChange = () => this.interactionHelperManager.updateScale();
  
  private handleTransformEnd = () => {
    if (!this.selectedObject) return;
    // Si el objeto movido es un proxy de una instancia, actualiza la instancia original.
    if (this.selectedObject.name === 'SelectionProxy') {
      this.sceneManager.scene.children.forEach(obj => {
        if (!this.selectedObject) return;
        if (obj.name.startsWith(CELESTIAL_MESH_PREFIX)) {
          const instancedMesh = obj as THREE.InstancedMesh;
          const allData: CelestialInstanceData[] = instancedMesh.userData["celestialData"];
          const instanceIndex = allData.findIndex(d => d.originalUuid === this.selectedObject!.uuid);
          if (instanceIndex > -1) {
            const data = allData[instanceIndex];
            data.originalMatrix.compose(this.selectedObject.position, this.selectedObject.quaternion, this.selectedObject.scale);
            data.position.copy(this.selectedObject.position);
            instancedMesh.setMatrixAt(instanceIndex, data.originalMatrix);
            instancedMesh.instanceMatrix.needsUpdate = true;
          }
        }
      });
    }
    this.transformEndSubject.next();
  };

  private addEventListeners = () => {
    const controls = this.controlsManager.getControls();
    controls.addEventListener('end', this.handleTransformEnd);
    controls.addEventListener('change', this.onControlsChange);
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.controlsSubscription = this.dragInteractionManager.onDragEnd$.subscribe(() => {
      this.handleTransformEnd();
      if (this.selectedObject) this.interactionHelperManager.updateHelperPositions(this.selectedObject);
    });
  };

  private removeEventListeners = (): void => {
    const controls = this.controlsManager.getControls();
    controls?.removeEventListener('end', this.handleTransformEnd);
    controls?.removeEventListener('change', this.onControlsChange);
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controlsSubscription?.unsubscribe();
  };
  
  public onWindowResize = () => {
    const parentElement = this.sceneManager.canvas?.parentElement;
    if (!parentElement) return;

    const aspect = parentElement.clientWidth / parentElement.clientHeight;
    if (this.sceneManager.editorCamera) {
      this.sceneManager.editorCamera.aspect = aspect;
      this.sceneManager.editorCamera.updateProjectionMatrix();
    }
    if (this.sceneManager.secondaryCamera) {
      this.sceneManager.secondaryCamera.aspect = aspect;
      this.sceneManager.secondaryCamera.updateProjectionMatrix();
    }

    this.sceneManager.onWindowResize();
    this.interactionHelperManager.updateScale();

    // Recalcula la vista ortográfica si está activa para evitar deformaciones.
    if (this.cameraModeSubject.getValue() === 'orthographic' && this.lastOrthographicState) {
      this.setCameraView(null, this.lastOrthographicState);
    }
  };

  ngOnDestroy = () => {
    this.removeEventListeners();
    this.interactionHelperManager.cleanupHelpers(this.selectedObject);
    this.dragInteractionManager.stopListening();
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.statsManager.destroy();
    this.controlsManager.ngOnDestroy();
    if (this.sceneManager.renderer) this.sceneManager.renderer.dispose();
  };
  
  // ====================================================================
  // SECTION: Private Utilities
  // ====================================================================
  
  private updateCameraFrustum(): void {
    const camera = this.sceneManager.activeCamera;
    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  private getAxisFromState(state: { position: THREE.Vector3, target: THREE.Vector3 } | null): string {
    if (!state) return 'axis-y-neg'; // Vista superior por defecto
    const dir = new THREE.Vector3().copy(state.position).sub(state.target).normalize();
    if (Math.abs(dir.x) > 0.9) return dir.x > 0 ? 'axis-x' : 'axis-x-neg';
    if (Math.abs(dir.y) > 0.9) return dir.y > 0 ? 'axis-y' : 'axis-y-neg';
    return dir.z > 0 ? 'axis-z' : 'axis-z-neg';
  }
}