// src/app/modules/admin/pages/episode-creator/engine/engine.service.ts
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

const INSTANCES_TO_CHECK_PER_FRAME = 20000; // Aumentado para escenas con muchos objetos
const VISUAL_BOOST_FACTOR = 1.8;
const DOMINANT_OBJECT_BOOST_FACTOR = 2.0;

// --- MEJORA CLAVE: Ajustar el desvanecimiento a la nueva escala del universo ---
// El SCENE_DEPTH_SPREAD es 200000. Estos valores deben estar dentro de ese rango.
const FADE_START_DISTANCE = 100000;
const FADE_END_DISTANCE = 180000;

@Injectable()
export class EngineService implements OnDestroy {
  public onTransformEnd$: Observable<void>;
  private transformEndSubject = new Subject<void>();
  private selectedObject?: THREE.Object3D;
  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private keyMap = new Map<string, boolean>();
  private axisLock: 'x' | 'y' | 'z' | null = null;
  private axisLockStateSubject = new BehaviorSubject<'x' | 'y' | 'z' | null>(null);
  public axisLockState$ = this.axisLockStateSubject.asObservable();
  private cameraOrientationSubject = new BehaviorSubject<THREE.Quaternion>(new THREE.Quaternion());
  public cameraOrientation$ = this.cameraOrientationSubject.asObservable();
  private cameraPositionSubject = new BehaviorSubject<THREE.Vector3>(new THREE.Vector3());
  public cameraPosition$ = this.cameraPositionSubject.asObservable();
  public isFlyModeActive$: Observable<boolean>;
  private controlsSubscription?: Subscription;
  private tempColor = new THREE.Color();
  private tempQuaternion = new THREE.Quaternion();
  private tempMatrix = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private boundingSphere = new THREE.Sphere();
  private updateIndexCounter = 0;

  constructor(
    private sceneManager: SceneManagerService,
    private entityManager: EntityManagerService,
    private controlsManager: ControlsManagerService,
    private selectionManager: SelectionManagerService,
    private statsManager: StatsManagerService,
    private interactionHelperManager: InteractionHelperManagerService,
    private dragInteractionManager: DragInteractionManagerService
  ) {
    this.onTransformEnd$ = this.transformEndSubject.asObservable().pipe(debounceTime(500));
    this.isFlyModeActive$ = this.controlsManager.isFlyModeActive$;
  }

  public init(canvasRef: ElementRef<HTMLCanvasElement>): void {
    const canvas = canvasRef.nativeElement;
    this.sceneManager.setupBasicScene(canvas);
    this.entityManager.init(this.sceneManager.scene);
    this.statsManager.init();
    this.selectionManager.init(this.sceneManager.scene, this.sceneManager.editorCamera, this.sceneManager.renderer, canvas);
    this.controlsManager.init(this.sceneManager.editorCamera, canvas, this.sceneManager.scene, this.sceneManager.focusPivot);
    this.sceneManager.setControls(this.controlsManager.getControls());
    this.interactionHelperManager.init(this.sceneManager.scene, this.sceneManager.editorCamera);
    this.dragInteractionManager.init(this.sceneManager.editorCamera, canvas, this.controlsManager);
    this.controlsManager.enableNavigation();
    this.addEventListeners();
    this.animate();
  }

  public populateScene(objects: SceneObjectResponse[], onProgress: (p: number) => void, onLoaded: () => void): void {
    if (!this.sceneManager.scene) return;
    this.entityManager.clearScene();
    // CORRECCIÓN: Añadir 'diffraction_star' a la lista para que se procese.
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

  ngOnDestroy = () => {
    this.removeEventListeners();
    this.interactionHelperManager.cleanupHelpers(this.selectedObject);
    this.dragInteractionManager.stopListening();
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.statsManager.destroy();
    this.controlsManager.ngOnDestroy();
    if (this.sceneManager.renderer) this.sceneManager.renderer.dispose();
  };

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    const delta = this.clock.getDelta();
    const cameraMoved = this.controlsManager.update(delta, this.keyMap);
    if (cameraMoved) {
      this.interactionHelperManager.updateScale();
      this.cameraPositionSubject.next(this.sceneManager.editorCamera.position);
    }
    this.updateVisibleCelestialInstances();
    this.sceneManager.composer.render();
    this.statsManager.end();
  };

  private updateCameraFrustum(): void {
    const camera = this.sceneManager.editorCamera;
    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  private updateVisibleCelestialInstances(): void {
    const instancedMesh = this.sceneManager.scene.getObjectByName('CelestialObjectsInstanced') as THREE.InstancedMesh;
    if (!instancedMesh) return;

    const allData: CelestialInstanceData[] = instancedMesh.userData['celestialData'];
    if (!allData || allData.length === 0) return;

    this.updateCameraFrustum();
    let needsColorUpdate = false;
    let needsMatrixUpdate = false;
    const camera = this.sceneManager.editorCamera;

    const startIndex = this.updateIndexCounter;
    const endIndex = Math.min(startIndex + INSTANCES_TO_CHECK_PER_FRAME, allData.length);

    for (let i = startIndex; i < endIndex; i++) {
      const data = allData[i];
      this.boundingSphere.center.copy(data.position);
      this.boundingSphere.radius = Math.max(data.scale.x, data.scale.y, data.scale.z);
      const isInFrustum = this.frustum.intersectsSphere(this.boundingSphere);

      const distance = data.position.distanceTo(camera.position);
      const attenuation = 1.0 - THREE.MathUtils.smoothstep(distance, FADE_START_DISTANCE, FADE_END_DISTANCE);

      const isVisible = isInFrustum && attenuation > 0;

      if (isVisible !== data.isVisible) {
        if (isVisible) {
          this.tempMatrix.compose(data.position, camera.quaternion, data.scale);
          instancedMesh.setMatrixAt(i, this.tempMatrix);

          const boostFactor = data.isDominant
            ? VISUAL_BOOST_FACTOR * DOMINANT_OBJECT_BOOST_FACTOR
            : VISUAL_BOOST_FACTOR;

          const scaleMultiplier = 1.0 + Math.log1p(data.scale.x * 0.7);
          const finalIntensity = data.emissiveIntensity * scaleMultiplier * boostFactor * attenuation;

          this.tempColor.copy(data.originalColor).multiplyScalar(finalIntensity);
          instancedMesh.setColorAt(i, this.tempColor);
          needsColorUpdate = true;
          needsMatrixUpdate = true; // Actualizar matriz al hacerse visible
        } else {
          this.tempColor.setRGB(0, 0, 0);
          instancedMesh.setColorAt(i, this.tempColor);
          needsColorUpdate = true;
        }
        data.isVisible = isVisible;
      } else if (isVisible) {
        // Si ya era visible, solo actualizamos la matriz para el billboarding
        this.tempMatrix.compose(data.position, camera.quaternion, data.scale);
        instancedMesh.setMatrixAt(i, this.tempMatrix);
        needsMatrixUpdate = true;
      }
    }

    this.updateIndexCounter = endIndex >= allData.length ? 0 : endIndex;

    if (needsColorUpdate && instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
    if (needsMatrixUpdate) instancedMesh.instanceMatrix.needsUpdate = true;
  }
  public selectObjectByUuid(uuid: string | null): void {
    this.interactionHelperManager.cleanupHelpers(this.selectedObject);
    this.dragInteractionManager.stopListening();
    this.controlsManager.detach();
    this.axisLock = null;
    this.dragInteractionManager.setAxisConstraint(null);
    this.axisLockStateSubject.next(null);
    this.selectedObject = undefined;
    this.entityManager.selectObjectByUuid(uuid, this.sceneManager.focusPivot);
    if (uuid) {
      this.selectedObject = this.entityManager.getObjectByUuid(uuid);
      if (this.selectedObject) {
        this.setToolMode(this.controlsManager.getCurrentToolMode());
      }
    }
  }

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

  private handleTransformEnd = () => {
    if (!this.selectedObject) return;
    if (this.selectedObject.name === 'SelectionProxy') {
      const instancedMesh = this.sceneManager.scene.getObjectByName('CelestialObjectsInstanced') as THREE.InstancedMesh;
      if (!instancedMesh) return;
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
    this.transformEndSubject.next();
  }

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

  private onControlsChange = () => {
    this.interactionHelperManager.updateScale();
    this.sceneManager.editorCamera.getWorldQuaternion(this.tempQuaternion);
    if (!this.tempQuaternion.equals(this.cameraOrientationSubject.getValue())) {
      this.cameraOrientationSubject.next(this.tempQuaternion.clone());
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (key === 'escape') { this.controlsManager.exitFlyMode(); return; }
    this.keyMap.set(key, true);
    if (this.controlsManager.getCurrentToolMode() === 'move' && ['x', 'y', 'z'].includes(key)) {
      this.axisLock = this.axisLock === key ? null : (key as 'x' | 'y' | 'z');
      this.dragInteractionManager.setAxisConstraint(this.axisLock);
      this.axisLockStateSubject.next(this.axisLock);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), false);
  public frameScene = (width: number, height: number) => this.sceneManager.frameScene(width, height);
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  private onWindowResize = () => { this.sceneManager.onWindowResize(); this.selectionManager.onResize(this.sceneManager.renderer.domElement.width, this.sceneManager.renderer.domElement.height); this.interactionHelperManager.updateScale(); };
  public addObjectToScene = (objData: SceneObjectResponse) => this.entityManager.createObjectFromData(objData);
  public updateObjectName = (uuid: string, newName: string) => this.entityManager.updateObjectName(uuid, newName);
  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number; y: number; z: number; }) => {
    const obj = this.entityManager.getObjectByUuid(uuid);
    if (obj) { obj[path].set(value.x, value.y, value.z); if (path === 'position') this.interactionHelperManager.updateHelperPositions(obj); }
  };
  public setCameraView = (axisName: string) => {
    const controls = this.controlsManager.getControls(); if (!controls) return;
    const target = this.sceneManager.focusPivot.position; const distance = Math.max(this.sceneManager.editorCamera.position.distanceTo(target), 5);
    const newPosition = new THREE.Vector3();
    switch (axisName) {
      case 'axis-x': newPosition.set(distance, 0, 0); break; case 'axis-x-neg': newPosition.set(-distance, 0, 0); break;
      case 'axis-y': newPosition.set(0, distance, 0); break; case 'axis-y-neg': newPosition.set(0, -distance, 0.0001); break;
      case 'axis-z': newPosition.set(0, 0, distance); break; case 'axis-z-neg': newPosition.set(0, 0, -distance); break;
      default: return;
    }
    this.sceneManager.editorCamera.position.copy(target).add(newPosition);
    this.sceneManager.editorCamera.lookAt(target); controls.target.copy(target);
    controls.update();
  };
}