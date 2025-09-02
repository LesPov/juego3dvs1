// src/app/features/admin/views/world-editor/world-view/world-view.component.ts

import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subject, Subscription, BehaviorSubject, combineLatest } from 'rxjs';
import { switchMap, tap, debounceTime, map, startWith } from 'rxjs/operators';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

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

export interface EntityGroup {
  type: string;
  visibleEntities: SceneEntity[];
  isExpanded: boolean;
  totalCount: number;
  isGroupVisible: boolean;
  brightness: number;
}

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
  public isFlyModeActive$: Observable<boolean>;

  public displayGroups$: Observable<EntityGroup[]>;
  public placeholderEntities: SceneEntity[] = [{ uuid: 'placeholder-1', name: 'Añadir objeto nuevo...', type: 'Model' }];
  public searchFilter: string = '';
  public totalFilteredEntityCount = 0;

  private groupExpansionState = new Map<string, boolean>();
  private groupVisibilityState = new Map<string, boolean>();
  private groupBrightnessState = new Map<string, number>();
  private brightnessUpdate$ = new Subject<{ groupType: string, brightness: number }>();
  private groupDisplayCountState = new Map<string, number>();
  private readonly listIncrement = 50;

  private analysisSummary: any = null;
  private searchFilter$ = new BehaviorSubject<string>('');
  private readonly typeColorMap: { [key: string]: string } = {
    'Camera': 'color-camera', 'Light': 'color-light', 'Model': 'color-model',
    'star': 'color-star', 'galaxy': 'color-galaxy', 'meteor': 'color-meteor', 'supernova': 'color-supernova', 'diffraction_star': 'color-diffraction-star',
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
    this.isFlyModeActive$ = this.engineService.isFlyModeActive$;

    this.displayGroups$ = combineLatest([
      this.allEntities$,
      this.searchFilter$.pipe(debounceTime(200), startWith(''))
    ]).pipe(
      map(([allEntities, filter]) => {
        const searchTerm = filter.trim().toLowerCase();
        const filteredEntities = searchTerm
          ? allEntities.filter(e => e.name.toLowerCase().includes(searchTerm))
          : allEntities;

        this.totalFilteredEntityCount = filteredEntities.length;

        const groups: { [key: string]: SceneEntity[] } = filteredEntities.reduce((acc, entity) => {
          const type = entity.type || 'unknown';
          (acc[type] = acc[type] || []).push(entity);
          return acc;
        }, {} as { [key: string]: SceneEntity[] });

        return Object.keys(groups).sort().map(type => {
          const allGroupEntities = groups[type];
          const totalCount = allGroupEntities.length;

          if (this.groupExpansionState.get(type) === undefined) this.groupExpansionState.set(type, false);
          if (this.groupVisibilityState.get(type) === undefined) this.groupVisibilityState.set(type, true);
          if (this.groupBrightnessState.get(type) === undefined) this.groupBrightnessState.set(type, 1.0);

          const isExpanded = this.groupExpansionState.get(type)!;
          const displayCount = this.groupDisplayCountState.get(type) || this.listIncrement;
          const visibleEntities = allGroupEntities.slice(0, displayCount);

          return {
            type: type,
            visibleEntities: visibleEntities,
            isExpanded: isExpanded,
            totalCount: totalCount,
            isGroupVisible: this.groupVisibilityState.get(type)!,
            brightness: this.groupBrightnessState.get(type)!,
          };
        });
      })
    );
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
    this.brightnessUpdate$.complete();
  }

  loadEpisodeData(id: number): void {
    this.isLoadingData = true;
    this.adminService.getEpisodeForEditor(id).subscribe({
      next: (data) => {
        this.episodeTitle = data.title;
        this.sceneObjects = data.sceneObjects || [];
        this.analysisSummary = data.analysisSummary || null;
        this.isLoadingData = false;
        this.isRenderingScene = true;
        if (this.analysisSummary?.scene_dimensions) { this.engineService.frameScene(this.analysisSummary.scene_dimensions.width, this.analysisSummary.scene_dimensions.height); }
        if (!this.sceneObjects.some(o => o.type === 'model' && o.asset?.path)) { this.simulateLoadingProgress(); }
      },
      error: (err) => { this.errorMessage = "Error al cargar los datos del episodio."; this.isLoadingData = false; console.error(err); }
    });
  }

  private setupSubscriptions(): void {
    const transformSub = this.engineService.onTransformEnd$.subscribe(() => this.handleTransformEnd());

    const propertyUpdateSub = this.propertyUpdate$.pipe(
      debounceTime(500),
      switchMap(update => this.handlePropertySave(update))
    ).subscribe({ error: err => console.error("[WorldView] Error al guardar propiedad:", err) });

    const entitiesSub = this.engineService.getSceneEntities().pipe(
      map(engineEntities => {
        const sceneObjectMap = new Map<string, SceneObjectResponse>();
        this.sceneObjects.forEach(obj => sceneObjectMap.set(obj.id.toString(), obj));

        return engineEntities.map(entity => {
          const originalObject = sceneObjectMap.get(entity.uuid);
          return { ...entity, type: originalObject ? originalObject.type : entity.type };
        });
      })
    ).subscribe(correctedEntities => {
      this.allEntities = correctedEntities;
      this.allEntities$.next(correctedEntities);
    });

    const brightnessSub = this.brightnessUpdate$.pipe(
      debounceTime(150)
    ).subscribe(({ groupType, brightness }) => {
      const entityUuidsInGroup = this.allEntities
        .filter(entity => entity.type === groupType)
        .map(entity => entity.uuid);

      if (entityUuidsInGroup.length > 0) {
        this.engineService.setGroupBrightness(entityUuidsInGroup, brightness);
      }
    });

    const cameraModeSub = this.engineService.cameraMode$.subscribe(mode => {
      if (mode === 'perspective') {
        let stateChanged = false;
        for (const key of this.groupBrightnessState.keys()) {
          if (this.groupBrightnessState.get(key) !== 1.0) {
            this.groupBrightnessState.set(key, 1.0);
            stateChanged = true;
          }
        }
        if (stateChanged) {
          this.allEntities$.next([...this.allEntities]);
        }
      }
    });

    this.subscriptions.add(transformSub);
    this.subscriptions.add(propertyUpdateSub);
    this.subscriptions.add(entitiesSub);
    this.subscriptions.add(brightnessSub);
    this.subscriptions.add(cameraModeSub);
  }

  public onGroupBrightnessChange(group: EntityGroup, event: Event): void {
    const slider = event.target as HTMLInputElement;
    const brightness = parseFloat(slider.value);
    this.groupBrightnessState.set(group.type, brightness);
    this.brightnessUpdate$.next({ groupType: group.type, brightness });
  }

  public toggleGroupVisibility(group: EntityGroup, event: MouseEvent): void {
    event.stopPropagation();
    const currentState = this.groupVisibilityState.get(group.type) ?? true;
    const newState = !currentState;
    this.groupVisibilityState.set(group.type, newState);
    const entityUuidsInGroup = this.allEntities
      .filter(entity => entity.type === group.type)
      .map(entity => entity.uuid);
    if (entityUuidsInGroup.length > 0) {
      this.engineService.setGroupVisibility(entityUuidsInGroup, newState);
    }
    this.allEntities$.next([...this.allEntities]);
  }

  public toggleGroup(group: EntityGroup): void {
    const newState = !group.isExpanded;
    this.groupExpansionState.set(group.type, newState);
    this.allEntities$.next([...this.allEntities]);
  }

  public showMoreInGroup(group: EntityGroup): void {
    const currentCount = this.groupDisplayCountState.get(group.type) || this.listIncrement;
    const newCount = currentCount + this.listIncrement;
    this.groupDisplayCountState.set(group.type, newCount);
    this.allEntities$.next([...this.allEntities]);
  }

  onDrop(event: CdkDragDrop<SceneEntity[]>): void { moveItemInArray(event.container.data, event.previousIndex, event.currentIndex); }
  trackByGroupType(index: number, group: EntityGroup): string { return group.type; }
  public onSearchChange(term: string): void { this.groupDisplayCountState.clear(); this.searchFilter$.next(term); }
  trackByEntity(index: number, entity: SceneEntity): string { return entity.uuid; }

  handleObjectUpdate(update: PropertyUpdate): void {
    if (!this.selectedObject) return;
    if (update.path === 'position' || update.path === 'rotation' || update.path === 'scale') {
      this.engineService.updateObjectTransform(this.selectedObject.id.toString(), update.path, update.value as any);
    } else if (update.path === 'name') {
      this.engineService.updateObjectName(this.selectedObject.id.toString(), update.value as string);
    }
    this.updateLocalSelectedObject({ [update.path]: update.value });
    this.propertyUpdate$.next(update);
  }

  private handlePropertySave(update: PropertyUpdate): Observable<SceneObjectResponse> {
    if (!this.episodeId || !this.selectedObject) {
      return new Observable(obs => { obs.error(new Error("EpisodeID or SelectedObject is null for saving")); });
    }
    const dataToUpdate: Partial<SceneObjectResponse> = { [update.path]: update.value };
    return this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToUpdate).pipe(
      tap(updatedObj => {
        this.updateLocalSelectedObject(updatedObj);
        console.log("Guardado exitoso:", updatedObj);
      })
    );
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

  getColorClassForEntity(entity: SceneEntity): string { return this.typeColorMap[entity.type] || this.typeColorMap['default']; }
  toggleMobileSidebar(): void { this.isMobileSidebarVisible = !this.isMobileSidebarVisible; }
  selectPropertiesTab(tab: string): void { this.activePropertiesTab = tab; }
  handleLoadingProgress(p: number): void { this.loadingProgress = p; this.cdr.detectChanges(); }
  handleLoadingComplete(): void { this.loadingProgress = 100; setTimeout(() => { this.isRenderingScene = false; this.cdr.detectChanges(); }, 500); }
  closeAddObjectModal(): void { this.isAddObjectModalVisible = false; }
  private simulateLoadingProgress(): void { let progress = 0; const interval = setInterval(() => { progress += 20; this.handleLoadingProgress(progress); if (progress >= 100) { clearInterval(interval); this.handleLoadingComplete(); } }, 50); }
}