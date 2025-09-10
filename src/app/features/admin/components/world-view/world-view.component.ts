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
import { environment } from '../../../../../environments/environment';

export interface EntityGroup {
  type: string;
  visibleEntities: SceneEntity[];
  isExpanded: boolean;
  totalCount: number;
  isGroupVisible: boolean;
  brightness: number;
}

export interface SceneTab {
  id: number;
  name: string;
  isActive: boolean;
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
  public episodeThumbnailUrl: string | null = null;
  public isThumbnailLoaded = false;
  public selectedEntityUuid: string | null = null;
  public selectedObject: SceneObjectResponse | null = null;
  public isAddObjectModalVisible = false;
  public activePropertiesTab: string = 'object';
  public axisLock$: Observable<'x' | 'y' | 'z' | null>;
  public isFlyModeActive$: Observable<boolean>;
  public displayGroups$: Observable<EntityGroup[]>;
  public placeholderEntities: SceneEntity[] = [{ uuid: 'placeholder-1', name: 'Añadir objeto nuevo...', type: 'Model' }];
  public searchFilter: string = '';
  public totalFilteredEntityCount = 0;
  public sceneTabs: SceneTab[] = [];
  public activeSceneId: number = 1;
  private nextSceneId: number = 2;
  public isImageModalVisible = false;

  public layoutState = {
    isMaximized: false,
    sceneListVisible: true,
    propertiesVisible: true,
    imageVisible: true,
    assetsVisible: true,
    performanceVisible: true,
    descriptionVisible: true
  };

  private groupExpansionState = new Map<string, boolean>();
  private groupVisibilityState = new Map<string, boolean>();
  private groupBrightnessState = new Map<string, number>();
  private brightnessUpdate$ = new Subject<{ groupType: string, brightness: number }>();
  private groupDisplayCountState = new Map<string, number>();
  private readonly listIncrement = 50;
  private searchFilter$ = new BehaviorSubject<string>('');
  private readonly typeColorMap: { [key: string]: string } = {
    'camera': 'color-camera',
    'directionalLight': 'color-light',
    'ambientLight': 'color-light',
    'Model': 'color-model',
    'star': 'color-star',
    'galaxy': 'color-galaxy',
    'supernova': 'color-supernova',
    'diffraction_star': 'color-diffraction-star',
    'default': 'color-default'
  };
  private propertyUpdate$ = new Subject<PropertyUpdate>();
  private subscriptions = new Subscription();
  private allEntities$ = new BehaviorSubject<SceneEntity[]>([]);

  // Banderas para controlar el estado de carga de forma precisa
  private isSceneAssetsLoaded = false;
  private isThumbnailAssetLoaded = false;

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
      map(([allEntities, filter]) => this.processEntities(allEntities, filter))
    );
  }

  ngOnInit(): void {
    this.sceneTabs.push({ id: 1, name: 'Escena Principal', isActive: true });
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
      next: (response) => {
        this.episodeTitle = response.episode.title;
        this.episodeThumbnailUrl = this.buildFullThumbnailUrl(response.episode.thumbnailUrl);
        this.sceneObjects = response.sceneObjects || [];

        // ¡LÓGICA CORREGIDA! Determinar si hay assets que cargar
        const hasSceneAssetsToLoad = this.sceneObjects.some(o => o.asset?.path);
        const hasThumbnailToLoad = !!this.episodeThumbnailUrl;

        // Iniciar la pantalla de carga
        this.isLoadingData = false;
        this.isRenderingScene = true;

        // 1. Manejar la carga del Thumbnail
        if (hasThumbnailToLoad) {
          this.isThumbnailAssetLoaded = false;
          const img = new Image();
          img.onload = () => {
            this.isThumbnailLoaded = true;
            this.isThumbnailAssetLoaded = true;
            console.log("✅ Thumbnail cargado.");
            this.cdr.detectChanges();
            this.checkAndFinalizeLoading();
          };
          img.onerror = () => {
            this.isThumbnailLoaded = true;
            this.isThumbnailAssetLoaded = true;
            console.warn("⚠️ Thumbnail no se pudo cargar, continuando.");
            this.checkAndFinalizeLoading();
          };
          img.src = this.episodeThumbnailUrl!;
        } else {
          this.isThumbnailAssetLoaded = true; // No hay thumbnail, se considera "cargado".
        }

        // 2. Manejar la carga de los assets de la escena
        if (!hasSceneAssetsToLoad) {
          this.isSceneAssetsLoaded = true; // No hay assets 3D, se considera "cargado".
        }
        
        // 3. Comprobar si ya podemos finalizar la carga (caso sin assets y sin thumbnail)
        this.checkAndFinalizeLoading();
      },
      error: (err) => {
        this.errorMessage = "Error al cargar los datos del episodio.";
        this.isLoadingData = false;
        console.error(err);
      }
    });
  }

  // ¡LÓGICA CORREGIDA! Este es el único punto que puede finalizar la carga.
  private checkAndFinalizeLoading(): void {
    // Solo finaliza si AMBOS han terminado.
    if (this.isSceneAssetsLoaded && this.isThumbnailAssetLoaded) {
      console.log("🏁 Ambos, escena y thumbnail, están listos. Finalizando carga.");
      this.loadingProgress = 100;
      this.cdr.detectChanges();
      
      // Pequeño delay para una transición de salida suave
      setTimeout(() => {
        this.isRenderingScene = false;
        this.cdr.detectChanges();
      }, 500);
    }
  }
  
  // Este método es llamado por el componente <app-scene> cuando Three.js termina.
  public handleSceneAssetsLoaded(): void {
    this.isSceneAssetsLoaded = true;
    console.log("✅ Assets de la escena 3D cargados.");
    this.checkAndFinalizeLoading();
  }

  // Este método es llamado por el componente <app-scene> para actualizar la barra.
  public handleLoadingProgress(progress: number): void {
    // La barra avanza hasta 99% y se queda ahí hasta que checkAndFinalizeLoading() la ponga en 100%.
    this.loadingProgress = Math.min(progress, 99);
    this.cdr.detectChanges();
  }

  // --- El resto del componente es idéntico y no necesita cambios ---
  
  onMaximizeToggle(): void {
    const goingToMaximized = !this.layoutState.isMaximized;
    if (goingToMaximized) {
      this.layoutState.isMaximized = true;
    } else {
      this.layoutState.sceneListVisible = true;
      this.layoutState.propertiesVisible = true;
      this.layoutState.imageVisible = true;
      this.layoutState.assetsVisible = true;
      this.layoutState.performanceVisible = true;
      this.layoutState.descriptionVisible = true;
      setTimeout(() => {
        this.layoutState.isMaximized = false;
        this.cdr.detectChanges();
      }, 10);
    }
  }

  togglePanel(panel: keyof Omit<typeof this.layoutState, 'isMaximized'>): void {
    this.layoutState[panel] = !this.layoutState[panel];
    if (this.layoutState[panel] === true && this.layoutState.isMaximized) {
      this.layoutState.isMaximized = false;
    }
  }

  private processEntities(allEntities: SceneEntity[], filter: string): EntityGroup[] {
    const searchTerm = filter.trim().toLowerCase();
    const filteredEntities = searchTerm ? allEntities.filter(e => e.name.toLowerCase().includes(searchTerm)) : allEntities;
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
      return { type, visibleEntities, isExpanded, totalCount, isGroupVisible: this.groupVisibilityState.get(type)!, brightness: this.groupBrightnessState.get(type)! };
    });
  }

  openImageModal(): void { if (this.episodeThumbnailUrl) { this.isImageModalVisible = true; } }
  closeImageModal(): void { this.isImageModalVisible = false; }
  selectScene(sceneId: number): void { if (this.activeSceneId === sceneId) return; this.activeSceneId = sceneId; this.sceneTabs.forEach(tab => tab.isActive = tab.id === sceneId); console.log(`Cambiando a escena ID: ${sceneId}`); }
  addScene(): void { const newScene: SceneTab = { id: this.nextSceneId, name: `Escena ${this.nextSceneId}`, isActive: false }; this.sceneTabs.push(newScene); this.nextSceneId++; this.selectScene(newScene.id); }
  private buildFullThumbnailUrl(relativePath: string | null): string | null { if (!relativePath) return null; const cleanEndpoint = environment.endpoint.endsWith('/') ? environment.endpoint.slice(0, -1) : environment.endpoint; const cleanThumbnailPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath; return `${cleanEndpoint}/${cleanThumbnailPath}`; }
  private setupSubscriptions(): void { const transformSub = this.engineService.onTransformEnd$.subscribe(() => this.handleTransformEnd()); const propertyUpdateSub = this.propertyUpdate$.pipe(debounceTime(500), switchMap(update => this.handlePropertySave(update))).subscribe({ error: err => console.error("[WorldView] Error al guardar propiedad:", err) }); const entitiesSub = this.engineService.getSceneEntities().pipe(map(engineEntities => { const sceneObjectMap = new Map<string, SceneObjectResponse>(); this.sceneObjects.forEach(obj => sceneObjectMap.set(obj.id.toString(), obj)); return engineEntities.map(entity => { const originalObject = sceneObjectMap.get(entity.uuid); return { ...entity, type: originalObject ? originalObject.type : entity.type }; }); })).subscribe((correctedEntities: SceneEntity[]) => { this.allEntities = correctedEntities; this.allEntities$.next(correctedEntities); }); const brightnessSub = this.brightnessUpdate$.pipe(debounceTime(150)).subscribe(({ groupType, brightness }) => { const entityUuidsInGroup = this.allEntities.filter(entity => entity.type === groupType).map(entity => entity.uuid); if (entityUuidsInGroup.length > 0) this.engineService.setGroupBrightness(entityUuidsInGroup, brightness); }); const cameraModeSub = this.engineService.cameraMode$.subscribe(mode => { if (mode === 'perspective') { let stateChanged = false; for (const key of this.groupBrightnessState.keys()) { if (this.groupBrightnessState.get(key) !== 1.0) { this.groupBrightnessState.set(key, 1.0); stateChanged = true; } } if (stateChanged) this.allEntities$.next([...this.allEntities]); } }); this.subscriptions.add(transformSub); this.subscriptions.add(propertyUpdateSub); this.subscriptions.add(entitiesSub); this.subscriptions.add(brightnessSub); this.subscriptions.add(cameraModeSub); }
  public onGroupBrightnessChange(group: EntityGroup, event: Event): void { const slider = event.target as HTMLInputElement; const brightness = parseFloat(slider.value); this.groupBrightnessState.set(group.type, brightness); this.brightnessUpdate$.next({ groupType: group.type, brightness }); }
  public toggleGroupVisibility(group: EntityGroup, event: MouseEvent): void { event.stopPropagation(); const newState = !(this.groupVisibilityState.get(group.type) ?? true); this.groupVisibilityState.set(group.type, newState); const entityUuidsInGroup = this.allEntities.filter(entity => entity.type === group.type).map(entity => entity.uuid); if (entityUuidsInGroup.length > 0) this.engineService.setGroupVisibility(entityUuidsInGroup, newState); this.allEntities$.next([...this.allEntities]); }
  public toggleGroup(group: EntityGroup): void { const newState = !group.isExpanded; this.groupExpansionState.set(group.type, newState); this.allEntities$.next([...this.allEntities]); }
  public showMoreInGroup(group: EntityGroup): void { const newCount = (this.groupDisplayCountState.get(group.type) || this.listIncrement) + this.listIncrement; this.groupDisplayCountState.set(group.type, newCount); this.allEntities$.next([...this.allEntities]); }
  onDrop(event: CdkDragDrop<SceneEntity[]>): void { moveItemInArray(event.container.data, event.previousIndex, event.currentIndex); }
  trackByGroupType(index: number, group: EntityGroup): string { return group.type; }
  public onSearchChange(term: string): void { this.groupDisplayCountState.clear(); this.searchFilter$.next(term); }
  trackByEntity(index: number, entity: SceneEntity): string { return entity.uuid; }
  handleObjectUpdate(update: PropertyUpdate): void { if (!this.selectedObject) return; if (['position', 'rotation', 'scale'].includes(update.path)) { this.engineService.updateObjectTransform(this.selectedObject.id.toString(), update.path as any, update.value as any); } else if (update.path === 'name') { this.engineService.updateObjectName(this.selectedObject.id.toString(), update.value as string); } this.updateLocalSelectedObject({ [update.path]: update.value }); this.propertyUpdate$.next(update); }
  private handlePropertySave(update: PropertyUpdate): Observable<SceneObjectResponse> { if (!this.episodeId || !this.selectedObject) return new Observable(obs => obs.error(new Error("EpisodeID or SelectedObject is null"))); const dataToUpdate: Partial<SceneObjectResponse> = { [update.path]: update.value }; return this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToUpdate).pipe(tap(updatedObj => { this.updateLocalSelectedObject(updatedObj); console.log("Guardado exitoso:", updatedObj); })); }
  private handleTransformEnd(): void { const transformedObject = this.engineService.getGizmoAttachedObject(); if (!transformedObject || !this.selectedObject || !this.episodeId) return; const newPosition = { x: transformedObject.position.x, y: transformedObject.position.y, z: transformedObject.position.z }; const newRotation = { x: transformedObject.rotation.x, y: transformedObject.rotation.y, z: transformedObject.rotation.z }; const newScale = { x: transformedObject.scale.x, y: transformedObject.scale.y, z: transformedObject.scale.z }; this.updateLocalSelectedObject({ position: newPosition, rotation: newRotation, scale: newScale }); const dataToSave: Partial<SceneObjectResponse> = { position: newPosition, rotation: newRotation, scale: newScale }; this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToSave).subscribe({ next: updatedObj => this.updateLocalSelectedObject(updatedObj), error: err => console.error("[WorldView] Error al guardar tras transformación:", err) }); }
  onEntitySelect(entity: SceneEntity): void { if (entity.uuid.startsWith('placeholder-')) { this.isAddObjectModalVisible = true; this.deselectObject(); return; } if (this.selectedEntityUuid === entity.uuid) { this.deselectObject(); } else { this.selectedEntityUuid = entity.uuid; const foundObject = this.sceneObjects.find(o => o.id.toString() === entity.uuid); if (foundObject) { this.selectedObject = { ...foundObject }; this.engineService.selectObjectByUuid(entity.uuid); this.selectPropertiesTab('object'); } else { this.deselectObject(); } } }
  deselectObject(): void { this.selectedEntityUuid = null; this.selectedObject = null; this.engineService.selectObjectByUuid(null); this.selectPropertiesTab('scene'); }
  createSceneObject(data: NewSceneObjectData): void { if (!this.episodeId) return; this.sceneObjectService.createSceneObject(this.episodeId, data).subscribe({ next: newObj => { this.closeAddObjectModal(); this.engineService.addObjectToScene(newObj); this.sceneObjects = [...this.sceneObjects, newObj]; }, error: err => console.error(err) }); }
  updateLocalSelectedObject(updatedData: Partial<SceneObjectResponse>): void { if (!this.selectedObject) return; this.selectedObject = { ...this.selectedObject, ...updatedData }; const index = this.sceneObjects.findIndex(o => o.id === this.selectedObject!.id); if (index !== -1) { this.sceneObjects[index] = { ...this.sceneObjects[index], ...updatedData }; } this.cdr.detectChanges(); }
  getColorClassForEntity(entity: SceneEntity): string { return this.typeColorMap[entity.type] || this.typeColorMap['default']; }
  selectPropertiesTab(tab: string): void { this.activePropertiesTab = tab; }
  closeAddObjectModal(): void { this.isAddObjectModalVisible = false; }
}