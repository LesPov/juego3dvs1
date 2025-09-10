// src/app/features/admin/views/world-editor/world-view/service/three-engine/engine.service.ts

import { Injectable, ElementRef, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ControlsManagerService } from './utils/controls-manager.service';
import { EntityManagerService, SceneEntity } from './utils/entity-manager.service';
import { SceneManagerService } from './utils/scene-manager.service';
import { StatsManagerService } from './utils/stats-manager.service';
import { ToolMode } from '../../toolbar/toolbar.component';
import { SceneObjectResponse } from '../../../../services/admin.service';
import { InteractionHelperManagerService } from './utils/interaction-helper.manager.service';
import { DragInteractionManagerService } from './utils/drag-interaction.manager.service';
import { CelestialInstanceData } from './utils/object-manager.service';
import {  CameraManagerService, CameraMode } from './utils/camera-manager.service'; // <--- IMPORTACIÓN

// ====================================================================
// SECTION: Constants
// ====================================================================

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
const NEAR_CULLING_THRESHOLD = 500_000;

@Injectable()
export class EngineService implements OnDestroy {

  // ====================================================================
  // SECTION: Public Observables & State
  // ====================================================================

  public onTransformEnd$: Observable<void>;
  public axisLockState$: Observable<'x' | 'y' | 'z' | null>;
  public cameraOrientation$: Observable<THREE.Quaternion>;
  public cameraPosition$: Observable<THREE.Vector3>;
  public isFlyModeActive$: Observable<boolean>;
  public cameraMode$: Observable<CameraMode>;

  // ====================================================================
  // SECTION: Private State & Subjects
  // ====================================================================

  private transformEndSubject = new Subject<void>();
  private axisLockStateSubject = new BehaviorSubject<'x' | 'y' | 'z' | null>(null);
  private cameraOrientationSubject = new BehaviorSubject<THREE.Quaternion>(new THREE.Quaternion());
  private cameraPositionSubject = new BehaviorSubject<THREE.Vector3>(new THREE.Vector3());

  private selectedObject?: THREE.Object3D;
  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private keyMap = new Map<string, boolean>();
  private axisLock: 'x' | 'y' | 'z' | null = null;
  private baseOrthoMatrixElement: number = 0;
  private controlsSubscription?: Subscription;
  private focusPivot: THREE.Object3D;

  private tempQuaternion = new THREE.Quaternion();
  private tempMatrix = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private boundingSphere = new THREE.Sphere();
  private tempScale = new THREE.Vector3();
  private tempColor = new THREE.Color();

  // ====================================================================
  // SECTION: Constructor & Initialization
  // ====================================================================

  constructor(
    private sceneManager: SceneManagerService,
    private entityManager: EntityManagerService,
    private controlsManager: ControlsManagerService,
    private statsManager: StatsManagerService,
    private interactionHelperManager: InteractionHelperManagerService,
    private dragInteractionManager: DragInteractionManagerService,
    private cameraManager: CameraManagerService // <--- INYECCIÓN
  ) {
    this.focusPivot = new THREE.Object3D();
    this.focusPivot.name = 'FocusPivot';

    this.onTransformEnd$ = this.transformEndSubject.asObservable().pipe(debounceTime(500));
    this.isFlyModeActive$ = this.controlsManager.isFlyModeActive$;
    this.axisLockState$ = this.axisLockStateSubject.asObservable();
    this.cameraOrientation$ = this.cameraOrientationSubject.asObservable();
    this.cameraPosition$ = this.cameraPositionSubject.asObservable();
    this.cameraMode$ = this.cameraManager.cameraMode$.asObservable(); // <--- DELEGACIÓN
  }

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
    this.cameraManager.initialize(); // <--- INICIALIZACIÓN
    this.controlsManager.enableNavigation();
    this.addEventListeners();
    this.animate();
  }

  // ====================================================================
  // SECTION: Core Render Loop
  // ====================================================================

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    const delta = this.clock.getDelta();

    // Actualiza la posición del target de la cámara secundaria para que siga a la principal
    if (this.cameraManager.activeCameraType === 'secondary') {
      const controls = this.controlsManager.getControls();
      this.sceneManager.editorCamera.getWorldPosition(controls.target);
    }

    // Actualiza los helpers visuales de las cámaras
    if (this.cameraManager.activeCameraType === 'editor') {
      this.sceneManager.secondaryCamera.userData['helper']?.update();
    } else {
      this.sceneManager.editorCamera.userData['helper']?.update();
    }

    const cameraMoved = this.controlsManager.update(delta, this.keyMap);
    if (cameraMoved) {
      this.interactionHelperManager.updateScale();
      this.cameraPositionSubject.next(this.sceneManager.activeCamera.position);
    }

    this.sceneManager.activeCamera.getWorldQuaternion(this.tempQuaternion);
    if (!this.tempQuaternion.equals(this.cameraOrientationSubject.getValue())) {
      this.cameraOrientationSubject.next(this.tempQuaternion.clone());
    }

    const selectionProxy = this.sceneManager.scene.getObjectByName('SelectionProxy');
    if (selectionProxy) {
      selectionProxy.quaternion.copy(this.sceneManager.activeCamera.quaternion);
    }

    this.sceneManager.scene.children.forEach(object => {
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        this.updateVisibleCelestialInstances(object as THREE.InstancedMesh);
      }
    });

    this.sceneManager.composer.render();
    this.statsManager.end();
  };

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
    const isOrthographic = this.cameraManager.cameraMode$.getValue() === 'orthographic';
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
  // SECTION: Public API (Delegation)
  // ====================================================================

  /**
   * DELEGADO: Cambia entre la cámara principal y la secundaria.
   */
  public toggleActiveCamera(): void {
    this.cameraManager.toggleActiveCamera(this.selectedObject);
  }

  /**
   * DELEGADO: Cambia entre el modo de cámara 3D y 2D.
   */
  public toggleCameraMode(): void {
    this.cameraManager.toggleCameraMode();
  }

  /**
   * DELEGADO: Establece la cámara en una vista ortográfica específica.
   */
  public setCameraView(axisName: string | null): void {
    this.baseOrthoMatrixElement = this.cameraManager.setCameraView(axisName, undefined);
  }

  /**
   * DELEGADO: Restaura la vista de cámara a perspectiva 3D.
   */
  public switchToPerspectiveView(): void {
    this.cameraManager.switchToPerspectiveView();
  }

  // ====================================================================
  // SECTION: Object Selection & Manipulation (Lógica que permanece en Engine)
  // ====================================================================

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

  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number; y: number; z: number; }) => {
    const standardObject = this.entityManager.getObjectByUuid(uuid);
    if (standardObject && standardObject.name !== 'SelectionProxy') {
      standardObject[path].set(value.x, value.y, value.z);
      if (path === 'position') this.interactionHelperManager.updateHelperPositions(standardObject);
      return;
    }
    const instanceInfo = this.entityManager['_findCelestialInstance'](uuid);
    if (instanceInfo) {
      const { mesh, instanceIndex, data } = instanceInfo;
      const tempQuaternion = new THREE.Quaternion(), tempScale = new THREE.Vector3();
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
        selectionProxy.scale.copy(data.scale).multiplyScalar(7.0);
      }
    }
  };

  public updateObjectName = (uuid: string, newName: string) => this.entityManager.updateObjectName(uuid, newName);

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
        case 'rotate': case 'scale':
          this.controlsManager.attach(this.selectedObject);
          break;
      }
    }
  }

  // ====================================================================
  // SECTION: Scene Population & Management
  // ====================================================================

  public populateScene(objects: SceneObjectResponse[], onProgress: (p: number) => void, onLoaded: () => void): void {
    if (!this.sceneManager.scene) return;
    this.entityManager.clearScene();
    const celestialTypes = ['star', 'galaxy', 'meteor', 'supernova', 'diffraction_star'];
    const celestialObjectsData = objects.filter(o => celestialTypes.includes(o.type));
    const standardObjectsData = objects.filter(o => !celestialTypes.includes(o.type));

    this.entityManager.objectManager.createCelestialObjectsInstanced(this.sceneManager.scene, celestialObjectsData);

    const loadingManager = this.entityManager.getLoadingManager();
    loadingManager.onProgress = (_, loaded, total) => onProgress((loaded / total) * 100);
    loadingManager.onLoad = () => { onLoaded(); this.entityManager.publishSceneEntities(); };

    standardObjectsData.forEach(o => this.entityManager.createObjectFromData(o));
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

    if (key === 'c' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      this.toggleActiveCamera();
    }

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

    if (this.cameraManager.cameraMode$.getValue() === 'orthographic') {
      this.baseOrthoMatrixElement = this.cameraManager.setCameraView(null, undefined);
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
}