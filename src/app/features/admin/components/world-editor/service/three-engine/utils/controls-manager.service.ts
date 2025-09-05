// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/controls-manager.service.ts

import { Injectable, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { BehaviorSubject, Subject } from 'rxjs';
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
  public isFlyEnabled = false;

  private isTouchDevice = false;
  private isOrbiting = false;
  private isPanning = false;
  private lookSpeed = 0.002;

  private currentToolMode: ToolMode = 'select';
  private transformEndSubject = new Subject<void>();
  public onTransformEnd$ = this.transformEndSubject.asObservable();

  private isFlyModeActiveSubject = new BehaviorSubject<boolean>(false);
  public isFlyModeActive$ = this.isFlyModeActiveSubject.asObservable();

  private readonly MOVEMENT_SPEED = 100000000.0;
  private readonly BOOST_MULTIPLIER = 125.0;

  private tempVector = new THREE.Vector3();

  constructor() { }

  public init(camera: THREE.PerspectiveCamera, domElement: HTMLElement, scene: THREE.Scene, focusPivot: THREE.Object3D): void {
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene;
    this.focusPivot = focusPivot;
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    this.createOrbitControls(camera, domElement);
    this.createTransformControls(camera, domElement);
    this.createFocusHelper();
    this.addEventListeners();
  }

  private onDocumentMouseWheel = (event: WheelEvent) => {
    if (!this.isOrbitEnabled) return;

    const isOrthographicMode = !this.orbitControls.enableRotate;

    if (isOrthographicMode) {
      // --- LÓGICA DE ZOOM ORTOGRÁFICO (Estilo Blender) ---
      const zoomFactor = 1.1;
      const effectiveFactor = event.deltaY > 0 ? 1 / zoomFactor : zoomFactor;
      const scaleMatrix = new THREE.Matrix4().makeScale(effectiveFactor, effectiveFactor, 1);
      
      this.camera.projectionMatrix.premultiply(scaleMatrix);
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    }
  };

  private onMouseDown = (event: MouseEvent) => {
    if (!this.isOrbitEnabled || this.transformControls.dragging || document.pointerLockElement === this.domElement) return;

    const isOrthographicMode = !this.orbitControls.enableRotate;

    if (event.button === 0) { // Clic Izquierdo
      if (isOrthographicMode) return;
      this.isOrbiting = true;
      this.orbitControls.enabled = true;

    } else if (event.button === 2) { // Clic Derecho
      this.isPanning = true;
      this.orbitControls.enabled = true;
    }
  };

  public exitFlyMode(): void { this.unlockCursor(); }
  public enableNavigation(): void { this.isOrbitEnabled = true; if (!this.isTouchDevice) this.isFlyEnabled = true; this.focusHelper.visible = document.pointerLockElement !== this.domElement; }
  private onMouseUp = (event: MouseEvent) => { if (this.isOrbiting || this.isPanning) { this.orbitControls.enabled = false; this.isOrbiting = false; this.isPanning = false; } };
  
  public ngOnDestroy = () => {
    if (this.domElement && !this.isTouchDevice) {
      this.domElement.removeEventListener('mousedown', this.onMouseDown);
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('mouseup', this.onMouseUp);
      this.domElement.removeEventListener('wheel', this.onDocumentMouseWheel);
      this.domElement.removeEventListener('click', this.lockCursor);
      document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    }
    if (this.orbitControls) this.orbitControls.dispose();
    if (this.transformControls) this.transformControls.dispose();
    if (this.focusHelper) {
      this.scene.remove(this.focusHelper);
      this.focusHelper.material.map?.dispose();
      this.focusHelper.material.dispose();
    }
    this.unlockCursor();
  };
  
  private createOrbitControls(camera: THREE.Camera, domElement: HTMLElement): void {
    this.orbitControls = new OrbitControls(camera, domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.screenSpacePanning = true;
    this.orbitControls.minDistance = 0;
    this.orbitControls.maxDistance = Infinity;
    this.orbitControls.enableZoom = true;
    this.orbitControls.enabled = false;
  }
  
  private createFocusHelper(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.strokeStyle = 'rgba(255, 255, 0, 0.8)';
    context.lineWidth = 6;
    context.beginPath(); context.moveTo(32, 10); context.lineTo(32, 26); context.stroke();
    context.beginPath(); context.moveTo(32, 38); context.lineTo(32, 54); context.stroke();
    context.beginPath(); context.moveTo(10, 32); context.lineTo(26, 32); context.stroke();
    context.beginPath(); context.moveTo(38, 32); context.lineTo(54, 32); context.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false, });
    this.focusHelper = new THREE.Sprite(material);
    this.focusHelper.name = "FocusHelper";
    this.focusHelper.scale.set(0.03, 0.03, 1);
    this.focusHelper.renderOrder = 999;
    this.scene.add(this.focusHelper);
  }

  private createTransformControls(camera: THREE.PerspectiveCamera, domElement: HTMLElement): void {
    this.transformControls = new TransformControls(camera, domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.isFlyEnabled = !event.value;
      if (event.value) {
        this.orbitControls.enabled = false;
        this.isOrbiting = false;
        this.unlockCursor();
      } else {
        this.lockCursor();
      }
    });
    this.transformControls.addEventListener('objectChange', () => this.transformEndSubject.next());
    this.transformControls.enabled = false;
    // ✅ CORRECCIÓN FINAL: Esta línea se ha eliminado para evitar el error de compilación.
    // this.scene.add(this.transformControls); 
  }
  
  public disableNavigation(): void { this.isOrbitEnabled = false; this.isFlyEnabled = false; this.focusHelper.visible = false; this.unlockCursor(); }
  public setTransformMode = (mode: ToolMode): void => { this.currentToolMode = mode; if (mode === 'rotate' || mode === 'scale') { this.transformControls.setMode(mode); } };
  public attach = (object: THREE.Object3D) => { this.transformControls.attach(object); this.transformControls.enabled = true; };
  public detach = () => { this.transformControls.detach(); this.transformControls.enabled = false; };
  
  public update = (delta: number, keyMap: Map<string, boolean>): boolean => {
    let moved = false;
    if (this.isFlyEnabled) {
      moved = this.handleKeyboardFly(delta, keyMap);
    }
    if (this.isOrbiting || this.isPanning) {
      if (this.orbitControls.update()) {
        moved = true;
      }
    }
    this.updateFocusHelperPosition();
    return moved;
  };
  
  private updateFocusHelperPosition(): void {
    const direction = this.tempVector;
    this.camera.getWorldDirection(direction);
    const distance = Math.max(20, this.camera.position.length() / 100);
    this.focusHelper.position.copy(this.camera.position).add(direction.multiplyScalar(distance));
  }
  
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
      const moveDistance = currentSpeed * delta;
      this.camera.position.addScaledVector(moveDirection, moveDistance);
      return true;
    }
    return false;
  }
  
  private addEventListeners = () => {
    if (!this.isTouchDevice) {
      this.domElement.addEventListener('mousedown', this.onMouseDown);
      window.addEventListener('mousemove', this.onMouseMove);
      window.addEventListener('mouseup', this.onMouseUp);
      this.domElement.addEventListener('wheel', this.onDocumentMouseWheel);
      this.domElement.addEventListener('click', this.lockCursor);
      document.addEventListener('pointerlockchange', this.onPointerLockChange);
    }
  };
  
  private lockCursor = () => { if (this.isFlyEnabled && !this.isOrbiting && !this.isPanning && !this.transformControls.dragging) this.domElement.requestPointerLock(); };
  private unlockCursor = () => { if (document.pointerLockElement === this.domElement) document.exitPointerLock(); };
  
  private onPointerLockChange = () => {
    const isLocked = document.pointerLockElement === this.domElement;
    this.isFlyModeActiveSubject.next(isLocked);
    this.focusHelper.visible = !isLocked;
    if (!isLocked) {
      const newTarget = this.tempVector;
      this.camera.getWorldDirection(newTarget);
      newTarget.multiplyScalar(100).add(this.camera.position);
      this.orbitControls.target.copy(newTarget);
    }
  };
  
  private onMouseMove = (event: MouseEvent) => {
    if (this.isFlyEnabled && !this.isOrbiting && !this.isPanning && !this.transformControls.dragging && document.pointerLockElement === this.domElement) {
      const deltaX = event.movementX || 0;
      const deltaY = event.movementY || 0;
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -deltaX * this.lookSpeed);
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -deltaY * this.lookSpeed);
      this.camera.quaternion.multiplyQuaternions(yaw, this.camera.quaternion.multiply(pitch));
    }
  };

  public getCurrentToolMode = (): ToolMode => this.currentToolMode;
  public getControls = (): OrbitControls => this.orbitControls;
  public getGizmoObject = (): THREE.Object3D | undefined => this.transformControls.object;
}