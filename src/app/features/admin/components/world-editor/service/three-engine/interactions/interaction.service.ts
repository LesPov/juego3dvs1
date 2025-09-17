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
import { EngineService, IntersectedObjectInfo } from '../core/engine.service'; // Usado para tipo y referencia circular controlada

/**
 * @class InteractionService
 * @description
 * Este servicio es el **cerebro central de la interacción del usuario** con la escena 3D.
 * Fue creado para desacoplar la lógica de manejo de eventos (ratón, teclado) del `EngineService`,
 * aplicando el principio de responsabilidad única. Su rol es interpretar las acciones del usuario
 * y orquestar las respuestas apropiadas a través de los otros managers.
 *
 * Funciones clave:
 * - Gestiona la lógica de "hover" (pre-selección) usando un `Raycaster` desde el centro de la pantalla.
 * - Centraliza el manejo de clics del ratón para seleccionar y deseleccionar objetos.
 * - Administra la lógica de cambio de herramientas (seleccionar, mover, rotar, escalar).
 * - Controla el estado de bloqueo de ejes (`X`, `Y`, `Z`) para la herramienta de movimiento.
 * - Actúa como intermediario, recibiendo la intención del usuario y delegando la ejecución a servicios especializados.
 */
@Injectable({
  providedIn: 'root'
})
export class InteractionService {

  // ====================================================================
  // ESTADO PÚBLICO
  // ====================================================================

  /** Emite el estado actual del bloqueo de ejes ('x', 'y', 'z' o `null`). */
  public axisLockState$: Observable<'x' | 'y' | 'z' | null>;

  // ====================================================================
  // DEPENDENCIAS Y ESTADO INTERNO
  // ====================================================================
  
  // Dependencias inyectadas desde EngineService a través del método `init`.
  private sceneManager!: EngineService['sceneManager'];
  private cameraManager!: CameraManagerService;
  private entityManager!: EntityManagerService;
  private controlsManager!: ControlsManagerService;
  private selectionManager!: SelectionManagerService;
  private interactionHelperManager!: InteractionHelperManagerService;
  private dragInteractionManager!: DragInteractionManagerService;
  private engine!: EngineService;

  // Estado interno de la interacción
  private preselectedObject: IntersectedObjectInfo | null = null;
  private selectedObject?: THREE.Object3D;
  private axisLock: 'x' | 'y' | 'z' | null = null;
  private axisLockStateSubject = new BehaviorSubject<'x' | 'y' | 'z' | null>(null);

  // Herramientas de Three.js
  private raycaster = new THREE.Raycaster();
  private centerScreen = new THREE.Vector2(0, 0); // Coordenadas normalizadas del centro de la pantalla.

  constructor() {
    this.axisLockState$ = this.axisLockStateSubject.asObservable();
  }

  // ====================================================================
  // INICIALIZACIÓN Y CICLO DE VIDA
  // ====================================================================

  /**
   * Inicializa el servicio con las dependencias necesarias del motor principal.
   * Este patrón de "inyección post-constructor" evita dependencias circulares directas con `EngineService`.
   * @param dependencies - Un objeto que contiene referencias a todos los managers y servicios que necesita.
   */
  public init(dependencies: {
    sceneManager: EngineService['sceneManager'],
    cameraManager: CameraManagerService,
    entityManager: EntityManagerService,
    controlsManager: ControlsManagerService,
    selectionManager: SelectionManagerService,
    interactionHelperManager: InteractionHelperManagerService,
    dragInteractionManager: DragInteractionManagerService,
    engine: EngineService
  }): void {
    this.sceneManager = dependencies.sceneManager;
    this.cameraManager = dependencies.cameraManager;
    this.entityManager = dependencies.entityManager;
    this.controlsManager = dependencies.controlsManager;
    this.selectionManager = dependencies.selectionManager;
    this.interactionHelperManager = dependencies.interactionHelperManager;
    this.dragInteractionManager = dependencies.dragInteractionManager;
    this.engine = dependencies.engine;
  }
  
  /**
   * Método principal llamado desde el bucle de animación del motor (`EngineService.animate`).
   * Su única tarea por ahora es actualizar el efecto de hover.
   */
  public update(): void {
    this.updateHoverEffect();
  }

  // ====================================================================
  // GESTIÓN DEL ESTADO DE SELECCIÓN
  // ====================================================================

  /**
   * Informa a este servicio sobre cuál es el objeto actualmente seleccionado.
   * Llamado por el `EngineService` después de que la selección ha sido procesada.
   * @param object - El `THREE.Object3D` seleccionado, o `undefined` si no hay selección.
   */
  public setSelectedObject(object: THREE.Object3D | undefined): void {
      this.selectedObject = object;
  }
  
  /**
   * Lógica de pre-selección (hover). Lanza un rayo desde el centro de la pantalla para
   * detectar sobre qué objeto está el cursor. Si encuentra un objeto válido, le pide
   * al `SelectionManager` que muestre el contorno de hover.
   */
  private updateHoverEffect(): void {
    // El hover solo funciona en modo "select" y en cámara de perspectiva.
    if (this.controlsManager.getCurrentToolMode() !== 'select' || this.cameraManager.cameraMode$.getValue() === 'orthographic') {
      if (this.preselectedObject) { // Limpiar hover si salimos del modo permitido
        this.selectionManager.setHoveredObjects([]);
        this.preselectedObject = null;
        this.entityManager.removeHoverProxy();
      }
      return;
    }

    this.raycaster.setFromCamera(this.centerScreen, this.sceneManager.activeCamera);
    const intersects = this.raycaster.intersectObjects(this.sceneManager.scene.children, true);
    
    const firstValidHit = intersects.find(hit => 
        !hit.object.name.endsWith('_helper') && 
        hit.object.visible && 
        !['SelectionProxy', 'HoverProxy', 'EditorGrid', 'FocusPivot'].includes(hit.object.name)
    );
    
    if (firstValidHit) {
      const { object: hitObject, instanceId } = firstValidHit;
      // Si el objeto es instanciado, se crea un proxy para visualizar el hover.
      const isInstanced = (hitObject as THREE.InstancedMesh).isInstancedMesh && instanceId !== undefined;
      const proxyObject = isInstanced 
        ? this.entityManager.createOrUpdateHoverProxy(hitObject as THREE.InstancedMesh, instanceId) 
        : hitObject;
      
      if (this.preselectedObject?.uuid !== proxyObject.uuid) {
        this.preselectedObject = { uuid: proxyObject.uuid, object: proxyObject };
        this.selectionManager.setHoveredObjects([this.preselectedObject.object]);
      }
    } else if (this.preselectedObject) { // Si el rayo no golpea nada, pero había un hover activo
      this.preselectedObject = null;
      this.selectionManager.setHoveredObjects([]);
      this.entityManager.removeHoverProxy();
    }
  }

  // ====================================================================
  // MANEJO DE HERRAMIENTAS Y EVENTOS
  // ====================================================================

  /**
   * Centraliza la lógica para cambiar entre herramientas (seleccionar, mover, rotar, escalar).
   * Se encarga de limpiar el estado anterior (gizmos, helpers) y configurar el nuevo.
   * @param mode - La nueva `ToolMode` a activar.
   */
  public setToolMode(mode: ToolMode): void {
    // 1. Informa a ControlsManager sobre el cambio de modo del gizmo.
    this.controlsManager.setTransformMode(mode);

    // 2. Limpieza de estado anterior
    this.interactionHelperManager.cleanupHelpers(this.selectedObject);
    this.dragInteractionManager.stopListening();
    this.controlsManager.detach(); // Desvincula el gizmo de TransformControls
    this.axisLock = null;
    this.dragInteractionManager.setAxisConstraint(null);
    this.axisLockStateSubject.next(null);

    // 3. Configuración del nuevo estado si hay un objeto seleccionado
    if (this.selectedObject) {
      switch (mode) {
        case 'move':
          // El modo 'move' usa nuestros helpers personalizados y el drag manager.
          this.interactionHelperManager.createHelpers(this.selectedObject);
          this.dragInteractionManager.startListening(this.selectedObject, this.interactionHelperManager);
          break;
        case 'rotate':
        case 'scale':
          // Los modos 'rotate' y 'scale' usan el gizmo de TransformControls.
          this.controlsManager.attach(this.selectedObject);
          break;
      }
    }
  }

  /**
   * Manejador para el evento `mousedown` en el canvas.
   * Si hay un objeto pre-seleccionado (con hover), ejecuta la selección a través del motor principal.
   * @param e - El evento del ratón.
   */
  public handleMouseDown(e: MouseEvent): void {
    // El clic izquierdo selecciona el objeto con hover.
    if (e.button === 0 && this.preselectedObject) {
      e.preventDefault();
      const hoveredUuid = this.preselectedObject.uuid;

      // Limpia el estado de hover visualmente.
      this.selectionManager.setHoveredObjects([]);
      this.entityManager.removeHoverProxy();
      this.preselectedObject = null;
      
      // Lógica de toggle: si se hace clic en lo ya seleccionado, se deselecciona.
      const newUuid = this.selectedObject?.uuid === hoveredUuid ? null : hoveredUuid;
      
      // Pide al motor principal que orqueste el cambio de selección.
      this.engine.setActiveSelectionByUuid(newUuid);
    }
  }

  /**
   * Manejador para los eventos de teclado relacionados con la interacción.
   * Específicamente, maneja el bloqueo de ejes con las teclas X, Y, Z.
   * @param e - El evento de teclado.
   */
  public handleKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    
    // Bloqueo de ejes (toggle) para la herramienta de movimiento.
    if (this.controlsManager.getCurrentToolMode() === 'move' && ['x', 'y', 'z'].includes(key)) {
      this.axisLock = this.axisLock === key ? null : (key as 'x' | 'y' | 'z');
      this.dragInteractionManager.setAxisConstraint(this.axisLock);
      this.axisLockStateSubject.next(this.axisLock);
    }
  }
}