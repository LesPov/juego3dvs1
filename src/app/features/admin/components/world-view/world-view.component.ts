// Imports - Añadimos lo necesario para Drag & Drop y BehaviorSubject
import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subject, Subscription, of, BehaviorSubject } from 'rxjs';
import { map, switchMap, tap, debounceTime } from 'rxjs/operators';
import * as THREE from 'three';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

// Imports de tus otros componentes y servicios
import { SceneComponent } from '../world-editor/scene/scene.component';
import { SceneObjectService } from '../../services/scene-object.service';
import { AddObjectModalComponent, NewSceneObjectData } from '../world-editor/add-object-modal/add-object-modal.component';
import { PropertiesPanelComponent, PropertyUpdate } from '../world-editor/properties-panel/properties-panel.component';
import { SceneSettingsPanelComponent } from '../world-editor/scene-settings-panel/scene-settings-panel.component';
import { SceneEntity } from '../world-editor/service/three-engine/utils/entity-manager.service';
import { ToolbarComponent } from '../world-editor/toolbar/toolbar.component';
import { SceneObjectResponse, AdminService } from '../../services/admin.service';
import { EngineService } from '../world-editor/service/three-engine/engine.service';
import { BrujulaComponent } from '../world-editor/brujula/brujula.component';

@Component({
  selector: 'app-world-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SceneComponent,
    AddObjectModalComponent,
    PropertiesPanelComponent,
    SceneSettingsPanelComponent,
    BrujulaComponent,
    ToolbarComponent,
    DragDropModule
  ],
  templateUrl: './world-view.component.html',
  styleUrls: ['./world-view.component.css'],
  providers: [EngineService]
})
export class WorldViewComponent implements OnInit, OnDestroy {
  episodeId?: number;
  isLoadingData = true;
  isRenderingScene = false;
  loadingProgress = 0;
  errorMessage: string | null = null;
  sceneObjects: SceneObjectResponse[] = [];
  episodeTitle = '';
  selectedEntityUuid: string | null = null;
  selectedObject: SceneObjectResponse | null = null;
  isAddObjectModalVisible = false;
  activePropertiesTab: string = 'object';
  isMobileSidebarVisible = false;
  public axisLock$: Observable<'x' | 'y' | 'z' | null>;

  public realEntities$ = new BehaviorSubject<SceneEntity[]>([]);
  public placeholderEntities: SceneEntity[] = [];

  private readonly typeColorMap: { [key: string]: string } = {
    'Camera': 'color-camera',
    'Light': 'color-light',
    'Model': 'color-model',
    'default': 'color-default'
  };

  private propertyUpdate$ = new Subject<PropertyUpdate>();
  private propertyUpdateSubscription?: Subscription;
  private transformEndSubscription?: Subscription;
  private sceneEntitiesSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private adminService: AdminService,
    private router: Router,
    public engineService: EngineService,
    private cdr: ChangeDetectorRef,
    private sceneObjectService: SceneObjectService,
  ) {
    this.placeholderEntities = Array.from({ length: 1 }, (_, i) => ({
      uuid: `placeholder-${i + 1}`, name: `Añadir objeto nuevo...`, type: 'Model',
    }));
    this.axisLock$ = this.engineService.axisLockState$;
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.episodeId = +id;
      this.loadEpisodeData(this.episodeId);
      this.setupPropertyUpdateSubscription();
      this.setupTransformEndSubscription();

      this.sceneEntitiesSubscription = this.engineService.getSceneEntities().subscribe(entities => {
        this.realEntities$.next(entities);
      });
    } else {
      this.router.navigate(['/admin/episodios']);
    }
  }

  ngOnDestroy(): void {
    this.propertyUpdateSubscription?.unsubscribe();
    this.transformEndSubscription?.unsubscribe();
    this.sceneEntitiesSubscription?.unsubscribe();
  }

  onDrop(event: CdkDragDrop<SceneEntity[]>) {
    moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    this.realEntities$.next([...event.container.data]);
    const newOrderUuids = event.container.data.map(entity => entity.uuid);
    console.log('Nuevo orden de UUIDs para guardar:', newOrderUuids);
  }

  getColorClassForEntity(entity: SceneEntity): string {
    return this.typeColorMap[entity.type] || this.typeColorMap['default'];
  }

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
      const newRotationInDegrees = { x: THREE.MathUtils.radToDeg(newRotationInRadians.x), y: THREE.MathUtils.radToDeg(newRotationInRadians.y), z: THREE.MathUtils.radToDeg(newRotationInRadians.z) };
      this.selectedObject = { ...this.selectedObject, position: newPosition, rotation: newRotationInDegrees, scale: newScale };
      this.cdr.detectChanges();
      const dataToSave: Partial<SceneObjectResponse> = { position: newPosition, rotation: newRotationInRadians, scale: newScale };
      this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToSave)
        .subscribe({
          next: updatedObjectFromServer => {
            updatedObjectFromServer.rotation = { x: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.x), y: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.y), z: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.z), };
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
        if (update.path === 'rotation') {
          const rotationInRadians = { x: THREE.MathUtils.degToRad((update.value as any).x), y: THREE.MathUtils.degToRad((update.value as any).y), z: THREE.MathUtils.degToRad((update.value as any).z), };
          dataToUpdate = { [update.path]: rotationInRadians };
        } else {
          dataToUpdate = { [update.path]: update.value };
        }
        const objectApiId = this.selectedObject.id;
        return this.sceneObjectService.updateSceneObject(this.episodeId, objectApiId, dataToUpdate);
      }),
      tap(updatedObjectFromServer => {
        if (updatedObjectFromServer && this.selectedObject) {
          updatedObjectFromServer.rotation = { x: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.x), y: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.y), z: THREE.MathUtils.radToDeg(updatedObjectFromServer.rotation.z), };
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

  loadEpisodeData(id: number): void {
    this.isLoadingData = true;
    this.adminService.getEpisodeForEditor(id).subscribe({
      next: (data) => {
        this.episodeTitle = data.title;
        this.sceneObjects = (data.sceneObjects || []).map(obj => ({ ...obj, rotation: { x: THREE.MathUtils.radToDeg(obj.rotation.x), y: THREE.MathUtils.radToDeg(obj.rotation.y), z: THREE.MathUtils.radToDeg(obj.rotation.z) } }));
        this.isLoadingData = false;
        this.isRenderingScene = true;
        const hasModels = this.sceneObjects.some(o => o.type === 'model' && o.asset?.path);
        if (!hasModels) {
          let progress = 0;
          const interval = setInterval(() => {
            progress += 10;
            this.handleLoadingProgress(progress);
            if (progress >= 100) {
              clearInterval(interval);
              this.handleLoadingComplete();
            }
          }, 30);
        }
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
      this.engineService.selectObjectByUuid(null);
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
        valueForEngine = { x: THREE.MathUtils.degToRad((update.value as any).x), y: THREE.MathUtils.degToRad((update.value as any).y), z: THREE.MathUtils.degToRad((update.value as any).z) };
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
        // 🎯 CORRECCIÓN: Se cambió el guion (-) por la sintaxis correcta de "camelCase".
        this.closeAddObjectModal();
        this.engineService.addObjectToScene(obj);
        obj.rotation = { x: THREE.MathUtils.radToDeg(obj.rotation.x), y: THREE.MathUtils.radToDeg(obj.rotation.y), z: THREE.MathUtils.radToDeg(obj.rotation.z) };
        this.sceneObjects.push(obj);
      },
      error: err => console.error(err)
    });
  }
}