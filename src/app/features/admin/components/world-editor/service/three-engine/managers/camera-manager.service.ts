// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/camera-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject } from 'rxjs';
import { SceneManagerService } from './scene-manager.service';
 
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ControlsManagerService } from '../interactions/controls-manager.service';
import { EntityManagerService } from './entity-manager.service';
import { SelectionManagerService } from '../interactions/selection-manager.service';
import { InteractionHelperManagerService } from '../interactions/interaction-helper.manager.service';
import { DragInteractionManagerService } from '../interactions/drag-interaction.manager.service';

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
  private cameraAnimationStartTime: number | null = null;
  private readonly cameraAnimationDuration = 1000;
  private clock = new THREE.Clock();

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

  public toggleActiveCamera(currentSelectedObject?: THREE.Object3D): void {
    const editorHelper = this.sceneManager.editorCamera.userData['helper'];
    const secondaryHelper = this.sceneManager.secondaryCamera.userData['helper'];
    const controls = this.controlsManager.getControls();

    if (this.activeCameraType === 'editor') {
      this.activeCameraType = 'secondary';
      this.sceneManager.activeCamera = this.sceneManager.secondaryCamera;
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
      this.sceneManager.activeCamera = this.sceneManager.editorCamera;
      controls.target.copy(this.lastEditorTarget);

      if (editorHelper) editorHelper.visible = false;
      if (secondaryHelper) secondaryHelper.visible = true;
      this.controlsManager.configureForEditorCamera();
    }

    const newActiveCamera = this.sceneManager.activeCamera;
    this.controlsManager.setCamera(newActiveCamera);
    (this.sceneManager.composer.passes[0] as RenderPass).camera = newActiveCamera;
    
    this.selectionManager.setCamera(newActiveCamera);

    this.interactionHelperManager.setCamera(newActiveCamera);
    this.dragInteractionManager.setCamera(newActiveCamera);
    controls.update(); 
    
    if(currentSelectedObject && currentSelectedObject.uuid === newActiveCamera.uuid) {
        this.controlsManager.attach(currentSelectedObject);
    }
  }

  public update(delta: number): boolean {
    if (this.isCameraAnimating) {
      this.updateCameraAnimation();
    }
    return this.isCameraAnimating;
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
      if (direction.lengthSq() === 0) {
          direction.set(0, 0, 1);
      }
      camera.position.copy(center).addScaledVector(direction, distance);
    } else {
      const currentAxis = this.getAxisFromState(this.lastOrthographicState);
      this.setCameraView(currentAxis);
      return;
    }
    
    controls.target.copy(center);
    controls.update();
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

    const rendererDomElement = this.sceneManager.renderer.domElement;
    const aspect = rendererDomElement.clientWidth / rendererDomElement.clientHeight;
    let frustumWidth = Math.max(boxSize.x, 0.1), frustumHeight = Math.max(boxSize.y, 0.1);
    const currentAxis = axisName || this.getAxisFromState(this.lastOrthographicState);
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
    this.controlsManager.setCamera(this.orthoCamera);
    (this.sceneManager.composer.passes[0] as RenderPass).camera = this.orthoCamera;
    
    this.selectionManager.setCamera(this.orthoCamera);

    this.controlsManager.exitFlyMode();
    this.controlsManager.isFlyEnabled = false;
    controls.enabled = true;
    controls.enableRotate = false;
    
    controls.target.copy(target);
    controls.update();
    this.selectionManager.updateOutlineParameters('orthographic');
    this.cameraMode$.next('orthographic');
    
    return this.orthoCamera.projectionMatrix.elements[0];
  }

  public switchToPerspectiveView(): void {
    this.entityManager.resetAllGroupsBrightness();
    const controls = this.controlsManager.getControls();
    if (!controls) return;

    this.sceneManager.activeCamera = this.sceneManager.editorCamera;
    this.controlsManager.setCamera(this.sceneManager.editorCamera);
    (this.sceneManager.composer.passes[0] as RenderPass).camera = this.sceneManager.editorCamera;

    this.selectionManager.setCamera(this.sceneManager.editorCamera);
    
    if (this.lastPerspectiveState) {
        this.sceneManager.editorCamera.position.copy(this.lastPerspectiveState.position);
        controls.target.copy(this.lastPerspectiveState.target);
    } else if (this.lastOrthographicState) {
        const target = this.lastOrthographicState.target.clone();
        const direction = new THREE.Vector3().copy(this.lastOrthographicState.position).sub(target).normalize();
        const boundingBox = this.sceneManager.getSceneBoundingBox();
        const sceneSize = boundingBox.getSize(new THREE.Vector3()).length();
        const safeDistance = sceneSize > 0 ? sceneSize * 1.5 : 500000;
        this.sceneManager.editorCamera.position.copy(target).addScaledVector(direction, safeDistance);
        controls.target.copy(target);
    }
    
    this.controlsManager.isFlyEnabled = true;
    controls.enableRotate = true;
    controls.update();
    this.selectionManager.updateOutlineParameters('perspective');
    this.cameraMode$.next('perspective');
  }

  private getAxisFromState(state: { position: THREE.Vector3, target: THREE.Vector3 } | null): string {
    if (!state) return 'axis-y-neg';
    const dir = new THREE.Vector3().copy(state.position).sub(state.target).normalize();
    if (Math.abs(dir.x) > 0.9) return dir.x > 0 ? 'axis-x' : 'axis-x-neg';
    if (Math.abs(dir.y) > 0.9) return dir.y > 0 ? 'axis-y' : 'axis-y-neg';
    return dir.z > 0 ? 'axis-z' : 'axis-z-neg';
  }

  public focusOnObject(uuid: string): void {
    if (this.isCameraAnimating) return;
    const object = this.entityManager.getObjectByUuid(uuid);
    if (!object) return;
    const cameraMode = this.cameraMode$.getValue();
    cameraMode === 'perspective' ? this.focusOnObject3D(object) : this.focusOnObject2D(object);
  }

  private focusOnObject3D(object: THREE.Object3D): void {
    const controls = this.controlsManager.getControls();
    const camera = this.sceneManager.activeCamera;
    
    this.tempBox.setFromObject(object, true);
    if (this.tempBox.isEmpty()) this.tempBox.setFromCenterAndSize(object.position, new THREE.Vector3(1, 1, 1));
    
    const targetPoint = this.tempBox.getCenter(new THREE.Vector3());
    const objectSize = this.tempBox.getSize(new THREE.Vector3()).length();
    const distance = Math.max(objectSize * 2.5, 10);
    
    const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
    const finalCamPos = new THREE.Vector3().copy(targetPoint).addScaledVector(cameraDirection.negate(), distance);
    
    this.isCameraAnimating = true;
    this.cameraAnimationStartTime = this.clock.getElapsedTime();
    this.cameraInitialState = { position: camera.position.clone(), target: controls.target.clone() };
    this.cameraAnimationTarget = { position: finalCamPos, target: targetPoint };

    controls.enabled = false;
    this.controlsManager.exitFlyMode();
  }
  
  private focusOnObject2D(object: THREE.Object3D): void {
    const camera = this.sceneManager.activeCamera as THREE.OrthographicCamera;
    const controls = this.controlsManager.getControls();
    if (!camera.isOrthographicCamera) return;

    this.tempBox.setFromObject(object, true);
    if (this.tempBox.isEmpty()) this.tempBox.setFromCenterAndSize(object.position, new THREE.Vector3(1, 1, 1));
    
    const objectCenter = this.tempBox.getCenter(new THREE.Vector3());
    const objectSize = this.tempBox.getSize(new THREE.Vector3());
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

    this.isCameraAnimating = true;
    this.cameraAnimationStartTime = this.clock.getElapsedTime();
    this.cameraInitialState = { position: camera.position.clone(), target: controls.target.clone(), left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom };
    this.cameraAnimationTarget = { position: finalCamPos, target: objectCenter, left: -requiredWidth / 2, right: requiredWidth / 2, top: requiredHeight / 2, bottom: -requiredHeight / 2 };
    
    controls.enabled = false;
  }

  private updateCameraAnimation(): void {
    if (!this.isCameraAnimating || !this.cameraAnimationTarget || !this.cameraInitialState || this.cameraAnimationStartTime === null) {
      return;
    }

    const elapsedTime = this.clock.getElapsedTime() - this.cameraAnimationStartTime;
    const progress = Math.min(elapsedTime / (this.cameraAnimationDuration / 1000), 1);
    const alpha = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    const camera = this.sceneManager.activeCamera;
    const controls = this.controlsManager.getControls();

    camera.position.lerpVectors(this.cameraInitialState.position, this.cameraAnimationTarget.position, alpha);
    controls.target.lerpVectors(this.cameraInitialState.target, this.cameraAnimationTarget.target, alpha);

    if ('left' in this.cameraInitialState && 'left' in this.cameraAnimationTarget && camera instanceof THREE.OrthographicCamera) {
        camera.left = THREE.MathUtils.lerp(this.cameraInitialState.left, this.cameraAnimationTarget.left, alpha);
        camera.right = THREE.MathUtils.lerp(this.cameraInitialState.right, this.cameraAnimationTarget.right, alpha);
        camera.top = THREE.MathUtils.lerp(this.cameraInitialState.top, this.cameraAnimationTarget.top, alpha);
        camera.bottom = THREE.MathUtils.lerp(this.cameraInitialState.bottom, this.cameraAnimationTarget.bottom, alpha);
        camera.updateProjectionMatrix();
    }
    
    controls.update();

    if (progress >= 1) {
      camera.position.copy(this.cameraAnimationTarget.position);
      controls.target.copy(this.cameraAnimationTarget.target);
      if ('left' in this.cameraAnimationTarget && camera instanceof THREE.OrthographicCamera) {
        camera.left = this.cameraAnimationTarget.left; camera.right = this.cameraAnimationTarget.right;
        camera.top = this.cameraAnimationTarget.top; camera.bottom = this.cameraAnimationTarget.bottom;
        camera.updateProjectionMatrix();
      }

      if (this.activeCameraType === 'editor') {
          controls.enabled = false;
      } else {
          controls.enabled = true;
      }

      controls.update();
      this.isCameraAnimating = false;
      this.cameraAnimationTarget = null;
      this.cameraInitialState = null;
      this.cameraAnimationStartTime = null;
    }
  }
}