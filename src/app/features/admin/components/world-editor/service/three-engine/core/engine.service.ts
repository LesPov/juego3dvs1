// src/app/features/admin/views/world-editor/world-view/service/three-engine/core/engine.service.ts

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
import { CelestialInstanceData, BLOOM_LAYER } from '../managers/object-manager.service'; // <<< [NUEVO] Importar BLOOM_LAYER
import { CameraManagerService, CameraMode } from '../managers/camera-manager.service';
import { SelectionManagerService } from '../interactions/selection-manager.service';
import { EventManagerService } from '../interactions/event-manager.service';
import { InteractionService } from '../interactions/interaction.service';
 
/**
 * @interface IntersectedObjectInfo
 * @description Define la estructura de la información de un objeto intersectado por el raycaster.
 * @property {string} uuid - El identificador único del objeto.
 * @property {THREE.Object3D} object - La referencia al objeto 3D de Three.js.
 */
export interface IntersectedObjectInfo {
    uuid: string;
    object: THREE.Object3D;
}

// ====================================================================
// CONSTANTES DE RENDIMIENTO Y VISUALIZACIÓN
// ====================================================================

const INSTANCES_TO_CHECK_PER_FRAME = 100000;      // Número de instancias celestes a verificar por frame para optimizar la visibilidad.
const BASE_VISIBILITY_DISTANCE = 1000000000000;   // Distancia base para que un objeto celeste sea visible.
const MAX_PERCEPTUAL_DISTANCE = 10000000000000;    // Distancia máxima a la que un objeto puede ser visible, independientemente de su luminosidad.
const DEEP_SPACE_SCALE_BOOST = 10.0;             // Multiplicador de escala para que los objetos lejanos sean perceptibles.
const ORTHO_ZOOM_VISIBILITY_MULTIPLIER = 5.0;    // Factor para ajustar la visibilidad en modo ortográfico basado en el zoom.
const ORTHO_ZOOM_BLOOM_DAMPENING_FACTOR = 12.0;  // Factor para atenuar el efecto de bloom en modo ortográfico al hacer zoom.
const MAX_INTENSITY = 8.0;                       // Intensidad máxima del brillo para el efecto de bloom.
const CELESTIAL_MESH_PREFIX = 'CelestialObjects_'; // Prefijo para identificar los InstancedMesh de objetos celestes.


/**
 * @class EngineService
 * @description
 * El corazón del editor 3D. Actúa como el **orquestador principal** que inicializa y coordina todos los demás
 * servicios y managers. Es responsable del ciclo de renderizado (bucle `animate`), de gestionar el estado
 * global de la selección y de delegar tareas específicas a los servicios especializados (cámara, interacciones, entidades, etc.).
 *
 * Su rol ha sido refactorizado para ser un "director de orquesta" en lugar de un "sabelotodo", delegando la
 * lógica de interacción del usuario al `InteractionService`.
 */
@Injectable()
export class EngineService implements OnDestroy {

  // ====================================================================
  // OBSERVABLES PÚBLICOS (API para la UI y otros servicios)
  // ====================================================================

  /** Emite el UUID del objeto seleccionado, o `null` si no hay ninguno. */
  public onObjectSelected$ = new Subject<string | null>();
  /** Emite un evento cuando una operación de transformación (mover, rotar, escalar) ha finalizado. */
  public onTransformEnd$: Observable<void>;
  /** Emite el estado de bloqueo de ejes ('x', 'y', 'z' o `null`) para la herramienta de movimiento. Delegado desde `InteractionService`. */
  public axisLockState$: Observable<'x' | 'y' | 'z' | null>;
  /** Emite la orientación actual (cuaternión) de la cámara activa. */
  public cameraOrientation$: Observable<THREE.Quaternion>;
  /** Emite la posición actual (vector) de la cámara activa. */
  public cameraPosition$: Observable<THREE.Vector3>;
  /** Emite `true` si el modo "fly" de la cámara está activo. */
  public isFlyModeActive$: Observable<boolean>;
  /** Emite el modo actual de la cámara ('perspective' o 'orthographic'). */
  public cameraMode$: Observable<CameraMode>;
  
  /** Referencia pública al SceneManager para que `InteractionService` pueda acceder a la escena. */
  public sceneManager!: SceneManagerService;
  
  // ====================================================================
  // ESTADO INTERNO DEL MOTOR
  // ====================================================================

  private transformEndSubject = new Subject<void>();
  private cameraOrientationSubject = new BehaviorSubject<THREE.Quaternion>(new THREE.Quaternion());
  private cameraPositionSubject = new BehaviorSubject<THREE.Vector3>(new THREE.Vector3());
  
  private selectedObject?: THREE.Object3D;
  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private baseOrthoMatrixElement: number = 0; // Almacena el valor de zoom base para la cámara ortográfica.
  private controlsSubscription?: Subscription;
  private focusPivot: THREE.Object3D; // Un objeto vacío que sirve como punto de enfoque para los controles de la cámara.

  // Objetos temporales para optimización (evitar crear nuevos objetos en el bucle de renderizado)
  private tempQuaternion = new THREE.Quaternion();
  private tempMatrix = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private boundingSphere = new THREE.Sphere();
  private tempScale = new THREE.Vector3();
  private tempColor = new THREE.Color();
  private tempBox = new THREE.Box3();
  private tempVec3 = new THREE.Vector3();
  
  private dynamicCelestialModels: THREE.Group[] = []; // Cache para modelos celestes que tienen animaciones o efectos dinámicos.
  
  private originalSceneBackground: THREE.Color | THREE.Texture | null = null; // <<< [NUEVO] Para guardar el fondo original
  
  /**
   * @constructor
   * Inyecta todas las dependencias de los servicios especializados y configura los observables iniciales.
   */
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
    private interactionService: InteractionService
  ) {
    this.sceneManager = sceneManager;
    this.focusPivot = new THREE.Object3D();
    this.focusPivot.name = 'FocusPivot';
    
    // Configuración de observables públicos
    this.axisLockState$ = this.interactionService.axisLockState$;
    this.onTransformEnd$ = this.transformEndSubject.asObservable().pipe(debounceTime(500));
    this.isFlyModeActive$ = this.controlsManager.isFlyModeActive$;
    this.cameraOrientation$ = this.cameraOrientationSubject.asObservable();
    this.cameraPosition$ = this.cameraPositionSubject.asObservable();
    this.cameraMode$ = this.cameraManager.cameraMode$.asObservable();
  }
  
  // ====================================================================
  // CICLO DE VIDA E INICIALIZACIÓN
  // ====================================================================

  /**
   * Inicializa todo el entorno de Three.js.
   * Este es el punto de entrada principal para poner en marcha el editor 3D.
   * @param canvasRef - La referencia al elemento `<canvas>` del DOM donde se renderizará la escena.
   */
  public init(canvasRef: ElementRef<HTMLCanvasElement>): void {
    const canvas = canvasRef.nativeElement;
    
    // 1. Inicializar cada manager en el orden correcto
    this.sceneManager.setupBasicScene(canvas);
    this.sceneManager.scene.add(this.focusPivot);
    this.entityManager.init(this.sceneManager.scene);
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
    
    // <<< [MODIFICADO] Añadir los pases de Outline al compositor FINAL
    this.selectionManager.getPasses().forEach(pass => this.sceneManager.composer.addPass(pass));

    // 2. Inicializar el servicio de interacción, pasándole todas sus dependencias.
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

    // 3. Pasos finales y arranque
    this.precompileShaders();
    this.subscribeToEvents();
    this.controlsManager.enableNavigation();
    this.animate();
  }
  
  /**
   * El bucle principal de renderizado. Se ejecuta en cada frame.
   * Orquesta las actualizaciones de todos los sistemas en cada fotograma.
   */
  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    const delta = this.clock.getDelta();
    
    // Actualizar animaciones de cámara y estado de interacción
    const isCameraAnimating = this.cameraManager.update(delta);
    this.interactionService.update();
    
    // Actualizar planos de recorte de la cámara dinámicamente
    this.adjustCameraClippingPlanes();
    
    // Sincronizar target de la cámara secundaria y helpers
    if (this.cameraManager.activeCameraType === 'secondary') {
      const controls = this.controlsManager.getControls();
      this.sceneManager.editorCamera.getWorldPosition(controls.target);
    }
    this.sceneManager.secondaryCamera.userData['helper']?.update();
    this.sceneManager.editorCamera.userData['helper']?.update();
    
    // Actualizar controles de cámara si no hay una animación en curso
    if (!isCameraAnimating) {
      const cameraMoved = this.controlsManager.update(delta, this.eventManager.keyMap);
      if (cameraMoved) {
        this.interactionHelperManager.updateScale();
        this.cameraPositionSubject.next(this.sceneManager.activeCamera.position);
      }
    }

    // Emitir cambios en la orientación de la cámara
    this.sceneManager.activeCamera.getWorldQuaternion(this.tempQuaternion);
    if (!this.tempQuaternion.equals(this.cameraOrientationSubject.getValue())) {
      this.cameraOrientationSubject.next(this.tempQuaternion.clone());
    }

    // Sincronizar proxy de selección para que siempre mire a la cámara (para billboards)
    const selectionProxy = this.sceneManager.scene.getObjectByName('SelectionProxy');
    if (selectionProxy) selectionProxy.quaternion.copy(this.sceneManager.activeCamera.quaternion);

    // Actualizar efectos de modelos y visibilidad de instancias
    this.updateDynamicCelestialModels(delta);
    this.sceneManager.scene.children.forEach(object => {
      if (object.name.startsWith(CELESTIAL_MESH_PREFIX)) this.updateVisibleCelestialInstances(object as THREE.InstancedMesh);
      if (object.userData['animationMixer']) object.userData['animationMixer'].update(delta);
    });

    // --- [NUEVA LÓGICA DE RENDERIZADO] ---
    this.renderSceneWithSelectiveBloom();

    this.statsManager.end();
  };
  
  /**
   * @private
   * Orquesta el renderizado en dos etapas para lograr el brillo selectivo.
   */
  private renderSceneWithSelectiveBloom(): void {
    // 1. Renderizar la pasada de BLOOM
    this.originalSceneBackground = this.sceneManager.scene.background;
    this.sceneManager.scene.background = null; // Fondo negro para aislar los objetos que brillan
    this.sceneManager.activeCamera.layers.set(BLOOM_LAYER); // La cámara solo ve los objetos en la capa de bloom
    this.sceneManager.bloomComposer.render(); // Renderiza solo el bloom a su buffer interno

    // 2. Restaurar el estado para renderizar la pasada FINAL
    this.sceneManager.scene.background = this.originalSceneBackground;
    this.sceneManager.activeCamera.layers.enableAll(); // La cámara vuelve a ver todas las capas

    // 3. Renderizar la pasada FINAL (escena + outlines + mezcla de bloom)
    this.sceneManager.composer.render();
  }


  /**
   * Se ejecuta al destruir el componente para limpiar recursos y detener el bucle de animación.
   */
  public ngOnDestroy = () => {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.statsManager.destroy();
    this.controlsManager.ngOnDestroy();
    if (this.sceneManager.renderer) this.sceneManager.renderer.dispose();
  };
  
  // ====================================================================
  // LÓGICA DE SELECCIÓN E INTERACCIÓN (Rol de Orquestador)
  // ====================================================================
  
  /**
   * Gestiona el proceso completo de seleccionar o deseleccionar un objeto por su UUID.
   * Este método actúa como un orquestador, coordinando las acciones de múltiples servicios.
   * @param uuid - El UUID del objeto a seleccionar, o `null` para deseleccionar todo.
   */
  public setActiveSelectionByUuid(uuid: string | null): void {
    const currentUuid = this.selectedObject?.uuid;
    if (currentUuid === uuid) return;

    // 1. Limpieza del estado de selección anterior.
    this.selectionManager.setSelectedObjects([]);
    this.interactionHelperManager.cleanupHelpers(this.selectedObject);
    this.dragInteractionManager.stopListening();
    this.controlsManager.detach();
    this.selectedObject = undefined;
    this.interactionService.setSelectedObject(undefined);
    this.interactionService.setToolMode('select'); // Siempre vuelve a modo selección.
    
    // 2. El EntityManager se encarga de preparar la representación del nuevo objeto (creando un proxy si es necesario).
    this.entityManager.selectObjectByUuid(uuid, this.focusPivot);

    // 3. Configuración del nuevo estado de selección.
    if (uuid) {
      this.selectedObject = this.entityManager.getObjectByUuid(uuid) ?? this.sceneManager.scene.getObjectByName('SelectionProxy');
      if (this.selectedObject) {
        // Informa al InteractionService del nuevo objeto para que pueda activar las herramientas correspondientes.
        this.interactionService.setSelectedObject(this.selectedObject);
        this.selectionManager.setSelectedObjects([this.selectedObject]);
        this.interactionService.setToolMode(this.controlsManager.getCurrentToolMode());
      }
    }
    
    // 4. Notifica a toda la aplicación sobre el cambio de selección.
    this.onObjectSelected$.next(uuid);
  }
  
  /**
   * Delega el cambio del modo de herramienta (mover, rotar, etc.) al `InteractionService`.
   * @param mode - La nueva herramienta a activar.
   */
  public setToolMode(mode: ToolMode): void {
    this.interactionService.setToolMode(mode);
  }
  
  // ====================================================================
  // MANEJADORES DE EVENTOS
  // ====================================================================

  /** Manejador para el evento `keydown`. Delega la mayor parte de la lógica al `InteractionService`. */
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
    
    this.interactionService.handleKeyDown(e); // Delegación clave
  };
  
  /** Manejador para el evento `mousedown` en el canvas. Delega al `InteractionService`. */
  private onCanvasMouseDown = (e: MouseEvent) => {
    this.interactionService.handleMouseDown(e); // Delegación clave
  };
  
  /**
   * Suscribe el motor a todos los eventos necesarios, tanto del DOM como de otros servicios.
   */
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

  // =================================================================================
  // POBLACIÓN DE LA ESCENA Y GESTIÓN DE OBJETOS
  // =================================================================================

  /**
   * Pre-compila los shaders de la escena para evitar "stuttering" (tirones) la primera vez que se usan.
   * Lo hace renderizando un objeto de prueba invisible con los materiales más complejos.
   */
  private precompileShaders(): void {
    const dummyGeometry = new THREE.BoxGeometry(0.001, 0.001, 0.001);
    const dummyMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    const dummyMesh = new THREE.Mesh(dummyGeometry, dummyMaterial);
    dummyMesh.position.set(Infinity, Infinity, Infinity);
    this.sceneManager.scene.add(dummyMesh);
    this.selectionManager.setSelectedObjects([dummyMesh]); // Asegura que los shaders de selección también se compilen
    this.sceneManager.composer.render();
    this.selectionManager.setSelectedObjects([]);
    this.sceneManager.scene.remove(dummyMesh);
    dummyGeometry.dispose();
    dummyMaterial.dispose();
  }
  
  /**
   * Limpia la escena y la puebla con una nueva lista de objetos provenientes de la API.
   * @param objects - Array de datos de objetos para crear.
   * @param onProgress - Callback para notificar el progreso de la carga.
   * @param onLoaded - Callback a ejecutar cuando todos los objetos se han cargado.
   */
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

  // =================================================================================
  // OPTIMIZACIONES Y ACTUALIZACIONES DINÁMICAS
  // =================================================================================
  
  /**
   * Ajusta dinámicamente los planos de recorte (near y far) de la cámara en perspectiva.
   * Previene el z-fighting y permite visualizar objetos tanto muy cercanos como extremadamente lejanos.
   */
  private adjustCameraClippingPlanes = () => {
    const camera = this.sceneManager.activeCamera as THREE.PerspectiveCamera;
    if (!camera.isPerspectiveCamera) return;
    
    const controls = this.controlsManager.getControls();
    if (!controls) return;
    
    const distanceToTarget = camera.position.distanceTo(controls.target);
    this.tempBox.setFromObject(this.selectedObject ?? this.focusPivot, true);
    const objectSize = this.tempBox.getSize(this.tempVec3).length() || distanceToTarget * 0.1;
    
    let newNear = THREE.MathUtils.clamp(Math.min(distanceToTarget / 1000, objectSize / 10), 0.1, 1000);
    let newFar = Math.max(distanceToTarget * 2, camera.userData['originalFar'] || 1e15);
    
    if (newFar <= newNear) newFar = newNear * 2;
    
    if (camera.near !== newNear || camera.far !== newFar) {
      camera.near = newNear;
      camera.far = newFar;
      camera.updateProjectionMatrix();
    }
  };

  /**
   * Actualiza la visibilidad y apariencia de los objetos celestes instanciados.
   * Utiliza frustum culling y una lógica de distancia para decidir qué instancias renderizar y con qué intensidad.
   * @param instancedMesh - El mesh de instancias a procesar.
   */
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
    
    // Procesar solo un subconjunto de instancias en cada frame para distribuir la carga.
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
  
  /** Ayudante para `updateVisibleCelestialInstances`: determina si una instancia es visible. */
  private _isInstanceVisible(data: CelestialInstanceData, camera: THREE.Camera, visibilityFactor: number): boolean {
    this.boundingSphere.center.copy(data.position);
    this.boundingSphere.radius = Math.max(data.scale.x, data.scale.y, data.scale.z) * DEEP_SPACE_SCALE_BOOST;
    if (!this.frustum.intersectsSphere(this.boundingSphere)) return false;
    
    const personalVisibilityDist = Math.min(BASE_VISIBILITY_DISTANCE * data.luminosity, MAX_PERCEPTUAL_DISTANCE);
    const distance = data.position.distanceTo(camera.position);
    return distance <= (personalVisibilityDist * visibilityFactor);
  }

  /** Ayudante para `updateVisibleCelestialInstances`: calcula la intensidad del brillo de una instancia. */
  private _calculateInstanceIntensity(data: CelestialInstanceData, camera: THREE.Camera, isOrthographic: boolean, bloomDampeningFactor: number): number {
    const distance = data.position.distanceTo(camera.position);
    const maxScale = Math.max(data.scale.x, data.scale.y, data.scale.z);
    const falloff = THREE.MathUtils.clamp(THREE.MathUtils.inverseLerp(maxScale * 80.0, maxScale * 10.0, distance), 0.0, 1.0);
    const targetIntensity = THREE.MathUtils.lerp(data.emissiveIntensity, data.baseEmissiveIntensity, falloff);
    
    return Math.min(targetIntensity, MAX_INTENSITY) * bloomDampeningFactor * data.brightness;
  }
  
  /**
   * Actualiza la intensidad emisiva de los modelos 3D celestes (no instanciados) en función de la distancia a la cámara.
   * @param delta - El tiempo transcurrido desde el último frame.
   */
  private updateDynamicCelestialModels(delta: number): void {
      this.dynamicCelestialModels.forEach(model => {
          if (!model.userData['isDynamicCelestialModel']) return;
          const distance = this.sceneManager.activeCamera.position.distanceTo(model.position);
          const maxScale = Math.max(model.scale.x, model.scale.y, model.scale.z);
          const originalIntensity = model.userData['originalEmissiveIntensity'] || 1.0;
          const baseIntensity = model.userData['baseEmissiveIntensity'] || 0.1;
          const fadeFactor = THREE.MathUtils.clamp(THREE.MathUtils.inverseLerp(maxScale * 80.0, maxScale * 10.0, distance), 0.0, 1.0);
          const targetIntensity = THREE.MathUtils.lerp(originalIntensity, baseIntensity, fadeFactor);
          
          model.traverse(child => {
              if (child instanceof THREE.Mesh) {
                const material = child.material as THREE.MeshStandardMaterial;
                if (material.emissiveIntensity !== undefined) {
                    material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, targetIntensity, delta * 5); // Suaviza la transición
                }
              }
          });
      });
  }
  
  // =================================================================================
  // API PÚBLICA (Métodos llamados desde la UI y otros componentes)
  // =================================================================================

  /** Delega el redimensionamiento de la ventana al SceneManager. */
  public onWindowResize = () => this.sceneManager.onWindowResize();
  /** Delega el cambio de cámara activa al CameraManager. */
  public toggleActiveCamera(): void { this.cameraManager.toggleActiveCamera(this.selectedObject); }
  /** Delega el cambio de modo de cámara (perspectiva/ortográfica) al CameraManager. */
  public toggleCameraMode(): void { this.cameraManager.toggleCameraMode(); }
  /** Establece una vista de cámara ortográfica desde un eje específico. */
  public setCameraView(axisName: string | null): void { this.baseOrthoMatrixElement = this.cameraManager.setCameraView(axisName, undefined); }
  /** Cambia explícitamente a la vista de perspectiva. */
  public switchToPerspectiveView(): void { this.cameraManager.switchToPerspectiveView(); }
  /** Actualiza el nombre de un objeto. */
  public updateObjectName = (uuid: string, newName: string) => this.entityManager.updateObjectName(uuid, newName);
  /** Modifica la visibilidad de un grupo de objetos. */
  public setGroupVisibility = (uuids: string[], visible: boolean): void => this.entityManager.setGroupVisibility(uuids, visible);
  /** Modifica el brillo (opacidad) de un grupo de objetos. */
  public setGroupBrightness = (uuids: string[], brightness: number): void => this.entityManager.setGroupBrightness(uuids, brightness);
  /** Añade un nuevo objeto a la escena a partir de sus datos. */
  public addObjectToScene = (objData: SceneObjectResponse) => this.entityManager.createObjectFromData(objData);
  /** Devuelve un observable con la lista de entidades de la escena. */
  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  /** Devuelve el objeto que actualmente tiene los gizmos de transformación adjuntos. */
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  /** Encuadra todos los objetos de la escena en la vista de la cámara. */
  public frameScene = () => this.cameraManager.frameScene();
  /** Enfoca la cámara en un objeto específico por su UUID. */
  public focusOnObject = (uuid: string) => this.cameraManager.focusOnObject(uuid);
  /** Devuelve el modo de herramienta actual. */
  public getCurrentToolMode = (): ToolMode => this.controlsManager.getCurrentToolMode();
  
  /**
   * Actualiza la transformación (posición, rotación o escala) de un objeto,
   * ya sea un objeto estándar o una instancia de un `InstancedMesh`.
   * @param uuid - El UUID del objeto a modificar.
   * @param path - La propiedad a modificar: 'position', 'rotation', o 'scale'.
   * @param value - El nuevo valor {x, y, z}.
   */
  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number; y: number; z: number; }) => {
    // Caso 1: Objeto estándar
    const standardObject = this.entityManager.getObjectByUuid(uuid);
    if (standardObject && standardObject.name !== 'SelectionProxy') {
      standardObject[path].set(value.x, value.y, value.z);
      if (path === 'position') this.interactionHelperManager.updateHelperPositions(standardObject);
      return;
    }
    
    // Caso 2: Instancia celeste
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
      
      // Si el proxy de selección está activo para esta instancia, actualizarlo también.
      const selectionProxy = this.sceneManager.scene.getObjectByName('SelectionProxy');
      if (selectionProxy && selectionProxy.uuid === uuid) {
        selectionProxy.position.copy(data.position);
        selectionProxy.scale.copy(data.scale).multiplyScalar(7.0);
      }
    }
  };
  
  // =================================================================================
  // HELPERS INTERNOS
  // =================================================================================

  /**
   * Manejador que se dispara cuando una transformación (via gizmos o drag) finaliza.
   * Actualiza los datos de la instancia si el objeto modificado era un proxy y emite el evento `onTransformEnd$`.
   */
  private handleTransformEnd = () => {
    if (!this.selectedObject) return;
    
    // Si el objeto movido era un proxy, debemos actualizar la matriz de la instancia original.
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

  /**
   * Actualiza el `frustum` de la cámara. El frustum es el volumen de espacio que la cámara puede ver.
   * Es esencial para el "frustum culling" (descartar objetos fuera de la vista).
   */
  private updateCameraFrustum(): void {
    const camera = this.sceneManager.activeCamera;
    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  /** Se llama cuando los controles de la cámara cambian. Usado para reescalar helpers. */
  private onControlsChange = () => this.interactionHelperManager.updateScale();
}