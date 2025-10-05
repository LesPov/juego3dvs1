// src/app/admin/pages/world-editor/world-view.component.ts

import { Component, OnInit, OnDestroy, ChangeDetectorRef, Renderer2 } from '@angular/core'; // ✨ Renderer2 AÑADIDO
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subject, Subscription, BehaviorSubject, combineLatest } from 'rxjs';
import { switchMap, tap, debounceTime, map, startWith, pairwise } from 'rxjs/operators'; // ✨ pairwise AÑADIDO
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { environment } from '../../../../../environments/environment';
import { SceneObjectResponse, AdminService } from '../../services/admin.service';
import { SceneObjectService } from '../../services/scene-object.service';
import { AddObjectModalComponent, NewSceneObjectData } from '../world-editor/add-object-modal/add-object-modal.component';
import { BrujulaComponent } from '../world-editor/brujula/brujula.component';
import { PropertiesPanelComponent, PropertyUpdate } from '../world-editor/properties-panel/properties-panel.component';
import { SceneSettingsPanelComponent } from '../world-editor/scene-settings-panel/scene-settings-panel.component';
import { SceneComponent } from '../world-editor/scene/scene.component';
import { SceneEntity } from '../world-editor/service/three-engine/managers/entity-manager.service';
import { ToolbarComponent } from '../world-editor/toolbar/toolbar.component';
import { EngineService } from '../world-editor/service/three-engine/core/engine.service';
import { TourGuideComponent } from '../world-editor/tour-guide/tour-guide.component';
import { TourService, TourStep } from '../../services/tour.service';

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
  private propertyUpdate$ = new Subject<PropertyUpdate>();
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
    private renderer: Renderer2 // ✨ Renderer2 INYECTADO
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
            const singleGroup: EntityGroup = {
              type: selectedEntity.type,
              visibleEntities: [selectedEntity],
              isExpanded: true,
              totalCount: 1,
              isGroupVisible: true,
              brightness: this.groupBrightnessState.get(selectedEntity.type) || 1.0,
            };
            this.totalFilteredEntityCount = 1;
            return [singleGroup];
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
    this.setupTourElementHighlighting(); // ✨ NUEVA LLAMADA
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.brightnessUpdate$.complete();
  }

  // ✨ --- LÓGICA DEL TOUR --- ✨
  public startTour(): void {
    this.tourService.start();
  }

  private setupTour(): void {
    const tourSteps: TourStep[] = [
      { step: 1, targetId: 'tour-target-viewport', title: '¡Bienvenido al Editor de Mundos!', content: '<p>Este es el <b>Viewport 3D</b>, tu ventana principal al universo que estás creando. Aquí puedes navegar, seleccionar y manipular todos los objetos de tu escena.</p>', position: 'center' },
      { step: 2, targetId: 'tour-target-toolbar', title: 'Barra de Herramientas Principal', content: '<p>Accede a las herramientas de <b>mover (W)</b>, <b>rotar (E)</b> y <b>escalar (R)</b>. También puedes cambiar el modo de cámara y maximizar el viewport.</p>', position: 'bottom' },
      { step: 3, targetId: 'tour-target-scene-list', title: 'Panel de Objetos', content: '<p>Aquí se listan todos los objetos de tu escena, agrupados por tipo. Puedes buscar, seleccionar, ocultar o cambiar el brillo de grupos enteros.</p>', position: 'right', action: () => { this.layoutState.sceneListVisible = true; this.cdr.detectChanges(); } },
      { step: 4, targetId: 'tour-target-properties', title: 'Panel de Propiedades', content: '<p>Cuando seleccionas un objeto, sus propiedades de transformación y ajustes aparecen aquí. ¡Pruébalo seleccionando un objeto de la lista!</p>', position: 'right', action: () => { this.layoutState.propertiesVisible = true; this.cdr.detectChanges(); } },
      { step: 5, targetId: 'tour-target-image', title: 'Imagen del Episodio', content: '<p>Este panel muestra la miniatura principal de tu episodio. Haz clic en ella para verla en tamaño completo.</p>', position: 'left', action: () => { this.layoutState.imageVisible = true; this.layoutState.assetsVisible = true; this.layoutState.performanceVisible = true; this.layoutState.descriptionVisible = true; this.cdr.detectChanges(); } },
      { step: 6, targetId: 'tour-target-assets', title: 'Panel de Assets', content: '<p>Aquí encontrarás la biblioteca de modelos 3D, texturas y sonidos disponibles para añadir a tu escena.</p>', position: 'left' },
      { step: 7, targetId: 'tour-target-performance', title: 'Monitor de Rendimiento', content: '<p>Este panel muestra información técnica en tiempo real, como los fotogramas por segundo (FPS), para ayudarte a optimizar tu escena.</p>', position: 'left' },
      { step: 8, targetId: 'tour-target-description', title: 'Descripción del Objeto', content: '<p>Cuando tienes un objeto seleccionado, puedes añadir notas o descripciones aquí. Es útil para recordar detalles importantes o para colaborar con otros.</p>', position: 'top', action: () => { this.layoutState.descriptionVisible = true; this.cdr.detectChanges(); } },
      { step: 9, targetId: 'tour-target-viewport', title: '¡Listo para Crear!', content: '<p>Ya conoces las secciones principales. Explora, experimenta y construye mundos increíbles. Puedes reiniciar esta guía cuando quieras desde el botón <b>?</b> en la cabecera.</p>', position: 'center' }
    ];
    this.tourService.initialize(tourSteps);
  }
  
  // ====================================================================
  // === ✨ NUEVA LÓGICA PARA RESALTAR EL ELEMENTO ACTIVO DEL TOUR ✨ ===
  // ====================================================================
  private setupTourElementHighlighting(): void {
    const tourStepSub = this.tourService.currentStep$
      .pipe(startWith(null), pairwise()) // pairwise nos da el paso [anterior, actual]
      .subscribe(([prevStep, currentStep]) => {
        // Quitar la clase del elemento anterior
        if (prevStep && prevStep.targetId) {
          const prevElement = document.getElementById(prevStep.targetId);
          if (prevElement) {
            this.renderer.removeClass(prevElement, 'tour-active-element');
          }
        }
        // Añadir la clase al elemento actual
        if (currentStep && currentStep.targetId) {
          const currentElement = document.getElementById(currentStep.targetId);
          if (currentElement) {
            this.renderer.addClass(currentElement, 'tour-active-element');
          }
        }
      });
  
    // Asegurarnos de limpiar la clase cuando el tour se detiene
    const tourStatusSub = this.tourService.isTourActive$.subscribe(isActive => {
      if (!isActive) {
        const activeElement = document.querySelector('.tour-active-element');
        if (activeElement) {
          this.renderer.removeClass(activeElement, 'tour-active-element');
        }
      }
    });
  
    this.subscriptions.add(tourStepSub);
    this.subscriptions.add(tourStatusSub);
  }

  loadEpisodeData(id: number): void {
    this.isLoadingData = true;
    this.adminService.getEpisodeForEditor(id).subscribe({
      next: (response) => {
        this.episodeTitle = response.episode.title;
        this.episodeThumbnailUrl = this.buildFullThumbnailUrl(response.episode.thumbnailUrl);
        this.sceneObjects = response.sceneObjects || [];
        this.isLoadingData = false;
        this.isRenderingScene = true;
        
        const hasThumbnailToLoad = !!this.episodeThumbnailUrl;
        if (hasThumbnailToLoad) {
          this.isThumbnailAssetLoaded = false;
          const img = new Image();
          img.onload = () => { this.isThumbnailLoaded = true; this.isThumbnailAssetLoaded = true; this.cdr.detectChanges(); this.checkAndFinalizeLoading(); };
          img.onerror = () => { this.isThumbnailLoaded = true; this.isThumbnailAssetLoaded = true; this.checkAndFinalizeLoading(); };
          img.src = this.episodeThumbnailUrl!;
        } else {
          this.isThumbnailAssetLoaded = true;
        }

        const hasSceneAssetsToLoad = this.sceneObjects.some(o => o.asset?.path);
        if (!hasSceneAssetsToLoad) { this.isSceneAssetsLoaded = true; }
        
        this.checkAndFinalizeLoading();
      },
      error: (err) => { this.errorMessage = "Error al cargar los datos del episodio."; this.isLoadingData = false; console.error(err); }
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
    const hasSeenTour = localStorage.getItem('hasSeenTour');
    if (!hasSeenTour) {
      setTimeout(() => {
        this.startTour();
        localStorage.setItem('hasSeenTour', 'true');
      }, 500);
    }
  }

  public handleSceneAssetsLoaded(): void { this.isSceneAssetsLoaded = true; this.checkAndFinalizeLoading(); }
  public handleLoadingProgress(progress: number): void { this.loadingProgress = Math.min(progress, 99); this.cdr.detectChanges(); }

  onMaximizeToggle(): void {
    const goingToMaximized = !this.layoutState.isMaximized;
    if (goingToMaximized) {
      this.layoutState.isMaximized = true;
    } else {
      this.layoutState.sceneListVisible = true; this.layoutState.propertiesVisible = true;
      this.layoutState.imageVisible = true; this.layoutState.assetsVisible = true;
      this.layoutState.performanceVisible = true; this.layoutState.descriptionVisible = true;
      setTimeout(() => { this.layoutState.isMaximized = false; this.cdr.detectChanges(); }, 10);
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

  public onFocusObject(): void { if (this.selectedEntityUuid) { this.engineService.focusOnObject(this.selectedEntityUuid); } }
  openImageModal(): void { if (this.episodeThumbnailUrl) { this.isImageModalVisible = true; } }
  closeImageModal(): void { this.isImageModalVisible = false; }
  selectScene(sceneId: number): void { if (this.activeSceneId === sceneId) return; this.activeSceneId = sceneId; this.sceneTabs.forEach(tab => tab.isActive = tab.id === sceneId); }
  addScene(): void { const newScene: SceneTab = { id: this.nextSceneId, name: `Escena ${this.nextSceneId}`, isActive: false }; this.sceneTabs.push(newScene); this.nextSceneId++; this.selectScene(newScene.id); }
  private buildFullThumbnailUrl(relativePath: string | null): string | null { if (!relativePath) return null; const cleanEndpoint = environment.endpoint.endsWith('/') ? environment.endpoint.slice(0, -1) : environment.endpoint; const cleanThumbnailPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath; return `${cleanEndpoint}/${cleanThumbnailPath}`; }

  private setupSubscriptions(): void {
    const transformSub = this.engineService.onTransformEnd$.subscribe(() => this.handleTransformEnd());
    const propertyUpdateSub = this.propertyUpdate$.pipe(debounceTime(500), switchMap(update => this.handlePropertySave(update))).subscribe({ error: err => console.error("[WorldView] Error al guardar propiedad:", err) });
    const entitiesSub = this.engineService.getSceneEntities().pipe(map(engineEntities => { const sceneObjectMap = new Map<string, SceneObjectResponse>(); this.sceneObjects.forEach(obj => sceneObjectMap.set(obj.id.toString(), obj)); return engineEntities.map(entity => { const originalObject = sceneObjectMap.get(entity.uuid); return { ...entity, type: originalObject ? originalObject.type : entity.type }; }); })).subscribe((correctedEntities: SceneEntity[]) => { this.allEntities = correctedEntities; this.allEntities$.next(correctedEntities); });
    const brightnessSub = this.brightnessUpdate$.pipe(debounceTime(150)).subscribe(({ groupType, brightness }) => { const entityUuidsInGroup = this.allEntities.filter(entity => entity.type === groupType).map(entity => entity.uuid); if (entityUuidsInGroup.length > 0) this.engineService.setGroupBrightness(entityUuidsInGroup, brightness); });
    const cameraModeSub = this.engineService.cameraMode$.subscribe(mode => { if (mode === 'perspective') { let stateChanged = false; for (const key of this.groupBrightnessState.keys()) { if (this.groupBrightnessState.get(key) !== 1.0) { this.groupBrightnessState.set(key, 1.0); stateChanged = true; } } if (stateChanged) this.allEntities$.next([...this.allEntities]); } });
    const selectionSub = this.engineService.onObjectSelected$.subscribe(uuid => { this.handleSelectionChange(uuid); });
    this.subscriptions.add(transformSub); this.subscriptions.add(propertyUpdateSub); this.subscriptions.add(entitiesSub); this.subscriptions.add(brightnessSub); this.subscriptions.add(cameraModeSub); this.subscriptions.add(selectionSub);
  }

  private handleSelectionChange(uuid: string | null): void {
    if (uuid) {
      let foundObject: SceneObjectResponse | undefined | null = this.sceneObjects.find(o => o.id.toString() === uuid);

      if (!foundObject) {
        const entity = this.allEntities.find(e => e.uuid === uuid);
        const liveObject = this.engineService.getGizmoAttachedObject();

        if (entity && liveObject && liveObject.uuid === uuid) {
          const objectType = (entity.type === 'Model' ? 'model' : entity.type) as SceneObjectType;
          foundObject = {
            id: parseInt(uuid, 10) || 0,
            name: entity.name,
            type: objectType,
            episodeId: this.episodeId || 0,
            asset: null,
            assetId: null,
            status: 'active',
            properties: {},
            position: { x: liveObject.position.x, y: liveObject.position.y, z: liveObject.position.z },
            rotation: { x: liveObject.rotation.x, y: liveObject.rotation.y, z: liveObject.rotation.z },
            scale: { x: liveObject.scale.x, y: liveObject.scale.y, z: liveObject.scale.z },
          };
        }
      }

      if (foundObject) {
        this.selectedEntityUuid = uuid;
        this.selectedObject = { ...foundObject };
        this.selectPropertiesTab('object');
      } else {
        this.deselectObject();
      }
    } else {
      this.selectedEntityUuid = null;
      this.selectedObject = null;
      this.selectPropertiesTab('scene');
    }
    this.selectedEntityUuid$.next(this.selectedEntityUuid);
    this.cdr.detectChanges();
  }

  public onEntitySelect(entity: SceneEntity): void {
    if (entity.uuid.startsWith('placeholder-')) {
      this.isAddObjectModalVisible = true; this.engineService.setActiveSelectionByUuid(null); return;
    }
    const newUuid = this.selectedEntityUuid === entity.uuid ? null : entity.uuid;
    this.engineService.setActiveSelectionByUuid(newUuid);
  }

  public deselectObject(): void { this.engineService.setActiveSelectionByUuid(null); }

  public onTravelSpeedChange(event: Event): void {
    const slider = event.target as HTMLInputElement;
    const rawValue = parseFloat(slider.value);
    this.cameraTravelSpeedMultiplier = rawValue;
    this.engineService.setTravelSpeedMultiplier(Math.pow(rawValue, 2));
  }

  public onGroupBrightnessChange(group: EntityGroup, event: Event): void { const slider = event.target as HTMLInputElement; const brightness = parseFloat(slider.value); this.groupBrightnessState.set(group.type, brightness); this.brightnessUpdate$.next({ groupType: group.type, brightness }); }
  public toggleGroupVisibility(group: EntityGroup, event: MouseEvent): void { event.stopPropagation(); const newState = !(this.groupVisibilityState.get(group.type) ?? true); this.groupVisibilityState.set(group.type, newState); const entityUuidsInGroup = this.allEntities.filter(entity => entity.type === group.type).map(entity => entity.uuid); if (entityUuidsInGroup.length > 0) this.engineService.setGroupVisibility(entityUuidsInGroup, newState); this.allEntities$.next([...this.allEntities]); }
  public toggleGroup(group: EntityGroup): void { const newState = !group.isExpanded; this.groupExpansionState.set(group.type, newState); this.allEntities$.next([...this.allEntities]); }
  public showMoreInGroup(group: EntityGroup): void { const newCount = (this.groupDisplayCountState.get(group.type) || this.listIncrement) + this.listIncrement; this.groupDisplayCountState.set(group.type, newCount); this.allEntities$.next([...this.allEntities]); }
  onDrop(event: CdkDragDrop<SceneEntity[]>): void { moveItemInArray(event.container.data, event.previousIndex, event.currentIndex); }
  trackByGroupType(index: number, group: EntityGroup): string { return group.type; }
  public onSearchChange(term: string): void { this.groupDisplayCountState.clear(); this.searchFilter$.next(term); }
  trackByEntity(index: number, entity: SceneEntity): string { return entity.uuid; }
  handleObjectUpdate(update: PropertyUpdate): void { if (!this.selectedObject) return; if (['position', 'rotation', 'scale'].includes(update.path)) { this.engineService.updateObjectTransform(this.selectedObject.id.toString(), update.path as any, update.value as any); } else if (update.path === 'name') { this.engineService.updateObjectName(this.selectedObject.id.toString(), update.value as string); } this.updateLocalSelectedObject({ [update.path]: update.value }); this.propertyUpdate$.next(update); }
  private handlePropertySave(update: PropertyUpdate): Observable<SceneObjectResponse> { if (!this.episodeId || !this.selectedObject) return new Observable(obs => obs.error(new Error("EpisodeID or SelectedObject is null"))); const dataToUpdate: Partial<SceneObjectResponse> = { [update.path]: update.value }; return this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToUpdate).pipe(tap(updatedObj => { this.updateLocalSelectedObject(updatedObj); })); }

  private handleTransformEnd(): void {
    const transformedObject = this.engineService.getGizmoAttachedObject();
    if (!transformedObject || !this.selectedObject || !this.episodeId) return;
    const currentTool = this.engineService.getCurrentToolMode();
    const dataToSave: Partial<SceneObjectResponse> = {};
    let hasChanges = false;
    switch (currentTool) {
      case 'move': const newPosition = { x: transformedObject.position.x, y: transformedObject.position.y, z: transformedObject.position.z }; this.updateLocalSelectedObject({ position: newPosition }); dataToSave.position = newPosition; hasChanges = true; break;
      case 'rotate': const newRotation = { x: transformedObject.rotation.x, y: transformedObject.rotation.y, z: transformedObject.rotation.z }; this.updateLocalSelectedObject({ rotation: newRotation }); dataToSave.rotation = newRotation; hasChanges = true; break;
      case 'scale': const newScale = { x: transformedObject.scale.x, y: transformedObject.scale.y, z: transformedObject.scale.z }; this.updateLocalSelectedObject({ scale: newScale }); dataToSave.scale = newScale; hasChanges = true; break;
    }
    if (hasChanges) {
      this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToSave).subscribe({
        next: updatedObj => this.updateLocalSelectedObject(updatedObj),
        error: err => console.error("[WorldView] Error al guardar tras transformación:", err)
      });
    }
  }

  createSceneObject(data: NewSceneObjectData): void { if (!this.episodeId) return; this.sceneObjectService.createSceneObject(this.episodeId, data).subscribe({ next: newObj => { this.closeAddObjectModal(); this.engineService.addObjectToScene(newObj); this.sceneObjects = [...this.sceneObjects, newObj]; }, error: err => console.error(err) }); }
  updateLocalSelectedObject(updatedData: Partial<SceneObjectResponse>): void { if (!this.selectedObject) return; this.selectedObject = { ...this.selectedObject, ...updatedData }; const index = this.sceneObjects.findIndex(o => o.id === this.selectedObject!.id); if (index !== -1) { this.sceneObjects[index] = { ...this.sceneObjects[index], ...updatedData }; } this.cdr.detectChanges(); }
  getColorClassForEntity(entity: SceneEntity): string { return this.typeColorMap[entity.type] || this.typeColorMap['default']; }
  selectPropertiesTab(tab: string): void { this.activePropertiesTab = tab; }
  closeAddObjectModal(): void { this.isAddObjectModalVisible = false; }
}