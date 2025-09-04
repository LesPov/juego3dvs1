// src/app/features/admin/views/world-editor/world-view/service/three-engine/engine.service.ts
// ... (Tu código existente de engine.service.ts va aquí, no necesita cambios) ...
// (Lo incluyo completo por si acaso, pero no hay cambios lógicos que hacer aquí)
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

const INSTANCES_TO_CHECK_PER_FRAME = 20000;
const BASE_VISIBILITY_DISTANCE = 1000000000;
const MAX_PERCEPTUAL_DISTANCE = 10000000000;
const DEEP_SPACE_SCALE_BOOST = 5.0;
const ORTHO_ZOOM_VISIBILITY_MULTIPLIER = 2.5;
const ORTHO_ZOOM_BLOOM_DAMPENING_FACTOR = 4.0;
const BRIGHTNESS_MULTIPLIER = 3.5;
const MAX_INTENSITY = 10.0;
const BRIGHTNESS_FALLOFF_START_DISTANCE = 50_000_000;

export type CameraMode = 'perspective' | 'orthographic';

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
  private cameraModeSubject = new BehaviorSubject<CameraMode>('perspective');
  public cameraMode$ = this.cameraModeSubject.asObservable();
  private originalProjectionMatrix = new THREE.Matrix4();
  private lastOrthographicState: { position: THREE.Vector3, target: THREE.Vector3 } | null = null;
  private baseOrthoMatrixElement: number = 0;
  private controlsSubscription?: Subscription;
  private tempColor = new THREE.Color();
  private tempQuaternion = new THREE.Quaternion();
  private tempMatrix = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private boundingSphere = new THREE.Sphere();
  private updateIndexCounter = 0;
  private tempScale = new THREE.Vector3();

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

  public setGroupVisibility(uuids: string[], visible: boolean): void { this.entityManager.setGroupVisibility(uuids, visible); }
  public setGroupBrightness(uuids: string[], brightness: number): void { this.entityManager.setGroupBrightness(uuids, brightness); }
  public init(canvasRef: ElementRef<HTMLCanvasElement>): void { const canvas = canvasRef.nativeElement; this.sceneManager.setupBasicScene(canvas); this.entityManager.init(this.sceneManager.scene); this.statsManager.init(); this.controlsManager.init(this.sceneManager.editorCamera, canvas, this.sceneManager.scene, this.sceneManager.focusPivot); this.sceneManager.setControls(this.controlsManager.getControls()); this.interactionHelperManager.init(this.sceneManager.scene, this.sceneManager.editorCamera); this.dragInteractionManager.init(this.sceneManager.editorCamera, canvas, this.controlsManager); this.controlsManager.enableNavigation(); this.addEventListeners(); if (this.sceneManager.editorCamera) { this.originalProjectionMatrix.copy(this.sceneManager.editorCamera.projectionMatrix); } this.animate(); }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    const delta = this.clock.getDelta();
    const cameraMoved = this.controlsManager.update(delta, this.keyMap);
    if (cameraMoved) {
        this.interactionHelperManager.updateScale();
        this.cameraPositionSubject.next(this.sceneManager.editorCamera.position);
    }
    this.sceneManager.editorCamera.getWorldQuaternion(this.tempQuaternion);
    if (!this.tempQuaternion.equals(this.cameraOrientationSubject.getValue())) {
        this.cameraOrientationSubject.next(this.tempQuaternion.clone());
    }
    const selectionProxy = this.sceneManager.scene.getObjectByName('SelectionProxy');
    if (selectionProxy) {
        selectionProxy.quaternion.copy(this.sceneManager.editorCamera.quaternion);
    }
    this.updateVisibleCelestialInstances();
    this.sceneManager.composer.render();
    this.statsManager.end();
  };

  private updateVisibleCelestialInstances(): void {
    const instancedMesh = this.sceneManager.scene.getObjectByName('CelestialObjectsInstanced') as THREE.InstancedMesh;
    if (!instancedMesh) return;
    const allData: CelestialInstanceData[] = instancedMesh.userData['celestialData'];
    if (!allData || allData.length === 0) return;
    this.updateCameraFrustum();
    let needsColorUpdate = false;
    let needsMatrixUpdate = false;
    const camera = this.sceneManager.editorCamera;
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
    const startIndex = this.updateIndexCounter;
    const endIndex = Math.min(startIndex + INSTANCES_TO_CHECK_PER_FRAME, allData.length);
    for (let i = startIndex; i < endIndex; i++) {
        const data = allData[i];
        if (data.isManuallyHidden) {
            continue;
        }
        this.boundingSphere.center.copy(data.position);
        this.boundingSphere.radius = Math.max(data.scale.x, data.scale.y, data.scale.z) * DEEP_SPACE_SCALE_BOOST;
        if (!this.frustum.intersectsSphere(this.boundingSphere)) {
            if (data.isVisible) { this.tempColor.setScalar(0); instancedMesh.setColorAt(i, this.tempColor); needsColorUpdate = true; data.isVisible = false; }
            continue;
        }
        const distance = data.position.distanceTo(camera.position);
        let personalVisibilityDistance = Math.min(BASE_VISIBILITY_DISTANCE * data.luminosity, MAX_PERCEPTUAL_DISTANCE);
        const effectiveVisibilityDistance = personalVisibilityDistance * visibilityFactor;
        if (distance > effectiveVisibilityDistance) {
            if (data.isVisible) { this.tempColor.setScalar(0); instancedMesh.setColorAt(i, this.tempColor); needsColorUpdate = true; data.isVisible = false; }
            continue;
        }
        const visibilityFalloff = 1.0 - THREE.MathUtils.smoothstep(distance, 0, effectiveVisibilityDistance);
        const distanceFalloff = 1.0 - THREE.MathUtils.smoothstep(distance, BRIGHTNESS_FALLOFF_START_DISTANCE, effectiveVisibilityDistance);
        const baseIntensity = data.emissiveIntensity * BRIGHTNESS_MULTIPLIER * visibilityFalloff * distanceFalloff;
        
        const brightnessMultiplier = isOrthographic ? data.brightness : 1.0;
        let finalIntensity = Math.min(baseIntensity, MAX_INTENSITY) * bloomDampeningFactor * brightnessMultiplier;
        
        this.tempScale.copy(data.scale).multiplyScalar(DEEP_SPACE_SCALE_BOOST);
        if (finalIntensity > 0.01) {
            if (!data.isVisible) data.isVisible = true;
            this.tempMatrix.compose(data.position, camera.quaternion, this.tempScale);
            instancedMesh.setMatrixAt(i, this.tempMatrix);
            needsMatrixUpdate = true;
            this.tempColor.copy(data.originalColor).multiplyScalar(finalIntensity);
            instancedMesh.setColorAt(i, this.tempColor);
            needsColorUpdate = true;
        } else if (data.isVisible) {
            this.tempColor.setScalar(0);
            instancedMesh.setColorAt(i, this.tempColor);
            needsColorUpdate = true;
            data.isVisible = false;
        }
    }
    this.updateIndexCounter = endIndex >= allData.length ? 0 : endIndex;
    if (needsColorUpdate && instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
    if (needsMatrixUpdate) instancedMesh.instanceMatrix.needsUpdate = true;
  }
  
  public selectObjectByUuid(uuid: string | null): void { this.interactionHelperManager.cleanupHelpers(this.selectedObject); this.dragInteractionManager.stopListening(); this.controlsManager.detach(); this.axisLock = null; this.dragInteractionManager.setAxisConstraint(null); this.axisLockStateSubject.next(null); this.selectedObject = undefined; this.entityManager.selectObjectByUuid(uuid, this.sceneManager.focusPivot); if (uuid) { this.selectedObject = this.entityManager.getObjectByUuid(uuid); if (this.selectedObject) { this.setToolMode(this.controlsManager.getCurrentToolMode()); } } }
  ngOnDestroy = () => { this.removeEventListeners(); this.interactionHelperManager.cleanupHelpers(this.selectedObject); this.dragInteractionManager.stopListening(); if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId); this.statsManager.destroy(); this.controlsManager.ngOnDestroy(); if (this.sceneManager.renderer) this.sceneManager.renderer.dispose(); };
  public toggleCameraMode = () => { if (this.cameraModeSubject.getValue() === 'perspective') { if (this.lastOrthographicState) { this.setCameraView(null, this.lastOrthographicState); } else { this.setCameraView('axis-y-neg'); } } else { this.switchToPerspectiveView(); } }
  public setCameraView = (axisName: string | null, state?: { position: THREE.Vector3, target: THREE.Vector3 }) => { const controls = this.controlsManager.getControls(); const camera = this.sceneManager.editorCamera as THREE.PerspectiveCamera; if (!controls || !camera?.isPerspectiveCamera) return; const target = this.sceneManager.focusPivot.position.clone(); const currentDistance = camera.position.distanceTo(target); const distance = Math.max(currentDistance, 5); if (axisName) { const newPosition = new THREE.Vector3(); switch (axisName) { case 'axis-x': newPosition.set(distance, 0, 0); break; case 'axis-x-neg': newPosition.set(-distance, 0, 0); break; case 'axis-y': newPosition.set(0, distance, 0); break; case 'axis-y-neg': newPosition.set(0, -distance, 0.0001); break; case 'axis-z': newPosition.set(0, 0, distance); break; case 'axis-z-neg': newPosition.set(0, 0, -distance); break; default: return; } camera.position.copy(target).add(newPosition); camera.lookAt(target); this.lastOrthographicState = { position: camera.position.clone(), target: target.clone() }; } else if (state) { camera.position.copy(state.position); camera.lookAt(state.target); } const vFOV = (camera.fov * Math.PI) / 180; const frustumHeight = 2 * Math.tan(vFOV / 2) * distance; const aspect = this.sceneManager.renderer.domElement.clientWidth / this.sceneManager.renderer.domElement.clientHeight; const frustumWidth = frustumHeight * aspect; const orthoMatrix = new THREE.Matrix4(); orthoMatrix.makeOrthographic( frustumWidth / -2, frustumWidth / 2, frustumHeight / 2, frustumHeight / -2, camera.near, camera.far ); camera.projectionMatrix.copy(orthoMatrix); camera.projectionMatrixInverse.copy(orthoMatrix).invert(); this.baseOrthoMatrixElement = camera.projectionMatrix.elements[0]; this.controlsManager.exitFlyMode(); this.controlsManager.isFlyEnabled = false; controls.enabled = true; controls.enableRotate = false; controls.target.copy(target); controls.update(); this.selectionManager.updateOutlineParameters('orthographic'); this.cameraModeSubject.next('orthographic'); };

  public switchToPerspectiveView = () => {
    this.entityManager.resetAllGroupsBrightness();
    const camera = this.sceneManager.editorCamera; const controls = this.controlsManager.getControls(); camera.projectionMatrix.copy(this.originalProjectionMatrix); camera.projectionMatrixInverse.copy(this.originalProjectionMatrix).invert(); this.controlsManager.isFlyEnabled = true; if (controls) { controls.enabled = false; controls.enableRotate = true; controls.update(); }
    this.selectionManager.updateOutlineParameters('perspective');
    this.cameraModeSubject.next('perspective');
  }

  private addEventListeners = () => { const controls = this.controlsManager.getControls(); controls.addEventListener('end', this.handleTransformEnd); controls.addEventListener('change', this.onControlsChange); window.addEventListener('resize', this.onWindowResize); window.addEventListener('keydown', this.onKeyDown); window.addEventListener('keyup', this.onKeyUp); this.controlsSubscription = this.dragInteractionManager.onDragEnd$.subscribe(() => { this.handleTransformEnd(); if (this.selectedObject) this.interactionHelperManager.updateHelperPositions(this.selectedObject); }); };
  private removeEventListeners = (): void => { const controls = this.controlsManager.getControls(); controls?.removeEventListener('end', this.handleTransformEnd); controls?.removeEventListener('change', this.onControlsChange); window.removeEventListener('resize', this.onWindowResize); window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp); this.controlsSubscription?.unsubscribe(); };
  public populateScene(objects: SceneObjectResponse[], onProgress: (p: number) => void, onLoaded: () => void): void { if (!this.sceneManager.scene) return; this.entityManager.clearScene(); const celestialTypes = ['star', 'galaxy', 'meteor', 'supernova', 'diffraction_star']; const celestialObjectsData = objects.filter(o => celestialTypes.includes(o.type)); const standardObjectsData = objects.filter(o => !celestialTypes.includes(o.type)); this.entityManager.objectManager.createCelestialObjectsInstanced(this.sceneManager.scene, celestialObjectsData); const loadingManager = this.entityManager.getLoadingManager(); loadingManager.onProgress = (_, loaded, total) => onProgress((loaded / total) * 100); loadingManager.onLoad = () => { onLoaded(); this.entityManager.publishSceneEntities(); }; standardObjectsData.forEach(o => this.entityManager.createObjectFromData(o)); if (!standardObjectsData.some(o => o.type === 'model' && o.asset?.path)) { setTimeout(() => { if (loadingManager.onLoad) loadingManager.onLoad(); }, 0); } }
  private updateCameraFrustum(): void { const camera = this.sceneManager.editorCamera; camera.updateMatrixWorld(); this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.projScreenMatrix); }
  public setToolMode(mode: ToolMode): void { this.controlsManager.setTransformMode(mode); this.interactionHelperManager.cleanupHelpers(this.selectedObject); this.dragInteractionManager.stopListening(); this.controlsManager.detach(); this.axisLock = null; this.dragInteractionManager.setAxisConstraint(null); this.axisLockStateSubject.next(null); if (this.selectedObject) { switch (mode) { case 'move': this.interactionHelperManager.createHelpers(this.selectedObject); this.dragInteractionManager.startListening(this.selectedObject, this.interactionHelperManager); break; case 'rotate': case 'scale': this.controlsManager.attach(this.selectedObject); break; } } }
  private handleTransformEnd = () => { if (!this.selectedObject) return; if (this.selectedObject.name === 'SelectionProxy') { const instancedMesh = this.sceneManager.scene.getObjectByName('CelestialObjectsInstanced') as THREE.InstancedMesh; if (!instancedMesh) return; const allData: CelestialInstanceData[] = instancedMesh.userData["celestialData"]; const instanceIndex = allData.findIndex(d => d.originalUuid === this.selectedObject!.uuid); if (instanceIndex > -1) { const data = allData[instanceIndex]; data.originalMatrix.compose(this.selectedObject.position, this.selectedObject.quaternion, this.selectedObject.scale); data.position.copy(this.selectedObject.position); instancedMesh.setMatrixAt(instanceIndex, data.originalMatrix); instancedMesh.instanceMatrix.needsUpdate = true; } } this.transformEndSubject.next(); }
  private onControlsChange = () => { this.interactionHelperManager.updateScale(); };
  private onKeyDown = (e: KeyboardEvent) => { const key = e.key.toLowerCase(); if (key === 'escape') { this.controlsManager.exitFlyMode(); return; } this.keyMap.set(key, true); if (this.controlsManager.getCurrentToolMode() === 'move' && ['x', 'y', 'z'].includes(key)) { this.axisLock = this.axisLock === key ? null : (key as 'x' | 'y' | 'z'); this.dragInteractionManager.setAxisConstraint(this.axisLock); this.axisLockStateSubject.next(this.axisLock); } };
  private onKeyUp = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), false);
  public frameScene = (width: number, height: number) => this.sceneManager.frameScene(width, height);
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  private onWindowResize = () => { this.sceneManager.onWindowResize(); this.interactionHelperManager.updateScale(); };
  public addObjectToScene = (objData: SceneObjectResponse) => this.entityManager.createObjectFromData(objData);
  public updateObjectName = (uuid: string, newName: string) => this.entityManager.updateObjectName(uuid, newName);

  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number; y: number; z: number; }) => {
    const standardObject = this.entityManager.getObjectByUuid(uuid);

    if (standardObject && standardObject.name !== 'SelectionProxy') {
        standardObject[path].set(value.x, value.y, value.z);
        if (path === 'position') {
            this.interactionHelperManager.updateHelperPositions(standardObject);
        }
        return;
    }

    const instancedMesh = this.sceneManager.scene.getObjectByName('CelestialObjectsInstanced') as THREE.InstancedMesh;
    if (!instancedMesh) return;

    const allData: CelestialInstanceData[] = instancedMesh.userData["celestialData"];
    const instanceIndex = allData.findIndex(d => d.originalUuid === uuid);

    if (instanceIndex > -1) {
        const data = allData[instanceIndex];
        const tempQuaternion = new THREE.Quaternion();
        const tempScale = new THREE.Vector3();

        data.originalMatrix.decompose(new THREE.Vector3(), tempQuaternion, tempScale);

        switch (path) {
            case 'position':
                data.position.set(value.x, value.y, value.z);
                break;
            case 'rotation':
                tempQuaternion.setFromEuler(new THREE.Euler(value.x, value.y, value.z));
                break;
            case 'scale':
                data.scale.set(value.x, value.y, value.z);
                tempScale.copy(data.scale);
                break;
        }
        
        data.originalMatrix.compose(data.position, tempQuaternion, tempScale);
        instancedMesh.setMatrixAt(instanceIndex, data.originalMatrix);
        instancedMesh.instanceMatrix.needsUpdate = true;
        const selectionProxy = this.sceneManager.scene.getObjectByName('SelectionProxy');
        if (selectionProxy && selectionProxy.uuid === uuid) {
            selectionProxy.position.copy(data.position);
            const PROXY_SCALE_MULTIPLIER = 7.0;
            selectionProxy.scale.copy(data.scale).multiplyScalar(PROXY_SCALE_MULTIPLIER);
        }
    }
  };
}