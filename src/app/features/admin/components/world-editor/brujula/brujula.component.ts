// Ubicación sugerida: src/app/features/admin/components/world-editor/brujula/brujula.component.ts

import { Component, AfterViewInit, ElementRef, ViewChild, OnDestroy, Input } from '@angular/core';
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
  private cameraSubscription?: Subscription;
  private animationFrameId?: number;

  // Inyectamos el EngineService para comunicarnos con la escena principal
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
    // Limpieza de recursos de Three.js si es necesario
    this.renderer.dispose();
  }

  private initBrujula(): void {
    const container = this.containerRef.nativeElement;
    const size = container.clientWidth;

    // 1. Escena y Cámara
    this.scene = new THREE.Scene();
    const aspect = 1;
    const frustumSize = 2.5;
    this.camera = new THREE.OrthographicCamera(
      -frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 100
    );
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

    // 2. Renderizador principal (para los ejes)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(size, size);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // 3. Renderizador de etiquetas (para las letras X, Y, Z)
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(size, size);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0px';
    container.appendChild(this.labelRenderer.domElement);

    // 4. Grupo que contendrá todos los elementos de la brújula
    this.brujulaGroup = new THREE.Group();
    this.scene.add(this.brujulaGroup);

    // 5. Crear los ejes y etiquetas
    this.createAxes();

    // 6. Configurar el listener para los clics
    this.renderer.domElement.addEventListener('click', this.onCanvasClick, false);
  }

  private createAxes(): void {
    const axisLength = 1;
    const axisRadius = 0.05;
    const headLength = 0.3;
    const headRadius = 0.1;

    const axesData = [
      { name: 'axis-x', dir: new THREE.Vector3(1, 0, 0), color: 0xff0000, label: 'X' },
      { name: 'axis-y', dir: new THREE.Vector3(0, 1, 0), color: 0x00ff00, label: 'Y' },
      { name: 'axis-z', dir: new THREE.Vector3(0, 0, 1), color: 0x0000ff, label: 'Z' },
      { name: 'axis-x-neg', dir: new THREE.Vector3(-1, 0, 0), color: 0xff0000, label: '-X' },
      { name: 'axis-y-neg', dir: new THREE.Vector3(0, -1, 0), color: 0x00ff00, label: '-Y' },
      { name: 'axis-z-neg', dir: new THREE.Vector3(0, 0, -1), color: 0x0000ff, label: '-Z' },
    ];

    axesData.forEach(data => {
      const material = new THREE.MeshBasicMaterial({ color: data.color, toneMapped: false });

      // Punta de la flecha
      const cone = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 16), material);
      cone.position.copy(data.dir).multiplyScalar(axisLength);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), data.dir);

      // Línea del eje
      const line = new THREE.Mesh(new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 16), material);
      line.position.copy(data.dir).multiplyScalar(axisLength / 2);
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), data.dir);
      
      // Esfera en el centro para una mejor interacción de clic
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 1.5), new THREE.MeshBasicMaterial({ visible: false }));
      sphere.position.copy(cone.position);
      sphere.name = data.name; // El nombre es clave para identificar el eje al hacer clic

      this.brujulaGroup.add(cone, line, sphere);
      this.clickeables.push(sphere);

      // Etiqueta de texto (X, Y, Z)
      const labelDiv = document.createElement('div');
      labelDiv.className = 'axis-label';
      labelDiv.textContent = data.label;
      labelDiv.style.color = `#${data.color.toString(16).padStart(6, '0')}`;
      const label = new CSS2DObject(labelDiv);
      label.position.copy(data.dir).multiplyScalar(axisLength + headLength + 0.3);
      this.brujulaGroup.add(label);
    });
  }

  private subscribeToCameraChanges(): void {
    // Nos suscribimos al observable de la orientación de la cámara del EngineService
    this.cameraSubscription = this.engineService.getCameraOrientation().subscribe(orientation => {
      // Invertimos el quaternion porque la brújula debe girar en sentido contrario a la cámara
      // para que siempre "apunte" en la dirección correcta desde la vista del usuario.
      this.brujulaGroup.quaternion.copy(orientation).invert();
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
      // Llamamos al método en EngineService para que mueva la cámara principal
      this.engineService.setCameraView(clickedAxisName);
    }
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}