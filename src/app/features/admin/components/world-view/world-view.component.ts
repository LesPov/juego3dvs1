// src/app/features/admin/components/world-view/world-view.component.ts

import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subject, Subscription, of } from 'rxjs';
import { map, switchMap, tap, debounceTime } from 'rxjs/operators';
import * as THREE from 'three';

import { SceneComponent } from '../world-editor/scene/scene.component';
import { SceneObjectService } from '../../services/scene-object.service';
import { AddObjectModalComponent, NewSceneObjectData } from '../world-editor/add-object-modal/add-object-modal.component';
import { PropertiesPanelComponent, PropertyUpdate } from '../world-editor/properties-panel/properties-panel.component';
import { SceneSettingsPanelComponent } from '../world-editor/scene-settings-panel/scene-settings-panel.component';
import { BrujulaComponent } from '../world-editor/brujula/brujula.component';
import { SceneEntity } from '../world-editor/service/three-engine/utils/entity-manager.service';
import { ToolbarComponent } from '../world-editor/toolbar/toolbar.component';
import { SceneObjectResponse, AdminService } from '../../services/admin.service';
import { EngineService } from '../world-editor/service/three-engine/engine.service';
  
@Component({
  selector: 'app-world-view',
  standalone: true,
  imports: [ CommonModule, FormsModule, SceneComponent, AddObjectModalComponent, PropertiesPanelComponent, SceneSettingsPanelComponent, BrujulaComponent, ToolbarComponent ],
  templateUrl: './world-view.component.html',
  styleUrls: ['./world-view.component.css'],
  providers: [EngineService]
})
export class WorldViewComponent implements OnInit, OnDestroy {
  // --- Propiedades ---
  episodeId?: number;
  isLoadingData = true;
  isRenderingScene = false;
  loadingProgress = 0;
  errorMessage: string | null = null;
  sceneObjects: SceneObjectResponse[] = [];
  episodeTitle = '';
  selectedEntityUuid: string | null = null;
  selectedObject: SceneObjectResponse | null = null;
  combinedEntities$: Observable<SceneEntity[]>;
  isAddObjectModalVisible = false;
  activePropertiesTab: string = 'object';

  // ✅ NUEVA PROPIEDAD PARA EL MODO MÓVIL
  isMobileSidebarVisible = false;

  private propertyUpdate$ = new Subject<PropertyUpdate>();
  private propertyUpdateSubscription?: Subscription;
  private transformEndSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private adminService: AdminService,
    private router: Router,
    public engineService: EngineService,
    private cdr: ChangeDetectorRef,
    private sceneObjectService: SceneObjectService,
  ) {
    const placeholders: SceneEntity[] = Array.from({ length: 5 }, (_, i) => ({
      uuid: `placeholder-${i + 1}`, name: `Añadir objeto nuevo...`, type: 'Model',
    }));
    this.combinedEntities$ = this.engineService.getSceneEntities().pipe(
      map((real: SceneEntity[]) => [...real, ...placeholders])
    );
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.episodeId = +id;
      this.loadEpisodeData(this.episodeId);
      this.setupPropertyUpdateSubscription();
      this.setupTransformEndSubscription();
    } else {
      this.router.navigate(['/admin/episodios']);
    }
  }

  ngOnDestroy(): void {
    this.propertyUpdateSubscription?.unsubscribe();
    this.transformEndSubscription?.unsubscribe();
  }
  
  // ✅ NUEVO MÉTODO PARA ALTERNAR LA BARRA LATERAL EN MÓVIL
  toggleMobileSidebar(): void {
    this.isMobileSidebarVisible = !this.isMobileSidebarVisible;
  }

  private setupTransformEndSubscription(): void {
    this.transformEndSubscription = this.engineService.onTransformEnd$.subscribe(() => {
      const transformedObject = this.engineService.getGizmoAttachedObject();

      if (!transformedObject || !this.selectedObject || !this.episodeId) {
        return;
      }
      
      const newPosition = { x: transformedObject.position.x, y: transformedObject.position.y, z: transformedObject.position.z };
      const newRotationInRadians = { x: transformedObject.rotation.x, y: transformedObject.rotation.y, z: transformedObject.rotation.z };
      const newScale = { x: transformedObject.scale.x, y: transformedObject.scale.y, z: transformedObject.scale.z };

      const newRotationInDegrees = {
        x: THREE.MathUtils.radToDeg(newRotationInRadians.x),
        y: THREE.MathUtils.radToDeg(newRotationInRadians.y),
        z: THREE.MathUtils.radToDeg(newRotationInRadians.z)
      };
      
      this.selectedObject = { ...this.selectedObject, position: newPosition, rotation: newRotationInDegrees, scale: newScale };
      this.cdr.detectChanges();

      const dataToSave: Partial<SceneObjectResponse> = {
        position: newPosition,
        rotation: newRotationInRadians,
        scale: newScale
      };

      this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToSave)
        .subscribe({
          next: updatedObjectFromServer => {
            updatedObjectFromServer.rotation = {
              x: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.x),
              y: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.y),
              z: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.z),
            };

            this.selectedObject = { ...this.selectedObject!, ...updatedObjectFromServer };
            const idx = this.sceneObjects.findIndex(o => o.id === this.selectedObject!.id);
            if (idx !== -1) {
              this.sceneObjects[idx] = { ...this.sceneObjects[idx], ...updatedObjectFromServer };
            }
            this.cdr.detectChanges();
          },
          error: err => console.error("[WorldView] Error al guardar objeto después de Drag&Drop:", err)
        });
    });
  }

  private setupPropertyUpdateSubscription(): void {
    this.propertyUpdateSubscription = this.propertyUpdate$.pipe(
      debounceTime(400),
      switchMap(update => {
        if (!this.episodeId || !this.selectedObject) return of(null);
        
        let dataToUpdate: Partial<Omit<SceneObjectResponse, 'id' | 'asset' | 'type' | 'name'>>;
        
        if(update.path === 'rotation'){
          const rotationInRadians = {
            x: THREE.MathUtils.degToRad((update.value as any).x),
            y: THREE.MathUtils.degToRad((update.value as any).y),
            z: THREE.MathUtils.degToRad((update.value as any).z),
          };
          dataToUpdate = { [update.path]: rotationInRadians };
        } else {
          dataToUpdate = { [update.path]: update.value };
        }

        const objectApiId = this.selectedObject.id;
        return this.sceneObjectService.updateSceneObject(this.episodeId, objectApiId, dataToUpdate);
      }),
      tap(updatedObjectFromServer => {
        if (updatedObjectFromServer && this.selectedObject) {
          updatedObjectFromServer.rotation = {
            x: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.x),
            y: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.y),
            z: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.z),
          };
          
          this.selectedObject = { ...this.selectedObject!, ...updatedObjectFromServer };
          const idx = this.sceneObjects.findIndex(o => o.id === this.selectedObject!.id);
          if (idx !== -1) {
            this.sceneObjects[idx] = { ...this.sceneObjects[idx], ...updatedObjectFromServer };
          }
          this.cdr.detectChanges();
        }
      })
    ).subscribe({
      error: err => console.error("[WorldView] Error fatal al actualizar objeto desde panel:", err)
    });
  }
  
  
  // ✅ MÉTODO CON LA LÓGICA DE CARGA MEJORADA
  loadEpisodeData(id: number): void {
    this.isLoadingData = true;
    this.adminService.getEpisodeForEditor(id).subscribe({
      next: (data) => {
        this.episodeTitle = data.title;
        this.sceneObjects = (data.sceneObjects || []).map(obj => ({
          ...obj,
          rotation: {
            x: THREE.MathUtils.radToDeg(obj.rotation.x),
            y: THREE.MathUtils.radToDeg(obj.rotation.y),
            z: THREE.MathUtils.radToDeg(obj.rotation.z)
          }
        }));
        this.isLoadingData = false;
        this.isRenderingScene = true;

        // Comprobamos si hay modelos para cargar
        const hasModels = this.sceneObjects.some(o => o.type === 'model' && o.asset?.path);
        
        // Si NO hay modelos, simulamos una carga rápida para mejorar la UX
        if (!hasModels) {
          console.log("[WorldView] No hay modelos para cargar, simulando progreso...");
          let progress = 0;
          const interval = setInterval(() => {
            progress += 10;
            this.handleLoadingProgress(progress);
            if (progress >= 100) {
              clearInterval(interval);
              // Llamamos a loadingComplete después de la animación
              this.handleLoadingComplete();
            }
          }, 30); // Cada 30ms, aumenta un 10%, tarda 300ms en total
        }
        // Si SÍ hay modelos, el LoadingManager de Three.js se encargará del progreso real.
      },
      error: () => {
        this.errorMessage = "Error al cargar el episodio.";
        this.isLoadingData = false;
      }
    });
  }

  selectPropertiesTab(tab: string) {
    this.activePropertiesTab = tab;
  }

  onEntitySelect(entity: SceneEntity) {
    if (entity.uuid.startsWith('placeholder-')) {
      this.isAddObjectModalVisible = true;
      this.engineService.selectObjectByUuid(null);
      this.selectedEntityUuid = null;
      this.selectedObject = null;
      this.selectPropertiesTab('render');
      return;
    }

    if (this.selectedEntityUuid === entity.uuid) {
      this.selectedEntityUuid = null;
      this.selectedObject = null;
this.engineService.selectObjectByUuid(entity.uuid);
      this.selectPropertiesTab('render');
    } else {
      this.selectedEntityUuid = entity.uuid;
      this.selectedObject = this.sceneObjects.find(o => o.id.toString() === entity.uuid) || null;
      this.engineService.selectObjectByUuid(entity.uuid);
      this.selectPropertiesTab('object');
    }
  }

  handleObjectUpdate(update: PropertyUpdate) {
    if (!this.selectedObject) return;
  
    if (update.type === 'transform') {
      let valueForEngine = update.value;
      if (update.path === 'rotation') {
        valueForEngine = {
          x: THREE.MathUtils.degToRad((update.value as any).x),
          y: THREE.MathUtils.degToRad((update.value as any).y),
          z: THREE.MathUtils.degToRad((update.value as any).z)
        };
      }
      this.engineService.updateObjectTransform(this.selectedObject.id.toString(), update.path as any, valueForEngine);
    } else if (update.path === 'name') {
      this.engineService.updateObjectName(this.selectedObject.id.toString(), update.value as any);
    }
  
    this.propertyUpdate$.next(update);
  }

  handleLoadingProgress(p: number) { this.loadingProgress = p; this.cdr.detectChanges(); }
  handleLoadingComplete() { this.loadingProgress = 100; setTimeout(() => { this.isRenderingScene = false; this.cdr.detectChanges(); }, 500); }
  closeAddObjectModal() { this.isAddObjectModalVisible = false; }
  createSceneObject(data: NewSceneObjectData) {
    if (!this.episodeId) return;
    this.sceneObjectService.createSceneObject(this.episodeId, data).subscribe({
      next: obj => {
        this.closeAddObjectModal();
        this.engineService.addObjectToScene(obj);
        obj.rotation = {
            x: THREE.MathUtils.radToDeg(obj.rotation.x),
            y: THREE.MathUtils.radToDeg(obj.rotation.y),
            z: THREE.MathUtils.radToDeg(obj.rotation.z)
        };
        this.sceneObjects.push(obj);
      },
      error: err => console.error(err)
    });
  }
}