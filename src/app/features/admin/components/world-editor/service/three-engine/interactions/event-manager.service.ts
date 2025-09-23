// src/app/features/admin/views/world-editor/world-view/service/three-engine/interactions/event-manager.service.ts

import { Injectable, OnDestroy } from '@angular/core';
import { fromEvent, Observable, Subject } from 'rxjs';
import { share, takeUntil } from 'rxjs/operators';
import * as THREE from 'three';

/**
 * @Injectable
 * @description
 * Gestiona y centraliza todos los eventos de entrada del DOM (ratón y teclado) para el motor 3D.
 * Proporciona Observables para que otros servicios puedan suscribirse a estos eventos
 * de forma reactiva, desacoplando la lógica de la manipulación directa del DOM.
 */
@Injectable({ providedIn: 'root' })
export class EventManagerService implements OnDestroy {

  // =============================================================================
  // --- PROPIEDADES PÚBLICAS Y OBSERVABLES (API del Servicio) ---
  // =============================================================================

  public keyDown$: Observable<KeyboardEvent>;
  public keyUp$: Observable<KeyboardEvent>;
  public canvasMouseDown$: Observable<MouseEvent>;
  public windowResize$: Observable<Event>;

  // ✨ NUEVO: Observable para el movimiento del ratón sobre el canvas.
  public canvasMouseMove$: Observable<MouseEvent>;
  
  // ✨ NUEVO: Rastreador de posición del ratón en coordenadas normalizadas.
  /**
   * Almacena las coordenadas del ratón normalizadas (-1 a +1),
   * listas para ser usadas por el Raycaster en la vista 2D.
   */
  public readonly mousePosition = new THREE.Vector2();

  public readonly keyMap = new Map<string, boolean>();

  // =============================================================================
  // --- PROPIEDADES PRIVADAS ---
  // =============================================================================

  private destroy$ = new Subject<void>();
  private canvas: HTMLCanvasElement | null = null;

  // =============================================================================
  // --- CONSTRUCTOR E INICIALIZACIÓN ---
  // =============================================================================

  constructor() {
    // Se configuran los observables globales que no dependen del canvas
    this.keyDown$ = fromEvent<KeyboardEvent>(window, 'keydown').pipe(takeUntil(this.destroy$), share());
    this.keyUp$ = fromEvent<KeyboardEvent>(window, 'keyup').pipe(takeUntil(this.destroy$), share());
    this.windowResize$ = fromEvent(window, 'resize').pipe(takeUntil(this.destroy$), share());
    
    // Se inicializan los observables dependientes del canvas como Subjects
    // que se conectarán en el método `init`.
    this.canvasMouseDown$ = new Subject<MouseEvent>().asObservable();
    this.canvasMouseMove$ = new Subject<MouseEvent>().asObservable();

    this.subscribeToKeyEvents();
  }

  /**
   * Inicializa el servicio con el elemento canvas para escuchar eventos específicos de él.
   * @param canvas El elemento canvas del editor.
   */
  public init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    // Conecta los Subjects a los eventos reales del DOM ahora que tenemos el canvas.
    this.canvasMouseDown$ = fromEvent<MouseEvent>(this.canvas, 'mousedown').pipe(takeUntil(this.destroy$), share());
    this.canvasMouseMove$ = fromEvent<MouseEvent>(this.canvas, 'mousemove').pipe(takeUntil(this.destroy$), share());
    
    // ✨ Se activa el rastreo de la posición del ratón.
    this.subscribeToMouseEvents();
  }

  private subscribeToKeyEvents(): void {
    this.keyDown$.subscribe(event => this.keyMap.set(event.key.toLowerCase(), true));
    this.keyUp$.subscribe(event => this.keyMap.set(event.key.toLowerCase(), false));
  }

  // ✨ NUEVO: Método para suscribirse a los eventos del ratón.
  private subscribeToMouseEvents(): void {
    this.canvasMouseMove$.subscribe(event => {
      if (!this.canvas) return;
      
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      this.mousePosition.x = (x / rect.width) * 2 - 1;
      this.mousePosition.y = -(y / rect.height) * 2 + 1;
    });
  }

  // =============================================================================
  // --- LIMPIEZA ---
  // =============================================================================

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.keyMap.clear();
  }
}