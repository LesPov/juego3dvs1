// src/app/features/admin/views/world-editor/world-view/service/three-engine/managers/camera-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject } from 'rxjs';
import { SceneManagerService } from '../managers/scene-manager.service';
import { ControlsManagerService } from '../interactions/controls-manager.service';
import { EntityManagerService } from '../managers/entity-manager.service';
import { SelectionManagerService } from '../interactions/selection-manager.service';
import { InteractionHelperManagerService } from '../interactions/interaction-helper.manager.service';
import { DragInteractionManagerService } from '../interactions/drag-interaction.manager.service';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

// ====================================================================
// TIPOS Y INTERFACES
// ====================================================================

/** Define los tipos de cámaras controlables por el manager. */
export type CameraType = 'editor' | 'secondary';

/** Define los modos de proyección de la cámara. */
export type CameraMode = 'perspective' | 'orthographic';

/** @internal Estructura para almacenar el estado de una cámara de perspectiva para animaciones. */
interface AnimationState3D {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** @internal Estructura para almacenar el estado de una cámara ortográfica para animaciones. */
interface AnimationState2D extends AnimationState3D {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * @class CameraManagerService
 * @description
 * Este servicio es el **centro de control para todas las operaciones de cámara** en la escena 3D.
 * Se encarga de gestionar el estado, las transiciones y las animaciones de las diferentes cámaras
 * (principal, secundaria, ortográfica).
 *
 * Funciones clave:
 * - Gestiona el cambio entre la cámara de `perspective` (3D) y `orthographic` (2D).
 * - Controla el cambio entre la cámara principal del editor y una cámara secundaria (por ejemplo, la de un objeto).
 * - Guarda y restaura los estados de la cámara al cambiar de modo para una experiencia de usuario fluida.
 * - Proporciona funcionalidades de alto nivel como `frameScene` (encuadrar toda la escena) y `focusOnObject` (enfocar un objeto específico).
 * - Maneja las animaciones de cámara (transiciones suaves) para evitar saltos bruscos.
 */
@Injectable({ providedIn: 'root' })
export class CameraManagerService {

  // ====================================================================
  // OBSERVABLES Y ESTADO PÚBLICO
  // ====================================================================

  /** Emite el modo de cámara actual ('perspective' o 'orthographic'). */
  public cameraMode$ = new BehaviorSubject<CameraMode>('perspective');
  /** El tipo de cámara que está actualmente activa ('editor' o 'secondary'). */
  public activeCameraType: CameraType = 'editor';

  // ====================================================================
  // ESTADO INTERNO
  // ====================================================================

  private orthoCamera!: THREE.OrthographicCamera;
  
  // Almacena la última posición y target para restaurarlos al cambiar de modo
  private lastPerspectiveState: { position: THREE.Vector3, target: THREE.Vector3 } | null = null;
  private lastOrthographicState: { position: THREE.Vector3, target: THREE.Vector3 } | null = null;
  private lastEditorTarget = new THREE.Vector3(); // Guarda el target de OrbitControls de la cámara principal
  
  // Objetos temporales para optimización (evitar `new` en el bucle de renderizado)
  private tempBox = new THREE.Box3();
  private tempBoxSize = new THREE.Vector3();
  private tempWorldPos = new THREE.Vector3();
  private tempQuaternion = new THREE.Quaternion();
  private tempSphere = new THREE.Sphere();

  // Estado de la animación de la cámara
  private isCameraAnimating = false;
  private cameraAnimationTarget: AnimationState2D | AnimationState3D | null = null;
  private cameraInitialState: AnimationState2D | AnimationState3D | null = null;
  private cameraAnimationStartTime: number | null = null;
  private readonly cameraAnimationDuration = 1000; // en milisegundos
  private clock = new THREE.Clock();

  /**
   * @constructor
   * Inyecta todas las dependencias de servicios necesarios.
   */
  constructor(
    private sceneManager: SceneManagerService,
    private controlsManager: ControlsManagerService,
    private entityManager: EntityManagerService,
    private selectionManager: SelectionManagerService,
    private interactionHelperManager: InteractionHelperManagerService,
    private dragInteractionManager: DragInteractionManagerService,
  ) { }

  // ====================================================================
  // INICIALIZACIÓN Y CICLO DE VIDA
  // ====================================================================

  /**
   * Inicializa el manager. Debe ser llamado después de que `SceneManager` haya configurado la escena.
   * Crea la cámara ortográfica que se reutilizará.
   */
  public initialize(): void {
    const aspect = this.sceneManager.canvas.clientWidth / this.sceneManager.canvas.clientHeight;
    this.orthoCamera = new THREE.OrthographicCamera(-1 * aspect, 1 * aspect, 1, -1, 0.1, 5e15);
    this.orthoCamera.name = 'Cámara Ortográfica';
  }
  
  /**
   * Se ejecuta en cada frame desde `EngineService.animate`.
   * Progresa cualquier animación de cámara que esté en curso.
   * @param delta - El tiempo transcurrido desde el último frame (no se usa aquí, pero es estándar).
   * @returns `true` si la cámara se está animando, `false` en caso contrario.
   */
  public update(delta: number): boolean {
    if (this.isCameraAnimating) {
      this._updateCameraAnimation();
    }
    return this.isCameraAnimating;
  }

  // ====================================================================
  // API PÚBLICA - CONTROL DE CÁMARAS Y MODOS
  // ====================================================================

  /**
   * Alterna entre la cámara del editor y la cámara secundaria.
   * Reconfigura todos los servicios dependientes (controles, selección, helpers) para usar la nueva cámara activa.
   * @param currentSelectedObject - El objeto actualmente seleccionado, para re-adjuntar gizmos si es necesario.
   */
  public toggleActiveCamera(currentSelectedObject?: THREE.Object3D): void {
    const editorHelper = this.sceneManager.editorCamera.userData['helper'];
    const secondaryHelper = this.sceneManager.secondaryCamera.userData['helper'];
    const controls = this.controlsManager.getControls();
    let newActiveCamera: THREE.Camera;

    if (this.activeCameraType === 'editor') {
      // --- Cambiando a la cámara secundaria ---
      this.activeCameraType = 'secondary';
      newActiveCamera = this.sceneManager.secondaryCamera;
      this.lastEditorTarget.copy(controls.target);

      // Posiciona la cámara secundaria relativa a la del editor
      const { editorCamera, secondaryCamera } = this.sceneManager;
      const offset = secondaryCamera.userData['initialOffset'] as THREE.Vector3;
      editorCamera.getWorldPosition(this.tempWorldPos);
      editorCamera.getWorldQuaternion(this.tempQuaternion);
      const newCamPos = offset.clone().applyQuaternion(this.tempQuaternion).add(this.tempWorldPos);
      secondaryCamera.position.copy(newCamPos);
      controls.target.copy(this.tempWorldPos);
      
      if (editorHelper) editorHelper.visible = true;
      if (secondaryHelper) secondaryHelper.visible = false;
      this.controlsManager.configureForSecondaryCamera();

    } else {
      // --- Volviendo a la cámara del editor ---
      this.activeCameraType = 'editor';
      newActiveCamera = this.sceneManager.editorCamera;
      controls.target.copy(this.lastEditorTarget);

      if (editorHelper) editorHelper.visible = false;
      if (secondaryHelper) secondaryHelper.visible = true;
      this.controlsManager.configureForEditorCamera();
    }

    // Actualiza la cámara activa global y todos los servicios que dependen de ella.
    this.sceneManager.activeCamera = newActiveCamera as THREE.PerspectiveCamera;
    this._updateDependentServices(newActiveCamera);
    
    // Si la cámara recién activada estaba seleccionada, vuelve a adjuntar el gizmo de transformación.
    if(currentSelectedObject && currentSelectedObject.uuid === newActiveCamera.uuid) {
        this.controlsManager.attach(currentSelectedObject);
    }
  }

  /**
   * Alterna entre el modo de proyección de perspectiva (3D) y ortográfico (2D).
   */
  public toggleCameraMode(): void {
    if (this.cameraMode$.getValue() === 'perspective') {
      const controls = this.controlsManager.getControls();
      this.lastPerspectiveState = {
        position: this.sceneManager.activeCamera.position.clone(),
        target: controls.target.clone()
      };
      // Por defecto, cambia a la vista superior (eje Z en Three.js)
      this.setCameraView('axis-z');
    } else {
      this.switchToPerspectiveView();
    }
  }
  
  /**
   * Cambia a una vista ortográfica desde un eje específico (ej. 'axis-x', 'axis-y-neg').
   * Calcula el frustum (área visible) para que toda la escena quepa en la vista.
   * @param axisName - El eje desde el cual mirar ('axis-x', 'axis-y', 'axis-z', con sufijo '-neg' para negativo).
   * @param state - Un estado opcional de posición/target para restaurar una vista ortográfica específica.
   * @returns El valor del elemento de la matriz de proyección, usado para calcular el zoom.
   */
  public setCameraView(axisName: string | null, state?: { position: THREE.Vector3, target: THREE.Vector3 }): number {
    const controls = this.controlsManager.getControls();
    if (!controls) return 0;
    
    // Guarda el estado de la perspectiva si venimos de ella.
    if (this.cameraMode$.getValue() === 'perspective') {
        this.lastPerspectiveState = { position: this.sceneManager.editorCamera.position.clone(), target: controls.target.clone() };
    }

    const boundingBox = this.sceneManager.getSceneBoundingBox();
    if (boundingBox.isEmpty()) return 0;

    const target = boundingBox.getCenter(new THREE.Vector3());
    const boxSize = boundingBox.getSize(this.tempBoxSize);
    const distance = Math.max(boxSize.length(), 100);

    // 1. Calcula la nueva posición de la cámara
    if (axisName) {
        const newPosition = new THREE.Vector3();
        switch (axisName) {
            case 'axis-x': newPosition.set(distance, 0, 0); break;
            case 'axis-x-neg': newPosition.set(-distance, 0, 0); break;
            case 'axis-y': newPosition.set(0, distance, 0.0001); break; // Pequeño offset para evitar problemas de "up" vector
            case 'axis-y-neg': newPosition.set(0, -distance, 0.0001); break;
            case 'axis-z': newPosition.set(0, 0, distance); break;
            case 'axis-z-neg': newPosition.set(0, 0, -distance); break;
            default: return 0;
        }
        this.orthoCamera.position.copy(target).add(newPosition);
    } else if (state) {
        this.orthoCamera.position.copy(state.position);
    }
    
    this.orthoCamera.lookAt(target);
    this.lastOrthographicState = { position: this.orthoCamera.position.clone(), target: target.clone() };

    // 2. Calcula el tamaño del frustum para que la escena quepa
    const aspect = this.sceneManager.canvas.clientWidth / this.sceneManager.canvas.clientHeight;
    let frustumWidth = Math.max(boxSize.x, 0.1);
    let frustumHeight = Math.max(boxSize.y, 0.1);
    const currentAxis = axisName || this._getAxisFromState(this.lastOrthographicState);
    
    // Ajusta qué dimensiones del BoundingBox corresponden al ancho/alto de la vista
    switch (currentAxis) {
        case 'axis-x': case 'axis-x-neg': frustumHeight = boxSize.y; frustumWidth = boxSize.z; break;
        case 'axis-y': case 'axis-y-neg': frustumHeight = boxSize.z; frustumWidth = boxSize.x; break;
        case 'axis-z': case 'axis-z-neg': default: frustumHeight = boxSize.y; frustumWidth = boxSize.x; break;
    }

    // Añade un pequeño padding y ajusta por el aspect ratio del canvas
    frustumWidth *= 1.1;
    frustumHeight *= 1.1;
    if (frustumWidth / aspect > frustumHeight) {
        frustumHeight = frustumWidth / aspect;
    } else {
        frustumWidth = frustumHeight * aspect;
    }

    // 3. Aplica la configuración a la cámara ortográfica
    this.orthoCamera.left = frustumWidth / -2;
    this.orthoCamera.right = frustumWidth / 2;
    this.orthoCamera.top = frustumHeight / 2;
    this.orthoCamera.bottom = frustumHeight / -2;
    this.orthoCamera.updateProjectionMatrix();

    // 4. Actualiza el estado global y los controles
    this.sceneManager.activeCamera = this.orthoCamera;
    this._updateDependentServices(this.orthoCamera);

    this.controlsManager.exitFlyMode();
    this.controlsManager.isFlyEnabled = false;
    controls.enabled = true;
    controls.enableRotate = false; // No se puede rotar en ortográfico
    controls.target.copy(target);
    controls.update();

    this.cameraMode$.next('orthographic');
    
    return this.orthoCamera.projectionMatrix.elements[0];
  }

  /**
   * Cambia explícitamente al modo de vista de perspectiva.
   * Restaura la última posición guardada o calcula una nueva posición segura si no hay estado previo.
   */
  public switchToPerspectiveView(): void {
    this.entityManager.resetAllGroupsBrightness();
    const controls = this.controlsManager.getControls();
    if (!controls) return;

    this.sceneManager.activeCamera = this.sceneManager.editorCamera;
    this._updateDependentServices(this.sceneManager.editorCamera);
    
    if (this.lastPerspectiveState) {
        // Restaura el estado guardado
        this.sceneManager.editorCamera.position.copy(this.lastPerspectiveState.position);
        controls.target.copy(this.lastPerspectiveState.target);
    } else if (this.lastOrthographicState) {
        // Calcula una nueva posición de perspectiva basada en la última vista ortográfica
        const target = this.lastOrthographicState.target.clone();
        const direction = new THREE.Vector3().copy(this.lastOrthographicState.position).sub(target).normalize();
        const sceneSize = this.sceneManager.getSceneBoundingBox().getSize(new THREE.Vector3()).length();
        const safeDistance = sceneSize > 0 ? sceneSize * 1.5 : 500000;
        this.sceneManager.editorCamera.position.copy(target).addScaledVector(direction, safeDistance);
        controls.target.copy(target);
    }
    
    this.controlsManager.isFlyEnabled = true;
    controls.enableRotate = true;
    controls.update();
    this.cameraMode$.next('perspective');
  }

  // ====================================================================
  // API PÚBLICA - INTERACCIÓN CON LA ESCENA
  // ====================================================================

  /**
   * Encuadra todos los objetos visibles de la escena en la vista de la cámara activa.
   */
  public frameScene(): void {
    const controls = this.controlsManager.getControls();
    const camera = this.sceneManager.activeCamera;
    if (!controls) return;

    const box = this.sceneManager.getSceneBoundingBox();
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());

    if (this.cameraMode$.getValue() === 'perspective' && camera instanceof THREE.PerspectiveCamera) {
      const sphere = box.getBoundingSphere(this.tempSphere);
      const radius = sphere.radius;
      
      const fov = camera.fov * (Math.PI / 180);
      const distance = (radius / Math.sin(fov / 2)) * 1.2; // 1.2 para un poco de margen
      
      const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
      if (direction.lengthSq() === 0) direction.set(0, 0, 1); // Evitar dirección nula

      camera.position.copy(center).addScaledVector(direction, distance);

    } else {
      // En modo ortográfico, simplemente recalcula la vista para el eje actual
      const currentAxis = this._getAxisFromState(this.lastOrthographicState);
      this.setCameraView(currentAxis);
      return;
    }
    
    controls.target.copy(center);
    controls.update();
  }
  
  /**
   * Inicia una animación para centrar la vista en un objeto específico por su UUID.
   * @param uuid - El identificador único del objeto a enfocar.
   */
  public focusOnObject(uuid: string): void {
    if (this.isCameraAnimating) return; // Evita iniciar una nueva animación si ya hay una en curso
    
    // Busca el objeto real. En caso de ser una instancia, `getObjectByUuid` devolverá el proxy de selección si está activo.
    const object = this.entityManager.getObjectByUuid(uuid) ?? this.sceneManager.scene.getObjectByName('SelectionProxy');

    if (!object) {
      console.warn(`[CameraManager] No se pudo encontrar el objeto con UUID: ${uuid} para enfocar.`);
      return;
    }

    const cameraMode = this.cameraMode$.getValue();
    cameraMode === 'perspective' ? this._focusOnObject3D(object) : this._focusOnObject2D(object);
  }

  // ====================================================================
  // LÓGICA DE ANIMACIÓN
  // ====================================================================
  
  /** @internal Inicia la animación de enfoque para una cámara de perspectiva. */
  private _focusOnObject3D(object: THREE.Object3D): void {
    const controls = this.controlsManager.getControls();
    const camera = this.sceneManager.activeCamera;
    
    this.tempBox.setFromObject(object, true);
    if (this.tempBox.isEmpty()) this.tempBox.setFromCenterAndSize(object.position, new THREE.Vector3(1, 1, 1));
    
    const targetPoint = this.tempBox.getCenter(new THREE.Vector3());
    const objectSize = this.tempBox.getSize(new THREE.Vector3()).length();
    const distance = Math.max(objectSize * 2.5, 10); // Distancia de cámara basada en tamaño del objeto
    
    // Mantiene la dirección actual de la cámara
    const cameraDirection = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    const finalCamPos = new THREE.Vector3().copy(targetPoint).addScaledVector(cameraDirection, distance);
    
    this._startAnimation(
        { position: camera.position.clone(), target: controls.target.clone() },
        { position: finalCamPos, target: targetPoint }
    );
  }
  
  /** @internal Inicia la animación de enfoque para una cámara ortográfica (zoom y paneo). */
  private _focusOnObject2D(object: THREE.Object3D): void {
    const camera = this.sceneManager.activeCamera as THREE.OrthographicCamera;
    const controls = this.controlsManager.getControls();
    if (!camera.isOrthographicCamera) return;

    this.tempBox.setFromObject(object, true);
    if (this.tempBox.isEmpty()) this.tempBox.setFromCenterAndSize(object.position, new THREE.Vector3(1, 1, 1));
    
    const objectCenter = this.tempBox.getCenter(new THREE.Vector3());
    const objectSize = this.tempBox.getSize(this.tempBoxSize);
    
    // Mueve la cámara para que esté alineada con el centro del objeto, manteniendo la distancia
    const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
    const distanceToTarget = camera.position.distanceTo(controls.target);
    const finalCamPos = new THREE.Vector3().copy(objectCenter).addScaledVector(cameraDirection.negate(), distanceToTarget);
    
    // Calcula el nuevo nivel de zoom (tamaño del frustum) para que el objeto quepa con un padding
    const aspect = (camera.right - camera.left) / (camera.top - camera.bottom);
    const padding = 1.5;
    let requiredWidth = 0, requiredHeight = 0;

    if (Math.abs(cameraDirection.z) > 0.9) { requiredWidth = objectSize.x; requiredHeight = objectSize.y; }
    else if (Math.abs(cameraDirection.x) > 0.9) { requiredWidth = objectSize.z; requiredHeight = objectSize.y; }
    else { requiredWidth = objectSize.x; requiredHeight = objectSize.z; }

    requiredWidth *= padding;
    requiredHeight *= padding;
    if (requiredWidth / aspect > requiredHeight) requiredHeight = requiredWidth / aspect;
    else requiredWidth = requiredHeight * aspect;

    this._startAnimation(
        { position: camera.position.clone(), target: controls.target.clone(), left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom },
        { position: finalCamPos, target: objectCenter, left: -requiredWidth / 2, right: requiredWidth / 2, top: requiredHeight / 2, bottom: -requiredHeight / 2 }
    );
  }

  /** @internal Método genérico para configurar e iniciar una animación de cámara. */
  private _startAnimation(initialState: AnimationState2D | AnimationState3D, targetState: AnimationState2D | AnimationState3D) {
    this.isCameraAnimating = true;
    this.cameraAnimationStartTime = this.clock.getElapsedTime();
    this.cameraInitialState = initialState;
    this.cameraAnimationTarget = targetState;

    this.controlsManager.getControls().enabled = false;
    this.controlsManager.exitFlyMode();
  }

  /** @internal Procesa un frame de la animación de cámara, interpolando valores. */
  private _updateCameraAnimation(): void {
    if (!this.isCameraAnimating || !this.cameraAnimationTarget || !this.cameraInitialState || this.cameraAnimationStartTime === null) {
      return;
    }

    const elapsedTime = this.clock.getElapsedTime() - this.cameraAnimationStartTime;
    const progress = Math.min(elapsedTime / (this.cameraAnimationDuration / 1000), 1);
    // Fórmula de easing "ease-in-out-cubic" para una transición suave
    const alpha = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    const camera = this.sceneManager.activeCamera;
    const controls = this.controlsManager.getControls();

    // Interpola posición y target
    camera.position.lerpVectors(this.cameraInitialState.position, this.cameraAnimationTarget.position, alpha);
    controls.target.lerpVectors(this.cameraInitialState.target, this.cameraAnimationTarget.target, alpha);

    // Si es una cámara ortográfica, interpola también los límites del frustum (zoom)
    if ('left' in this.cameraInitialState && 'left' in this.cameraAnimationTarget && camera instanceof THREE.OrthographicCamera) {
        camera.left = THREE.MathUtils.lerp(this.cameraInitialState.left, this.cameraAnimationTarget.left, alpha);
        camera.right = THREE.MathUtils.lerp(this.cameraInitialState.right, this.cameraAnimationTarget.right, alpha);
        camera.top = THREE.MathUtils.lerp(this.cameraInitialState.top, this.cameraAnimationTarget.top, alpha);
        camera.bottom = THREE.MathUtils.lerp(this.cameraInitialState.bottom, this.cameraAnimationTarget.bottom, alpha);
        camera.updateProjectionMatrix();
    }
    
    controls.update();

    // Finaliza la animación
    if (progress >= 1) {
      camera.position.copy(this.cameraAnimationTarget.position);
      controls.target.copy(this.cameraAnimationTarget.target);
      if ('left' in this.cameraAnimationTarget && camera instanceof THREE.OrthographicCamera) {
        camera.left = this.cameraAnimationTarget.left; camera.right = this.cameraAnimationTarget.right;
        camera.top = this.cameraAnimationTarget.top; camera.bottom = this.cameraAnimationTarget.bottom;
        camera.updateProjectionMatrix();
      }
      
      // Habilita los controles de nuevo, excepto en modo "fly"
      controls.enabled = this.cameraMode$.getValue() === 'orthographic' || this.activeCameraType !== 'editor';
      controls.update();
      
      this.isCameraAnimating = false;
      this.cameraAnimationTarget = null;
      this.cameraInitialState = null;
      this.cameraAnimationStartTime = null;
    }
  }

  // ====================================================================
  // HELPERS PRIVADOS
  // ====================================================================
  
  /** @internal Determina el eje principal de la vista ortográfica basándose en la dirección de la cámara. */
  private _getAxisFromState(state: { position: THREE.Vector3, target: THREE.Vector3 } | null): string {
    if (!state) return 'axis-y-neg'; // Valor por defecto seguro
    const dir = new THREE.Vector3().copy(state.position).sub(state.target).normalize();
    if (Math.abs(dir.x) > 0.9) return dir.x > 0 ? 'axis-x' : 'axis-x-neg';
    if (Math.abs(dir.y) > 0.9) return dir.y > 0 ? 'axis-y' : 'axis-y-neg';
    return dir.z > 0 ? 'axis-z' : 'axis-z-neg';
  }

  /**
   * @internal Centraliza la actualización de todos los servicios que dependen de la cámara activa.
   * @param newActiveCamera - La cámara que ahora está activa.
   */
  private _updateDependentServices(newActiveCamera: THREE.Camera): void {
    const controls = this.controlsManager.getControls();

    // Actualiza la cámara en los controles, el compositor de post-procesado y todos los managers de interacción.
    this.controlsManager.setCamera(newActiveCamera as THREE.PerspectiveCamera | THREE.OrthographicCamera);
    (this.sceneManager.composer.passes[0] as RenderPass).camera = newActiveCamera;
    this.selectionManager.setCamera(newActiveCamera);
    this.interactionHelperManager.setCamera(newActiveCamera);
    this.dragInteractionManager.setCamera(newActiveCamera);
    
    // Forzar actualización de controles para reflejar los cambios inmediatamente
    controls.update(); 
  }
}