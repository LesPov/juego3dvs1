import { Injectable, ElementRef, OnDestroy } from '@angular/core';
import * as THREE from 'three';
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

// ====================================================================
// CONSTANTES DE RENDIMIENTO Y VISUALIZACIÓN
// ====================================================================

const INSTANCES_TO_CHECK_PER_FRAME = 100000;
const BASE_VISIBILITY_DISTANCE = 1000000000000;
const MAX_PERCEPTUAL_DISTANCE = 10000000000000;
const DEEP_SPACE_SCALE_BOOST = 10.0;
const ORTHO_ZOOM_VISIBILITY_MULTIPLIER = 5.0;
const ORTHO_ZOOM_BLOOM_DAMPENING_FACTOR = 12.0;
const MAX_INTENSITY = 8.0;
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
    this.sceneManager.scene.add(this.focusPivot);
    this.entityManager.init(this.sceneManager.scene);
    this.labelManager.init(this.sceneManager.scene);
    this.statsManager.init();
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
        engine: this
    });

    this.precompileShaders();
    this.subscribeToEvents();
    this.controlsManager.enableNavigation();
    this.animate();
  }
  
  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    const delta = this.clock.getDelta();
    
    const isCameraAnimating = this.cameraManager.update(delta);
    this.interactionService.update();
    this.labelManager.update();
    
    this.adjustCameraClippingPlanes();
    
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

    const selectionProxy = this.sceneManager.scene.getObjectByName('SelectionProxy');
    if (selectionProxy) selectionProxy.quaternion.copy(this.sceneManager.activeCamera.quaternion);

    this.updateDynamicCelestialModels(delta);
    this.sceneManager.scene.children.forEach(object => {
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) this.updateVisibleCelestialInstances(object as THREE.InstancedMesh);
      if (object.userData['animationMixer']) object.userData['animationMixer'].update(delta);
    });

    this.renderSceneWithSelectiveBloom();

    this.statsManager.end();
  };
  
  private renderSceneWithSelectiveBloom(): void {
    this.originalSceneBackground = this.sceneManager.scene.background;
    this.sceneManager.scene.background = null;
    this.sceneManager.activeCamera.layers.set(BLOOM_LAYER);
    this.sceneManager.bloomComposer.render();

    this.sceneManager.scene.background = this.originalSceneBackground;
    this.sceneManager.activeCamera.layers.enableAll();

    this.sceneManager.composer.render();
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
    
    // ✨ LÓGICA DE ETIQUETA SIMPLIFICADA ✨
    // Oculta la etiqueta anterior solo si no es la misma que la que se va a mostrar ahora (caso de hover -> select).
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

        // Muestra la nueva etiqueta. Si ya estaba visible por el hover, esta llamada no hará nada.
        this.labelManager.showLabel(uuid);
      }
    }
    
    this.onObjectSelected$.next(uuid);
  }
  
  public setToolMode(mode: ToolMode): void {
    this.interactionService.setToolMode(mode);
  }
  
  private onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    
    if (key === 'escape') {
        this.controlsManager.exitFlyMode();
        return;
    }
    
    if (key === 'c' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      this.toggleActiveCamera();
    }
    
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
    this.eventManager.keyDown$.subscribe(this.onKeyDown);
    this.eventManager.canvasMouseDown$.subscribe(this.onCanvasMouseDown);
    
    this.controlsSubscription = this.dragInteractionManager.onDragEnd$.subscribe(() => {
      this.handleTransformEnd();
      if (this.selectedObject) this.interactionHelperManager.updateHelperPositions(this.selectedObject);
    });
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
    
    const celestialTypes = ['galaxy_normal', 'galaxy_bright', 'meteor', 'galaxy_far', 'galaxy_medium', 'model'];
    const celestialObjectsData = objects.filter(o => celestialTypes.includes(o.type));
    const standardObjectsData = objects.filter(o => !celestialTypes.includes(o.type));
    
    this.entityManager.objectManager.createCelestialObjectsInstanced(
      this.sceneManager.scene, celestialObjectsData, this.entityManager.getGltfLoader()
    );
    
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
    
    standardObjectsData.forEach(o => this.entityManager.createObjectFromData(o));
    
    const hasModelsToLoad = standardObjectsData.some(o => o.type === 'model' && o.asset?.path) ||
                            celestialObjectsData.some(o => o.asset?.type === 'model_glb');
    if (!hasModelsToLoad && loadingManager.onLoad) setTimeout(() => loadingManager.onLoad!(), 0);
  }
  
  // ✨ --- LÓGICA DE CÁMARA MEJORADA --- ✨
  private adjustCameraClippingPlanes = () => {
    const camera = this.sceneManager.activeCamera as THREE.PerspectiveCamera;
    if (!camera.isPerspectiveCamera) return;
    
    const controls = this.controlsManager.getControls();
    if (!controls) return;
    
    const distanceToTarget = camera.position.distanceTo(controls.target);
    this.tempBox.setFromObject(this.selectedObject ?? this.focusPivot, true);
    const objectSize = this.tempBox.getSize(this.tempVec3).length();
    
    // Si hay un objeto seleccionado, el near plane se vuelve mucho más pequeño para evitar cortarlo.
    // Si no hay nada seleccionado, usa una fórmula más conservadora.
    let newNear: number;
    if (this.selectedObject && objectSize > 0) {
      newNear = Math.min(distanceToTarget * 0.1, objectSize * 0.05);
    } else {
      newNear = distanceToTarget / 1000;
    }
    newNear = THREE.MathUtils.clamp(newNear, 0.01, 1000);

    // El far plane siempre se asegura de cubrir más allá del target.
    let newFar = Math.max(distanceToTarget * 2.5, camera.userData['originalFar'] || 1e15);
    
    if (newFar <= newNear) newFar = newNear * 2;
    
    if (camera.near !== newNear || camera.far !== newFar) {
      camera.near = newNear;
      camera.far = newFar;
      camera.updateProjectionMatrix();
    }
  };

  private updateVisibleCelestialInstances(instancedMesh: THREE.InstancedMesh): void {
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
        
        let isVisible = this._isInstanceVisible(data, camera, visibilityFactor);
        
        if (isVisible) {
          const finalIntensity = this._calculateInstanceIntensity(data, camera, isOrthographic, bloomDampeningFactor);
          if (finalIntensity < 0.01) {
            isVisible = false;
          } else {
            this.tempMatrix.compose(data.position, camera.quaternion, this.tempScale.copy(data.scale).multiplyScalar(DEEP_SPACE_SCALE_BOOST));
            instancedMesh.setMatrixAt(idx, this.tempMatrix);
            instancedMesh.setColorAt(idx, this.tempColor.copy(data.originalColor).multiplyScalar(finalIntensity));
            needsMatrixUpdate = true;
            needsColorUpdate = true;
          }
        }
        
        if (data.isVisible !== isVisible) {
          if (!isVisible) {
             instancedMesh.setColorAt(idx, this.tempColor.setScalar(0));
             needsColorUpdate = true;
          }
          data.isVisible = isVisible;
        }
    }
    
    instancedMesh.userData['updateIndexCounter'] += checkCount;
    if (needsColorUpdate && instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
    if (needsMatrixUpdate) instancedMesh.instanceMatrix.needsUpdate = true;
  }
  
  private _isInstanceVisible(data: CelestialInstanceData, camera: THREE.Camera, visibilityFactor: number): boolean {
    this.boundingSphere.center.copy(data.position);
    this.boundingSphere.radius = Math.max(data.scale.x, data.scale.y, data.scale.z) * DEEP_SPACE_SCALE_BOOST;
    if (!this.frustum.intersectsSphere(this.boundingSphere)) return false;
    
    const personalVisibilityDist = Math.min(BASE_VISIBILITY_DISTANCE * data.luminosity, MAX_PERCEPTUAL_DISTANCE);
    const distance = data.position.distanceTo(camera.position);
    return distance <= (personalVisibilityDist * visibilityFactor);
  }

  // ✨ --- LÓGICA DE BRILLO MEJORADA --- ✨
  private _calculateInstanceIntensity(data: CelestialInstanceData, camera: THREE.Camera, isOrthographic: boolean, bloomDampeningFactor: number): number {
    const distance = data.position.distanceTo(camera.position);
    const maxScale = Math.max(data.scale.x, data.scale.y, data.scale.z);

    // Factor de atenuación basado en la distancia lejana.
    const falloff = THREE.MathUtils.clamp(THREE.MathUtils.inverseLerp(maxScale * 80.0, maxScale * 10.0, distance), 0.0, 1.0);
    const targetIntensity = THREE.MathUtils.lerp(data.emissiveIntensity, data.baseEmissiveIntensity, falloff);
    
    // NUEVO: Factor de atenuación basado en la proximidad para evitar brillo excesivo.
    const proximityFade = THREE.MathUtils.smoothstep(distance, maxScale * 1.5, maxScale * 3.0);
    
    return Math.min(targetIntensity, MAX_INTENSITY) * bloomDampeningFactor * data.brightness * proximityFade;
  }
  
  // ✨ --- LÓGICA DE BRILLO MEJORADA (PARA MODELOS) --- ✨
  private updateDynamicCelestialModels(delta: number): void {
      this.dynamicCelestialModels.forEach(model => {
          if (!model.userData['isDynamicCelestialModel']) return;
          const distance = this.sceneManager.activeCamera.position.distanceTo(model.position);
          const maxScale = Math.max(model.scale.x, model.scale.y, model.scale.z);
          const originalIntensity = model.userData['originalEmissiveIntensity'] || 1.0;
          const baseIntensity = model.userData['baseEmissiveIntensity'] || 0.1;
          
          const fadeFactor = THREE.MathUtils.clamp(THREE.MathUtils.inverseLerp(maxScale * 80.0, maxScale * 10.0, distance), 0.0, 1.0);
          let targetIntensity = THREE.MathUtils.lerp(originalIntensity, baseIntensity, fadeFactor);
          
          // NUEVO: Factor de atenuación basado en la proximidad.
          const proximityFade = THREE.MathUtils.smoothstep(distance, maxScale * 1.5, maxScale * 3.0);
          targetIntensity *= proximityFade;

          model.traverse(child => {
              if (child instanceof THREE.Mesh) {
                const material = child.material as THREE.MeshStandardMaterial;
                if (material.emissiveIntensity !== undefined) {
                    material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, targetIntensity, delta * 5);
                }
              }
          });
      });
  }
  
  public onWindowResize = () => this.sceneManager.onWindowResize();
  public toggleActiveCamera(): void { this.cameraManager.toggleActiveCamera(this.selectedObject); }
  public toggleCameraMode(): void { this.cameraManager.toggleCameraMode(); }
  public setCameraView(axisName: string | null): void { this.baseOrthoMatrixElement = this.cameraManager.setCameraView(axisName, undefined); }
  public switchToPerspectiveView(): void { this.cameraManager.switchToPerspectiveView(); }
  public updateObjectName = (uuid: string, newName: string) => this.entityManager.updateObjectName(uuid, newName);
  public setGroupVisibility = (uuids: string[], visible: boolean): void => this.entityManager.setGroupVisibility(uuids, visible);
  public setGroupBrightness = (uuids: string[], brightness: number): void => this.entityManager.setGroupBrightness(uuids, brightness);
  public addObjectToScene = (objData: SceneObjectResponse) => this.entityManager.createObjectFromData(objData);
  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  public frameScene = () => this.cameraManager.frameScene();
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
        selectionProxy.scale.copy(data.scale).multiplyScalar(7.0);
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