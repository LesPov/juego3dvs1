import { Component, AfterViewInit, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Subscription } from 'rxjs';
import { EngineService } from '../service/three-engine/engine.service';

@Component({
  selector: 'app-brujula',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './brujula.component.html',
  styleUrls: ['./brujula.component.css']
})
export class BrujulaComponent implements AfterViewInit, OnDestroy {
  @ViewChild('brujulaContainer', { static: true }) private containerRef!: ElementRef<HTMLDivElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private renderer!: THREE.WebGLRenderer;
  private labelRenderer!: CSS2DRenderer;

  private raycaster = new THREE.Raycaster();
  private clickeables: THREE.Object3D[] = [];
  private brujulaGroup!: THREE.Group;
  
  private cameraSubscription!: Subscription;
  
  private animationFrameId?: number;
  private hoveredAxisName: string | null = null;
  private originalMaterials: Map<string, THREE.Material> = new Map();

  constructor(private engineService: EngineService) { }

  ngAfterViewInit(): void {
    this.initBrujula();
    this.animate();
    this.subscribeToCameraChanges();
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.cameraSubscription?.unsubscribe();

    if (this.renderer) {
      this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
      this.renderer.domElement.removeEventListener('mousemove', this.onCanvasMouseMove);
    }

    this.renderer?.dispose();
    this.originalMaterials.clear();
  }
  
  private subscribeToCameraChanges(): void {
    this.cameraSubscription = this.engineService.cameraOrientation$.subscribe(orientation => {
      if (this.brujulaGroup) {
        this.brujulaGroup.quaternion.copy(orientation).invert();
      }
    });
  }

  private initBrujula(): void {
    const container = this.containerRef.nativeElement;
    const size = container.clientWidth;

    this.scene = new THREE.Scene();

    const aspect = 1;
    const frustumSize = 3.5;
    this.camera = new THREE.OrthographicCamera(
      -frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 100
    );
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    this.scene.add(directionalLight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(size, size);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(size, size);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0px';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);

    this.brujulaGroup = new THREE.Group();
    this.scene.add(this.brujulaGroup);

    this.createAxes();

    this.renderer.domElement.addEventListener('click', this.onCanvasClick, false);
    this.renderer.domElement.addEventListener('mousemove', this.onCanvasMouseMove, false);
  }
  
  private createAxes(): void {
     const axisLength = 1.6;
    const axisRadius = 0.1;
    const headLength = 1;
    const headRadius = 0.25;

    const centerSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.15),
      new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.5, metalness: 0.8 })
    );
    this.brujulaGroup.add(centerSphere);

    const axesData = [
      { name: 'axis-x', dir: new THREE.Vector3(1, 0, 0), color: 0xff3333, label: 'X' },
      { name: 'axis-y', dir: new THREE.Vector3(0, 1, 0), color: 0x33ff33, label: 'Y' },
      { name: 'axis-z', dir: new THREE.Vector3(0, 0, 1), color: 0x3333ff, label: 'Z' },
      { name: 'axis-x-neg', dir: new THREE.Vector3(-1, 0, 0), color: 0xff3333, label: '-X' },
      { name: 'axis-y-neg', dir: new THREE.Vector3(0, -1, 0), color: 0x33ff33, label: '-Y' },
      { name: 'axis-z-neg', dir: new THREE.Vector3(0, 0, -1), color: 0x3333ff, label: '-Z' },
    ];

    axesData.forEach(data => {
      const material = new THREE.MeshStandardMaterial({
        color: data.color,
        roughness: 0.6,
        metalness: 0.3,
        toneMapped: false
      });

      const cone = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 16), material);
      cone.position.copy(data.dir).multiplyScalar(axisLength);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), data.dir);
      cone.name = data.name; 

      const line = new THREE.Mesh(new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 16), material);
      line.position.copy(data.dir).multiplyScalar(axisLength / 2);
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), data.dir);
      
      const labelDiv = document.createElement('div');
      labelDiv.className = 'axis-label';
      labelDiv.textContent = data.label;
      labelDiv.style.color = `#${new THREE.Color(data.color).getHexString()}`;
      const label = new CSS2DObject(labelDiv);
      const labelPosition = data.dir.clone().multiplyScalar(axisLength + headLength + 0.6);
      label.position.copy(labelPosition);
      
      const labelHitSphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.6),
          new THREE.MeshBasicMaterial({ visible: false })
      );
      labelHitSphere.position.copy(labelPosition);
      labelHitSphere.name = data.name;

      cone.userData['axisName'] = data.name;
      line.userData['axisName'] = data.name;
      label.userData['axisName'] = data.name;

      this.originalMaterials.set(cone.uuid, material);
      this.originalMaterials.set(line.uuid, material);

      this.brujulaGroup.add(cone, line, label, labelHitSphere);
      
      this.clickeables.push(cone, labelHitSphere);
    });
  }
  
  private onCanvasMouseMove = (event: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.clickeables);

    if (intersects.length > 0) {
      const intersectedObjectName = intersects[0].object.name;
      if (this.hoveredAxisName !== intersectedObjectName) {
        this.clearHoverEffect();
        this.applyHoverEffect(intersectedObjectName);
        this.hoveredAxisName = intersectedObjectName;
      }
      this.renderer.domElement.style.cursor = 'pointer';
    } else {
      if (this.hoveredAxisName) {
        this.clearHoverEffect();
        this.hoveredAxisName = null;
      }
      this.renderer.domElement.style.cursor = 'default';
    }
  }
  
  private applyHoverEffect(axisName: string) {
    this.brujulaGroup.children.forEach(child => {
      if (child.userData['axisName'] === axisName) {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          const hoverMaterial = child.material.clone();
          hoverMaterial.emissive.copy(hoverMaterial.color);
          hoverMaterial.emissiveIntensity = 0.6;
          child.material = hoverMaterial;
        }
        else if (child instanceof CSS2DObject) {
          child.element.classList.add('hovered');
        }
      }
    });
  }
  
  private clearHoverEffect() {
    if (!this.hoveredAxisName) return;

    const axisToClear = this.hoveredAxisName;
    this.brujulaGroup.children.forEach(child => {
      if (child.userData['axisName'] === axisToClear) {
        if (child instanceof THREE.Mesh) {
          const originalMaterial = this.originalMaterials.get(child.uuid);
          if (originalMaterial) {
            child.material = originalMaterial;
          }
        }
        else if (child instanceof CSS2DObject) {
          child.element.classList.remove('hovered');
        }
      }
    });
  }
  
  private onCanvasClick = (event: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.clickeables);

    if (intersects.length > 0) {
      const clickedAxisName = intersects[0].object.name;
      this.engineService.setCameraView(clickedAxisName);
    }
  }
  
  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}