// controls-manager.service.ts
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
  private focusPivot!: THREE.Object3D;

  private isOrbitEnabled = false;
  private isFlyEnabled = false;
  private isTouchDevice = false;

  private currentToolMode: ToolMode = 'select';
  private transformEndSubject = new Subject<void>();
  public onTransformEnd$ = this.transformEndSubject.asObservable();

  private velocity = new THREE.Vector3();
  private readonly MOVEMENT_SPEED = 8.0;
  private readonly BOOST_MULTIPLIER = 2.5;
  private readonly DAMPING_FACTOR = 0.88;
  
  // --- CAMBIO CLAVE 2: Zoom más rápido y sensible ---
  private readonly DOLLY_SPEED = 0.8; // Aumentado para un zoom más ágil

  constructor() {}

  public init(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    scene: THREE.Scene,
    focusPivot: THREE.Object3D
  ): void {
    this.camera = camera;
    this.domElement = domElement;
    this.focusPivot = focusPivot;
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    this.createOrbitControls(camera, domElement);
    this.createTransformControls(camera, domElement);
    this.addEventListeners();

    this.orbitControls.target.copy(this.focusPivot.position);
    this.orbitControls.update();
  }

  public ngOnDestroy = () => {
    if (this.domElement && !this.isTouchDevice) {
      this.domElement.removeEventListener('wheel', this.onDocumentMouseWheel);
    }
    if (this.orbitControls) {
      this.orbitControls.removeEventListener('change', this.syncPivotToControlsTarget);
      this.orbitControls.dispose();
    }
    if (this.transformControls) this.transformControls.dispose();
  };

  private createOrbitControls(camera: THREE.Camera, domElement: HTMLElement): void {
    this.orbitControls = new OrbitControls(camera, domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.screenSpacePanning = true;

    if (this.isTouchDevice) {
      this.orbitControls.enableZoom = true;
      this.orbitControls.zoomSpeed = 0.7;
      this.orbitControls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    } else {
      this.orbitControls.enableZoom = false; // El zoom se controla manualmente con la rueda del ratón
      this.orbitControls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    }
  }

  private createTransformControls(camera: THREE.PerspectiveCamera, domElement: HTMLElement): void {
    this.transformControls = new TransformControls(camera, domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value;
      if (!this.isTouchDevice) {
        this.isFlyEnabled = !event.value;
      }
    });
    this.transformControls.addEventListener('objectChange', () => this.transformEndSubject.next());
    this.transformControls.enabled = false;
  }

  public enableNavigation(): void {
    this.isOrbitEnabled = true;
    if (!this.isTouchDevice) this.isFlyEnabled = true;
    this.orbitControls.enabled = true;
  }

  public disableNavigation(): void {
    this.isOrbitEnabled = false;
    this.isFlyEnabled = false;
    this.orbitControls.enabled = false;
    this.velocity.set(0, 0, 0);
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
    if (this.isFlyEnabled) {
      moved = this.handleKeyboardFly(delta, keyMap);
    }
    if (this.isOrbitEnabled) {
      // El método update() de OrbitControls devuelve true si la cámara cambió
      const orbitMoved = this.orbitControls.update();
      if (orbitMoved) {
        moved = true;
      }
    }
    return moved;
  };

  private handleKeyboardFly(delta: number, keyMap: Map<string, boolean>): boolean {
    const moveDirection = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.copy(forward).cross(this.camera.up).normalize();

    if (keyMap.get('w')) moveDirection.add(forward);
    if (keyMap.get('s')) moveDirection.sub(forward);
    if (keyMap.get('a')) moveDirection.sub(right);
    if (keyMap.get('d')) moveDirection.add(right);
    if (keyMap.get('e')) moveDirection.y += 1;
    if (keyMap.get('q')) moveDirection.y -= 1;

    const didMove = moveDirection.lengthSq() > 0;

    if (didMove) {
      moveDirection.normalize();
      const currentSpeed = this.MOVEMENT_SPEED * (keyMap.get('shift') ? this.BOOST_MULTIPLIER : 1);
      this.velocity.lerp(moveDirection.multiplyScalar(currentSpeed), delta * 10);
    }

    this.velocity.multiplyScalar(this.DAMPING_FACTOR);

    if (this.velocity.lengthSq() < 0.0001) {
      this.velocity.set(0, 0, 0);
      if (!didMove) return false;
    }

    const displacement = this.velocity.clone().multiplyScalar(delta);

    this.camera.position.add(displacement);
    this.orbitControls.target.add(displacement);
    this.focusPivot.position.copy(this.orbitControls.target);

    return true;
  }

  private addEventListeners = () => {
    if (!this.isTouchDevice) {
      this.domElement.addEventListener('wheel', this.onDocumentMouseWheel, { passive: false });
    }
    this.orbitControls.addEventListener('change', this.syncPivotToControlsTarget);
  };

  private syncPivotToControlsTarget = (): void => {
    if (this.focusPivot) {
      this.focusPivot.position.copy(this.orbitControls.target);
    }
  };

  private onDocumentMouseWheel = (event: WheelEvent) => {
    if (this.isOrbitEnabled) {
      event.preventDefault();
      this.dolly((event.deltaY < 0 ? 1 : -1) * this.DOLLY_SPEED);
    }
  };

  private dolly = (dollyDelta: number) => {
    const offset = new THREE.Vector3().copy(this.camera.position).sub(this.orbitControls.target);
    const dist = Math.max(0.1, offset.length() * (1 - dollyDelta));
    offset.setLength(dist);
    this.camera.position.copy(this.orbitControls.target).add(offset);
    this.orbitControls.update(); // Forzamos una actualización para que el damping no interfiera
  };

  public getCurrentToolMode = (): ToolMode => this.currentToolMode;
  public getControls = (): OrbitControls => this.orbitControls;
  public getGizmoObject = (): THREE.Object3D | undefined => this.transformControls.object;
}