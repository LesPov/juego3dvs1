// src/app/features/admin/components/world-editor/service/three-engine/core/engine.service.ts

import { Injectable, ElementRef, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ControlsManagerService } from '../interactions/controls-manager.service';
import { EntityManagerService, SceneEntity } from '../managers/entity-manager.service';
import { SceneManagerService } from '../managers/scene-manager.service';
import { StatsManagerService } from '../managers/stats-manager.service';
import { ToolMode } from '../../../toolbar/toolbar.component';
import { SceneObjectResponse } from '../../../../../services/admin.service';
import { InteractionHelperManagerService } from '../interactions/interaction-helper.manager.service';
import { DragInteractionManagerService } from '../interactions/drag-interaction.manager.service';
import { CelestialInstanceData, BLOOM_LAYER } from '../managers/object-manager.service';
import { CameraManagerService, CameraMode } from '../managers/camera-manager.service';
import { SelectionManagerService } from '../interactions/selection-manager.service';
import { EventManagerService } from '../interactions/event-manager.service';
import { InteractionService } from '../interactions/interaction.service';
import { LabelManagerService } from '../managers/label-manager.service';

export interface IntersectedObjectInfo {
  uuid: string;
  object: THREE.Object3D;
}


const INSTANCES_TO_CHECK_PER_FRAME = 10000000;
const BASE_VISIBILITY_DISTANCE = 1000000000;
const MAX_PERCEPTUAL_DISTANCE = 10000000000000;
const PERSPECTIVE_VISIBILITY_MULTIPLIER = 0.08;
const FADE_IN_SPEED = 3.0;
const FADE_OUT_SPEED = 7.0;
const VISIBILITY_HYSTERESIS_FACTOR = 15.05;
const FOG_START_DISTANCE_MULTIPLIER = 0.01;
const FOG_DENSITY = 0.95;
const DEEP_SPACE_SCALE_BOOST = 50.0;
const ORTHO_ZOOM_VISIBILITY_MULTIPLIER = 5.0;
const ORTHO_ZOOM_BLOOM_DAMPENING_FACTOR = 12.0;
const MAX_INTENSITY = 8.0;
const ORTHO_MAX_INTENSITY = 1.5;
const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';


@Injectable()
export class EngineService implements OnDestroy {

  public onObjectSelected$ = new Subject<string | null>();
  public onTransformEnd$: Observable<void>;
  public axisLockState$: Observable<'x' | 'y' | 'z' | null>;
  public cameraOrientation$: Observable<THREE.Quaternion>;
  public cameraPosition$: Observable<THREE.Vector3>;
  public isFlyModeActive$: Observable<boolean>;
  public cameraMode$: Observable<CameraMode>;
  public sceneManager!: SceneManagerService;

  private transformEndSubject = new Subject<void>();
  private cameraOrientationSubject = new BehaviorSubject<THREE.Quaternion>(new THREE.Quaternion());
  private cameraPositionSubject = new BehaviorSubject<THREE.Vector3>(new THREE.Vector3());

  private selectedObject?: THREE.Object3D;
  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private baseOrthoMatrixElement: number = 0;
  private controlsSubscription?: Subscription;
  private focusPivot: THREE.Object3D;

  private orthoBillboardRotation = new THREE.Quaternion();
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
  private originalSceneBackground: THREE.Color | THREE.Texture | null = null;
  private lastPerspectiveCameraState: { position: THREE.Vector3, target: THREE.Vector3 } | null = null;

  constructor(
    sceneManager: SceneManagerService,
    private entityManager: EntityManagerService,
    private controlsManager: ControlsManagerService,
    private statsManager: StatsManagerService,
    private interactionHelperManager: InteractionHelperManagerService,
    private dragInteractionManager: DragInteractionManagerService,
    private cameraManager: CameraManagerService,
    private selectionManager: SelectionManagerService,
    private eventManager: EventManagerService,
    private interactionService: InteractionService,
    private labelManager: LabelManagerService
  ) {
    this.sceneManager = sceneManager;
    this.focusPivot = new THREE.Object3D();
    this.focusPivot.name = 'FocusPivot';

    this.axisLockState$ = this.interactionService.axisLockState$;
    this.onTransformEnd$ = this.transformEndSubject.asObservable().pipe(debounceTime(500));
    this.isFlyModeActive$ = this.controlsManager.isFlyModeActive$;
    this.cameraOrientation$ = this.cameraOrientationSubject.asObservable();
    this.cameraPosition$ = this.cameraPositionSubject.asObservable();
    this.cameraMode$ = this.cameraManager.cameraMode$.asObservable();
  }

  public init(canvasRef: ElementRef<HTMLCanvasElement>): void {
    const canvas = canvasRef.nativeElement;

    this.sceneManager.setupBasicScene(canvas);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    ambientLight.name = 'GlobalAmbientLight';
    this.sceneManager.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.name = 'GlobalDirectionalLight';
    this.sceneManager.scene.add(directionalLight);

    const environment = new RoomEnvironment();
    const pmremGenerator = new THREE.PMREMGenerator(this.sceneManager.renderer);
    this.sceneManager.scene.environment = pmremGenerator.fromScene(environment).texture;
    environment.dispose();
    pmremGenerator.dispose();

    this.sceneManager.scene.add(this.focusPivot);
    this.entityManager.init(this.sceneManager.scene);
    this.labelManager.init(this.sceneManager.scene);

    // =========================================================
    // ===       ✨ CORRECCIÓN DEL ERROR DE COMPILACIÓN ✨      ===
    // =========================================================
    this.statsManager.init('stats-container');

    this.controlsManager.init(this.sceneManager.editorCamera, canvas, this.sceneManager.scene, this.focusPivot);
    this.sceneManager.setControls(this.controlsManager.getControls());
    this.interactionHelperManager.init(this.sceneManager.scene, this.sceneManager.editorCamera);
    this.dragInteractionManager.init(this.sceneManager.editorCamera, canvas, this.controlsManager);
    this.cameraManager.initialize();
    this.eventManager.init(canvas);

    const parent = this.sceneManager.canvas.parentElement!;
    const initialSize = new THREE.Vector2(parent.clientWidth, parent.clientHeight);
    this.selectionManager.init(this.sceneManager.scene, this.sceneManager.activeCamera, initialSize);

    this.selectionManager.getPasses().forEach(pass => this.sceneManager.composer.addPass(pass));

    this.interactionService.init({
      sceneManager: this.sceneManager,
      cameraManager: this.cameraManager,
      entityManager: this.entityManager,
      controlsManager: this.controlsManager,
      selectionManager: this.selectionManager,
      interactionHelperManager: this.interactionHelperManager,
      dragInteractionManager: this.dragInteractionManager,
      engine: this,
      eventManager: this.eventManager
    });

    this.precompileShaders();
    this.subscribeToEvents();
    this.controlsManager.enableNavigation();
    this.animate();
  }

    // ... (El resto del archivo `engine.service.ts` no tiene más cambios) ...
    
  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    const delta = this.clock.getDelta();

    const isCameraAnimating = this.cameraManager.update(delta);
    this.interactionService.update();
    this.labelManager.update();

    if (this.cameraManager.activeCameraType === 'secondary') {
      const controls = this.controlsManager.getControls();
      this.sceneManager.editorCamera.getWorldPosition(controls.target);
    }
    this.sceneManager.secondaryCamera.userData['helper']?.update();
    this.sceneManager.editorCamera.userData['helper']?.update();

    if (!isCameraAnimating) {
      const cameraMoved = this.controlsManager.update(delta, this.eventManager.keyMap);
      if (cameraMoved) {
        this.interactionHelperManager.updateScale();
        this.cameraPositionSubject.next(this.sceneManager.activeCamera.position);
      }
    }

    this.sceneManager.activeCamera.getWorldQuaternion(this.tempQuaternion);
    if (!this.tempQuaternion.equals(this.cameraOrientationSubject.getValue())) {
      this.cameraOrientationSubject.next(this.tempQuaternion.clone());
    }

    const isOrthographic = this.cameraManager.cameraMode$.getValue() === 'orthographic';
    const selectionProxy = this.sceneManager.scene.getObjectByName('SelectionProxy');
    if (selectionProxy) {
      const rotation = isOrthographic ? this.orthoBillboardRotation : this.sceneManager.activeCamera.quaternion;
      selectionProxy.quaternion.copy(rotation);
    }

    this.updateDynamicCelestialModels(delta);
    this.sceneManager.scene.children.forEach(object => {
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) this.updateVisibleCelestialInstances(object as THREE.InstancedMesh, delta);
      if (object.userData['animationMixer']) object.userData['animationMixer'].update(delta);
    });

    this.renderSceneWithSelectiveBloom();

    this.statsManager.end();
  };

  private renderSceneWithSelectiveBloom(): void {
    const isOrthographic = this.cameraManager.cameraMode$.getValue() === 'orthographic';
    const skySphere = this.sceneManager.scene.getObjectByName('SkySphere');

    if (skySphere) {
        skySphere.visible = !isOrthographic;
    }

    this.originalSceneBackground = this.sceneManager.scene.background;
    
    const mainRenderBackground = isOrthographic 
        ? new THREE.Color(0x000000) 
        : this.originalSceneBackground;

    this.sceneManager.scene.background = null;
    this.sceneManager.activeCamera.layers.set(BLOOM_LAYER);
    this.sceneManager.bloomComposer.render();

    this.sceneManager.scene.background = mainRenderBackground;
    this.sceneManager.activeCamera.layers.enableAll();
    this.sceneManager.composer.render();

    this.sceneManager.scene.background = this.originalSceneBackground;
  }


  public ngOnDestroy = () => {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.statsManager.destroy();
    this.controlsManager.ngOnDestroy();
    if (this.sceneManager.renderer) this.sceneManager.renderer.dispose();
  };

  public setActiveSelectionByUuid(uuid: string | null): void {
    const currentUuid = this.selectedObject?.uuid;
    if (currentUuid === uuid) return;

    if (currentUuid && currentUuid !== uuid) {
      this.labelManager.hideLabel(currentUuid);
    }

    this.selectionManager.setSelectedObjects([]);
    this.interactionHelperManager.cleanupHelpers(this.selectedObject);
    this.dragInteractionManager.stopListening();
    this.controlsManager.detach();
    this.selectedObject = undefined;
    this.interactionService.setSelectedObject(undefined);
    this.interactionService.setToolMode('select');

    this.entityManager.selectObjectByUuid(uuid, this.focusPivot);

    if (uuid) {
      this.selectedObject = this.entityManager.getObjectByUuid(uuid) ?? this.sceneManager.scene.getObjectByName('SelectionProxy');
      if (this.selectedObject) {
        this.interactionService.setSelectedObject(this.selectedObject);
        this.selectionManager.setSelectedObjects([this.selectedObject]);
        this.interactionService.setToolMode(this.controlsManager.getCurrentToolMode());
        this.labelManager.showLabel(uuid);
      }
    }

    this.onObjectSelected$.next(uuid);
  }

  public setToolMode(mode: ToolMode): void {
    this.interactionService.setToolMode(mode);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.interactionService.handleKeyDown(e);
  };

  private onCanvasMouseDown = (e: MouseEvent) => {
    this.interactionService.handleMouseDown(e);
  };

  private subscribeToEvents(): void {
    this.cameraMode$.subscribe(mode => this.selectionManager.updateOutlineParameters(mode));

    const controls = this.controlsManager.getControls();
    controls.addEventListener('end', this.handleTransformEnd);
    controls.addEventListener('change', this.onControlsChange);

    this.eventManager.windowResize$.subscribe(this.onWindowResize);

    this.controlsSubscription = this.dragInteractionManager.onDragEnd$.subscribe(() => {
      this.handleTransformEnd();
      if (this.selectedObject) this.interactionHelperManager.updateHelperPositions(this.selectedObject);
    });

    this.eventManager.keyDown$.subscribe(this.onKeyDown);
    this.eventManager.canvasMouseDown$.subscribe(this.onCanvasMouseDown);
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

  public populateScene(objects: SceneObjectResponse[], onProgress: (p: number) => void, onLoaded: () => void): void {
    if (!this.sceneManager.scene) return;
    this.entityManager.clearScene();
    this.dynamicCelestialModels = [];

    const objectsForInstancing: SceneObjectResponse[] = [];
    const individualObjects: SceneObjectResponse[] = [];

    for (const obj of objects) {
      const isWmtsPlanet = obj.asset?.path.includes('{TileMatrix}');
      const isGltfModel = obj.asset?.type === 'model_glb';
      const isStandardPrimitive = ['cube', 'sphere', 'cone', 'torus', 'floor'].includes(obj.type);
      const isLightOrCamera = ['camera', 'directionalLight', 'ambientLight', 'pointLight'].includes(obj.type);

      if (isWmtsPlanet || isGltfModel || isStandardPrimitive || isLightOrCamera) {
        individualObjects.push(obj);
      } else {
        objectsForInstancing.push(obj);
      }
    }
    
    console.log(`[EngineService] Clasificación: ${individualObjects.length} objetos individuales, ${objectsForInstancing.length} para instancing.`);

    if (objectsForInstancing.length > 0) {
      this.entityManager.objectManager.createCelestialObjectsInstanced(
        this.sceneManager.scene,
        objectsForInstancing,
        this.entityManager.getGltfLoader()
      );
    }

    const loadingManager = this.entityManager.getLoadingManager();
    loadingManager.onProgress = (_, loaded, total) => onProgress((loaded / total) * 100);
    loadingManager.onLoad = () => {
      this.sceneManager.renderer.compile(this.sceneManager.scene, this.sceneManager.activeCamera);
      onLoaded();
      this.entityManager.publishSceneEntities();
      this.sceneManager.scene.traverse(obj => {
        if (obj.userData['isDynamicCelestialModel']) this.dynamicCelestialModels.push(obj as THREE.Group);
      });
    };

    individualObjects.forEach(o => this.entityManager.createObjectFromData(o));

    const hasModelsToLoad = individualObjects.some(o => o.asset?.type === 'model_glb');
    if (!hasModelsToLoad && loadingManager.onLoad) {
      setTimeout(() => loadingManager.onLoad!(), 0);
    }
  }

  private updateVisibleCelestialInstances(instancedMesh: THREE.InstancedMesh, delta: number): void {
    const allData: CelestialInstanceData[] = instancedMesh.userData['celestialData'];
    if (!allData || allData.length === 0) return;

    this.updateCameraFrustum();
    let needsColorUpdate = false, needsMatrixUpdate = false;
    const camera = this.sceneManager.activeCamera;
    const isOrthographic = this.cameraManager.cameraMode$.getValue() === 'orthographic';

    let visibilityFactor = 1.0, bloomDampeningFactor = 1.0;
    if (isOrthographic && this.baseOrthoMatrixElement > 0) {
      const orthoCam = camera as THREE.OrthographicCamera;
      const zoomRatio = this.baseOrthoMatrixElement / orthoCam.projectionMatrix.elements[0];
      visibilityFactor = Math.max(0.1, zoomRatio * ORTHO_ZOOM_VISIBILITY_MULTIPLIER);
      bloomDampeningFactor = Math.min(1.0, ORTHO_ZOOM_BLOOM_DAMPENING_FACTOR / zoomRatio);
    }

    const totalInstances = allData.length;
    const startIndex = (instancedMesh.userData['updateIndexCounter'] = (instancedMesh.userData['updateIndexCounter'] || 0) % totalInstances);
    const checkCount = Math.min(totalInstances, Math.ceil(INSTANCES_TO_CHECK_PER_FRAME / 5));

    for (let i = 0; i < checkCount; i++) {
      const idx = (startIndex + i) % totalInstances;
      const data = allData[idx];
      if (data.isManuallyHidden) continue;

      const personalVisibilityDist = Math.min(BASE_VISIBILITY_DISTANCE * data.luminosity, MAX_PERCEPTUAL_DISTANCE) * visibilityFactor * (isOrthographic ? 1.0 : PERSPECTIVE_VISIBILITY_MULTIPLIER);
      const shouldBeVisible = this._isInstanceVisible(data, camera, personalVisibilityDist);
      const targetIntensity = shouldBeVisible ? this._calculateInstanceIntensity(data, camera, isOrthographic, bloomDampeningFactor, personalVisibilityDist) : 0.0;

      const fadeSpeed = targetIntensity > data.currentIntensity ? FADE_IN_SPEED : FADE_OUT_SPEED;
      data.currentIntensity = THREE.MathUtils.lerp(data.currentIntensity, targetIntensity, 1.0 - Math.exp(-fadeSpeed * delta));

      if (data.currentIntensity < 0.001) {
        data.currentIntensity = 0.0;
      }

      if (data.currentIntensity > 0) {
        const rotation = isOrthographic ? this.orthoBillboardRotation : camera.quaternion;
        this.tempMatrix.compose(data.position, rotation, this.tempScale.copy(data.scale).multiplyScalar(DEEP_SPACE_SCALE_BOOST));
        instancedMesh.setMatrixAt(idx, this.tempMatrix);
        needsMatrixUpdate = true;
      }

      instancedMesh.setColorAt(idx, this.tempColor.copy(data.originalColor).multiplyScalar(data.currentIntensity));
      needsColorUpdate = true;
    }

    instancedMesh.userData['updateIndexCounter'] += checkCount;
    if (needsColorUpdate && instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
    if (needsMatrixUpdate) instancedMesh.instanceMatrix.needsUpdate = true;
  }

  private _isInstanceVisible(data: CelestialInstanceData, camera: THREE.Camera, personalVisibilityDist: number): boolean {
    this.boundingSphere.center.copy(data.position);
    this.boundingSphere.radius = Math.max(data.scale.x, data.scale.y, data.scale.z) * DEEP_SPACE_SCALE_BOOST;
    if (!this.frustum.intersectsSphere(this.boundingSphere)) return false;

    if (this.cameraManager.cameraMode$.getValue() === 'orthographic') {
      return true;
    }

    const distance = data.position.distanceTo(camera.position);

    if (data.currentIntensity > 0) {
      return distance <= (personalVisibilityDist * VISIBILITY_HYSTERESIS_FACTOR);
    } else {
      return distance <= personalVisibilityDist;
    }
  }

  private _calculateInstanceIntensity(data: CelestialInstanceData, camera: THREE.Camera, isOrthographic: boolean, bloomDampeningFactor: number, personalVisibilityDist: number): number {
    if (isOrthographic) {
        const intensity = data.isDominant ? data.emissiveIntensity : (data.emissiveIntensity + data.baseEmissiveIntensity) / 2;
        return Math.min(intensity, ORTHO_MAX_INTENSITY) * bloomDampeningFactor * data.brightness;
    }

    const distance = data.position.distanceTo(camera.position);
    const maxScale = Math.max(data.scale.x, data.scale.y, data.scale.z);

    const falloff = THREE.MathUtils.clamp(THREE.MathUtils.inverseLerp(maxScale * 80.0, maxScale * 10.0, distance), 0.0, 1.0);
    let finalIntensity = THREE.MathUtils.lerp(data.emissiveIntensity, data.baseEmissiveIntensity, falloff);

    const proximityFade = THREE.MathUtils.smoothstep(distance, maxScale * 1.5, maxScale * 3.0);

    const maxIntensity = isOrthographic ? ORTHO_MAX_INTENSITY : MAX_INTENSITY;
    finalIntensity = Math.min(finalIntensity, maxIntensity) * bloomDampeningFactor * data.brightness * proximityFade;

    if (!isOrthographic) {
      const fogStartDistance = personalVisibilityDist * FOG_START_DISTANCE_MULTIPLIER;
      if (distance > fogStartDistance) {
        const fogFactor = THREE.MathUtils.inverseLerp(fogStartDistance, personalVisibilityDist, distance);
        finalIntensity *= (1.0 - fogFactor * FOG_DENSITY);
      }
    }

    return finalIntensity;
  }

  private updateDynamicCelestialModels(delta: number): void {
    this.dynamicCelestialModels.forEach(model => {
      if (!model.userData['isDynamicCelestialModel']) return;

      if (!model.userData['boundingSphere']) {
        const sphere = new THREE.Sphere();
        this.tempBox.setFromObject(model, true);
        model.userData['boundingSphere'] = this.tempBox.getBoundingSphere(sphere);
      }
      const radius = model.userData['boundingSphere'].radius;
      if (radius === 0) return;

      const distance = this.sceneManager.activeCamera.position.distanceTo(model.position);
      const originalEmissiveIntensity = model.userData['originalEmissiveIntensity'] || 1.0;
      const baseEmissiveIntensity = model.userData['baseEmissiveIntensity'] || 0.1;

      const farFalloffStart = radius * 80.0;
      const farFalloffEnd = radius * 860.0;
      const farFalloffAlpha = THREE.MathUtils.clamp(THREE.MathUtils.inverseLerp(farFalloffStart, farFalloffEnd, distance), 0, 1);
      const intensityAfterFalloff = THREE.MathUtils.lerp(originalEmissiveIntensity, baseEmissiveIntensity, farFalloffAlpha);

      const proximityFadeStart = 20.0 * radius;
      const proximityFadeEnd = 8.0 * radius;
      const proximityFadeFactor = THREE.MathUtils.smoothstep(distance, proximityFadeEnd, proximityFadeStart);

      const targetIntensity = intensityAfterFalloff * proximityFadeFactor;

      model.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const material = child.material as THREE.MeshStandardMaterial;
          if (material && material.emissiveIntensity !== undefined) {
            material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, targetIntensity, 5.0 * delta);
          }
        }
      });
    });
  }

  public setTravelSpeedMultiplier(multiplier: number): void { this.cameraManager.setTravelSpeedMultiplier(multiplier); }
  public onWindowResize = () => this.sceneManager.onWindowResize();
  public toggleActiveCamera(): void { this.cameraManager.toggleActiveCamera(this.selectedObject); }
  
  public toggleCameraMode(): void {
    const currentMode = this.cameraManager.cameraMode$.getValue();

    if (currentMode === 'perspective') {
      const controls = this.controlsManager.getControls();
      this.lastPerspectiveCameraState = {
        position: this.sceneManager.activeCamera.position.clone(),
        target: controls.target.clone(),
      };

      this.cameraManager.toggleCameraMode();
      this.setCameraView('z');
    } else {
      this.cameraManager.toggleCameraMode();
      if (this.lastPerspectiveCameraState) {
        setTimeout(() => {
          const controls = this.controlsManager.getControls();
          if(this.lastPerspectiveCameraState){
            controls.object.position.copy(this.lastPerspectiveCameraState.position);
            controls.target.copy(this.lastPerspectiveCameraState.target);
            controls.update();
            this.lastPerspectiveCameraState = null;
          }
        }, 50);
      }
    }
  }

  public setCameraView(axisName: string | null): void {
    this.baseOrthoMatrixElement = this.cameraManager.setCameraView(axisName, undefined);
    if (axisName) {
        setTimeout(() => this.frameScene(), 50);
    }
  }

  public switchToPerspectiveView(): void {
    this.cameraManager.switchToPerspectiveView();
  }

  public updateObjectName = (uuid: string, newName: string) => this.entityManager.updateObjectName(uuid, newName);
  public setGroupVisibility = (uuids: string[], visible: boolean): void => this.entityManager.setGroupVisibility(uuids, visible);
  public setGroupBrightness = (uuids: string[], brightness: number): void => this.entityManager.setGroupBrightness(uuids, brightness);
  public addObjectToScene = (objData: SceneObjectResponse) => this.entityManager.createObjectFromData(objData);
  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  
  public frameScene = () => {
    this.sceneManager.frameScene();
  }

  public focusOnObject = (uuid: string) => this.cameraManager.focusOnObject(uuid);
  public getCurrentToolMode = (): ToolMode => this.controlsManager.getCurrentToolMode();

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
        selectionProxy.scale.copy(data.scale).multiplyScalar(DEEP_SPACE_SCALE_BOOST);
      }
    }
  };

  private handleTransformEnd = () => {
    if (!this.selectedObject) return;

    if (this.selectedObject.name === 'SelectionProxy') {
      const instanceInfo = this.entityManager._findCelestialInstance(this.selectedObject.uuid);
      if (instanceInfo) {
        const { mesh, instanceIndex, data } = instanceInfo;
        data.originalMatrix.compose(this.selectedObject.position, this.selectedObject.quaternion, this.selectedObject.scale);
        data.position.copy(this.selectedObject.position);
        mesh.setMatrixAt(instanceIndex, data.originalMatrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }

    this.transformEndSubject.next();
  };

  private updateCameraFrustum(): void {
    const camera = this.sceneManager.activeCamera;
    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  private onControlsChange = () => this.interactionHelperManager.updateScale();
}