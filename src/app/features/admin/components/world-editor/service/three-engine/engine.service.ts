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
 
@Injectable()
export class EngineService implements OnDestroy {
  // =================================================================================================
  // == SECCIÓN 1: PROPIEDADES Y API PÚBLICA =========================================================
  // =================================================================================================
  
  public onTransformEnd$: Observable<void>; // <-- 🎯 1. SOLO SE DECLARA AQUÍ
  private selectedObject?: THREE.Object3D;
  
  // --- Bucle de Renderizado y Estado ---
  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private needsRender = true;

  // --- Estado de Teclado y Cámara ---
  private keyMap = new Map<string, boolean>();
  private cameraOrientation = new BehaviorSubject<THREE.Quaternion>(new THREE.Quaternion());
  private tempQuaternion = new THREE.Quaternion();

  private controlsSubscription?: Subscription;

  // =================================================================================================
  // == SECCIÓN 2: CICLO DE VIDA Y ORQUESTACIÓN =======================================================
  // =================================================================================================
  
  constructor(
    // Servicios principales de la escena
    private sceneManager: SceneManagerService,
    private entityManager: EntityManagerService,
    private controlsManager: ControlsManagerService,
    private selectionManager: SelectionManagerService,
    private statsManager: StatsManagerService,
    // Nuevos servicios de interacción
    private interactionHelperManager: InteractionHelperManagerService,
    private dragInteractionManager: DragInteractionManagerService
  ) {
    // 🎯 2. SE INICIALIZA EN EL CONSTRUCTOR, DONDE dragInteractionManager YA EXISTE
    this.onTransformEnd$ = this.dragInteractionManager.onDragEnd$.pipe(debounceTime(400)); // Ajusté el debounce a 400ms que es un valor más común para autoguardado.
  }

  public init(canvasRef: ElementRef<HTMLCanvasElement>, objects: SceneObjectResponse[], onProgress: (p: number) => void, onLoaded: () => void): void {
    const canvas = canvasRef.nativeElement;
    
    // 1. Configurar la escena y servicios base
    this.sceneManager.setupBasicScene(canvas);
    this.entityManager.init(this.sceneManager.scene);
    this.statsManager.init();
    this.selectionManager.init(this.sceneManager.scene, this.sceneManager.editorCamera, this.sceneManager.renderer, canvas);
    this.controlsManager.init(this.sceneManager.editorCamera, canvas, this.sceneManager.scene, this.sceneManager.focusPivot);
    
    // 2. Inicializar los nuevos servicios de interacción
    this.interactionHelperManager.init(this.sceneManager.scene, this.sceneManager.editorCamera);
    this.dragInteractionManager.init(this.sceneManager.editorCamera, canvas, this.controlsManager);

    // 3. Cargar datos y empezar
    const lm = this.entityManager.getLoadingManager();
    lm.onProgress = (_, i, t) => onProgress((i / t) * 100);
    lm.onLoad = () => { onLoaded(); this.entityManager.publishSceneEntities(); this.requestRender(); };
    
    objects.forEach(o => this.entityManager.createObjectFromData(o));
    if (!objects.some(o => o.type === 'model' && o.asset?.path)) setTimeout(() => lm.onLoad!(), 0); 
    
    this.controlsManager.enableNavigation();
    this.addEventListeners();
    this.animate();
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

  // =================================================================================================
  // == SECCIÓN 3: GESTIÓN DE SELECCIÓN Y HERRAMIENTAS ===============================================
  // =================================================================================================
  
   public setToolMode(mode: ToolMode): void {
    this.controlsManager.setTransformMode(mode);
    this.interactionHelperManager.cleanupHelpers(this.selectedObject);
    this.dragInteractionManager.stopListening();
    this.controlsManager.detach();

    if (this.selectedObject) {
      switch (mode) {
        case 'move':
          this.interactionHelperManager.createHelpers(this.selectedObject);
          this.interactionHelperManager.makeObjectOpaque(this.selectedObject);
          
          // 🎯 LÓGICA MEJORADA: Se le pasa el helper manager al drag manager.
          this.dragInteractionManager.startListening(this.selectedObject, this.interactionHelperManager);
          break;
        case 'rotate':
        case 'scale':
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

    if (!uuid) {
      this.selectedObject = undefined;
      this.selectionManager.selectObjects([]);
      this.entityManager.selectObjectByUuid(null, this.sceneManager.focusPivot);
      this.requestRender();
      return;
    }

    this.selectedObject = this.entityManager.getObjectByUuid(uuid);
    this.entityManager.selectObjectByUuid(uuid, this.sceneManager.focusPivot);
    
    const currentTool = this.controlsManager.getCurrentToolMode();
    if (this.selectedObject) {
      this.setToolMode(currentTool);
    }
    this.requestRender();
  }

  // =================================================================================================
  // == SECCIÓN 4: BUCLE PRINCIPAL Y EVENTOS =========================================================
  // =================================================================================================

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    
    const delta = this.clock.getDelta();
    if (this.controlsManager.update(delta, this.keyMap)) {
      this.requestRender();
      this.interactionHelperManager.updateScale();
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

  private addEventListeners = () => {
    this.controlsManager.getControls().addEventListener('change', this.onControlsChange);
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.controlsSubscription = this.controlsManager.onTransformEnd$.subscribe(() => {
        // Futuras notificaciones desde TransformControls (rotar/escalar)
    });
    
    // Escucha el movimiento en tiempo real del drag para actualizar helpers
    this.dragInteractionManager.onDragEnd$.subscribe(() => {
        if (this.selectedObject) {
            this.interactionHelperManager.updateHelperPositions(this.selectedObject);
            this.requestRender();
        }
    });
  };

  private removeEventListeners = () => {
    this.controlsManager.getControls()?.removeEventListener('change', this.onControlsChange);
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controlsSubscription?.unsubscribe();
  };
  
  private onControlsChange = () => { this.interactionHelperManager.updateScale(); this.requestRender(); };
  private onWindowResize = () => {
    this.sceneManager.onWindowResize();
    this.selectionManager.onResize(this.sceneManager.renderer.domElement.width, this.sceneManager.renderer.domElement.height);
    this.interactionHelperManager.updateScale();
    this.requestRender();
  };
  private onKeyDown = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), true);
  private onKeyUp = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), false);
  public requestRender = () => { this.needsRender = true; };

  // =================================================================================================
  // == SECCIÓN 5: API PÚBLICA DEL SERVICIO (GETTERS Y ACTUALIZADORES) ===============================
  // =================================================================================================
  
  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  public getCameraOrientation = (): Observable<THREE.Quaternion> => this.cameraOrientation.asObservable();
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;

  public addObjectToScene = (objData: SceneObjectResponse) => {
    this.entityManager.createObjectFromData(objData);
    this.entityManager.publishSceneEntities();
    this.requestRender();
  };
  
  public updateObjectName = (uuid: string, newName: string) => {
    this.entityManager.updateObjectName(uuid, newName);
    this.requestRender();
  };
  
  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number, y: number, z: number }) => {
    const obj = this.entityManager.getObjectByUuid(uuid);
    if (obj) {
      obj[path].set(value.x, value.y, value.z);
      if (path === 'position') {
        this.interactionHelperManager.updateHelperPositions(obj);
      }
      this.requestRender();
    }
  };

  public setCameraView = (axisName: string) => {
    // ... (este método no cambia, se queda aquí ya que es una acción de alto nivel)
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
    this.requestRender();
  };
}