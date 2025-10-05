import { Injectable, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { ToolMode } from '../../../toolbar/toolbar.component';

@Injectable({ providedIn: 'root' })
export class ControlsManagerService implements OnDestroy {

  public onTransformEnd$: Observable<void>;
  public isFlyModeActive$: Observable<boolean>;
  public isFlyEnabled = false;

  private orbitControls!: OrbitControls;
  private transformControls!: TransformControls;
  private camera!: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private domElement!: HTMLElement;
  
  private isOrbitEnabled = false;
  private isTouchDevice = false;
  private isOrbiting = false;
  private isPanning = false;
  private isOrthoPanning = false;
  private currentToolMode: ToolMode = 'select';
  
  private transformEndSubject = new Subject<void>();
  private isFlyModeActiveSubject = new BehaviorSubject<boolean>(false);

  private readonly MOVEMENT_SPEED = 200_000_000.0;
  private readonly BOOST_MULTIPLIER = 200.0;
  private readonly LOOK_SPEED = 0.002;

  private tempVector = new THREE.Vector3();
  private panOffset = new THREE.Vector3();

  constructor() {
    this.onTransformEnd$ = this.transformEndSubject.asObservable();
    this.isFlyModeActive$ = this.isFlyModeActiveSubject.asObservable();
  }

  public init(camera: THREE.PerspectiveCamera, domElement: HTMLElement, scene: THREE.Scene, focusPivot: THREE.Object3D): void {
    this.camera = camera;
    this.domElement = domElement;
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    this.createOrbitControls(camera, domElement);
    this.createTransformControls(camera, domElement);
        
    this.addEventListeners();
  }

  public ngOnDestroy = () => {
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
  
  public enableNavigation(): void { this.isOrbitEnabled = true; if (!this.isTouchDevice) this.isFlyEnabled = true; }
  public disableNavigation(): void { this.isOrbitEnabled = false; this.isFlyEnabled = false; this.unlockCursor(); }
  public exitFlyMode(): void { this.unlockCursor(); }

  public setCamera(newCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    this.camera = newCamera;
    this.orbitControls.object = newCamera;
    this.transformControls.camera = newCamera;
  }
  
  public configureForEditorCamera(): void {
    this.isFlyEnabled = true;
    this.orbitControls.enabled = false;
    this.orbitControls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.orbitControls.enablePan = true;
    this.orbitControls.enableRotate = true;
  }
  
  public configureForSecondaryCamera(): void {
    this.isFlyEnabled = false;
    this.exitFlyMode();
    this.orbitControls.enabled = true;
    this.orbitControls.enablePan = false;
    this.orbitControls.enableRotate = true;
    this.orbitControls.enableZoom = true;
    this.orbitControls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  }
  
  public setTransformMode = (mode: ToolMode): void => {
    this.currentToolMode = mode;
    if (mode === 'rotate' || mode === 'scale' || mode === 'move') {
        this.transformControls.setMode(mode === 'move' ? 'translate' : mode);
    }
  };
  
  public attach = (object: THREE.Object3D) => { this.transformControls.attach(object); this.transformControls.enabled = true; };
  public detach = () => { this.transformControls.detach(); this.transformControls.enabled = false; };
  
  public getCurrentToolMode = (): ToolMode => this.currentToolMode;
  public getControls = (): OrbitControls => this.orbitControls;
  public getGizmoObject = (): THREE.Object3D | undefined => this.transformControls.object;

  private createOrbitControls(camera: THREE.Camera, domElement: HTMLElement): void {
    this.orbitControls = new OrbitControls(camera, domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.screenSpacePanning = true;
    this.orbitControls.minDistance = 1;
    this.orbitControls.maxDistance = Infinity;
    this.orbitControls.enabled = false;
  }

  private createTransformControls(camera: THREE.Camera, domElement: HTMLElement): void {
    this.transformControls = new TransformControls(camera, domElement);
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      const isDragging = event.value as boolean;
      this.orbitControls.enabled = !isDragging; 
      if (isDragging) {
        this.isOrbiting = false;
        this.unlockCursor();
      }
    });
    this.transformControls.addEventListener('objectChange', () => this.transformEndSubject.next());
    this.transformControls.enabled = false;
  }
  
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
    if (this.transformControls.dragging) return;
    if (this.orbitControls.enabled && !this.isFlyEnabled) return;
    if (!this.isOrbitEnabled || document.pointerLockElement === this.domElement) return;
    
    const isOrthographicMode = this.camera.type === 'OrthographicCamera';
    if (isOrthographicMode) {
      if (event.button === 2) {
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
      const orthoCam = this.camera as THREE.OrthographicCamera;
      const visibleWidth = orthoCam.right - orthoCam.left;
      const visibleHeight = orthoCam.top - orthoCam.bottom;
      const deltaX = event.movementX / this.domElement.clientWidth;
      const deltaY = event.movementY / this.domElement.clientHeight;
      const panX = deltaX * visibleWidth;
      const panY = deltaY * visibleHeight;
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
  
  private onMouseUp = () => {
    if (this.isOrthoPanning) this.isOrthoPanning = false;
    if ((this.isOrbiting || this.isPanning) && this.isFlyEnabled) {
      this.orbitControls.enabled = false;
      this.isOrbiting = false;
      this.isPanning = false;
    }
  };
  
  private onDocumentMouseWheel = (event: WheelEvent) => {
    if (!this.isOrbitEnabled) return;
    if (this.camera.type === 'OrthographicCamera') {
      event.preventDefault();
      const orthoCam = this.camera as THREE.OrthographicCamera;
      const zoomFactor = 1.1;
      const zoomAmount = event.deltaY > 0 ? zoomFactor : 1 / zoomFactor;
  
      orthoCam.left *= zoomAmount;
      orthoCam.right *= zoomAmount;
      orthoCam.top *= zoomAmount;
      orthoCam.bottom *= zoomAmount;
      orthoCam.updateProjectionMatrix();
    }
  };
  
  private onPointerLockChange = () => {
    const isLocked = document.pointerLockElement === this.domElement;
    this.isFlyModeActiveSubject.next(isLocked);
    
    if (!isLocked) {
      const oldDistance = this.camera.position.distanceTo(this.orbitControls.target);
      const newTarget = this.tempVector;
      this.camera.getWorldDirection(newTarget);
      newTarget.multiplyScalar(oldDistance > 1 ? oldDistance : 1000);
      newTarget.add(this.camera.position);
      this.orbitControls.target.copy(newTarget);
    }
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
    if (keyMap.get('e')) moveDirection.y += 1;
    if (keyMap.get('q')) moveDirection.y -= 1;

    if (moveDirection.lengthSq() > 0) {
      moveDirection.normalize();
      const currentSpeed = this.MOVEMENT_SPEED * (keyMap.get('shift') ? this.BOOST_MULTIPLIER : 1.0);
      this.camera.position.addScaledVector(moveDirection, currentSpeed * delta);
      return true;
    }
    return false;
  }
  
  private lockCursor = () => {
    if (this.isFlyEnabled && !this.isOrbiting && !this.isPanning && !this.transformControls.dragging) {
      this.domElement.requestPointerLock();
    }
  };

  private unlockCursor = () => {
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  };
  
  private preventContextMenu = (event: MouseEvent) => event.preventDefault();
}