// src/app/features/admin/views/world-view/world-view.component.ts

import { Component, OnInit, OnDestroy, ChangeDetectorRef, Renderer2 } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subject, Subscription, BehaviorSubject, combineLatest } from 'rxjs';
import { switchMap, tap, debounceTime, map, startWith, pairwise } from 'rxjs/operators';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { environment } from '../../../../../environments/environment';
import { SceneObjectResponse, AdminService } from '../../services/admin.service';
import { SceneObjectService } from '../../services/scene-object.service';
import { AddObjectModalComponent, NewSceneObjectData } from '../world-editor/add-object-modal/add-object-modal.component';
import { BrujulaComponent } from '../world-editor/brujula/brujula.component';
import { DescriptionUpdate, PropertiesPanelComponent, PropertyUpdate } from '../world-editor/properties-panel/properties-panel.component';
import { SceneSettingsPanelComponent } from '../world-editor/scene-settings-panel/scene-settings-panel.component';
import { SceneComponent } from '../world-editor/scene/scene.component';
import { SceneEntity } from '../world-editor/service/three-engine/managers/entity-manager.service';
import { ToolbarComponent } from '../world-editor/toolbar/toolbar.component';
import { EngineService } from '../world-editor/service/three-engine/core/engine.service';
import { TourGuideComponent } from '../world-editor/tour-guide/tour-guide.component';
import { TourService, TourStep } from '../../services/tour.service';
import { StatsManagerService } from '../world-editor/service/three-engine/managers/stats-manager.service';

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

type SceneObjectType = "cube" | "sphere" | "floor" | "model" | "video" | "sound" | "camera" | "torus" | "ambientLight" | "directionalLight" | "cone" | "galaxy_normal" | "galaxy_bright" | "galaxy_medium" | "galaxy_far";

@Component({
  selector: 'app-world-view',
  standalone: true,
  imports: [CommonModule, FormsModule, SceneComponent, AddObjectModalComponent, PropertiesPanelComponent, SceneSettingsPanelComponent, BrujulaComponent, ToolbarComponent, DragDropModule, TourGuideComponent],
  templateUrl: './world-view.component.html',
  styleUrls: ['./world-view.component.css'],
  providers: [EngineService, TourService]
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
  public cameraTravelSpeedMultiplier: number = 1.0;
  public layoutState = {
    isMaximized: false,
    sceneListVisible: true,
    propertiesVisible: true,
    imageVisible: true,
    assetsVisible: true,
    performanceVisible: true,
    descriptionVisible: true
  };
  
  public editableDescription: string = '';

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
    'galaxy_bright': 'color-galaxy',
    'galaxy_medium': 'color-diffraction-star',
    'galaxy_far': 'color-supernova',
    'galaxy_normal': 'color-star',
    'default': 'color-default'
  };
  private propertyUpdate$ = new Subject<PropertyUpdate | DescriptionUpdate>();
  private subscriptions = new Subscription();
  private allEntities$ = new BehaviorSubject<SceneEntity[]>([]);
  private selectedEntityUuid$ = new BehaviorSubject<string | null>(null);

  private isSceneAssetsLoaded = false;
  private isThumbnailAssetLoaded = false;

  constructor(
    private route: ActivatedRoute,
    private adminService: AdminService,
    private router: Router,
    public engineService: EngineService,
    private cdr: ChangeDetectorRef,
    private sceneObjectService: SceneObjectService,
    private tourService: TourService,
    private renderer: Renderer2,
    private statsManager: StatsManagerService
  ) {
    this.axisLock$ = this.engineService.axisLockState$;
    this.isFlyModeActive$ = this.engineService.isFlyModeActive$;
    this.displayGroups$ = combineLatest([
      this.allEntities$,
      this.searchFilter$.pipe(debounceTime(200), startWith('')),
      this.selectedEntityUuid$
    ]).pipe(
      map(([allEntities, filter, selectedUuid]) => {
        if (selectedUuid) {
          const selectedEntity = allEntities.find(e => e.uuid === selectedUuid);
          if (selectedEntity) {
            return [{
              type: selectedEntity.type,
              visibleEntities: [selectedEntity],
              isExpanded: true, totalCount: 1, isGroupVisible: true,
              brightness: this.groupBrightnessState.get(selectedEntity.type) || 1.0,
            }];
          }
        }
        return this.processEntities(allEntities, filter);
      })
    );
  }

  ngOnInit(): void {
    this.engineService.setTravelSpeedMultiplier(this.cameraTravelSpeedMultiplier);
    this.sceneTabs.push({ id: 1, name: 'Escena Principal', isActive: true });
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.episodeId = +id;
      this.loadEpisodeData(this.episodeId);
      this.setupSubscriptions();
    } else {
      this.router.navigate(['/admin/episodios']);
    }
    this.setupTour();
    this.setupTourElementHighlighting();
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      if (!this.isLoadingData) { this.statsManager.init('stats-container'); }
    }, 0);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.brightnessUpdate$.complete();
    this.statsManager.destroy();
  }

  private setupSubscriptions(): void {
    const transformSub = this.engineService.onTransformEnd$.subscribe(() => this.handleTransformEnd());
    const propertyUpdateSub = this.propertyUpdate$.pipe(
      debounceTime(500),
      switchMap(update => this.handlePropertySave(update))
    ).subscribe({ error: err => console.error("[WorldView] Error al guardar propiedad:", err) });
    const entitiesSub = this.engineService.getSceneEntities().pipe(map(engineEntities => {
      const sceneObjectMap = new Map(this.sceneObjects.map(obj => [obj.id.toString(), obj]));
      return engineEntities.map(entity => ({ ...entity, type: sceneObjectMap.get(entity.uuid)?.type ?? entity.type }));
    })).subscribe(correctedEntities => {
      this.allEntities = correctedEntities;
      this.allEntities$.next(correctedEntities);
    });
    const brightnessSub = this.brightnessUpdate$.pipe(debounceTime(150)).subscribe(({ groupType, brightness }) => {
      const entityUuids = this.allEntities.filter(e => e.type === groupType).map(e => e.uuid);
      if (entityUuids.length > 0) this.engineService.setGroupBrightness(entityUuids, brightness);
    });
    const cameraModeSub = this.engineService.cameraMode$.subscribe(mode => {
      if (mode === 'perspective') {
        let stateChanged = false;
        this.groupBrightnessState.forEach((val, key) => {
          if (val !== 1.0) { this.groupBrightnessState.set(key, 1.0); stateChanged = true; }
        });
        if (stateChanged) this.allEntities$.next([...this.allEntities]);
      }
    });
    const selectionSub = this.engineService.onObjectSelected$.subscribe(uuid => this.handleSelectionChange(uuid));
    this.subscriptions.add(transformSub);
    this.subscriptions.add(propertyUpdateSub);
    this.subscriptions.add(entitiesSub);
    this.subscriptions.add(brightnessSub);
    this.subscriptions.add(cameraModeSub);
    this.subscriptions.add(selectionSub);
  }

  private handleSelectionChange(uuid: string | null): void {
    if (uuid) {
      const foundObject = this.sceneObjects.find(o => o.id.toString() === uuid);
      if (foundObject) {
        this.selectedEntityUuid = uuid;
        this.selectedObject = { ...foundObject };
        this.editableDescription = this.selectedObject.properties?.['description'] || '';
        this.selectPropertiesTab('object');
      } else {
        this.deselectObject();
      }
    } else {
      this.selectedEntityUuid = null;
      this.selectedObject = null;
      this.editableDescription = '';
      this.selectPropertiesTab('scene');
    }
    this.selectedEntityUuid$.next(this.selectedEntityUuid);
    this.cdr.detectChanges();
  }
  
  public onDescriptionChange(): void {
    if (!this.selectedObject) return;
    const currentDescription = this.selectedObject.properties?.['description'] || '';
    if (currentDescription === this.editableDescription) return;

    this.propertyUpdate$.next({
      path: 'properties.description',
      value: this.editableDescription
    });
  }

  private handlePropertySave(update: PropertyUpdate | DescriptionUpdate): Observable<SceneObjectResponse> {
    if (!this.episodeId || !this.selectedObject) {
      return new Observable(obs => obs.error(new Error("EpisodeID or SelectedObject is null")));
    }

    let dataToUpdate: Partial<SceneObjectResponse> | { properties: any };

    if (update.path === 'properties.description') {
      const newProperties = { ...this.selectedObject.properties, description: update.value };
      dataToUpdate = { properties: newProperties };
    } else {
      dataToUpdate = { [update.path]: update.value };
    }
    
    return this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToUpdate).pipe(
      tap(updatedObj => this.updateLocalSelectedObject(updatedObj))
    );
  }

  public handleObjectUpdate(update: PropertyUpdate): void {
    if (!this.selectedObject) return;
    if (['position', 'rotation', 'scale'].includes(update.path)) {
      this.engineService.updateObjectTransform(this.selectedObject.id.toString(), update.path as any, update.value as any);
    } else if (update.path === 'name') {
      this.engineService.updateObjectName(this.selectedObject.id.toString(), update.value as string);
    }
    this.updateLocalSelectedObject({ [update.path]: update.value });
    this.propertyUpdate$.next(update);
  }

  private handleTransformEnd(): void {
    const transformedObject = this.engineService.getGizmoAttachedObject();
    if (!transformedObject || !this.selectedObject || !this.episodeId) return;
    
    const dataToSave: Partial<SceneObjectResponse> = {
      position: { x: transformedObject.position.x, y: transformedObject.position.y, z: transformedObject.position.z },
      rotation: { x: transformedObject.rotation.x, y: transformedObject.rotation.y, z: transformedObject.rotation.z },
      scale: { x: transformedObject.scale.x, y: transformedObject.scale.y, z: transformedObject.scale.z },
    };

    this.updateLocalSelectedObject(dataToSave);

    this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToSave).subscribe({
      next: updatedObj => this.updateLocalSelectedObject(updatedObj),
      error: err => console.error("[WorldView] Error al guardar tras transformación:", err)
    });
  }
  
  private processEntities(all: SceneEntity[], filter: string): EntityGroup[] {
    const term = filter.trim().toLowerCase();
    const filtered = term ? all.filter(e => e.name.toLowerCase().includes(term)) : all;
    this.totalFilteredEntityCount = filtered.length;
    
    // ✅ SOLUCIÓN AL ERROR DE TIPADO: Le decimos a TypeScript que `acc` es un objeto que tendrá claves string y valores de array de SceneEntity.
    const groups = filtered.reduce((acc: { [key: string]: SceneEntity[] }, entity) => {
        const type = entity.type || 'unknown';
        (acc[type] = acc[type] || []).push(entity);
        return acc;
    }, {});

    return Object.keys(groups).sort().map(type => {
        const groupEntities = groups[type];
        if (this.groupExpansionState.get(type) === undefined) this.groupExpansionState.set(type, false);
        if (this.groupVisibilityState.get(type) === undefined) this.groupVisibilityState.set(type, true);
        if (this.groupBrightnessState.get(type) === undefined) this.groupBrightnessState.set(type, 1.0);
        const displayCount = this.groupDisplayCountState.get(type) || this.listIncrement;
        return {
            type,
            visibleEntities: groupEntities.slice(0, displayCount),
            isExpanded: this.groupExpansionState.get(type)!,
            totalCount: groupEntities.length,
            isGroupVisible: this.groupVisibilityState.get(type)!,
            brightness: this.groupBrightnessState.get(type)!
        };
    });
  }

  loadEpisodeData(id: number): void {
    this.isLoadingData = true;
    this.adminService.getEpisodeForEditor(id).subscribe({
      next: (res) => {
        this.episodeTitle = res.episode.title;
        this.episodeThumbnailUrl = this.buildFullThumbnailUrl(res.episode.thumbnailUrl);
        this.sceneObjects = res.sceneObjects || [];
        this.isLoadingData = false;
        this.isRenderingScene = true;
        if (this.episodeThumbnailUrl) {
          const img = new Image();
          img.onload = () => { this.isThumbnailLoaded = true; this.isThumbnailAssetLoaded = true; this.cdr.detectChanges(); this.checkAndFinalizeLoading(); };
          img.onerror = () => { this.isThumbnailLoaded = true; this.isThumbnailAssetLoaded = true; this.checkAndFinalizeLoading(); };
          img.src = this.episodeThumbnailUrl;
        } else {
          this.isThumbnailAssetLoaded = true;
        }
        if (!this.sceneObjects.some(o => o.asset?.path)) { this.isSceneAssetsLoaded = true; }
        this.checkAndFinalizeLoading();
      },
      error: (err) => { this.errorMessage = "Error al cargar datos."; this.isLoadingData = false; console.error(err); }
    });
  }

  private checkAndFinalizeLoading(): void {
    if (this.isSceneAssetsLoaded && this.isThumbnailAssetLoaded) {
      this.loadingProgress = 100;
      this.cdr.detectChanges();
      setTimeout(() => {
        this.isRenderingScene = false;
        this.cdr.detectChanges();
        this.checkAndStartTour();
      }, 500);
    }
  }

  private checkAndStartTour(): void {
    if (!localStorage.getItem('hasSeenTour')) {
      setTimeout(() => {
        this.startTour();
        localStorage.setItem('hasSeenTour', 'true');
      }, 500);
    }
  }

  public handleSceneAssetsLoaded(): void { this.isSceneAssetsLoaded = true; this.checkAndFinalizeLoading(); }
  public handleLoadingProgress(progress: number): void { this.loadingProgress = Math.min(progress, 99); this.cdr.detectChanges(); }
  onMaximizeToggle(): void { if (!this.layoutState.isMaximized) { this.layoutState.isMaximized = true; } else { this.layoutState = {...this.layoutState, sceneListVisible: true, propertiesVisible: true, imageVisible: true, assetsVisible: true, performanceVisible: true, descriptionVisible: true}; setTimeout(() => { this.layoutState.isMaximized = false; this.cdr.detectChanges(); }, 10); } }
  togglePanel(panel: keyof Omit<typeof this.layoutState, 'isMaximized'>): void { this.layoutState[panel] = !this.layoutState[panel]; if (this.layoutState[panel] && this.layoutState.isMaximized) { this.layoutState.isMaximized = false; } }
  public onFocusObject(): void { if (this.selectedEntityUuid) { this.engineService.focusOnObject(this.selectedEntityUuid); } }
  openImageModal(): void { if (this.episodeThumbnailUrl) { this.isImageModalVisible = true; } }
  closeImageModal(): void { this.isImageModalVisible = false; }
  selectScene(id: number): void { if (this.activeSceneId === id) return; this.activeSceneId = id; this.sceneTabs.forEach(t => t.isActive = t.id === id); }
  addScene(): void { const newScene = { id: this.nextSceneId, name: `Escena ${this.nextSceneId}`, isActive: false }; this.sceneTabs.push(newScene); this.nextSceneId++; this.selectScene(newScene.id); }
  private buildFullThumbnailUrl(path: string | null): string | null { if (!path) return null; const endpoint = environment.endpoint.endsWith('/') ? environment.endpoint.slice(0, -1) : environment.endpoint; return `${endpoint}${path.startsWith('/') ? '' : '/'}${path}`; }
  public onEntitySelect(entity: SceneEntity): void { if (entity.uuid.startsWith('placeholder-')) { this.isAddObjectModalVisible = true; this.engineService.setActiveSelectionByUuid(null); return; } const newUuid = this.selectedEntityUuid === entity.uuid ? null : entity.uuid; this.engineService.setActiveSelectionByUuid(newUuid); }
  public deselectObject(): void { this.engineService.setActiveSelectionByUuid(null); }
  public onTravelSpeedChange(event: Event): void { const slider = event.target as HTMLInputElement; const rawValue = parseFloat(slider.value); this.cameraTravelSpeedMultiplier = rawValue; this.engineService.setTravelSpeedMultiplier(Math.pow(rawValue, 6)); }
  public onGroupBrightnessChange(group: EntityGroup, event: Event): void { const brightness = parseFloat((event.target as HTMLInputElement).value); this.groupBrightnessState.set(group.type, brightness); this.brightnessUpdate$.next({ groupType: group.type, brightness }); }
  public toggleGroupVisibility(group: EntityGroup, event: MouseEvent): void { event.stopPropagation(); const newState = !this.groupVisibilityState.get(group.type); this.groupVisibilityState.set(group.type, newState); const uuids = this.allEntities.filter(e => e.type === group.type).map(e => e.uuid); if (uuids.length > 0) this.engineService.setGroupVisibility(uuids, newState); this.allEntities$.next([...this.allEntities]); }
  public toggleGroup(group: EntityGroup): void { const newState = !group.isExpanded; this.groupExpansionState.set(group.type, newState); this.allEntities$.next([...this.allEntities]); }
  public showMoreInGroup(group: EntityGroup): void { const newCount = (this.groupDisplayCountState.get(group.type) || this.listIncrement) + this.listIncrement; this.groupDisplayCountState.set(group.type, newCount); this.allEntities$.next([...this.allEntities]); }
  onDrop(event: CdkDragDrop<SceneEntity[]>): void { moveItemInArray(event.container.data, event.previousIndex, event.currentIndex); }
  trackByGroupType(i: number, g: EntityGroup): string { return g.type; }
  public onSearchChange(term: string): void { this.groupDisplayCountState.clear(); this.searchFilter$.next(term); }
  trackByEntity(i: number, e: SceneEntity): string { return e.uuid; }
  createSceneObject(data: NewSceneObjectData): void { if (!this.episodeId) return; this.sceneObjectService.createSceneObject(this.episodeId, data).subscribe({ next: newObj => { this.closeAddObjectModal(); this.engineService.addObjectToScene(newObj); this.sceneObjects = [...this.sceneObjects, newObj]; }, error: err => console.error(err) }); }
  updateLocalSelectedObject(data: Partial<SceneObjectResponse>): void { if (!this.selectedObject) return; this.selectedObject = { ...this.selectedObject, ...data }; const index = this.sceneObjects.findIndex(o => o.id === this.selectedObject!.id); if (index !== -1) { this.sceneObjects[index] = { ...this.sceneObjects[index], ...data }; } this.cdr.detectChanges(); }
  getColorClassForEntity(entity: SceneEntity): string { return this.typeColorMap[entity.type] || this.typeColorMap['default']; }
  selectPropertiesTab(tab: string): void { this.activePropertiesTab = tab; }
  closeAddObjectModal(): void { this.isAddObjectModalVisible = false; }
  public startTour(): void { this.tourService.start(); }
  private setupTour(): void { const steps: TourStep[] = [ { step: 1, targetId: 'tour-target-viewport', title: '¡Bienvenido al Editor!', content: 'Este es el <b>Viewport 3D</b>, tu ventana al universo que estás creando.', position: 'center' }, { step: 2, targetId: 'tour-target-toolbar', title: 'Barra de Herramientas', content: 'Accede a las herramientas de <b>mover (W)</b>, <b>rotar (E)</b> y <b>escalar (R)</b>.', position: 'bottom' }, { step: 3, targetId: 'tour-target-scene-list', title: 'Panel de Objetos', content: 'Aquí se listan todos los objetos de tu escena.', position: 'right' }, { step: 4, targetId: 'tour-target-properties', title: 'Panel de Propiedades', content: 'Cuando seleccionas un objeto, sus propiedades aparecen aquí.', position: 'right' }, { step: 5, targetId: 'tour-target-description', title: 'Información del Objeto', content: 'Aquí verás los detalles y metadatos del objeto seleccionado.', position: 'top' }, { step: 6, targetId: 'tour-target-viewport', title: '¡Listo para Crear!', content: 'Explora y construye. Reinicia esta guía desde el botón <b>?</b>.', position: 'center' } ]; this.tourService.initialize(steps); }
  private setupTourElementHighlighting(): void { const sub = this.tourService.currentStep$.pipe(startWith(null), pairwise()).subscribe(([prev, curr]) => { if (prev?.targetId) { const el = document.getElementById(prev.targetId); if (el) this.renderer.removeClass(el, 'tour-active-element'); } if (curr?.targetId) { const el = document.getElementById(curr.targetId); if (el) this.renderer.addClass(el, 'tour-active-element'); } }); this.subscriptions.add(sub); }
}