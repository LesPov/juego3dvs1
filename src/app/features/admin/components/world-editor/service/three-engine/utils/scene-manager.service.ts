// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/scene-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SelectionManagerService } from './selection-manager.service';

@Injectable({
  providedIn: 'root'
})
export class SceneManagerService {
  public scene!: THREE.Scene;
  public renderer!: THREE.WebGLRenderer;
  public editorCamera!: THREE.PerspectiveCamera;
  public focusPivot!: THREE.Object3D;
  public composer!: EffectComposer;
  private controls!: OrbitControls | undefined;

  constructor(private selectionManager: SelectionManagerService) { }

  public setupBasicScene(canvas: HTMLCanvasElement): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    const fieldOfView = 45;
    const cameraFarPlane = 1e16;
    const cameraNearPlane = 1000.0;
    this.editorCamera = new THREE.PerspectiveCamera( fieldOfView, canvas.clientWidth / canvas.clientHeight, cameraNearPlane, cameraFarPlane );
    this.editorCamera.name = 'Cámara del Editor';
    this.editorCamera.position.set(0, 0, 90_000_000);
    this.scene.add(this.editorCamera);

    this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;

    const normalPixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(normalPixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    this.selectionManager.init(this.scene, this.editorCamera);
    this.setupPostProcessing(canvas);

    this.focusPivot = new THREE.Object3D();
    this.focusPivot.name = "FocusPivot";
    this.scene.add(this.focusPivot);
  }

  private setupPostProcessing(canvas: HTMLCanvasElement): void {
    const renderPass = new RenderPass(this.scene, this.editorCamera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), 0.1, 0.1, 0.1);
    const outlinePass = this.selectionManager.getPass();
    const outputPass = new OutputPass();
    
    this.composer = new EffectComposer(this.renderer);
    
    this.composer.addPass(renderPass);
    this.composer.addPass(outlinePass);
    this.composer.addPass(bloomPass);
    this.composer.addPass(outputPass);
  }

  public onWindowResize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      this.editorCamera.aspect = width / height;
      this.editorCamera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
      this.composer.setSize(width, height);
    }
  }

  public setControls(controls: OrbitControls) { this.controls = controls; }
  public frameScene(sceneWidth: number, sceneHeight: number): void { if (!this.editorCamera || !this.controls) return; const fovRad = THREE.MathUtils.degToRad(this.editorCamera.fov); const effectiveHeight = Math.max(sceneHeight, sceneWidth / this.editorCamera.aspect); const distance = (effectiveHeight / 2) / Math.tan(fovRad / 2); const finalZ = distance * 1.2; this.editorCamera.position.set(0, 0, finalZ); this.editorCamera.lookAt(0, 0, 0); this.controls.target.set(0, 0, 0); this.controls.update(); }
}