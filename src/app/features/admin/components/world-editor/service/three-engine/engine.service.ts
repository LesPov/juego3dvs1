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

const INSTANCES_TO_CHECK_PER_FRAME = 500;

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
  
  // <<< NUEVO: Exponemos el estado del modo vuelo para la UI >>>
  public isFlyModeActive$: Observable<boolean>;


  private controlsSubscription?: Subscription;
  private tempColor = new THREE.Color();
  private tempQuaternion = new THREE.Quaternion();

  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private boundingSphere = new THREE.Sphere();
  private updateIndexCounter = 0; 
  private lastCameraVersion = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

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
    // <<< NUEVO: Hacemos accesible el estado del modo vuelo desde el manager de controles >>>
    this.isFlyModeActive$ = this.controlsManager.isFlyModeActive$;
  }

  public init(canvasRef: ElementRef<HTMLCanvasElement>): void {
    const canvas = canvasRef.nativeElement;
    this.sceneManager.setupBasicScene(canvas);
    this.entityManager.init(this.sceneManager.scene);
    this.statsManager.init();
    this.selectionManager.init(this.sceneManager.scene, this.sceneManager.editorCamera, this.sceneManager.renderer, canvas);
    this.controlsManager.init(this.sceneManager.editorCamera, canvas, this.sceneManager.scene, this.sceneManager.focusPivot);
    this.interactionHelperManager.init(this.sceneManager.scene, this.sceneManager.editorCamera);
    this.dragInteractionManager.init(this.sceneManager.editorCamera, canvas, this.controlsManager);

    this.controlsManager.enableNavigation();
    this.addEventListeners();
    this.animate();
  }

  // ... (el método populateScene no cambia)
  public populateScene(objects: SceneObjectResponse[], onProgress: (p: number) => void, onLoaded: () => void): void {
    if (!this.sceneManager.scene) return;
    this.entityManager.clearScene();

    const celestialTypes = ['star', 'galaxy', 'meteor'];
    const celestialObjectsData = objects.filter(o => celestialTypes.includes(o.type));
    const standardObjectsData = objects.filter(o => !celestialTypes.includes(o.type));

    this.entityManager.objectManager.createCelestialObjectsInstanced(this.sceneManager.scene, celestialObjectsData);

    const loadingManager = this.entityManager.getLoadingManager();
    loadingManager.onProgress = (_, loaded, total) => onProgress((loaded / total) * 100);
    loadingManager.onLoad = () => {
      onLoaded();
      this.entityManager.publishSceneEntities();
    };

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

  // ... (los métodos updateCameraFrustum y updateVisibleCelestialInstances no cambian)
  private updateCameraFrustum(): void {
    const camera = this.sceneManager.editorCamera;
    const currentPos = camera.position;
    const currentQuat = camera.quaternion;

    if (this.lastCameraVersion.position.equals(currentPos) && this.lastCameraVersion.quaternion.equals(currentQuat)) {
        return;
    }

    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    this.lastCameraVersion.position.copy(currentPos);
    this.lastCameraVersion.quaternion.copy(currentQuat);
  }

  private updateVisibleCelestialInstances(): void {
    const camera = this.sceneManager.editorCamera;
    const instancedMesh = this.sceneManager.scene.getObjectByName('CelestialObjectsInstanced') as THREE.InstancedMesh;
    if (!camera || !instancedMesh) return;
    const allData: CelestialInstanceData[] = instancedMesh.userData['celestialData'];
    if (!allData || allData.length === 0) return;
    this.updateCameraFrustum();
    const BASE_LUMINOSITY_FACTOR = 0.35;
    const PROXIMITY_LUMINOSITY_FACTOR = 1.0 - BASE_LUMINOSITY_FACTOR;
    const FADE_START_DISTANCE = 800.0;
    const FADE_END_DISTANCE = 12000.0;
    const LUMINOSITY_RANGE = FADE_END_DISTANCE - FADE_START_DISTANCE;
    let needsColorUpdate = false;
    const startIndex = this.updateIndexCounter;
    const endIndex = Math.min(startIndex + INSTANCES_TO_CHECK_PER_FRAME, allData.length);
    for (let i = startIndex; i < endIndex; i++) {
        const data = allData[i];
        if (!data.emissiveIntensity || data.emissiveIntensity === 0) continue;
        this.boundingSphere.center.copy(data.position);
        this.boundingSphere.radius = Math.max(data.scale.x, data.scale.y, data.scale.z);
        const isCurrentlyVisible = this.frustum.intersectsSphere(this.boundingSphere);
        if (isCurrentlyVisible !== data.isVisible) {
            data.isVisible = isCurrentlyVisible;
            if (isCurrentlyVisible) {
                const distance = data.position.distanceTo(camera.position);
                let proximityIntensity = 1.0;
                if (distance > FADE_START_DISTANCE) {
                    const fadeProgress = (distance - FADE_START_DISTANCE) / LUMINOSITY_RANGE;
                    proximityIntensity = 1.0 - Math.pow(Math.min(1.0, fadeProgress), 0.75);
                }
                const distanceFactor = BASE_LUMINOSITY_FACTOR + (PROXIMITY_LUMINOSITY_FACTOR * proximityIntensity);
                const scaleMultiplier = 1.0 + Math.log1p(data.scale.x);
                const finalIntensity = data.emissiveIntensity * distanceFactor * scaleMultiplier;
                this.tempColor.copy(data.originalColor).multiplyScalar(finalIntensity);
                instancedMesh.setColorAt(i, this.tempColor);
            } else {
                this.tempColor.setRGB(0, 0, 0);
                instancedMesh.setColorAt(i, this.tempColor);
            }
            needsColorUpdate = true;
        } 
        else if (data.isVisible) {
            const distance = data.position.distanceTo(camera.position);
             let proximityIntensity = 1.0;
             if (distance > FADE_START_DISTANCE) {
                 const fadeProgress = (distance - FADE_START_DISTANCE) / LUMINOSITY_RANGE;
                 proximityIntensity = 1.0 - Math.pow(Math.min(1.0, fadeProgress), 0.75);
             }
             const distanceFactor = BASE_LUMINOSITY_FACTOR + (PROXIMITY_LUMINOSITY_FACTOR * proximityIntensity);
             const scaleMultiplier = 1.0 + Math.log1p(data.scale.x);
             const finalIntensity = data.emissiveIntensity * distanceFactor * scaleMultiplier;
             this.tempColor.copy(data.originalColor).multiplyScalar(finalIntensity);
             instancedMesh.setColorAt(i, this.tempColor);
             needsColorUpdate = true;
        }
    }
    this.updateIndexCounter = endIndex >= allData.length ? 0 : endIndex;
    if (needsColorUpdate && instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }
  }
  
  // ... (métodos selectObjectByUuid, setToolMode y handleTransformEnd no cambian)
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
      if (this.selectedObject) {
        this.interactionHelperManager.updateHelperPositions(this.selectedObject);
      }
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

  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  private onWindowResize = () => { this.sceneManager.onWindowResize(); this.selectionManager.onResize(this.sceneManager.renderer.domElement.width, this.sceneManager.renderer.domElement.height); this.interactionHelperManager.updateScale(); };

  public addObjectToScene = (objData: SceneObjectResponse) => { this.entityManager.createObjectFromData(objData); };
  public updateObjectName = (uuid: string, newName: string) => { this.entityManager.updateObjectName(uuid, newName); };

  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number; y: number; z: number; }) => {
    const obj = this.entityManager.getObjectByUuid(uuid);
    if (obj) {
      obj[path].set(value.x, value.y, value.z);
      if (path === 'position') this.interactionHelperManager.updateHelperPositions(obj);
    }
  };
  
  // <<< MODIFICADO: Añadimos la lógica para la tecla 'Escape' >>>
  private onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    
    // Si se presiona Escape, salimos del modo vuelo.
    if (key === 'escape') {
      this.controlsManager.exitFlyMode();
      return; // Importante para no procesar otras lógicas
    }
    
    this.keyMap.set(key, true);
    if (this.controlsManager.getCurrentToolMode() === 'move' && ['x', 'y', 'z'].includes(key)) {
      this.axisLock = this.axisLock === key ? null : (key as 'x' | 'y' | 'z');
      this.dragInteractionManager.setAxisConstraint(this.axisLock);
      this.axisLockStateSubject.next(this.axisLock);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), false);
  
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