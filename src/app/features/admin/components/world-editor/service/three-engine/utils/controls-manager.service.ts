// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/controls-manager.service.ts

import { Injectable, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { BehaviorSubject, Subject } from 'rxjs';
import { ToolMode } from '../../../toolbar/toolbar.component';

@Injectable({ providedIn: 'root' })
export class ControlsManagerService implements OnDestroy {

  // ====================================================================
  // SECTION: Properties & State
  // ====================================================================
  
  // Controles de Three.js
  private orbitControls!: OrbitControls;
  private transformControls!: TransformControls;

  // Referencias del entorno
  private camera!: THREE.PerspectiveCamera;
  private domElement!: HTMLElement;
  
  // Estado interno de los controles
  private isOrbitEnabled = false;
  public isFlyEnabled = false;
  private isTouchDevice = false;
  private isOrbiting = false;
  private isPanning = false;
  private isOrthoPanning = false;
  private currentToolMode: ToolMode = 'select';
  
  // Sujetos y Observables de RxJS para comunicar el estado
  private transformEndSubject = new Subject<void>();
  public onTransformEnd$ = this.transformEndSubject.asObservable();
  private isFlyModeActiveSubject = new BehaviorSubject<boolean>(false);
  public isFlyModeActive$ = this.isFlyModeActiveSubject.asObservable();

  // Constantes de configuración
  private readonly MOVEMENT_SPEED = 100000000.0;
  private readonly BOOST_MULTIPLIER = 100.0;
  private readonly LOOK_SPEED = 0.002;
  private readonly ORTHO_PAN_SENSITIVITY = 0.5;

  // Vectores temporales para optimización
  private tempVector = new THREE.Vector3();
  private panOffset = new THREE.Vector3();

  // ====================================================================
  // SECTION: Initialization & Teardown
  // ====================================================================
  
  /**
   * Inicializa el gestor de controles.
   * @param camera Cámara inicial.
   * @param domElement Elemento del DOM para los eventos del ratón.
   * @param scene La escena de Three.js.
   * @param focusPivot Objeto pivote para los controles de órbita.
   */
  public init(camera: THREE.PerspectiveCamera, domElement: HTMLElement, scene: THREE.Scene, focusPivot: THREE.Object3D): void {
    this.camera = camera;
    this.domElement = domElement;
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    this.createOrbitControls(camera, domElement);
    this.createTransformControls(camera, domElement);
    
    // ✅ CORRECCIÓN: Se elimina la siguiente línea.
    // TransformControls no se añade a la escena, funciona como una superposición.
    // scene.add(this.transformControls); 
    
    this.addEventListeners();
  }

  ngOnDestroy = () => {
    if (this.domElement && !this.isTouchDevice) {
      this.domElement.removeEventListener('mousedown', this.onMouseDown);
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('mouseup', this.onMouseUp);
      this.domElement.removeEventListener('wheel', this.onDocumentMouseWheel);
      this.domElement.removeEventListener('click', this.lockCursor);
      document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    }
    this.orbitControls?.dispose();
    this.transformControls?.dispose();
    this.unlockCursor();
  };

  private createOrbitControls(camera: THREE.Camera, domElement: HTMLElement): void {
    this.orbitControls = new OrbitControls(camera, domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.screenSpacePanning = true;
    this.orbitControls.minDistance = 1;
    this.orbitControls.maxDistance = Infinity; // Permite alejarse sin límite
    this.orbitControls.enabled = false;
  }

  private createTransformControls(camera: THREE.PerspectiveCamera, domElement: HTMLElement): void {
    this.transformControls = new TransformControls(camera, domElement);
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      const isDragging = event.value as boolean;
      // Desactiva la navegación de la cámara mientras se arrastra el gizmo
      this.orbitControls.enabled = !isDragging; 
      if (isDragging) {
        this.isOrbiting = false;
        this.unlockCursor();
      }
    });
    this.transformControls.addEventListener('objectChange', () => this.transformEndSubject.next());
    this.transformControls.enabled = false;
  }

  // ====================================================================
  // SECTION: Camera & Mode Configuration
  // ====================================================================

  /**
   * Cambia la cámara que los controles están manejando.
   * @param newCamera La nueva cámara a controlar.
   */
  public setCamera(newCamera: THREE.PerspectiveCamera): void {
    this.camera = newCamera;
    this.orbitControls.object = newCamera;
    this.transformControls.camera = newCamera;
  }
  
  /** Configura los controles para la cámara principal del editor (modo vuelo activado, órbita con ratón). */
  public configureForEditorCamera(): void {
    this.isFlyEnabled = true;
    this.orbitControls.enabled = false;
    this.orbitControls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.orbitControls.enablePan = true;
  }
  
  /** Configura los controles para la cámara secundaria (modo órbita, sin modo vuelo). */
  public configureForSecondaryCamera(): void {
    this.isFlyEnabled = false;
    this.exitFlyMode();
    this.orbitControls.enabled = true;
    this.orbitControls.enablePan = false;
    this.orbitControls.enableRotate = true;
    this.orbitControls.enableZoom = true;
    this.orbitControls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  }

  // ====================================================================
  // SECTION: Event Listeners & Handlers
  // ====================================================================

  private addEventListeners = () => {
    if (!this.isTouchDevice) {
      this.domElement.addEventListener('mousedown', this.onMouseDown);
      window.addEventListener('mousemove', this.onMouseMove);
      window.addEventListener('mouseup', this.onMouseUp);
      this.domElement.addEventListener('wheel', this.onDocumentMouseWheel, { passive: false });
      this.domElement.addEventListener('click', this.lockCursor);
      document.addEventListener('pointerlockchange', this.onPointerLockChange);
    }
  };

  private onMouseDown = (event: MouseEvent) => {
    // Si el gizmo está activo, no iniciar navegación de cámara
    if (this.transformControls.dragging) return;
    if (this.orbitControls.enabled && !this.isFlyEnabled) return;
    if (!this.isOrbitEnabled || document.pointerLockElement === this.domElement) return;
    
    const isOrthographicMode = !this.orbitControls.enableRotate;
    if (isOrthographicMode) {
      if (event.button === 2) { // Clic derecho
        this.isOrthoPanning = true;
        this.domElement.addEventListener('contextmenu', this.preventContextMenu, { once: true });
      }
      return;
    }
    
    if (event.button === 0) { this.isOrbiting = true; this.orbitControls.enabled = true; } 
    else if (event.button === 2) { this.isPanning = true; this.orbitControls.enabled = true; }
  };

  private onMouseMove = (event: MouseEvent) => {
    if (this.isOrthoPanning) {
      const orthoWidth = 2 / this.camera.projectionMatrix.elements[0];
      const orthoHeight = 2 / this.camera.projectionMatrix.elements[5];
      const panX = (event.movementX / this.domElement.clientWidth) * orthoWidth * this.ORTHO_PAN_SENSITIVITY;
      const panY = (event.movementY / this.domElement.clientHeight) * orthoHeight * this.ORTHO_PAN_SENSITIVITY;
      const right = this.tempVector.setFromMatrixColumn(this.camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
      this.panOffset.copy(right).multiplyScalar(-panX).add(up.multiplyScalar(panY));
      this.camera.position.add(this.panOffset);
      this.orbitControls.target.add(this.panOffset);
      this.orbitControls.update();
      return;
    }
    
    if (this.isFlyEnabled && !this.isOrbiting && !this.isPanning && !this.transformControls.dragging && document.pointerLockElement === this.domElement) {
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -event.movementX * this.LOOK_SPEED);
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -event.movementY * this.LOOK_SPEED);
      this.camera.quaternion.multiplyQuaternions(yaw, this.camera.quaternion.multiply(pitch));
    }
  };

  private onMouseUp = (event: MouseEvent) => {
    if (this.isOrthoPanning) this.isOrthoPanning = false;
    if ((this.isOrbiting || this.isPanning) && this.isFlyEnabled) {
      this.orbitControls.enabled = false;
      this.isOrbiting = false;
      this.isPanning = false;
    }
  };

  private onDocumentMouseWheel = (event: WheelEvent) => {
    if (!this.isOrbitEnabled) return;
    if (!this.orbitControls.enableRotate) {
      event.preventDefault();
      const zoomFactor = 1.1;
      const effectiveFactor = event.deltaY > 0 ? 1 / zoomFactor : zoomFactor;
      const scaleMatrix = new THREE.Matrix4().makeScale(effectiveFactor, effectiveFactor, 1);
      this.camera.projectionMatrix.premultiply(scaleMatrix);
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    }
  };
  
  private onPointerLockChange = () => {
    const isLocked = document.pointerLockElement === this.domElement;
    this.isFlyModeActiveSubject.next(isLocked);
    if (!isLocked) { 
      const newTarget = this.tempVector;
      this.camera.getWorldDirection(newTarget);
      newTarget.multiplyScalar(100).add(this.camera.position);
      this.orbitControls.target.copy(newTarget);
    }
  };

  private preventContextMenu = (event: MouseEvent) => event.preventDefault();

  // ====================================================================
  // SECTION: Core Update Loop
  // ====================================================================

  /**
   * Actualiza el estado de los controles en cada frame. Llamado por EngineService.
   * @param delta Tiempo transcurrido desde el último frame.
   * @param keyMap Mapa del estado actual de las teclas.
   * @returns `true` si la cámara se ha movido, `false` en caso contrario.
   */
  public update = (delta: number, keyMap: Map<string, boolean>): boolean => {
    let moved = false;
    if (this.isFlyEnabled && document.pointerLockElement === this.domElement) {
      moved = this.handleKeyboardFly(delta, keyMap);
    }
    if (this.orbitControls.enabled && this.orbitControls.update()) {
      moved = true;
    }
    return moved;
  };

  private handleKeyboardFly(delta: number, keyMap: Map<string, boolean>): boolean {
    if (document.pointerLockElement !== this.domElement) return false;
    const moveDirection = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    right.copy(forward).cross(this.camera.up);

    if (keyMap.get('w')) moveDirection.add(forward);
    if (keyMap.get('s')) moveDirection.sub(forward);
    if (keyMap.get('a')) moveDirection.sub(right);
    if (keyMap.get('d')) moveDirection.add(right);
    if (keyMap.get('e')) moveDirection.y += 1; // Subir
    if (keyMap.get('q')) moveDirection.y -= 1; // Bajar

    if (moveDirection.lengthSq() > 0) {
      moveDirection.normalize();
      const currentSpeed = this.MOVEMENT_SPEED * (keyMap.get('shift') ? this.BOOST_MULTIPLIER : 1.0);
      this.camera.position.addScaledVector(moveDirection, currentSpeed * delta);
      return true;
    }
    return false;
  }

  // ====================================================================
  // SECTION: Public API
  // ====================================================================
  
  public enableNavigation(): void { this.isOrbitEnabled = true; if (!this.isTouchDevice) this.isFlyEnabled = true; }
  public disableNavigation(): void { this.isOrbitEnabled = false; this.isFlyEnabled = false; this.unlockCursor(); }
  public exitFlyMode(): void { this.unlockCursor(); }
  
  public setTransformMode = (mode: ToolMode): void => {
    this.currentToolMode = mode;
    if (mode === 'rotate' || mode === 'scale' || mode === 'move') {
        // En Three.js, el modo para 'move' es 'translate'
        this.transformControls.setMode(mode === 'move' ? 'translate' : mode);
    }
  };
  
  public attach = (object: THREE.Object3D) => { this.transformControls.attach(object); this.transformControls.enabled = true; };
  public detach = () => { this.transformControls.detach(); this.transformControls.enabled = false; };
  
  private lockCursor = () => { if (this.isFlyEnabled && !this.isOrbiting && !this.isPanning && !this.transformControls.dragging) this.domElement.requestPointerLock(); };
  private unlockCursor = () => { if (document.pointerLockElement === this.domElement) document.exitPointerLock(); };
  
  public getCurrentToolMode = (): ToolMode => this.currentToolMode;
  public getControls = (): OrbitControls => this.orbitControls;
  public getGizmoObject = (): THREE.Object3D | undefined => this.transformControls.object;
}