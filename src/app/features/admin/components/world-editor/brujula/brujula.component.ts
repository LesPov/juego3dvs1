// src/app/features/admin/components/world-editor/brujula/brujula.component.ts

import { Component, AfterViewInit, ElementRef, ViewChild, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Subscription } from 'rxjs';
import { EngineService,  } from '../service/three-engine/engine.service'; // Importa el tipo CameraMode
import { CameraMode } from '../service/three-engine/utils/camera-manager.service';

@Component({
  selector: 'app-brujula',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './brujula.component.html',
  styleUrls: ['./brujula.component.css']
})
export class BrujulaComponent implements AfterViewInit, OnDestroy {
  @ViewChild('brujulaContainer', { static: true }) private containerRef!: ElementRef<HTMLDivElement>;

  // --- Propiedad para el botón ---
  public cameraMode: CameraMode = 'perspective';
  private cameraModeSubscription!: Subscription;

  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private renderer!: THREE.WebGLRenderer;
  private labelRenderer!: CSS2DRenderer;

  private raycaster = new THREE.Raycaster();
  private brujulaGroup!: THREE.Group;
  private interactiveObjects: THREE.Object3D[] = [];
  private cameraSubscription!: Subscription;
  private animationFrameId?: number;
  private hoveredAxisName: string | null = null;
  private originalMaterials: Map<string, THREE.Material> = new Map();
  private axisElements: Map<string, { meshes: THREE.Mesh[], label: CSS2DObject }> = new Map();

  constructor(
      private engineService: EngineService,
      private cdr: ChangeDetectorRef // ChangeDetectorRef para actualizar la vista
    ) { }

  ngAfterViewInit(): void {
    this.initBrujula();
    this.animate();
    this.subscribeToCameraChanges();
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    // Desuscribirse de todo
    this.cameraSubscription?.unsubscribe();
    this.cameraModeSubscription?.unsubscribe();

    if (this.renderer) {
      this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
      this.renderer.domElement.removeEventListener('mousemove', this.onCanvasMouseMove);
    }

    this.disposeThreeObjects();
    this.renderer?.dispose();
    this.originalMaterials.clear();
    this.axisElements.clear();
  }
  
  public toggleViewMode(): void {
    this.engineService.toggleCameraMode();
  }

  private subscribeToCameraChanges(): void {
    this.cameraSubscription = this.engineService.cameraOrientation$.subscribe(orientation => {
      if (this.brujulaGroup) {
        this.brujulaGroup.quaternion.copy(orientation).invert();
      }
    });

    this.cameraModeSubscription = this.engineService.cameraMode$.subscribe(mode => {
        this.cameraMode = mode;
        this.cdr.detectChanges(); 
    });
  }

  private onCanvasClick = (event: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.interactiveObjects);

    if (intersects.length > 0) {
      const clickedAxisName = intersects[0].object.name;
      this.engineService.setCameraView(clickedAxisName);
    }
  }

  // --- Métodos sin cambios (colapsados por brevedad) ---
  private initBrujula(): void { const container = this.containerRef.nativeElement; if (!container) return; const size = container.clientWidth; this.scene = new THREE.Scene(); this.scene.background = null; const aspect = 1; const frustumSize = 3.5; this.camera = new THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 100); this.camera.position.set(0, 0, 10); this.camera.lookAt(0, 0, 0); const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); this.scene.add(ambientLight); const directionalLight = new THREE.DirectionalLight(0xffffff, 1); directionalLight.position.set(5, 10, 7.5); this.scene.add(directionalLight); this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); this.renderer.setSize(size, size); this.renderer.setPixelRatio(window.devicePixelRatio); container.appendChild(this.renderer.domElement); this.labelRenderer = new CSS2DRenderer(); this.labelRenderer.setSize(size, size); this.labelRenderer.domElement.style.position = 'absolute'; this.labelRenderer.domElement.style.top = '0px'; this.labelRenderer.domElement.style.pointerEvents = 'none'; container.appendChild(this.labelRenderer.domElement); this.brujulaGroup = new THREE.Group(); this.scene.add(this.brujulaGroup); this.createAxes(); this.renderer.domElement.addEventListener('click', this.onCanvasClick, false); this.renderer.domElement.addEventListener('mousemove', this.onCanvasMouseMove, false); }
  private createAxes(): void { const axisLength = 1.6; const axisRadius = 0.1; const headLength = 1; const headRadius = 0.25; const centerSphere = new THREE.Mesh(new THREE.SphereGeometry(0.15), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.5, metalness: 0.8 })); this.brujulaGroup.add(centerSphere); const axesData = [ { name: 'axis-x', dir: new THREE.Vector3(1, 0, 0), color: 0xff3333, label: 'X' }, { name: 'axis-y', dir: new THREE.Vector3(0, 1, 0), color: 0x33ff33, label: 'Y' }, { name: 'axis-z', dir: new THREE.Vector3(0, 0, 1), color: 0x3333ff, label: 'Z' }, { name: 'axis-x-neg', dir: new THREE.Vector3(-1, 0, 0), color: 0xff3333, label: '-X' }, { name: 'axis-y-neg', dir: new THREE.Vector3(0, -1, 0), color: 0x33ff33, label: '-Y' }, { name: 'axis-z-neg', dir: new THREE.Vector3(0, 0, -1), color: 0x3333ff, label: '-Z' }, ]; axesData.forEach(data => { const material = new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.6, metalness: 0.3, toneMapped: false }); const cone = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 16), material); cone.position.copy(data.dir).multiplyScalar(axisLength); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), data.dir); const line = new THREE.Mesh(new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 16), material); line.position.copy(data.dir).multiplyScalar(axisLength / 2); line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), data.dir); const labelDiv = document.createElement('div'); labelDiv.className = 'axis-label'; labelDiv.textContent = data.label; labelDiv.style.color = `#${new THREE.Color(data.color).getHexString()}`; const label = new CSS2DObject(labelDiv); const labelPosition = data.dir.clone().multiplyScalar(axisLength + headLength + 0.6); label.position.copy(labelPosition); const labelHitSphere = new THREE.Mesh( new THREE.SphereGeometry(0.6), new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 }) ); labelHitSphere.position.copy(labelPosition); cone.name = data.name; labelHitSphere.name = data.name; this.originalMaterials.set(cone.uuid, material); this.originalMaterials.set(line.uuid, material); this.axisElements.set(data.name, { meshes: [cone, line], label }); this.brujulaGroup.add(cone, line, label, labelHitSphere); this.interactiveObjects.push(cone, labelHitSphere); }); }
  private onCanvasMouseMove = (event: MouseEvent) => { const rect = this.renderer.domElement.getBoundingClientRect(); const mouse = new THREE.Vector2( ((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1 ); this.raycaster.setFromCamera(mouse, this.camera); const intersects = this.raycaster.intersectObjects(this.interactiveObjects); if (intersects.length > 0) { const intersectedObjectName = intersects[0].object.name; if (this.hoveredAxisName !== intersectedObjectName) { this.clearHoverEffect(); this.applyHoverEffect(intersectedObjectName); this.hoveredAxisName = intersectedObjectName; } this.renderer.domElement.style.cursor = 'pointer'; } else { if (this.hoveredAxisName) { this.clearHoverEffect(); this.hoveredAxisName = null; } this.renderer.domElement.style.cursor = 'default'; } }
  private applyHoverEffect(axisName: string) { const elements = this.axisElements.get(axisName); if (!elements) return; elements.meshes.forEach(mesh => { if (mesh.material instanceof THREE.MeshStandardMaterial) { const hoverMaterial = mesh.material.clone(); hoverMaterial.emissive.copy(hoverMaterial.color); hoverMaterial.emissiveIntensity = 0.6; mesh.material = hoverMaterial; } }); elements.label.element.classList.add('hovered'); }
  private clearHoverEffect() { if (!this.hoveredAxisName) return; const elements = this.axisElements.get(this.hoveredAxisName); if (!elements) return; elements.meshes.forEach(mesh => { const originalMaterial = this.originalMaterials.get(mesh.uuid); if (originalMaterial) { mesh.material = originalMaterial; } }); elements.label.element.classList.remove('hovered'); }
  private animate = () => { this.animationFrameId = requestAnimationFrame(this.animate); this.renderer.render(this.scene, this.camera); this.labelRenderer.render(this.scene, this.camera); }
  private disposeThreeObjects() { this.scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry?.dispose(); if (Array.isArray(object.material)) { object.material.forEach(material => material.dispose()); } else { object.material?.dispose(); } } }); }
}