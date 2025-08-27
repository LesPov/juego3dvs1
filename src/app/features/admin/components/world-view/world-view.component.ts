// src/app/features/admin/components/world-view/world-view.component.ts

import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subject, Subscription, of, BehaviorSubject, combineLatest } from 'rxjs';
import { switchMap, tap, debounceTime, map, startWith } from 'rxjs/operators';
import * as THREE from 'three';
import { DragDropModule, CdkDropList, CdkDrag, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { SceneComponent } from '../world-editor/scene/scene.component';
import { SceneObjectService } from '../../services/scene-object.service';
import { AddObjectModalComponent, NewSceneObjectData } from '../world-editor/add-object-modal/add-object-modal.component';
import { PropertiesPanelComponent, PropertyUpdate } from '../world-editor/properties-panel/properties-panel.component';
import { SceneSettingsPanelComponent } from '../world-editor/scene-settings-panel/scene-settings-panel.component';
import { SceneEntity } from '../world-editor/service/three-engine/utils/entity-manager.service';
import { ToolbarComponent } from '../world-editor/toolbar/toolbar.component';
import { SceneObjectResponse, AdminService } from '../../services/admin.service';
import { BrujulaComponent } from '../world-editor/brujula/brujula.component';
import { EngineService } from '../world-editor/service/three-engine/engine.service';

@Component({
  selector: 'app-world-view',
  standalone: true,
  imports: [CommonModule, FormsModule, SceneComponent, AddObjectModalComponent, PropertiesPanelComponent, SceneSettingsPanelComponent, BrujulaComponent, ToolbarComponent, DragDropModule],
  templateUrl: './world-view.component.html',
  styleUrls: ['./world-view.component.css'],
  providers: [EngineService]
})
export class WorldViewComponent implements OnInit, OnDestroy {
  public episodeId?: number;
  public isLoadingData = true;
  public isRenderingScene = false;
  public loadingProgress = 0;
  public errorMessage: string | null = null;
  public sceneObjects: SceneObjectResponse[] = [];
  public allEntities: SceneEntity[] = [];
  public episodeTitle = '';
  public selectedEntityUuid: string | null = null;
  public selectedObject: SceneObjectResponse | null = null;
  public isAddObjectModalVisible = false;
  public activePropertiesTab: string = 'scene';
  public isMobileSidebarVisible = false;
  public axisLock$: Observable<'x' | 'y' | 'z' | null>;

  public displayEntities$: Observable<SceneEntity[]>;
  public placeholderEntities: SceneEntity[] = [{ uuid: 'placeholder-1', name: 'Añadir objeto nuevo...', type: 'Model' }];

  private readonly typeColorMap: { [key: string]: string } = {
    'Camera': 'color-camera', 'Light': 'color-light', 'Model': 'color-model',
    'star': 'color-star', 'galaxy': 'color-galaxy', 'meteor': 'color-meteor',
    'default': 'color-default'
  };

  private propertyUpdate$ = new Subject<PropertyUpdate>();
  private subscriptions = new Subscription();
  private allEntities$ = new BehaviorSubject<SceneEntity[]>([]);

  constructor(
    private route: ActivatedRoute,
    private adminService: AdminService,
    private router: Router,
    public engineService: EngineService,
    private cdr: ChangeDetectorRef,
    private sceneObjectService: SceneObjectService,
  ) {
    this.axisLock$ = this.engineService.axisLockState$;
    // La lista de entidades a mostrar es ahora un observable
    this.displayEntities$ = this.allEntities$.asObservable();
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.episodeId = +id;
      this.loadEpisodeData(this.episodeId);
      this.setupSubscriptions();
    } else {
      this.router.navigate(['/admin/episodios']);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  loadEpisodeData(id: number): void {
    this.isLoadingData = true;
    this.adminService.getEpisodeForEditor(id).subscribe({
      next: (data) => {
        this.episodeTitle = data.title;
        this.sceneObjects = data.sceneObjects || [];
        this.isLoadingData = false;
        this.isRenderingScene = true;

        if (!this.sceneObjects.some(o => o.type === 'model' && o.asset?.path)) {
          this.simulateLoadingProgress();
        }
      },
      error: (err) => {
        this.errorMessage = "Error al cargar los datos del episodio.";
        this.isLoadingData = false;
        console.error(err);
      }
    });
  }

  private setupSubscriptions(): void {
    const transformSub = this.engineService.onTransformEnd$.subscribe(() => this.handleTransformEnd());
    const propertyUpdateSub = this.propertyUpdate$.pipe(
      debounceTime(400),
      switchMap(update => this.handlePropertyUpdate(update))
    ).subscribe({ error: err => console.error("[WorldView] Error al actualizar propiedad:", err) });
    
    // Escucha la lista completa de entidades (incluyendo las instanciadas) del motor
    const entitiesSub = this.engineService.getSceneEntities().subscribe(entities => {
        this.allEntities = entities;
        this.allEntities$.next(entities);
    });

    this.subscriptions.add(transformSub);
    this.subscriptions.add(propertyUpdateSub);
    this.subscriptions.add(entitiesSub);
  }

  private handleTransformEnd(): void {
    const transformedObject = this.engineService.getGizmoAttachedObject();
    if (!transformedObject || !this.selectedObject || !this.episodeId) return;

    const newPosition = { x: transformedObject.position.x, y: transformedObject.position.y, z: transformedObject.position.z };
    const newRotation = { x: transformedObject.rotation.x, y: transformedObject.rotation.y, z: transformedObject.rotation.z };
    const newScale = { x: transformedObject.scale.x, y: transformedObject.scale.y, z: transformedObject.scale.z };

    this.updateLocalSelectedObject({ position: newPosition, rotation: newRotation, scale: newScale });

    const dataToSave: Partial<SceneObjectResponse> = { position: newPosition, rotation: newRotation, scale: newScale };
    this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToSave)
      .subscribe({
        next: updatedObj => this.updateLocalSelectedObject(updatedObj),
        error: err => console.error("[WorldView] Error al guardar objeto tras transformación:", err)
      });
  }

  private handlePropertyUpdate(update: PropertyUpdate): Observable<SceneObjectResponse | null> {
    if (!this.episodeId || !this.selectedObject) return of(null);
    let dataToUpdate: Partial<SceneObjectResponse> = { [update.path]: update.value };
    return this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToUpdate).pipe(
      tap(updatedObj => this.updateLocalSelectedObject(updatedObj))
    );
  }

  onEntitySelect(entity: SceneEntity): void {
    if (entity.uuid.startsWith('placeholder-')) {
      this.isAddObjectModalVisible = true;
      this.deselectObject();
      return;
    }
    if (this.selectedEntityUuid === entity.uuid) {
      this.deselectObject();
    } else {
      this.selectedEntityUuid = entity.uuid;
      // Busca en la lista original de objetos cargados, no en la lista de entidades del motor
      const foundObject = this.sceneObjects.find(o => o.id.toString() === entity.uuid);
      if (foundObject) {
        this.selectedObject = { ...foundObject };
        this.engineService.selectObjectByUuid(entity.uuid);
        this.selectPropertiesTab('object');
      } else {
        this.deselectObject();
      }
    }
  }

  deselectObject(): void {
    this.selectedEntityUuid = null;
    this.selectedObject = null;
    this.engineService.selectObjectByUuid(null);
    this.selectPropertiesTab('scene');
  }

  createSceneObject(data: NewSceneObjectData): void {
    if (!this.episodeId) return;
    this.sceneObjectService.createSceneObject(this.episodeId, data).subscribe({
      next: newObj => {
        this.closeAddObjectModal();
        this.engineService.addObjectToScene(newObj);
        this.sceneObjects = [...this.sceneObjects, newObj];
        // Se actualizará la lista de entidades automáticamente a través de la suscripción
      },
      error: err => console.error(err)
    });
  }

  updateLocalSelectedObject(updatedData: Partial<SceneObjectResponse>): void {
    if (!this.selectedObject) return;

    this.selectedObject = { ...this.selectedObject, ...updatedData };
    
    const index = this.sceneObjects.findIndex(o => o.id === this.selectedObject!.id);
    if (index !== -1) {
      this.sceneObjects[index] = { ...this.sceneObjects[index], ...updatedData };
    }
    this.cdr.detectChanges();
  }
  
  onDrop(event: CdkDragDrop<SceneEntity[]>): void { 
      const currentEntities = this.allEntities$.getValue();
      moveItemInArray(currentEntities, event.previousIndex, event.currentIndex); 
      this.allEntities$.next([...currentEntities]); 
  }

  trackByEntity(index: number, entity: SceneEntity): string {
    return entity.uuid;
  }
  
  getColorClassForEntity(entity: SceneEntity): string { return this.typeColorMap[entity.type] || this.typeColorMap['default']; }
  toggleMobileSidebar(): void { this.isMobileSidebarVisible = !this.isMobileSidebarVisible; }
  selectPropertiesTab(tab: string): void { this.activePropertiesTab = tab; }
  handleObjectUpdate(update: PropertyUpdate): void { this.propertyUpdate$.next(update); }
  handleLoadingProgress(p: number): void { this.loadingProgress = p; this.cdr.detectChanges(); }
  handleLoadingComplete(): void { this.loadingProgress = 100; setTimeout(() => { this.isRenderingScene = false; this.cdr.detectChanges(); }, 500); }
  closeAddObjectModal(): void { this.isAddObjectModalVisible = false; }
  private simulateLoadingProgress(): void {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 20;
      this.handleLoadingProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        this.handleLoadingComplete();
      }
    }, 50);
  }
}