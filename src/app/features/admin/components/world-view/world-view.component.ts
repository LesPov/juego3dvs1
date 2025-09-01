import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subject, Subscription, BehaviorSubject, combineLatest } from 'rxjs';
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
  public isFlyModeActive$: Observable<boolean>;

  public displayEntities$: Observable<SceneEntity[]>;
  public placeholderEntities: SceneEntity[] = [{ uuid: 'placeholder-1', name: 'Añadir objeto nuevo...', type: 'Model' }];
  private analysisSummary: any = null;

  // --- Propiedades para paginación de la lista ---
  public totalEntityCount = 0;
  public displayedEntityCount = 0;
  private readonly listIncrement = 50;
  private displayCount$ = new BehaviorSubject<number>(this.listIncrement);

  // =======================================================
  // === INICIO DE LA MEJORA: Lógica para el Buscador   ====
  // =======================================================
  public searchFilter: string = ''; // Vinculado al input del HTML con ngModel
  public totalFilteredEntityCount = 0; // Total de objetos después de aplicar el filtro
  private searchFilter$ = new BehaviorSubject<string>('');
  // =======================================================
  // === FIN DE LA MEJORA                               ====
  // =======================================================

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

    // --- Lógica reactiva para filtrar, y luego paginar la lista ---
    this.displayEntities$ = combineLatest([
      this.allEntities$,
      this.displayCount$,
      this.searchFilter$.pipe(debounceTime(200), startWith('')) // Añadimos el filtro de búsqueda
    ]).pipe(
      map(([allEntities, count, filter]) => {
        // 1. Filtra las entidades basado en el término de búsqueda
        const searchTerm = filter.trim().toLowerCase();
        const filteredEntities = searchTerm
          ? allEntities.filter(e => e.name.toLowerCase().includes(searchTerm))
          : allEntities;

        // 2. Actualiza los contadores para la UI
        this.totalEntityCount = allEntities.length;
        this.totalFilteredEntityCount = filteredEntities.length;

        // 3. Pagina la lista ya filtrada
        const slicedEntities = filteredEntities.slice(0, count);
        this.displayedEntityCount = slicedEntities.length;
        
        // 4. Devuelve la porción de entidades que se debe renderizar
        return slicedEntities;
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

        if (this.analysisSummary?.scene_dimensions) {
          this.engineService.frameScene(
            this.analysisSummary.scene_dimensions.width,
            this.analysisSummary.scene_dimensions.height
          );
        }

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

    const entitiesSub = this.engineService.getSceneEntities().subscribe(entities => {
      this.allEntities = entities;
      this.allEntities$.next(entities);
      // Cuando la lista de entidades cambia, si hay un filtro de búsqueda, se re-aplicará automáticamente
      // gracias a combineLatest. Reseteamos la paginación para empezar desde el principio.
      if (this.displayCount$.getValue() > this.listIncrement) {
          this.displayCount$.next(this.listIncrement);
      }
    });

    this.subscriptions.add(transformSub);
    this.subscriptions.add(propertyUpdateSub);
    this.subscriptions.add(entitiesSub);
  }
  
  private handlePropertyUpdate(update: PropertyUpdate): Observable<SceneObjectResponse> {
    if (!this.episodeId || !this.selectedObject) {
        return new Observable(obs => { obs.error(new Error("EpisodeID or SelectedObject is null")); });
    }
    const dataToUpdate: Partial<SceneObjectResponse> = { [update.path]: update.value };
    return this.sceneObjectService.updateSceneObject(this.episodeId, this.selectedObject.id, dataToUpdate).pipe(
        tap(updatedObj => this.updateLocalSelectedObject(updatedObj))
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

  onDrop(event: CdkDragDrop<SceneEntity[]>): void {
    // Nota: El Drag & Drop puede tener un comportamiento inesperado si la lista está filtrada.
    // Una implementación más robusta requeriría mapear los índices del array filtrado a los del array original.
    // Por ahora, se mantiene la funcionalidad simple.
    moveItemInArray(this.allEntities, event.previousIndex, event.currentIndex);
    this.allEntities$.next([...this.allEntities]);
  }
  
  public showMoreEntities(): void {
    const newCount = this.displayCount$.getValue() + this.listIncrement;
    this.displayCount$.next(newCount);
  }

  // =======================================================
  // === INICIO DE LA MEJORA: Método para el Buscador   ====
  // =======================================================
  public onSearchChange(term: string): void {
    // Cada vez que el usuario escribe, actualizamos el `BehaviorSubject`.
    // La lógica de RxJS se encargará del resto.
    // También reseteamos la paginación para ver los resultados desde el principio.
    this.searchFilter$.next(term);
    this.displayCount$.next(this.listIncrement);
  }
  // =======================================================
  // === FIN DE LA MEJORA                               ====
  // =======================================================

  trackByEntity(index: number, entity: SceneEntity): string { return entity.uuid; }
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