import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { CameraManagerService } from './camera-manager.service';
import { LightManagerService } from './light-manager.service';

@Injectable({
  providedIn: 'root'
})
export class SceneManagerService {
  public scene!: THREE.Scene;
  public renderer!: THREE.WebGLRenderer;
  public editorCamera!: THREE.PerspectiveCamera;
  public focusPivot!: THREE.Object3D;

  constructor(
    private cameraManager: CameraManagerService,
    private lightManager: LightManagerService
  ) { }

  public setupBasicScene(canvas: HTMLCanvasElement): void {
    // 1. Escena
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x282c34);

    // 2. Renderizador
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 3. Cámara del Editor
    const aspectRatio = canvas.clientWidth / canvas.clientHeight;
    const editorCamData = this.cameraManager.createCamera(aspectRatio, 50, 0.1, 1000);
    this.editorCamera = editorCamData.camera;
    this.editorCamera.name = "Cámara del Editor";
    this.editorCamera.position.set(0, 5, 15);
    editorCamData.helper.name = `${this.editorCamera.name}_helper`;
    editorCamData.helper.visible = false;
    this.scene.add(this.editorCamera, editorCamData.helper);

    // 4. Pivote de Enfoque
    this.focusPivot = new THREE.Object3D();
    this.focusPivot.name = "FocusPivot";
    const pivotGeometry = new THREE.SphereGeometry(0.05, 16, 8);
    const pivotMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true, opacity: 0.8 });
    const pivotSphere = new THREE.Mesh(pivotGeometry, pivotMaterial);
    this.focusPivot.add(pivotSphere);
    this.scene.add(this.focusPivot);

    // 5. Luces base y ayudas visuales
    this.lightManager.addLightsToScene(this.scene);
    this.setupEditorGridAndAxes();
  }

  private setupEditorGridAndAxes(): void {
    const size = 500;
    const divisions = 100;
    const gridHelper = new THREE.GridHelper(size, divisions, 0xaaaaaa, 0x888888);
    
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.5;
    
    gridHelper.name = "EditorGrid";
    gridHelper.renderOrder = -2;
    this.scene.add(gridHelper);

    const axisLength = size;
    const axisRadius = 0.02;
    const axisMatX = new THREE.MeshBasicMaterial({ color: 0xff0000, toneMapped: false });
    const axisMatZ = new THREE.MeshBasicMaterial({ color: 0x0000ff, toneMapped: false });
    
    const axisGeoX = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 8);
    const axisLineX = new THREE.Mesh(axisGeoX, axisMatX);
    axisLineX.rotation.z = Math.PI / 2;
    axisLineX.position.y = 0.01;
    axisLineX.renderOrder = -1;
    this.scene.add(axisLineX);

    const axisGeoZ = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 8);
    const axisLineZ = new THREE.Mesh(axisGeoZ, axisMatZ);
    axisLineZ.rotation.x = Math.PI / 2;
    axisLineZ.position.y = 0.01;
    axisLineZ.renderOrder = -1;
    this.scene.add(axisLineZ);
  }

  public onWindowResize(): void {
    if (!this.renderer || !this.editorCamera) return;

    const canvas = this.renderer.domElement;
    const width = canvas.parentElement?.clientWidth || window.innerWidth;
    const height = canvas.parentElement?.clientHeight || window.innerHeight;

    if (width === 0 || height === 0) return;

    this.editorCamera.aspect = width / height;
    this.editorCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}