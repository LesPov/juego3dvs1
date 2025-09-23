// src/app/features/admin/views/world-editor/world-view/service/three-engine/interactions/interaction.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject, Observable } from 'rxjs';
import { ToolMode } from '../../../toolbar/toolbar.component';
import { ControlsManagerService } from './controls-manager.service';
import { DragInteractionManagerService } from './drag-interaction.manager.service';
import { InteractionHelperManagerService } from './interaction-helper.manager.service';
import { SelectionManagerService } from './selection-manager.service';
import { EntityManagerService } from '../managers/entity-manager.service';
import { CameraManagerService } from '../managers/camera-manager.service';
import { EngineService, IntersectedObjectInfo } from '../core/engine.service';
// ✨ NUEVA DEPENDENCIA: EventManagerService es crucial para la nueva funcionalidad.
import { EventManagerService } from './event-manager.service';

/**
 * @class InteractionService
 * @description
 * Interpreta las acciones del usuario (ratón, teclado) y orquesta las respuestas
 * a través de los otros managers. Es el cerebro de la interacción con la escena.
 */
@Injectable({
  providedIn: 'root'
})
export class InteractionService {

  public axisLockState$: Observable<'x' | 'y' | 'z' | null>;

  // Dependencias
  private sceneManager!: EngineService['sceneManager'];
  private cameraManager!: CameraManagerService;
  private entityManager!: EntityManagerService;
  private controlsManager!: ControlsManagerService;
  private selectionManager!: SelectionManagerService;
  private interactionHelperManager!: InteractionHelperManagerService;
  private dragInteractionManager!: DragInteractionManagerService;
  private engine!: EngineService;
  // ✨ Referencia al servicio de eventos.
  private eventManager!: EventManagerService;

  // Estado interno
  private preselectedObject: IntersectedObjectInfo | null = null;
  private selectedObject?: THREE.Object3D;
  private axisLock: 'x' | 'y' | 'z' | null = null;
  private axisLockStateSubject = new BehaviorSubject<'x' | 'y' | 'z' | null>(null);

  // Herramientas
  private raycaster = new THREE.Raycaster();
  private centerScreen = new THREE.Vector2(0, 0);

  constructor() {
    this.axisLockState$ = this.axisLockStateSubject.asObservable();
  }

  public init(dependencies: {
    sceneManager: EngineService['sceneManager'],
    cameraManager: CameraManagerService,
    entityManager: EntityManagerService,
    controlsManager: ControlsManagerService,
    selectionManager: SelectionManagerService,
    interactionHelperManager: InteractionHelperManagerService,
    dragInteractionManager: DragInteractionManagerService,
    engine: EngineService,
    // ✨ Se añade EventManagerService a las dependencias de inicialización.
    eventManager: EventManagerService
  }): void {
    this.sceneManager = dependencies.sceneManager;
    this.cameraManager = dependencies.cameraManager;
    this.entityManager = dependencies.entityManager;
    this.controlsManager = dependencies.controlsManager;
    this.selectionManager = dependencies.selectionManager;
    this.interactionHelperManager = dependencies.interactionHelperManager;
    this.dragInteractionManager = dependencies.dragInteractionManager;
    this.engine = dependencies.engine;
    this.eventManager = dependencies.eventManager; // Se guarda la referencia
  }
  
  public update(): void {
    this.updateHoverEffect();
  }

  public setSelectedObject(object: THREE.Object3D | undefined): void {
      this.selectedObject = object;
  }
  
  /**
   * Lógica de pre-selección (hover). Lanza un rayo para detectar sobre qué objeto está el cursor.
   * En vista 3D, el rayo sale del centro de la pantalla (mira).
   * En vista 2D, el rayo sale de la posición actual del ratón.
   */
  private updateHoverEffect(): void {
    // La pre-selección solo funciona si la herramienta activa es 'select'.
    if (this.controlsManager.getCurrentToolMode() !== 'select') {
      if (this.preselectedObject) {
        this.selectionManager.setHoveredObjects([]);
        this.preselectedObject = null;
        this.entityManager.removeHoverProxy();
      }
      return;
    }

    // ✨ LÓGICA CLAVE: Se elige el origen del rayo según el modo de la cámara.
    const cameraMode = this.cameraManager.cameraMode$.getValue();
    const rayOrigin = cameraMode === 'orthographic' 
        ? this.eventManager.mousePosition 
        : this.centerScreen;
    
    this.raycaster.setFromCamera(rayOrigin, this.sceneManager.activeCamera);

    const intersects = this.raycaster.intersectObjects(this.sceneManager.scene.children, true);
    
    const firstValidHit = intersects.find(hit => 
        !hit.object.name.endsWith('_helper') && 
        hit.object.visible && 
        !['SelectionProxy', 'HoverProxy', 'EditorGrid', 'FocusPivot'].includes(hit.object.name)
    );
    
    if (firstValidHit) {
      let selectableObject = firstValidHit.object;
      let current = selectableObject;
      while (current.parent && current.parent.type !== 'Scene') {
        current = current.parent;
      }
      selectableObject = current;
      
      const { instanceId } = firstValidHit;

      const isInstanced = (selectableObject as THREE.InstancedMesh).isInstancedMesh && instanceId !== undefined;
      const proxyObject = isInstanced 
        ? this.entityManager.createOrUpdateHoverProxy(selectableObject as THREE.InstancedMesh, instanceId) 
        : selectableObject;
      
      if (this.preselectedObject?.uuid !== proxyObject.uuid) {
        this.preselectedObject = { uuid: proxyObject.uuid, object: proxyObject };
        this.selectionManager.setHoveredObjects([this.preselectedObject.object]);
      }
    } else if (this.preselectedObject) {
      this.preselectedObject = null;
      this.selectionManager.setHoveredObjects([]);
      this.entityManager.removeHoverProxy();
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
        case 'rotate':
        case 'scale':
          this.controlsManager.attach(this.selectedObject);
          break;
      }
    }
  }

  public handleMouseDown(e: MouseEvent): void {
    // El clic izquierdo selecciona el objeto que está bajo el cursor (pre-seleccionado).
    // Esta lógica ahora funciona tanto en 2D como en 3D gracias a `updateHoverEffect`.
    if (e.button === 0 && this.preselectedObject) {
      e.preventDefault();
      const hoveredUuid = this.preselectedObject.uuid;

      this.selectionManager.setHoveredObjects([]);
      this.entityManager.removeHoverProxy();
      this.preselectedObject = null;
      
      const newUuid = this.selectedObject?.uuid === hoveredUuid ? null : hoveredUuid;
      
      this.engine.setActiveSelectionByUuid(newUuid);
    }
  }

  public handleKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    
    if (this.controlsManager.getCurrentToolMode() === 'move' && ['x', 'y', 'z'].includes(key)) {
      this.axisLock = this.axisLock === key ? null : (key as 'x' | 'y' | 'z');
      this.dragInteractionManager.setAxisConstraint(this.axisLock);
      this.axisLockStateSubject.next(this.axisLock);
    }
  }
}