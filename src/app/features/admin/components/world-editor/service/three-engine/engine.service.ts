// engine.service.ts
import { Injectable, ElementRef, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
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
 
@Injectable()
export class EngineService implements OnDestroy {
  public onTransformEnd$: Observable<void>;
  private selectedObject?: THREE.Object3D;
  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private needsRender = true;
  private keyMap = new Map<string, boolean>();
  private axisLock: 'x' | 'y' | 'z' | null = null;
  private axisLockStateSubject = new BehaviorSubject<'x' | 'y' | 'z' | null>(null);
  public axisLockState$ = this.axisLockStateSubject.asObservable();
  private cameraOrientation = new BehaviorSubject<THREE.Quaternion>(new THREE.Quaternion());
  private tempQuaternion = new THREE.Quaternion();
  private controlsSubscription?: Subscription;

  // --- LÓGICA DE OPTIMIZACIÓN 1: Variables para el Culling ---
  private cullableObjects: THREE.Object3D[] = [];
  private lastCullTime = 0;
  // Intervalo en milisegundos para ejecutar el culling (500ms = 2 veces por segundo)
  private readonly CULL_INTERVAL = 500; 
  // Distancia máxima a la que los objetos serán visibles. ¡Ajusta este valor según tu escena!
  private readonly MAX_VISIBILITY_DISTANCE = 500; 

  constructor(
    private sceneManager: SceneManagerService,
    private entityManager: EntityManagerService,
    private controlsManager: ControlsManagerService,
    private selectionManager: SelectionManagerService,
    private statsManager: StatsManagerService,
    private interactionHelperManager: InteractionHelperManagerService,
    private dragInteractionManager: DragInteractionManagerService
  ) {
    this.onTransformEnd$ = this.dragInteractionManager.onDragEnd$.pipe(debounceTime(400));
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

  public populateScene(objects: SceneObjectResponse[], onProgress: (p: number) => void, onLoaded: () => void): void {
    if (!this.sceneManager.scene) {
        console.error("EngineService.populateScene llamado antes de que la escena esté inicializada.");
        return;
    }

    this.entityManager.clearScene();

    const loadingManager = this.entityManager.getLoadingManager();
    loadingManager.onProgress = (_, loaded, total) => onProgress((loaded / total) * 100);
    loadingManager.onLoad = () => { 
      // --- LÓGICA DE OPTIMIZACIÓN 2: Obtener la lista de objetos a optimizar ---
      // Una vez que todos los objetos están cargados, obtenemos una lista de ellos para el culling.
      this.cullableObjects = this.entityManager.getAllCullableObjects();
      console.log(`[EngineService] Optimización activada para ${this.cullableObjects.length} objetos.`);
      this.performDistanceCulling(); // Hacemos una pasada inicial

      onLoaded(); 
      this.entityManager.publishSceneEntities(); 
      this.requestRender(); 
    };

    objects.forEach(o => this.entityManager.createObjectFromData(o));

    if (!objects.some(o => o.type === 'model' && o.asset?.path)) {
      setTimeout(() => {
        if (loadingManager.onLoad) loadingManager.onLoad();
      }, 0); 
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
          this.interactionHelperManager.makeObjectOpaque(this.selectedObject);
          this.dragInteractionManager.startListening(this.selectedObject, this.interactionHelperManager);
          break;
        case 'rotate': case 'scale':
          this.controlsManager.attach(this.selectedObject);
          break;
      }
    }
    this.requestRender();
  }

  public selectObjectByUuid(uuid: string | null): void {
    this.interactionHelperManager.cleanupHelpers(this.selectedObject);
    this.dragInteractionManager.stopListening();
    this.controlsManager.detach();
    this.axisLock = null;
    this.dragInteractionManager.setAxisConstraint(null);
    this.axisLockStateSubject.next(null);
    
    if (!uuid) {
      this.selectedObject = undefined;
      this.entityManager.selectObjectByUuid(null, this.sceneManager.focusPivot);
    } else {
      this.selectedObject = this.entityManager.getObjectByUuid(uuid);
      this.entityManager.selectObjectByUuid(uuid, this.sceneManager.focusPivot);
      if (this.selectedObject) {
        this.setToolMode(this.controlsManager.getCurrentToolMode());
      }
    }

    // --- LÓGICA DE OPTIMIZACIÓN 3: Asegurarse de que el objeto seleccionado sea visible ---
    // Al seleccionar/deseleccionar, re-evaluamos la visibilidad para que el objeto aparezca si estaba oculto.
    this.performDistanceCulling();
    this.requestRender();
  }

  // --- LÓGICA DE OPTIMIZACIÓN 4: El bucle de animación ahora controla el culling ---
  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    const delta = this.clock.getDelta();

    // Comprobamos si los controles de la cámara se han movido
    const cameraMoved = this.controlsManager.update(delta, this.keyMap);
    if (cameraMoved) {
      this.requestRender();
      this.interactionHelperManager.updateScale();
    }
    
    // Ejecutamos el culling a intervalos regulares si la cámara se mueve
    const now = this.clock.elapsedTime * 1000;
    if (cameraMoved && now - this.lastCullTime > this.CULL_INTERVAL) {
      this.performDistanceCulling();
      this.lastCullTime = now;
    }

    this.sceneManager.editorCamera.getWorldQuaternion(this.tempQuaternion);
    if (!this.tempQuaternion.equals(this.cameraOrientation.getValue())) {
      this.cameraOrientation.next(this.tempQuaternion.clone());
    }

    if (this.needsRender) {
      this.selectionManager.composer.render();
      this.needsRender = false;
    }
    this.statsManager.end();
  };

  // --- LÓGICA DE OPTIMIZACIÓN 5: La función principal de Culling por Distancia ---
  private performDistanceCulling(): void {
    const cameraPosition = this.sceneManager.editorCamera.position;
    let visibilityChanged = false;

    this.cullableObjects.forEach(obj => {
      const distance = obj.position.distanceTo(cameraPosition);
      
      // Un objeto es visible si está dentro de la distancia O si es el objeto seleccionado.
      const shouldBeVisible = (distance < this.MAX_VISIBILITY_DISTANCE) || (obj === this.selectedObject);

      if (obj.visible !== shouldBeVisible) {
        obj.visible = shouldBeVisible;
        visibilityChanged = true;
      }
    });

    if (visibilityChanged) {
      //console.log("[EngineService] Visibilidad de objetos actualizada.");
      this.requestRender();
    }
  }

  public addObjectToScene = (objData: SceneObjectResponse) => {
    const newObject = this.entityManager.createObjectFromData(objData);
    // --- LÓGICA DE OPTIMIZACIÓN 6: Añadir nuevos objetos a la lista de culling ---
    if (newObject) {
      this.cullableObjects.push(newObject);
    }
    this.entityManager.publishSceneEntities();
    this.requestRender();
  };

  private addEventListeners = () => {
    const controls = this.controlsManager.getControls();
    controls.addEventListener('start', this.onInteractionStart);
    controls.addEventListener('end', this.onInteractionEnd);
    controls.addEventListener('change', this.onControlsChange);
    
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.controlsSubscription = this.controlsManager.onTransformEnd$.subscribe(() => {});
    this.dragInteractionManager.onDragEnd$.subscribe(() => {
        if (this.selectedObject) {
            this.interactionHelperManager.updateHelperPositions(this.selectedObject);
            this.requestRender();
        }
    });
  };

  private removeEventListeners = () => {
    const controls = this.controlsManager.getControls();
    controls?.removeEventListener('start', this.onInteractionStart);
    controls?.removeEventListener('end', this.onInteractionEnd);
    controls?.removeEventListener('change', this.onControlsChange);

    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controlsSubscription?.unsubscribe();
  };
  
  private onInteractionStart = () => { this.sceneManager.setLowQualityRender(); }
  private onInteractionEnd = () => {
    this.sceneManager.setNormalQualityRender();
    // Al final de una interacción de cámara, forzamos una comprobación de culling.
    this.performDistanceCulling();
    this.requestRender();
  }
  private onControlsChange = () => { this.interactionHelperManager.updateScale(); this.requestRender(); };
  
  private onWindowResize = () => {
    this.sceneManager.onWindowResize();
    this.selectionManager.onResize(this.sceneManager.renderer.domElement.width, this.sceneManager.renderer.domElement.height);
    this.interactionHelperManager.updateScale();
    this.requestRender();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    this.keyMap.set(key, true);
    if (this.controlsManager.getCurrentToolMode() === 'move' && ['x', 'y', 'z'].includes(key)) {
        this.axisLock = this.axisLock === key ? null : (key as 'x' | 'y' | 'z');
        this.dragInteractionManager.setAxisConstraint(this.axisLock);
        this.axisLockStateSubject.next(this.axisLock);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), false);
  
  public requestRender = () => { this.needsRender = true; };
  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  public getCameraOrientation = (): Observable<THREE.Quaternion> => this.cameraOrientation.asObservable();
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  
  public updateObjectName = (uuid: string, newName: string) => {
    this.entityManager.updateObjectName(uuid, newName);
    this.requestRender();
  };
  
  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number, y: number, z: number }) => {
    const obj = this.entityManager.getObjectByUuid(uuid);
    if (obj) {
      obj[path].set(value.x, value.y, value.z);
      if (path === 'position') this.interactionHelperManager.updateHelperPositions(obj);
      this.requestRender();
    }
  };

  public setCameraView = (axisName: string) => {
    const controls = this.controlsManager.getControls();
    if (!controls) return;
    const target = this.sceneManager.focusPivot.position;
    const distance = Math.max(this.sceneManager.editorCamera.position.distanceTo(target), 5);
    const newPosition = new THREE.Vector3();
    switch (axisName) {
      case 'axis-x': newPosition.set(distance, 0, 0); break;
      case 'axis-x-neg': newPosition.set(-distance, 0, 0); break;
      case 'axis-y': newPosition.set(0, distance, 0); break;
      case 'axis-y-neg': newPosition.set(0, -distance, 0.0001); break;
      case 'axis-z': newPosition.set(0, 0, distance); break;
      case 'axis-z-neg': newPosition.set(0, 0, -distance); break;
      default: return;
    }
    this.sceneManager.editorCamera.position.copy(target).add(newPosition);
    this.sceneManager.editorCamera.lookAt(target);
    controls.target.copy(target);
    controls.update();
    this.performDistanceCulling(); // Re-evaluar culling después de cambiar de vista
    this.requestRender();
  };
}