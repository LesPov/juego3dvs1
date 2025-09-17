// src/app/features/admin/views/world-editor/service/three-engine/engine.service.ts

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
import { CameraManagerService, CameraMode } from './utils/camera-manager.service';
import { SelectionManagerService } from './utils/selection-manager.service';

export interface IntersectedObjectInfo {
    uuid: string;
    object: THREE.Object3D;
}

// Interfaces para el estado de la animación
interface AnimationState3D {
    position: THREE.Vector3;
    target: THREE.Vector3;
}

interface AnimationState2D extends AnimationState3D {
    left: number;
    right: number;
    top: number;
    bottom: number;
}


const INSTANCES_TO_CHECK_PER_FRAME = 100000;
const BASE_VISIBILITY_DISTANCE = 1000000000000;
const MAX_PERCEPTUAL_DISTANCE = 10000000000000;
const DEEP_SPACE_SCALE_BOOST = 10.0;
const ORTHO_ZOOM_VISIBILITY_MULTIPLIER = 5.0;
const ORTHO_ZOOM_BLOOM_DAMPENING_FACTOR = 12.0;
const BRIGHTNESS_MULTIPLIER = 1.0;
const MAX_INTENSITY = 8.0;
const BRIGHTNESS_FALLOFF_START_DISTANCE = 500_000_000;
const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';

@Injectable()
export class EngineService implements OnDestroy {
  private isCameraAnimating = false;

  public onTransformEnd$: Observable<void>;
  public axisLockState$: Observable<'x' | 'y' | 'z' | null>;
  public cameraOrientation$: Observable<THREE.Quaternion>;
  public cameraPosition$: Observable<THREE.Vector3>;
  public isFlyModeActive$: Observable<boolean>;
  public cameraMode$: Observable<CameraMode>;
  public onObjectSelected$ = new Subject<string | null>();

  private transformEndSubject = new Subject<void>();
  private axisLockStateSubject = new BehaviorSubject<'x' | 'y' | 'z' | null>(null);
  private cameraOrientationSubject = new BehaviorSubject<THREE.Quaternion>(new THREE.Quaternion());
  private cameraPositionSubject = new BehaviorSubject<THREE.Vector3>(new THREE.Vector3());

  private selectedObject?: THREE.Object3D;
  private preselectedObject: IntersectedObjectInfo | null = null;

  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private keyMap = new Map<string, boolean>();
  private axisLock: 'x' | 'y' | 'z' | null = null;
  private baseOrthoMatrixElement: number = 0;
  private controlsSubscription?: Subscription;
  private focusPivot: THREE.Object3D;

  private raycaster = new THREE.Raycaster();
  private centerScreen = new THREE.Vector2(0, 0);

  // ✨ MEJORA: El estado de la animación ahora puede ser 2D o 3D
  private cameraAnimationTarget: AnimationState2D | AnimationState3D | null = null;
  private cameraInitialState: AnimationState2D | AnimationState3D | null = null;
  private cameraAnimationStartTime: number | null = null;
  private readonly cameraAnimationDuration = 1000; // 1 segundo

  private tempQuaternion = new THREE.Quaternion();
  private tempMatrix = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private boundingSphere = new THREE.Sphere();
  private tempScale = new THREE.Vector3();
  private tempColor = new THREE.Color();
  private tempBox = new THREE.Box3();
  private tempVec3 = new THREE.Vector3();
  private dynamicCelestialModels: THREE.Group[] = [];

  constructor(
    private sceneManager: SceneManagerService,
    private entityManager: EntityManagerService,
    private controlsManager: ControlsManagerService,
    private statsManager: StatsManagerService,
    private interactionHelperManager: InteractionHelperManagerService,
    private dragInteractionManager: DragInteractionManagerService,
    private cameraManager: CameraManagerService,
    private selectionManager: SelectionManagerService
  ) {
    this.focusPivot = new THREE.Object3D();
    this.focusPivot.name = 'FocusPivot';
    this.onTransformEnd$ = this.transformEndSubject.asObservable().pipe(debounceTime(500));
    this.isFlyModeActive$ = this.controlsManager.isFlyModeActive$;
    this.axisLockState$ = this.axisLockStateSubject.asObservable();
    this.cameraOrientation$ = this.cameraOrientationSubject.asObservable();
    this.cameraPosition$ = this.cameraPositionSubject.asObservable();
    this.cameraMode$ = this.cameraManager.cameraMode$.asObservable();
  }

  public init(canvasRef: ElementRef<HTMLCanvasElement>): void {
    const canvas = canvasRef.nativeElement;
    this.sceneManager.setupBasicScene(canvas);
    this.sceneManager.scene.add(this.focusPivot);

    this.entityManager.init(this.sceneManager.scene);
    this.statsManager.init();
    this.controlsManager.init(this.sceneManager.editorCamera, canvas, this.sceneManager.scene, this.focusPivot);
    this.sceneManager.setControls(this.controlsManager.getControls());
    this.interactionHelperManager.init(this.sceneManager.scene, this.sceneManager.editorCamera);
    this.dragInteractionManager.init(this.sceneManager.editorCamera, canvas, this.controlsManager);
    this.cameraManager.initialize();

    const parent = this.sceneManager.canvas.parentElement!;
    const initialSize = new THREE.Vector2(parent.clientWidth, parent.clientHeight);
    this.selectionManager.init(this.sceneManager.scene, this.sceneManager.activeCamera, initialSize);
    this.selectionManager.getPasses().forEach(pass => {
        this.sceneManager.composer.addPass(pass);
    });

    this.precompileShaders();

    this.cameraMode$.subscribe(mode => {
        this.selectionManager.updateOutlineParameters(mode);
    });

    this.controlsManager.enableNavigation();
    this.addEventListeners();
    this.animate();
  }

  private precompileShaders(): void {
    const dummyGeometry = new THREE.BoxGeometry(0.001, 0.001, 0.001);
    const dummyMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    const dummyMesh = new THREE.Mesh(dummyGeometry, dummyMaterial);
    dummyMesh.position.set(Infinity, Infinity, Infinity);
    this.sceneManager.scene.add(dummyMesh);
    this.selectionManager.setSelectedObjects([dummyMesh]);
    this.sceneManager.composer.render();
    this.selectionManager.setSelectedObjects([]);
    this.sceneManager.scene.remove(dummyMesh);
    dummyGeometry.dispose();
    dummyMaterial.dispose();
  }

  public onWindowResize = () => {
    const parentElement = this.sceneManager.canvas?.parentElement;
    if (!parentElement) return;

    const newWidth = parentElement.clientWidth;
    const newHeight = parentElement.clientHeight;

    this.sceneManager.onWindowResize();
    this.interactionHelperManager.updateScale();
    this.selectionManager.setSize(newWidth, newHeight);
  };

  public setActiveSelectionByUuid(uuid: string | null): void {
    const currentUuid = this.selectedObject?.uuid;
    if (currentUuid === uuid) return;

    this.selectionManager.setSelectedObjects([]);
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
      if (!this.selectedObject) {
        this.selectedObject = this.sceneManager.scene.getObjectByName('SelectionProxy');
      }
      if (this.selectedObject) {
        this.selectionManager.setSelectedObjects([this.selectedObject]);
        this.setToolMode(this.controlsManager.getCurrentToolMode());
      }
    }
    this.onObjectSelected$.next(uuid);
  }

  public focusOnObject(uuid: string): void {
    if (this.isCameraAnimating) return;

    const object = this.entityManager.getObjectByUuid(uuid);
    if (!object) return;

    const cameraMode = this.cameraManager.cameraMode$.getValue();

    if (cameraMode === 'perspective') {
      this.focusOnObject3D(object);
    } else {
      this.focusOnObject2D(object);
    }
  }

  private focusOnObject3D(object: THREE.Object3D): void {
    const controls = this.controlsManager.getControls();
    const camera = this.sceneManager.activeCamera;

    this.tempBox.setFromObject(object, true);
    if (this.tempBox.isEmpty()) {
      this.tempBox.setFromCenterAndSize(object.position, new THREE.Vector3(1, 1, 1));
    }

    const targetPoint = this.tempBox.getCenter(new THREE.Vector3());
    const objectSize = this.tempBox.getSize(new THREE.Vector3()).length();

    const distance = Math.max(objectSize * 2.5, 10);

    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);

    const finalCamPos = new THREE.Vector3()
        .copy(targetPoint)
        .addScaledVector(cameraDirection.negate(), distance);

    this.isCameraAnimating = true;
    this.cameraAnimationStartTime = this.clock.getElapsedTime();
    this.cameraInitialState = {
      position: camera.position.clone(),
      target: controls.target.clone()
    };
    this.cameraAnimationTarget = {
      position: finalCamPos,
      target: targetPoint,
    };

    controls.enabled = false;
    this.controlsManager.exitFlyMode();
  }

  // ✨ MEJORA: focusOnObject2D ahora inicia una animación en lugar de un salto
  private focusOnObject2D(object: THREE.Object3D): void {
    const camera = this.sceneManager.activeCamera;
    const controls = this.controlsManager.getControls();
    if (!(camera instanceof THREE.OrthographicCamera)) return;

    this.tempBox.setFromObject(object, true);
    if (this.tempBox.isEmpty()) {
        this.tempBox.setFromCenterAndSize(object.position, new THREE.Vector3(1, 1, 1));
    }

    const objectCenter = this.tempBox.getCenter(new THREE.Vector3());
    const objectSize = this.tempBox.getSize(new THREE.Vector3());

    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);

    const distanceToTarget = camera.position.distanceTo(controls.target);
    const finalCamPos = new THREE.Vector3().copy(objectCenter).addScaledVector(cameraDirection.negate(), distanceToTarget);

    const aspect = (camera.right - camera.left) / (camera.top - camera.bottom);
    const padding = 1.5;

    let requiredWidth = 0, requiredHeight = 0;
    if (Math.abs(cameraDirection.z) > 0.9) {
        requiredWidth = objectSize.x; requiredHeight = objectSize.y;
    } else if (Math.abs(cameraDirection.x) > 0.9) {
        requiredWidth = objectSize.z; requiredHeight = objectSize.y;
    } else {
        requiredWidth = objectSize.x; requiredHeight = objectSize.z;
    }

    requiredWidth *= padding;
    requiredHeight *= padding;

    if (requiredWidth / aspect > requiredHeight) {
        requiredHeight = requiredWidth / aspect;
    } else {
        requiredWidth = requiredHeight * aspect;
    }

    this.isCameraAnimating = true;
    this.cameraAnimationStartTime = this.clock.getElapsedTime();

    this.cameraInitialState = {
        position: camera.position.clone(),
        target: controls.target.clone(),
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
    };

    this.cameraAnimationTarget = {
        position: finalCamPos,
        target: objectCenter,
        left: -requiredWidth / 2,
        right: requiredWidth / 2,
        top: requiredHeight / 2,
        bottom: -requiredHeight / 2,
    };

    controls.enabled = false;
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    const delta = this.clock.getDelta();

    this.updateCameraAnimation();
    this.updateHoverEffect();
    this.adjustCameraClippingPlanes();

    if (this.cameraManager.activeCameraType === 'secondary') {
      const controls = this.controlsManager.getControls();
      this.sceneManager.editorCamera.getWorldPosition(controls.target);
    }
    if (this.cameraManager.activeCameraType === 'editor') {
      this.sceneManager.secondaryCamera.userData['helper']?.update();
    } else {
      this.sceneManager.editorCamera.userData['helper']?.update();
    }

    if (!this.isCameraAnimating) {
      const cameraMoved = this.controlsManager.update(delta, this.keyMap);
      if (cameraMoved) {
        this.interactionHelperManager.updateScale();
        this.cameraPositionSubject.next(this.sceneManager.activeCamera.position);
      }
    }

    this.sceneManager.activeCamera.getWorldQuaternion(this.tempQuaternion);
    if (!this.tempQuaternion.equals(this.cameraOrientationSubject.getValue())) {
      this.cameraOrientationSubject.next(this.tempQuaternion.clone());
    }
    const selectionProxy = this.sceneManager.scene.getObjectByName('SelectionProxy');
    if (selectionProxy) {
      selectionProxy.quaternion.copy(this.sceneManager.activeCamera.quaternion);
    }
    this.updateDynamicCelestialModels(delta);
    this.sceneManager.scene.children.forEach(object => {
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) {
        this.updateVisibleCelestialInstances(object as THREE.InstancedMesh);
      }
      if (object.userData['animationMixer']) {
        object.userData['animationMixer'].update(delta);
      }
    });
    this.sceneManager.composer.render();
    this.statsManager.end();
  };

  // ✨ MEJORA: El bucle de animación ahora interpola el zoom 2D
  private updateCameraAnimation(): void {
    if (!this.isCameraAnimating || !this.cameraAnimationTarget || !this.cameraInitialState || this.cameraAnimationStartTime === null) {
      return;
    }

    const elapsedTime = this.clock.getElapsedTime() - this.cameraAnimationStartTime;
    const progress = Math.min(elapsedTime / (this.cameraAnimationDuration / 1000), 1);

    const alpha = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    const camera = this.sceneManager.activeCamera;
    const controls = this.controlsManager.getControls();

    camera.position.lerpVectors(this.cameraInitialState.position, this.cameraAnimationTarget.position, alpha);
    controls.target.lerpVectors(this.cameraInitialState.target, this.cameraAnimationTarget.target, alpha);

    // Si es una animación 2D, también interpolamos los límites del frustum (zoom)
    if ('left' in this.cameraInitialState && 'left' in this.cameraAnimationTarget && camera instanceof THREE.OrthographicCamera) {
        camera.left = THREE.MathUtils.lerp(this.cameraInitialState.left, this.cameraAnimationTarget.left, alpha);
        camera.right = THREE.MathUtils.lerp(this.cameraInitialState.right, this.cameraAnimationTarget.right, alpha);
        camera.top = THREE.MathUtils.lerp(this.cameraInitialState.top, this.cameraAnimationTarget.top, alpha);
        camera.bottom = THREE.MathUtils.lerp(this.cameraInitialState.bottom, this.cameraAnimationTarget.bottom, alpha);
        camera.updateProjectionMatrix();
    }

    controls.update();

    if (progress >= 1) {
      camera.position.copy(this.cameraAnimationTarget.position);
      controls.target.copy(this.cameraAnimationTarget.target);

      if ('left' in this.cameraAnimationTarget && camera instanceof THREE.OrthographicCamera) {
        camera.left = this.cameraAnimationTarget.left;
        camera.right = this.cameraAnimationTarget.right;
        camera.top = this.cameraAnimationTarget.top;
        camera.bottom = this.cameraAnimationTarget.bottom;
        camera.updateProjectionMatrix();
      }

      controls.enabled = true;
      controls.update();

      this.isCameraAnimating = false;
      this.cameraAnimationTarget = null;
      this.cameraInitialState = null;
      this.cameraAnimationStartTime = null;
    }
  }

  private updateHoverEffect(): void {
    if (this.controlsManager.getCurrentToolMode() !== 'select' || this.cameraManager.cameraMode$.getValue() === 'orthographic') {
      this.selectionManager.setHoveredObjects([]);
      this.preselectedObject = null;
      this.entityManager.removeHoverProxy();
      return;
    }

    this.raycaster.setFromCamera(this.centerScreen, this.sceneManager.activeCamera);
    const intersects = this.raycaster.intersectObjects(this.sceneManager.scene.children, true);

    const firstValidHit = intersects.find(hit =>
        !hit.object.name.endsWith('_helper') &&
        hit.object.name !== '' &&
        hit.object.visible &&
        !['SelectionProxy', 'HoverProxy', 'EditorGrid', 'FocusPivot'].includes(hit.object.name)
    );

    if (firstValidHit) {
      const hitObject = firstValidHit.object;
      let targetUuid: string;
      let proxyObject: THREE.Object3D;

      if ((hitObject as THREE.InstancedMesh).isInstancedMesh && firstValidHit.instanceId !== undefined) {
          proxyObject = this.entityManager.createOrUpdateHoverProxy(hitObject as THREE.InstancedMesh, firstValidHit.instanceId);
          targetUuid = proxyObject.uuid;
      } else {
        proxyObject = hitObject;
        targetUuid = hitObject.uuid;
      }

      if (this.preselectedObject?.uuid !== targetUuid) {
        this.preselectedObject = { uuid: targetUuid, object: proxyObject };
        this.selectionManager.setHoveredObjects([this.preselectedObject.object]);
      }
    } else {
      if (this.preselectedObject) {
        this.preselectedObject = null;
        this.selectionManager.setHoveredObjects([]);
        this.entityManager.removeHoverProxy();
      }
    }
  }

  private onCanvasMouseDown = (event: MouseEvent) => {
    if (event.button === 0 && this.preselectedObject) {
      event.preventDefault();
      const hoveredUuid = this.preselectedObject.uuid;

      this.selectionManager.setHoveredObjects([]);
      this.entityManager.removeHoverProxy();
      this.preselectedObject = null;

      const newUuid = this.selectedObject?.uuid === hoveredUuid ? null : hoveredUuid;
      this.setActiveSelectionByUuid(newUuid);
    }
  };

  private updateDynamicCelestialModels(delta: number): void {
    this.dynamicCelestialModels.forEach(model => {
      if (!model.userData['isDynamicCelestialModel']) return;
      const distance = this.sceneManager.activeCamera.position.distanceTo(model.position);
      const maxScale = Math.max(model.scale.x, model.scale.y, model.scale.z);
      const START_FADE_DISTANCE = maxScale * 80.0;
      const END_FADE_DISTANCE = maxScale * 10.0;
      const originalIntensity = model.userData['originalEmissiveIntensity'] || 1.0;
      const baseIntensity = model.userData['baseEmissiveIntensity'] || 0.1;
      const fadeFactor = THREE.MathUtils.inverseLerp(START_FADE_DISTANCE, END_FADE_DISTANCE, distance);
      const clampedFadeFactor = THREE.MathUtils.clamp(fadeFactor, 0.0, 1.0);
      const targetIntensity = THREE.MathUtils.lerp(originalIntensity, baseIntensity, clampedFadeFactor);
      model.traverse(child => {
        if (child instanceof THREE.Mesh && child.material) {
          const applyIntensity = (material: any) => {
            if ('emissiveIntensity' in material) {
              material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, targetIntensity, delta * 5);
            }
          };
          if (Array.isArray(child.material)) {
            child.material.forEach(applyIntensity);
          } else {
            applyIntensity(child.material);
          }
        }
      });
    });
  }

  private adjustCameraClippingPlanes = () => {
    const camera = this.sceneManager.activeCamera;
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const controls = this.controlsManager.getControls();
    if (!controls) return;
    const minNear = 0.1;
    const maxFar = 1e15;
    const distanceToTarget = camera.position.distanceTo(controls.target);
    let objectSize = 0;
    if (this.selectedObject) {
        this.tempBox.setFromObject(this.selectedObject, true);
        objectSize = this.tempBox.getSize(this.tempVec3).length();
    }
    if (objectSize === 0) {
        objectSize = distanceToTarget * 0.1;
    }
    let newNear = Math.min(distanceToTarget / 1000, objectSize / 10);
    newNear = THREE.MathUtils.clamp(newNear, minNear, 1000);
    const originalFar = camera.userData['originalFar'] || maxFar;
    let newFar = Math.max(distanceToTarget * 2, originalFar);
    newFar = Math.min(newFar, maxFar);
    if (newFar <= newNear) {
      newFar = newNear * 2;
    }
    if (camera.near !== newNear || camera.far !== newFar) {
      camera.near = newNear;
      camera.far = newFar;
      camera.updateProjectionMatrix();
    }
  };

  public populateScene(objects: SceneObjectResponse[], onProgress: (p: number) => void, onLoaded: () => void): void {
    if (!this.sceneManager.scene) return;
    this.entityManager.clearScene();
    this.dynamicCelestialModels = [];
    const celestialTypes = ['galaxy_normal', 'galaxy_bright', 'meteor', 'galaxy_far', 'galaxy_medium', 'model'];
    const celestialObjectsData = objects.filter(o => celestialTypes.includes(o.type));
    const standardObjectsData = objects.filter(o => !celestialTypes.includes(o.type));
    this.entityManager.objectManager.createCelestialObjectsInstanced(
      this.sceneManager.scene,
      celestialObjectsData,
      this.entityManager.getGltfLoader()
    );
    const loadingManager = this.entityManager.getLoadingManager();
    loadingManager.onProgress = (_, loaded, total) => onProgress((loaded / total) * 100);
    loadingManager.onLoad = () => {
      this.sceneManager.renderer.compile(this.sceneManager.scene, this.sceneManager.activeCamera);
      onLoaded();
      this.entityManager.publishSceneEntities();
      this.sceneManager.scene.traverse(obj => {
        if (obj.userData['isDynamicCelestialModel']) {
          this.dynamicCelestialModels.push(obj as THREE.Group);
        }
      });
    };
    standardObjectsData.forEach(o => this.entityManager.createObjectFromData(o));
    const hasModelsToLoad = standardObjectsData.some(o => o.type === 'model' && o.asset?.path) ||
      celestialObjectsData.some(o => o.asset?.type === 'model_glb');
    if (!hasModelsToLoad) {
      setTimeout(() => { if (loadingManager.onLoad) loadingManager.onLoad(); }, 0);
    }
  }

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

      this.boundingSphere.center.copy(data.position);
      this.boundingSphere.radius = Math.max(data.scale.x, data.scale.y, data.scale.z) * DEEP_SPACE_SCALE_BOOST;
      if (!this.frustum.intersectsSphere(this.boundingSphere)) {
        if (data.isVisible) {
          this.tempColor.setScalar(0);
          instancedMesh.setColorAt(currentIndex, this.tempColor);
          needsColorUpdate = true;
          data.isVisible = false;
        }
        continue;
      }

      const personalVisibilityDistance = Math.min(BASE_VISIBILITY_DISTANCE * data.luminosity, MAX_PERCEPTUAL_DISTANCE);
      const effectiveVisibilityDistance = personalVisibilityDistance * visibilityFactor;
      const distance = data.position.distanceTo(camera.position);

      if (distance > effectiveVisibilityDistance) {
        if (data.isVisible) {
          this.tempColor.setScalar(0);
          instancedMesh.setColorAt(currentIndex, this.tempColor);
          needsColorUpdate = true;
          data.isVisible = false;
        }
        continue;
      }

      const maxScale = Math.max(data.scale.x, data.scale.y, data.scale.z);
      const startFadeDistance = maxScale * 80.0;
      const endFadeDistance = maxScale * 10.0;
      const fadeFactor = THREE.MathUtils.inverseLerp(startFadeDistance, endFadeDistance, distance);
      const clampedFadeFactor = THREE.MathUtils.clamp(fadeFactor, 0.0, 1.0);
      const targetIntensity = THREE.MathUtils.lerp(data.emissiveIntensity, data.baseEmissiveIntensity, clampedFadeFactor);
      const visibilityFalloff = 1.0 - THREE.MathUtils.smoothstep(distance, 0, effectiveVisibilityDistance);
      const distanceFalloff = 1.0 - THREE.MathUtils.smoothstep(distance, BRIGHTNESS_FALLOFF_START_DISTANCE, effectiveVisibilityDistance);
      const baseIntensity = targetIntensity * BRIGHTNESS_MULTIPLIER * visibilityFalloff * distanceFalloff;
      const brightnessMultiplier = isOrthographic ? data.brightness : 1.0;
      const finalIntensity = Math.min(baseIntensity, MAX_INTENSITY) * bloomDampeningFactor * brightnessMultiplier;

      if (finalIntensity > 0.01) {
        if (!data.isVisible) {
          data.isVisible = true;
        }
        this.tempScale.copy(data.scale).multiplyScalar(DEEP_SPACE_SCALE_BOOST);
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

  public toggleActiveCamera(): void { this.cameraManager.toggleActiveCamera(this.selectedObject); }
  public toggleCameraMode(): void { this.cameraManager.toggleCameraMode(); }
  public setCameraView(axisName: string | null): void { this.baseOrthoMatrixElement = this.cameraManager.setCameraView(axisName, undefined); }
  public switchToPerspectiveView(): void { this.cameraManager.switchToPerspectiveView(); }

  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number; y: number; z: number; }) => {
    const standardObject = this.entityManager.getObjectByUuid(uuid);
    if (standardObject && standardObject.name !== 'SelectionProxy') {
      standardObject[path].set(value.x, value.y, value.z);
      if (path === 'position') this.interactionHelperManager.updateHelperPositions(standardObject);
      return;
    }
    const instanceInfo = this.entityManager._findCelestialInstance(uuid);
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

  public getCurrentToolMode = (): ToolMode => this.controlsManager.getCurrentToolMode();

  public setGroupVisibility = (uuids: string[], visible: boolean): void => this.entityManager.setGroupVisibility(uuids, visible);
  public setGroupBrightness = (uuids: string[], brightness: number): void => this.entityManager.setGroupBrightness(uuids, brightness);
  public addObjectToScene = (objData: SceneObjectResponse) => this.entityManager.createObjectFromData(objData);
  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  public frameScene = () => this.cameraManager.frameScene();
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
    this.sceneManager.canvas.addEventListener('mousedown', this.onCanvasMouseDown, false);
  };
  private removeEventListeners = (): void => {
    const controls = this.controlsManager.getControls();
    controls?.removeEventListener('end', this.handleTransformEnd);
    controls?.removeEventListener('change', this.onControlsChange);
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controlsSubscription?.unsubscribe();
    this.sceneManager.canvas.removeEventListener('mousedown', this.onCanvasMouseDown, false);
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
  private updateCameraFrustum(): void {
    const camera = this.sceneManager.activeCamera;
    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }
}