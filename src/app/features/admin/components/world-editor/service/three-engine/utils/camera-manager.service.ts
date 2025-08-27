import { Injectable, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Subject } from 'rxjs';
import { ToolMode } from '../../../toolbar/toolbar.component';

@Injectable({ providedIn: 'root' })
export class ControlsManagerService implements OnDestroy {
  private orbitControls!: OrbitControls;
  private transformControls!: TransformControls;
  private camera!: THREE.PerspectiveCamera;
  private domElement!: HTMLElement;
  private scene!: THREE.Scene;
  private focusPivot!: THREE.Object3D;
  private focusHelper!: THREE.Sprite;

  private isOrbitEnabled = false;
  private isFlyEnabled = false;
  private isTouchDevice = false;

  // --- MODIFICACIÓN CLAVE: Gestión de estado para el modo híbrido ---
  private isOrbiting = false; // ¿Está el usuario orbitando activamente (clic izquierdo)?
  private isPanning = false; // ¿Está el usuario paneando (clic derecho)?
  private lookSpeed = 0.002; // Sensibilidad de la vista en modo vuelo
  private lastMousePosition = { x: 0, y: 0 };


  private currentToolMode: ToolMode = 'select';
  private transformEndSubject = new Subject<void>();
  public onTransformEnd$ = this.transformEndSubject.asObservable();

  private velocity = new THREE.Vector3();
  private readonly MOVEMENT_SPEED = 40.0;
  private readonly BOOST_MULTIPLIER = 5.0;
  private readonly DAMPING_FACTOR = 0.90;

  constructor() { }

  public init(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    scene: THREE.Scene,
    focusPivot: THREE.Object3D
  ): void {
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene; // Guardamos la referencia a la escena
    this.focusPivot = focusPivot;
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    this.createOrbitControls(camera, domElement);
    this.createTransformControls(camera, domElement);
    this.createFocusHelper();
    this.addEventListeners();

    this.orbitControls.target.copy(this.focusPivot.position);
    this.orbitControls.update();
  }

  public ngOnDestroy = () => {
    // Limpieza completa de todos los listeners
    if (this.domElement && !this.isTouchDevice) {
      this.domElement.removeEventListener('mousedown', this.onMouseDown);
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('mouseup', this.onMouseUp);
      this.domElement.removeEventListener('wheel', this.onDocumentMouseWheel);
    }
    if (this.orbitControls) this.orbitControls.dispose();
    if (this.transformControls) this.transformControls.dispose();

    if (this.focusHelper) {
      this.scene.remove(this.focusHelper);
      this.focusHelper.material.map?.dispose();
      this.focusHelper.material.dispose();
    }
  };

  private createOrbitControls(camera: THREE.Camera, domElement: HTMLElement): void {
    this.orbitControls = new OrbitControls(camera, domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.screenSpacePanning = true;
    this.orbitControls.minDistance = 0;
    this.orbitControls.maxDistance = Infinity;
    this.orbitControls.enableZoom = false; // Desactivamos el zoom nativo

    // Desactivamos los controles por defecto, los manejaremos manualmente
    this.orbitControls.enabled = false;
  }

  private createFocusHelper(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.strokeStyle = '#FFFF00';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(32, 12); context.lineTo(32, 52);
    context.moveTo(12, 32); context.lineTo(52, 32);
    context.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: false,
    });

    this.focusHelper = new THREE.Sprite(material);
    this.focusHelper.name = "FocusHelper";
    this.focusHelper.scale.set(0.04, 0.04, 1);
    this.focusHelper.renderOrder = 999; // Asegura que se renderice encima de todo
    this.scene.add(this.focusHelper); // Lo añadimos a la escena principal
  }

  private createTransformControls(camera: THREE.PerspectiveCamera, domElement: HTMLElement): void {
    this.transformControls = new TransformControls(camera, domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.isFlyEnabled = !event.value;
      if (event.value) { // Si empieza el arrastre del gizmo, desactivamos todo lo demás
          this.orbitControls.enabled = false;
          this.isOrbiting = false;
      }
    });
    this.transformControls.addEventListener('objectChange', () => this.transformEndSubject.next());
    this.transformControls.enabled = false;
  }

  public enableNavigation(): void {
    this.isOrbitEnabled = true;
    if (!this.isTouchDevice) this.isFlyEnabled = true;
    this.focusHelper.visible = true;
  }

  public disableNavigation(): void {
    this.isOrbitEnabled = false;
    this.isFlyEnabled = false;
    this.focusHelper.visible = false;
  }

  public setTransformMode = (mode: ToolMode): void => {
    this.currentToolMode = mode;
    if (mode === 'rotate' || mode === 'scale') {
      this.transformControls.setMode(mode);
    }
  };

  public attach = (object: THREE.Object3D) => { this.transformControls.attach(object); this.transformControls.enabled = true; };
  public detach = () => { this.transformControls.detach(); this.transformControls.enabled = false; };

  public update = (delta: number, keyMap: Map<string, boolean>): boolean => {
    let moved = false;
    
    // 1. Actualizar movimiento por teclado (si está habilitado)
    if (this.isFlyEnabled) {
      moved = this.handleKeyboardFly(delta, keyMap);
    }

    // 2. Si estamos en modo órbita o paneo, dejamos que OrbitControls trabaje
    if (this.isOrbiting || this.isPanning) {
      if (this.orbitControls.update()) {
        moved = true;
      }
    }

    // 3. Siempre actualizamos la posición de la cruz
    this.updateFocusHelperPosition();

    return moved;
  };

  /** ¡NUEVO! Actualiza la posición del helper para que siempre esté en el centro de la vista */
  private updateFocusHelperPosition(): void {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    // Coloca la cruz a una distancia fija delante de la cámara
    const distance = 20;
    this.focusHelper.position.copy(this.camera.position).add(direction.multiplyScalar(distance));
  }

  private handleKeyboardFly(delta: number, keyMap: Map<string, boolean>): boolean {
    const moveDirection = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    this.camera.getWorldDirection(forward);
    right.copy(forward).cross(this.camera.up).normalize();

    if (keyMap.get('w')) moveDirection.add(forward);
    if (keyMap.get('s')) moveDirection.sub(forward);
    if (keyMap.get('a')) moveDirection.sub(right);
    if (keyMap.get('d')) moveDirection.add(right);
    if (keyMap.get('e')) moveDirection.y += 1;
    if (keyMap.get('q')) moveDirection.y -= 1;

    const didMove = moveDirection.lengthSq() > 0;
    if (!didMove && this.velocity.lengthSq() === 0) return false;

    if (didMove) {
      moveDirection.normalize();
      const currentSpeed = this.MOVEMENT_SPEED * (keyMap.get('shift') ? this.BOOST_MULTIPLIER : 1);
      this.velocity.lerp(moveDirection.multiplyScalar(currentSpeed), delta * 15);
    }

    this.velocity.multiplyScalar(this.DAMPING_FACTOR);
    if (this.velocity.lengthSq() < 0.0001) this.velocity.set(0, 0, 0);

    this.camera.position.add(this.velocity.clone().multiplyScalar(delta));
    return true;
  }

  private addEventListeners = () => {
    if (!this.isTouchDevice) {
      this.domElement.addEventListener('mousedown', this.onMouseDown);
      window.addEventListener('mousemove', this.onMouseMove);
      window.addEventListener('mouseup', this.onMouseUp);
      this.domElement.addEventListener('wheel', this.onDocumentMouseWheel);
    }
  };
  
  // --- LÓGICA DE RATÓN COMPLETAMENTE REFACTORIZADA ---

  private onMouseDown = (event: MouseEvent) => {
    if (!this.isOrbitEnabled || this.transformControls.dragging) return;
    
    // Clic Izquierdo: Iniciar modo ÓRBITA
    if (event.button === 0) {
      this.isOrbiting = true;
      // Establecemos el punto de enfoque (target) en la posición actual de la cruz
      this.orbitControls.target.copy(this.focusHelper.position);
      this.focusPivot.position.copy(this.focusHelper.position);
      this.orbitControls.enabled = true; // Activamos los controles para que procesen el movimiento
    }
    // Clic Derecho: Iniciar modo PANEO
    else if (event.button === 2) {
        this.isPanning = true;
        this.orbitControls.enabled = true;
    }
  };

  private onMouseMove = (event: MouseEvent) => {
    // Si no estamos orbitando ni paneando, controlamos la VISTA LIBRE
    if (this.isFlyEnabled && !this.isOrbiting && !this.isPanning && !this.transformControls.dragging) {
      const deltaX = event.movementX || 0;
      const deltaY = event.movementY || 0;

      // Rotación horizontal sobre el eje Y global
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -deltaX * this.lookSpeed);
      // Rotación vertical sobre el eje X local de la cámara
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -deltaY * this.lookSpeed);
      
      this.camera.quaternion.multiplyQuaternions(yaw, this.camera.quaternion.multiply(pitch));
    }
  };

  private onMouseUp = (event: MouseEvent) => {
    // Al soltar cualquier botón, desactivamos los OrbitControls y volvemos a modo Vuelo Libre
    this.orbitControls.enabled = false;
    this.isOrbiting = false;
    this.isPanning = false;
  };
  
  private onDocumentMouseWheel = (event: WheelEvent) => {
    if (!this.isFlyEnabled) return;
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const moveAmount = event.deltaY > 0 ? -2 : 2; // Cantidad fija de movimiento
    this.camera.position.add(direction.multiplyScalar(moveAmount));
  };
  
  public getCurrentToolMode = (): ToolMode => this.currentToolMode;
  public getControls = (): OrbitControls => this.orbitControls;
  public getGizmoObject = (): THREE.Object3D | undefined => this.transformControls.object;
}