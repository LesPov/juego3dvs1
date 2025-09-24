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

export type CameraType = 'editor' | 'secondary';
export type CameraMode = 'perspective' | 'orthographic';

interface AnimationState3D {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

interface AnimationState2D extends AnimationState3D {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

@Injectable({ providedIn: 'root' })
export class CameraManagerService {

  public cameraMode$ = new BehaviorSubject<CameraMode>('perspective');
  public activeCameraType: CameraType = 'editor';

  private orthoCamera!: THREE.OrthographicCamera;
  private lastPerspectiveState: { position: THREE.Vector3, target: THREE.Vector3 } | null = null;
  private lastOrthographicState: { position: THREE.Vector3, target: THREE.Vector3 } | null = null;
  private lastEditorTarget = new THREE.Vector3();

  private tempBox = new THREE.Box3();
  private tempBoxSize = new THREE.Vector3();
  private tempWorldPos = new THREE.Vector3();
  private tempQuaternion = new THREE.Quaternion();
  private tempSphere = new THREE.Sphere();

  private isCameraAnimating = false;
  private cameraAnimationTarget: AnimationState2D | AnimationState3D | null = null;
  private cameraInitialState: AnimationState2D | AnimationState3D | null = null;
  private cameraAnimationDuration = 1000;

  private travelSpeedMultiplier: number = 1.0;
  private animationProgress: number = 0;

  private isCameraOrbiting = false;
  private orbitTarget: THREE.Vector3 | null = null;
  private orbitStartTime = 0;
  private orbitInitialOffset = new THREE.Vector3();
  private clock = new THREE.Clock();

  private readonly BASE_TRAVEL_SPEED = 1000000000;
  private readonly ORBIT_DURATION = 4000;

  constructor(
    private sceneManager: SceneManagerService,
    private controlsManager: ControlsManagerService,
    private entityManager: EntityManagerService,
    private selectionManager: SelectionManagerService,
    private interactionHelperManager: InteractionHelperManagerService,
    private dragInteractionManager: DragInteractionManagerService,
  ) { }

  public initialize(): void {
    const aspect = this.sceneManager.canvas.clientWidth / this.sceneManager.canvas.clientHeight;
    this.orthoCamera = new THREE.OrthographicCamera(-1 * aspect, 1 * aspect, 1, -1, 0.1, 5e15);
    this.orthoCamera.name = 'Cámara Ortográfica';
  }

  public setTravelSpeedMultiplier(multiplier: number): void {
    this.travelSpeedMultiplier = Math.max(0, multiplier);
  }

  public update(delta: number): boolean {
    if (this.isCameraAnimating) {
      if (this.travelSpeedMultiplier > 0) {
        this._updateCameraAnimation(delta);
      }
    } else if (this.isCameraOrbiting) {
      this._updateCameraOrbit(delta);
    }
    return this.isCameraAnimating || this.isCameraOrbiting;
  }

  public toggleActiveCamera(currentSelectedObject?: THREE.Object3D): void {
    const editorHelper = this.sceneManager.editorCamera.userData['helper'];
    const secondaryHelper = this.sceneManager.secondaryCamera.userData['helper'];
    const controls = this.controlsManager.getControls();
    let newActiveCamera: THREE.Camera;
    if (this.activeCameraType === 'editor') {
      this.activeCameraType = 'secondary';
      newActiveCamera = this.sceneManager.secondaryCamera;
      this.lastEditorTarget.copy(controls.target);
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
      this.activeCameraType = 'editor';
      newActiveCamera = this.sceneManager.editorCamera;
      controls.target.copy(this.lastEditorTarget);
      if (editorHelper) editorHelper.visible = false;
      if (secondaryHelper) secondaryHelper.visible = true;
      this.controlsManager.configureForEditorCamera();
    }
    this.sceneManager.activeCamera = newActiveCamera as THREE.PerspectiveCamera;
    this._updateDependentServices(newActiveCamera);
    if(currentSelectedObject && currentSelectedObject.uuid === newActiveCamera.uuid) {
        this.controlsManager.attach(currentSelectedObject);
    }
  }

  public toggleCameraMode(): void {
    if (this.cameraMode$.getValue() === 'perspective') {
      const controls = this.controlsManager.getControls();
      this.lastPerspectiveState = {
        position: this.sceneManager.activeCamera.position.clone(),
        target: controls.target.clone()
      };
      this.setCameraView('axis-z');
    } else {
      this.switchToPerspectiveView();
    }
  }

  public setCameraView(axisName: string | null, state?: { position: THREE.Vector3, target: THREE.Vector3 }): number {
    const controls = this.controlsManager.getControls();
    if (!controls) return 0;
    if (this.cameraMode$.getValue() === 'perspective') {
        this.lastPerspectiveState = { position: this.sceneManager.editorCamera.position.clone(), target: controls.target.clone() };
    }
    const boundingBox = this.sceneManager.getSceneBoundingBox();
    if (boundingBox.isEmpty()) return 0;
    const target = boundingBox.getCenter(new THREE.Vector3());
    const boxSize = boundingBox.getSize(this.tempBoxSize);
    const distance = Math.max(boxSize.length(), 100);
    if (axisName) {
        const newPosition = new THREE.Vector3();
        switch (axisName) {
            case 'axis-x': newPosition.set(distance, 0, 0); break;
            case 'axis-x-neg': newPosition.set(-distance, 0, 0); break;
            case 'axis-y': newPosition.set(0, distance, 0.0001); break;
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
    const aspect = this.sceneManager.canvas.clientWidth / this.sceneManager.canvas.clientHeight;
    let frustumWidth = Math.max(boxSize.x, 0.1);
    let frustumHeight = Math.max(boxSize.y, 0.1);
    const currentAxis = axisName || this._getAxisFromState(this.lastOrthographicState);
    switch (currentAxis) {
        case 'axis-x': case 'axis-x-neg': frustumHeight = boxSize.y; frustumWidth = boxSize.z; break;
        case 'axis-y': case 'axis-y-neg': frustumHeight = boxSize.z; frustumWidth = boxSize.x; break;
        case 'axis-z': case 'axis-z-neg': default: frustumHeight = boxSize.y; frustumWidth = boxSize.x; break;
    }
    frustumWidth *= 1.1;
    frustumHeight *= 1.1;
    if (frustumWidth / aspect > frustumHeight) {
        frustumHeight = frustumWidth / aspect;
    } else {
        frustumWidth = frustumHeight * aspect;
    }
    this.orthoCamera.left = frustumWidth / -2;
    this.orthoCamera.right = frustumWidth / 2;
    this.orthoCamera.top = frustumHeight / 2;
    this.orthoCamera.bottom = frustumHeight / -2;
    this.orthoCamera.updateProjectionMatrix();
    this.sceneManager.activeCamera = this.orthoCamera;
    this._updateDependentServices(this.orthoCamera);
    this.controlsManager.exitFlyMode();
    this.controlsManager.isFlyEnabled = false;
    controls.enabled = true;
    controls.enableRotate = false;
    controls.target.copy(target);
    controls.update();
    this.cameraMode$.next('orthographic');
    return this.orthoCamera.projectionMatrix.elements[0];
  }

  public switchToPerspectiveView(): void {
    // ✨ LÓGICA RESTAURADA: Esta línea ahora funcionará porque el método existe en EntityManagerService.
    this.entityManager.resetAllGroupsBrightness();
    const controls = this.controlsManager.getControls();
    if (!controls) return;
    this.sceneManager.activeCamera = this.sceneManager.editorCamera;
    this._updateDependentServices(this.sceneManager.editorCamera);
    if (this.lastPerspectiveState) {
        this.sceneManager.editorCamera.position.copy(this.lastPerspectiveState.position);
        controls.target.copy(this.lastPerspectiveState.target);
    } else if (this.lastOrthographicState) {
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
      const distance = (radius / Math.sin(fov / 2)) * 1.2;
      const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
      if (direction.lengthSq() === 0) direction.set(0, 0, 1);
      camera.position.copy(center).addScaledVector(direction, distance);
    } else {
      const currentAxis = this._getAxisFromState(this.lastOrthographicState);
      this.setCameraView(currentAxis);
      return;
    }
    controls.target.copy(center);
    controls.update();
  }

  public focusOnObject(uuid: string): void {
    if (this.isCameraAnimating) this.isCameraAnimating = false;
    if (this.isCameraOrbiting) this.isCameraOrbiting = false;
    const object = this.entityManager.getObjectByUuid(uuid) ?? this.sceneManager.scene.getObjectByName('SelectionProxy');
    if (!object) {
      console.warn(`[CameraManager] No se pudo encontrar el objeto con UUID: ${uuid} para enfocar.`);
      return;
    }
    const cameraMode = this.cameraMode$.getValue();
    cameraMode === 'perspective' ? this._focusOnObject3D(object) : this._focusOnObject2D(object);
  }

  private _focusOnObject3D(object: THREE.Object3D): void {
    const controls = this.controlsManager.getControls();
    const camera = this.sceneManager.activeCamera;
    this.tempBox.setFromObject(object, true);
    if (this.tempBox.isEmpty()) this.tempBox.setFromCenterAndSize(object.position, new THREE.Vector3(1, 1, 1));
    const targetPoint = this.tempBox.getCenter(new THREE.Vector3());
    const objectSize = this.tempBox.getSize(new THREE.Vector3()).length();
    const distanceToObject = Math.max(objectSize * 2.5, 10);

    // ====================================================================
    // ✨ INICIO DE LA LÓGICA DE ENFOQUE MEJORADA ✨
    // ====================================================================
    // LÓGICA: En lugar de mantener la dirección de la cámara actual, calculamos la
    // dirección desde la posición actual de la cámara hacia el centro del nuevo objeto.
    // Esto asegura que la cámara "vuele" en línea recta hacia el objeto.
    const cameraDirection = new THREE.Vector3().subVectors(camera.position, targetPoint).normalize();
    // ====================================================================
    // ✨ FIN DE LA LÓGICA DE ENFOQUE MEJORADA ✨
    // ====================================================================

    if (cameraDirection.lengthSq() === 0) cameraDirection.set(0, 0.5, 1).normalize();
    const finalCamPos = new THREE.Vector3().copy(targetPoint).addScaledVector(cameraDirection, distanceToObject);
    const travelDistance = camera.position.distanceTo(finalCamPos);
    const duration = (travelDistance / this.BASE_TRAVEL_SPEED) * 1000;
    this._startAnimation({ position: camera.position.clone(), target: controls.target.clone() }, { position: finalCamPos, target: targetPoint }, duration);
  }

  private _focusOnObject2D(object: THREE.Object3D): void {
    const camera = this.sceneManager.activeCamera as THREE.OrthographicCamera;
    const controls = this.controlsManager.getControls();
    if (!camera.isOrthographicCamera) return;
    this.tempBox.setFromObject(object, true);
    if (this.tempBox.isEmpty()) this.tempBox.setFromCenterAndSize(object.position, new THREE.Vector3(1, 1, 1));
    const objectCenter = this.tempBox.getCenter(new THREE.Vector3());
    const objectSize = this.tempBox.getSize(this.tempBoxSize);
    const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
    const distanceToTarget = camera.position.distanceTo(controls.target);
    const finalCamPos = new THREE.Vector3().copy(objectCenter).addScaledVector(cameraDirection.negate(), distanceToTarget);
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
    const travelDistance = camera.position.distanceTo(finalCamPos);
    const duration = (travelDistance / this.BASE_TRAVEL_SPEED) * 1000;
    this._startAnimation({ position: camera.position.clone(), target: controls.target.clone(), left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom }, { position: finalCamPos, target: objectCenter, left: -requiredWidth / 2, right: requiredWidth / 2, top: requiredHeight / 2, bottom: -requiredHeight / 2 }, duration);
  }

  private _startAnimation(initialState: AnimationState2D | AnimationState3D, targetState: AnimationState2D | AnimationState3D, duration: number) {
    this.isCameraAnimating = true;
    this.animationProgress = 0;
    this.cameraInitialState = initialState;
    this.cameraAnimationTarget = targetState;
    this.cameraAnimationDuration = Math.max(duration, 500);
    this.controlsManager.getControls().enabled = false;
    this.controlsManager.exitFlyMode();
  }

  private _updateCameraAnimation(delta: number): void {
    if (!this.isCameraAnimating || !this.cameraAnimationTarget || !this.cameraInitialState) return;
    const durationInSeconds = this.cameraAnimationDuration / 1000;
    const progressIncrement = (delta / durationInSeconds) * this.travelSpeedMultiplier;
    this.animationProgress = Math.min(this.animationProgress + progressIncrement, 1.0);

    // ====================================================================
    // ✨ INICIO DE LA LÓGICA DE ANIMACIÓN MEJORADA ✨
    // ====================================================================
    // LÓGICA: Se usan dos curvas de interpolación (easing) distintas para que la
    // rotación de la cámara sea más rápida que su traslación.
    // - targetAlpha (easeOutQuint): Hace que la cámara se oriente rápidamente al objetivo.
    // - positionAlpha (easeOutCubic): Mueve la cámara de forma más suave, sobre todo al final.
    // El resultado es que la cámara primero "mira" y luego "viaja".
    const targetAlpha = 1 - Math.pow(1 - this.animationProgress, 5); // Curva rápida para la rotación
    const positionAlpha = 1 - Math.pow(1 - this.animationProgress, 3); // Curva suave para la posición
    // ====================================================================
    // ✨ FIN DE LA LÓGICA DE ANIMACIÓN MEJORADA ✨
    // ====================================================================

    const camera = this.sceneManager.activeCamera;
    const controls = this.controlsManager.getControls();
    camera.position.lerpVectors(this.cameraInitialState.position, this.cameraAnimationTarget.position, positionAlpha);
    controls.target.lerpVectors(this.cameraInitialState.target, this.cameraAnimationTarget.target, targetAlpha);
    if ('left' in this.cameraInitialState && 'left' in this.cameraAnimationTarget && camera instanceof THREE.OrthographicCamera) {
        camera.left = THREE.MathUtils.lerp(this.cameraInitialState.left, this.cameraAnimationTarget.left, positionAlpha);
        camera.right = THREE.MathUtils.lerp(this.cameraInitialState.right, this.cameraAnimationTarget.right, positionAlpha);
        camera.top = THREE.MathUtils.lerp(this.cameraInitialState.top, this.cameraAnimationTarget.top, positionAlpha);
        camera.bottom = THREE.MathUtils.lerp(this.cameraInitialState.bottom, this.cameraAnimationTarget.bottom, positionAlpha);
        camera.updateProjectionMatrix();
    }
    controls.update();
    if (this.animationProgress >= 1) {
      camera.position.copy(this.cameraAnimationTarget.position);
      controls.target.copy(this.cameraAnimationTarget.target);
      this.isCameraAnimating = false;
      this.cameraAnimationTarget = null;
      this.cameraInitialState = null;
      if (this.cameraMode$.getValue() === 'perspective') {
        this.isCameraOrbiting = true;
        this.orbitStartTime = this.clock.getElapsedTime();
        this.orbitTarget = controls.target.clone();
        this.orbitInitialOffset.subVectors(camera.position, this.orbitTarget);
      } else {
         controls.enabled = true;
      }
    }
  }

  private _updateCameraOrbit(delta: number): void {
    if (!this.isCameraOrbiting || !this.orbitTarget) return;
    const camera = this.sceneManager.activeCamera;
    const controls = this.controlsManager.getControls();
    const elapsedOrbitTime = (this.clock.getElapsedTime() - this.orbitStartTime) * 1000;
    if (elapsedOrbitTime >= this.ORBIT_DURATION) {
      this.isCameraOrbiting = false;
      this.orbitTarget = null;
      controls.enabled = true;
      controls.update();
      return;
    }
    const rotationAngle = (delta / (this.ORBIT_DURATION / 1000)) * Math.PI * 2;
    this.orbitInitialOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationAngle);
    camera.position.copy(this.orbitTarget).add(this.orbitInitialOffset);
    controls.target.copy(this.orbitTarget);
    controls.update();
  }

  private _getAxisFromState(state: { position: THREE.Vector3, target: THREE.Vector3 } | null): string {
    if (!state) return 'axis-y-neg';
    const dir = new THREE.Vector3().copy(state.position).sub(state.target).normalize();
    if (Math.abs(dir.x) > 0.9) return dir.x > 0 ? 'axis-x' : 'axis-x-neg';
    if (Math.abs(dir.y) > 0.9) return dir.y > 0 ? 'axis-y' : 'axis-y-neg';
    return dir.z > 0 ? 'axis-z' : 'axis-z-neg';
  }

  private _updateDependentServices(newActiveCamera: THREE.Camera): void {
    (this.sceneManager.composer.passes[0] as RenderPass).camera = newActiveCamera;
    this.selectionManager.setCamera(newActiveCamera);
    this.interactionHelperManager.setCamera(newActiveCamera);
    this.dragInteractionManager.setCamera(newActiveCamera);
    this.controlsManager.setCamera(newActiveCamera as THREE.PerspectiveCamera | THREE.OrthographicCamera);
    this.controlsManager.getControls().update();
  }
}
