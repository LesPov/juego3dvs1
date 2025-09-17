import { Injectable, OnDestroy } from '@angular/core';
import { fromEvent, Observable, Subject } from 'rxjs';
import { map, share, takeUntil } from 'rxjs/operators';

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
    this.keyDown$ = fromEvent<KeyboardEvent>(window, 'keydown').pipe(
      takeUntil(this.destroy$),
      share()
    );

    this.keyUp$ = fromEvent<KeyboardEvent>(window, 'keyup').pipe(
      takeUntil(this.destroy$),
      share()
    );

    this.windowResize$ = fromEvent(window, 'resize').pipe(
      takeUntil(this.destroy$),
      share()
    );
    
    // Este observable se inicializa aquí pero se conecta en 'init'
    this.canvasMouseDown$ = new Subject<MouseEvent>().asObservable();

    this.subscribeToKeyEvents();
  }

  /**
   * Inicializa el servicio con el elemento canvas para escuchar eventos específicos de él.
   * @param canvas El elemento canvas del editor.
   */
  public init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.canvasMouseDown$ = fromEvent<MouseEvent>(this.canvas, 'mousedown').pipe(
      takeUntil(this.destroy$),
      share()
    );
  }

  /**
   * Se suscribe internamente a los eventos de teclado para mantener el estado de `keyMap`.
   */
  private subscribeToKeyEvents(): void {
    this.keyDown$.subscribe(event => {
      this.keyMap.set(event.key.toLowerCase(), true);
    });

    this.keyUp$.subscribe(event => {
      this.keyMap.set(event.key.toLowerCase(), false);
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